import { Text, View, type InputRef } from "nsh";
import { Input } from "nsh/base";
import { palette } from "./appearance";
import { displaySettings } from "./settings";

/** The blue Android draws its own text selection in (Pixel's accent, `#4285F4`). */
const SELECTION_BLUE = "#4285F4";

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
 * A floor's text as a read-only native input, in the floor's own place: a long press on a post
 * swaps its rich body for this, so the platform's own selection is the one at work — a long press
 * picks a word, and the two handles then move the ends character by character, with the system's
 * Copy / Select All menu. `readonly` keeps `EditText.setTextIsSelectable` on Android, which is the
 * character-precise selection `nsh/base`'s text view does not offer there.
 *
 * Tapping Copy ends it, with nothing of the app's in the way: the selection collapses in the
 * platform's code and that report is what puts the rich body back. A press outside the text, or
 * Back, closes it through the same path.
 *
 * The floor keeps its size while the body is a field. The text is laid out twice: an invisible
 * copy in the layout's own flow, at the body's size and leading, is what holds the floor's height
 * and its wrapping column (the text engine wraps it, so the field breaks lines in the same places);
 * the field, drawn over it, is as tall as the platform draws its own text and is centred in that
 * height, so the extra room goes above and below it in equal parts instead of collecting under the
 * last line. The field's leading is the platform's own (Android's EditText has no line height the
 * framework sets, it takes the font's), which is a little tighter than the body's — the one thing
 * here that cannot be asked for.
 */
export function InlineTextSelect(props: {
  text: string;
  onDone?: () => void;
  /** Handed to the page around it, so a press elsewhere closes the selection the way a copy does. */
  onApi?: (api: InlineTextSelectApi) => void;
}) {
  const size = displaySettings().body;
  const lineHeight = Math.round(size * displaySettings().spacing);
  let field: InputRef | null = null;
  const finish = createFinish(
    () => {
      field?.setSelection(0, 0);
      field?.blur();
    },
    () => props.onDone?.(),
  );
  props.onApi?.({ finish });
  const selectionEnded = createSelectionEnd(finish);
  return (
    <View testID="inline-select-block" style={{ alignSelf: "stretch" }}>
      {/* The body's own text, invisible: it is the height and the wrapping column the floor had,
          so the floor does not move when its rich body gives way to the field. */}
      <Text style={{ fontSize: size, lineHeight, opacity: 0 }}>{props.text}</Text>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          justifyContent: "center",
        }}
      >
        <Input
          testID="inline-select-body"
          ref={(n: InputRef | null) => {
            field = n;
          }}
          multiline={true}
          readonly={true}
          value={props.text}
          scrollbar={false}
          onSelectionChange={(e: { start: number; end: number }) => selectionEnded(e.start, e.end)}
          style={{
            alignSelf: "stretch",
            fontSize: size,
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
}
