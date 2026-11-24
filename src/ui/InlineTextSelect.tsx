import { Text, View, type InputRef } from "nsh";
import { Input } from "nsh/base";
import type { TextBlock } from "../discuz/parse";
import { palette } from "./appearance";
import { displaySettings } from "./settings";

/** The blue Android draws its own text selection in (Pixel's accent, `#4285F4`). */
const SELECTION_BLUE = "#4285F4";

/** A first post's headings, as the rich body draws them (`OP_TITLE_STYLES` in Thread.tsx). */
export const HEADING_SIZE = 16;
export const HEADING_WEIGHT = 500;

// The rich body's own measure (`crates/nsh-base/src/text_view/view.rs`): every block sits in a
// column whose gap is `BODY_SIZE * 0.75`, and a heading's room above it is its own size times a
// factor — `0.6` after another heading, and `1.1` / `1.6` / `1.4` after a block — minus that gap.
// The two are one margin here: what a heading asks for, never less than the column's gap.
const BODY_SIZE = 15;
const BLOCK_GAP = BODY_SIZE * 0.75;
const HEADINGS = {
  1: { size: 27, line: 1.25, tracking: -0.02, above: 1.1 },
  2: { size: 20, line: 1.35, tracking: -0.012, above: 1.6 },
  3: { size: 17, line: 1.35, tracking: -0.012, above: 1.4 },
} as const;
/** A quote's bar and the room between it and the text (`border_l(2)` and `ps(BODY_SIZE * 0.9)`). */
const QUOTE_BAR = 2;
const QUOTE_INDENT = BODY_SIZE * 0.9;
/** A quoted passage is drawn in the text's color at four fifths of it. */
const QUOTE_OPACITY = 0.8;

/** `#rrggbb` at an opacity, as a color a style takes. */
function faint(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

/** One block as the screen draws it: its own type, and the room the page puts above it. */
export type Run = {
  block: TextBlock;
  size: number;
  weight: number;
  /** The page's line height for this block, which the field is given (`setLineSpacing`). */
  line: number;
  /** The page's letter spacing for this block (a heading's is negative). */
  tracking: number;
  /** The room above it, in the page's own terms (0 for a group's first block). */
  gap: number;
};

/**
 * How a selection screen closes: `clear` drops the platform's selection and gives the field's
 * focus up, and `done` — which takes the field away — runs a moment later, so the platform has
 * finished with its own selection UI (the handles, and the floating Copy / Select All toolbar)
 * before the field it belongs to is gone.
 *
 * The order matters on Android. A text selection's toolbar is a window of its own, tied to the
 * field that started it: a field unmounted while the toolbar is still up can leave it detached
 * from anything, on top of the window, where it takes every touch that comes after — the whole
 * page stops answering. Both steps are also put off the gesture's own dispatch, because a copy
 * ends the action mode from inside a touch on that toolbar.
 *
 * Calling it twice does nothing the second time: the state change it starts is already under way.
 */
export function createFinish(clear: () => void, done: () => void, delayMs = 100) {
  let closed = false;
  return function finish(): void {
    if (closed) return;
    closed = true;
    setTimeout(() => {
      try {
        clear();
      } catch {
        // The field can already be gone (a second close): nothing left to clear.
      }
      setTimeout(done, delayMs);
    }, 0);
  };
}

/**
 * Reads the platform's selection reports and calls `onEnd` when a selection ends.
 *
 * A copy is what ends one in the platform's own code: the toolbar's Copy puts the text on the
 * clipboard and calls `stopTextActionMode()`, and TextView then collapses the selection to a
 * caret (`Selection.setSelection(…, getSelectionEnd())`) — reported here as `start === end`. A
 * press on the text that collapses the selection reports the same thing, and so does a tap that
 * puts the caret somewhere else, which is the same "done with the selection" the user means.
 *
 * The empty report a field gives while nothing is selected yet (on opening, on a caret) must not
 * end anything: only an empty report after a non-empty one is an end.
 */
export function createSelectionEnd(onEnd: () => void) {
  let selected = false;
  return function report(start: number, end: number): void {
    if (start !== end) {
      selected = true;
      return;
    }
    if (!selected) return;
    selected = false;
    onEnd();
  };
}

/** The blocks as runs: the body's own type, a heading's own, and the page's gap between them. */
export function toRuns(blocks: TextBlock[], body: number, bodyLine: number): Run[] {
  const runs: Run[] = [];
  let previous: TextBlock | null = null;
  for (const block of blocks) {
    const h = block.heading ? HEADINGS[block.heading] : null;
    const above = h
      ? Math.max(h.size * (previous?.heading ? 0.6 : h.above), BLOCK_GAP)
      : BLOCK_GAP;
    runs.push({
      block,
      size: h ? HEADING_SIZE : body,
      weight: h ? HEADING_WEIGHT : 400,
      line: h ? h.size * h.line : bodyLine,
      tracking: h ? h.size * h.tracking : 0,
      gap: previous ? above : 0,
    });
    previous = block;
  }
  // A group's first run starts at the group's own margin, not its block gap.
  if (runs.length > 0) runs[0].gap = 0;
  return runs;
}

/** What a selection screen lets the page around it do: close it, as a copy does. */
export type InlineTextSelectApi = { finish: () => void };

/**
 * A floor's text as read-only native inputs, in the floor's own place: a long press on a post
 * swaps its rich body for these, so the platform's own selection is the one at work — a long press
 * picks a word, and the two handles then move the ends character by character, with the system's
 * Copy / Select All menu. `readonly` keeps `EditText.setTextIsSelectable` on Android, which is the
 * character-precise selection `nsh/base`'s text view does not offer there.
 *
 * Tapping Copy ends it, with nothing of the app's in the way: the selection collapses in the
 * platform's code and that report is what puts the rich body back. A press outside the text, or
 * Back, closes it through the same path.
 *
 * A field carries one size, one weight and one leading, while the page gives its paragraphs,
 * headings and quotes each their own: so every block is a field, kept in the page's own geometry
 * — the same type, the same leading handed to the platform (`setLineSpacing`, which a field's
 * style cannot ask for), the same gap above, and a quote's bar and indent around it. The invisible
 * copy in the layout's flow is the height and the wrapping column, so the floor does not move and
 * the lines break where they did; the field over it is what the platform lays out.
 */
export function InlineTextSelect(props: {
  blocks: TextBlock[];
  onDone?: () => void;
  /** Handed to the page around it, so a press elsewhere closes the selection the way a copy does. */
  onApi?: (api: InlineTextSelectApi) => void;
}) {
  const body = displaySettings().body;
  // The body's own leading: the rich body sets the line height on its root, which a heading
  // inherits for its size (the field is given this block's leading, not the body's).
  const bodyLine = Math.round(body * displaySettings().spacing);
  const fields: (InputRef | null)[] = [];
  const finish = createFinish(
    () => {
      for (const field of fields) {
        try {
          field?.setSelection(0, 0);
          field?.blur();
        } catch {
          // Already gone: nothing of this field is left to clear.
        }
      }
    },
    () => props.onDone?.(),
  );
  props.onApi?.({ finish });
  const selectionEnded = createSelectionEnd(finish);
  // A floor with nothing to select still keeps one empty run, so the swap never leaves the list
  // with a hole where the post was.
  const blocks = props.blocks.length > 0 ? props.blocks : [{ text: "", heading: 0 as const, quote: false }];
  const runs = toRuns(blocks, body, bodyLine);
  // Quotes sit under one bar: the runs of one quote are a group of their own, so the bar runs on
  // past the gaps between them instead of breaking at each.
  const groups: { quote: boolean; gap: number; runs: Run[] }[] = [];
  for (const run of runs) {
    const last = groups[groups.length - 1];
    if (last && last.quote === run.block.quote) last.runs.push(run);
    else groups.push({ quote: run.block.quote, gap: run.gap, runs: [run] });
  }
  let index = 0;
  return (
    <View testID="inline-select-block" style={{ alignSelf: "stretch", minHeight: bodyLine }}>
      {groups.map((group) => (
        <View
          style={{
            alignSelf: "stretch",
            marginTop: group.gap,
            ...(group.quote
              ? {
                  borderLeftWidth: QUOTE_BAR,
                  borderLeftColor: palette().border,
                  paddingLeft: QUOTE_INDENT,
                }
              : {}),
          }}
        >
          {group.runs.map((run, at) => {
            const fieldIndex = index++;
            const color = run.block.quote ? faint(palette().text, QUOTE_OPACITY) : palette().text;
            return (
              // A group's first run starts at the group's own margin: its gap is already there.
              <View style={{ alignSelf: "stretch", marginTop: at === 0 ? 0 : run.gap }}>
                {/* The page's own text, invisible: it is the height and the wrapping column the
                    floor had, so the floor does not move when its rich body gives way to the
                    field, and the field breaks its lines where the page did. */}
                <Text
                  style={{
                    fontSize: run.size,
                    lineHeight: run.line,
                    fontWeight: run.weight,
                    letterSpacing: run.tracking,
                    opacity: 0,
                  }}
                >
                  {run.block.text}
                </Text>
                <Input
                  testID={fieldIndex === 0 ? "inline-select-body" : `inline-select-body-${fieldIndex}`}
                  ref={(n: InputRef | null) => {
                    fields[fieldIndex] = n;
                  }}
                  multiline={true}
                  readonly={true}
                  value={run.block.text}
                  scrollbar={false}
                  onSelectionChange={(e: { start: number; end: number }) => selectionEnded(e.start, e.end)}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    fontSize: run.size,
                    fontWeight: run.weight,
                    letterSpacing: run.tracking,
                    // The page's leading, handed to the field: the runtime lays it on the lines
                    // (`setLineSpacing`), which a field cannot ask for in a style of its own.
                    lineHeight: run.line,
                    color,
                    backgroundColor: "transparent",
                    paddingHorizontal: 0,
                    paddingVertical: 0,
                    selectionColor: SELECTION_BLUE,
                  }}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
