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
 * A field carries one size and one weight, while a first post's headings are set differently from
 * its body: each run the page styles separately is a field of its own, kept flush against the next
 * (a `</h1>` is a line break, so nothing may go between them). The floor then reads exactly as it
 * did, line for line, and each field's own leading is fitted to the app's (`fitLines` in the
 * runtime): the invisible copy in the layout's flow is the height and the wrapping column, and the
 * field over it is what the platform lays out.
 */
export function InlineTextSelect(props: {
  blocks: TextBlock[];
  onDone?: () => void;
  /** Handed to the page around it, so a press elsewhere closes the selection the way a copy does. */
  onApi?: (api: InlineTextSelectApi) => void;
}) {
  const body = displaySettings().body;
  // The body's own leading: the rich body sets the line height on its root, which a heading
  // inherits, so every run of a floor is led the same way whatever its size.
  const lineHeight = Math.round(body * displaySettings().spacing);
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
  return (
    <View testID="inline-select-block" style={{ alignSelf: "stretch" }}>
      {props.blocks.map((block, index) => {
        const size = block.heading ? HEADING_SIZE : body;
        const weight = block.heading ? HEADING_WEIGHT : 400;
        return (
          <View style={{ alignSelf: "stretch" }}>
            {/* The body's own text, invisible: it is the height and the wrapping column the floor
                had, so the floor does not move when its rich body gives way to the field. */}
            <Text style={{ fontSize: size, lineHeight, fontWeight: weight, opacity: 0 }}>{block.text}</Text>
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
              }}
            >
              <Input
                testID={index === 0 ? "inline-select-body" : `inline-select-body-${index}`}
                ref={(n: InputRef | null) => {
                  fields[index] = n;
                }}
                multiline={true}
                readonly={true}
                value={block.text}
                scrollbar={false}
                onSelectionChange={(e: { start: number; end: number }) => selectionEnded(e.start, e.end)}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  fontSize: size,
                  fontWeight: weight,
                  color: palette().text,
                  backgroundColor: "transparent",
                  paddingHorizontal: 0,
                  paddingVertical: 0,
                  selectionColor: SELECTION_BLUE,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
