import { Text, View } from "nsh";
import { palette } from "./appearance";
import { displaySettings } from "./settings";

/** The blue Android draws its own text selection in (Pixel's accent, `#4285F4`). */
const SELECTION_BLUE = "#4285F4";

/**
 * How a selection screen closes: `done`, which takes the plain text away and puts the rich body
 * back, waits for the platform to finish with its own selection UI first. A copy empties the
 * selection and closes the floating menu in the platform's own code; taking the text away on the
 * same turn would pull the view out from under that, so it happens a moment later, off the touch's
 * dispatch. Calling it twice does nothing the second time.
 */
export function createFinish(done: () => void, pauseMs = 120) {
  let closed = false;
  return function finish(): void {
    if (closed) return;
    closed = true;
    setTimeout(done, pauseMs);
  };
}

/** What a selection screen lets the page around it do: close it, as a press outside does. */
export type InlineTextSelectApi = { finish: () => void };

/**
 * A floor's text as plain, selectable text in the floor's own place: a long press on a post swaps
 * its rich body for this, so the platform's selection menu is the one at work — a long press picks
 * a word, the two handles move the ends character by character, and the floating menu offers Copy,
 * Select all and Share.
 *
 * A copy ends the selection: the menu's Copy puts the text on the clipboard and clears the
 * selection in the platform's own code, which is reported here as an empty selection — that is the
 * moment the rich body comes back, with no button of the app's and no second gesture. A press
 * outside the text clears the selection the same way, and so does Back.
 *
 * The handles and the highlight are Android's blue, the color of the system's own selection.
 */
export function InlineTextSelect(props: {
  text: string;
  onDone?: () => void;
  /** Handed to the page around it, so a press elsewhere closes the selection the way a copy does. */
  onApi?: (api: InlineTextSelectApi) => void;
}) {
  const size = displaySettings().body;
  const lineHeight = Math.round(size * displaySettings().spacing);
  // Whether the platform has a selection now: it reports `""` when one ends — a copy, a press
  // somewhere else — and that is when the rich body comes back. The first report (nothing
  // selected yet) must not close it.
  let selected = false;
  const finish = createFinish(() => props.onDone?.());
  props.onApi?.({ finish });

  return (
    <View style={{ alignSelf: "stretch", gap: 6 }}>
      <View
        testID="inline-select-body"
        selectable={true}
        onSelectionChange={(e: { text: string }) => {
          if (e.text) {
            selected = true;
            return;
          }
          if (!selected) return;
          selected = false;
          finish();
        }}
        style={{ alignSelf: "stretch" }}
      >
        <Text style={{ fontSize: size, lineHeight, color: palette().text, selectionColor: SELECTION_BLUE }}>
          {props.text}
        </Text>
      </View>
      <Text style={{ fontSize: 11, lineHeight: 15, color: palette().muted }}>
        长按选词，拖两端手柄逐字选；点浮条的「复制」后自动恢复正文
      </Text>
    </View>
  );
}
