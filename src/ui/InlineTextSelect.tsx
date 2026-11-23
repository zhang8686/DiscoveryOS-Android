import { Clipboard, Text, View, type InputRef } from "nsh";
import { Input } from "nsh/base";
import { palette } from "./appearance";
import { displaySettings } from "./settings";

/** The part of `text` between two selection offsets, either order: `""` when it is a caret. */
export function selectedSlice(text: string, start: number, end: number): string {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(text.length, Math.max(start, end));
  return to > from ? text.slice(from, to) : "";
}

/**
 * How a selection screen closes: `clear` drops the platform's selection (the field's selection
 * collapsed and its focus given up) and `done` — which takes the field away — runs a moment later,
 * so the platform has finished with its own selection UI before the field it belongs to is gone.
 *
 * Both steps wait for the touch that asked for them to be fully dispatched first: a tap puts its
 * state change on the next turn of the loop instead of inside the gesture's own dispatch. Changing
 * the platform's selection from there — a tap's own `ACTION_UP`, or a press handler that runs inside
 * it — leaves the field's selection machinery half torn down, and the page stops hearing touches:
 * nothing can be pressed until the app is relaunched.
 *
 * Calling it twice does nothing the second time: the state change it starts is already under way.
 */
export function createFinish(clear: () => void, done: () => void, pauseMs = 120) {
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
      setTimeout(done, pauseMs);
    }, 0);
  };
}

/** What a selection screen lets the page around it do: close it, as a press outside does. */
export type InlineTextSelectApi = { finish: () => void };

/**
 * A floor's text as a read-only native input, in the floor's own place: a long press on a post
 * swaps its rich body for this, so the platform's own selection is the one at work — a long press
 * picks a word, and the two handles then move the ends character by character, with the system's
 * Copy / Select All menu. `readonly` keeps `EditText.setTextIsSelectable` on Android, which is the
 * character-precise selection `nsh/base`'s text view does not offer there.
 *
 * The row under it copies what is selected and closes: one button, and no gesture to discover. The
 * platform's own Copy in its floating menu still works, but this one also ends the selection — the
 * menu is a window of its own, and leaving it behind with the field went wrong before.
 *
 * The text is plain: a picture's place is left out and the markup is gone, so the floor shows no
 * picture while it is open. A press anywhere outside the input puts the rich body back too (the
 * floor around it, or any other floor, hears the press, through `onApi`'s `finish`).
 */
export function InlineTextSelect(props: {
  text: string;
  onDone?: () => void;
  /** Told what the copy button put on the clipboard; `""` when nothing was selected to copy. */
  onCopied?: (text: string) => void;
  /** Handed to the page around it, so a press elsewhere closes the selection the way the button does. */
  onApi?: (api: InlineTextSelectApi) => void;
}) {
  const size = displaySettings().body;
  const lineHeight = Math.round(size * displaySettings().spacing);
  let field: InputRef | null = null;
  // Where the platform's selection is (UTF-16 offsets): the copy button takes this run of text.
  let start = 0;
  let end = 0;
  const finish = createFinish(
    () => {
      field?.setSelection(0, 0);
      field?.blur();
    },
    () => props.onDone?.(),
  );
  props.onApi?.({ finish });

  function copyPicked(): void {
    const picked = selectedSlice(props.text, start, end);
    if (!picked) {
      // Nothing to copy: the row stays, so a tap that missed the selection is not the way out.
      props.onCopied?.("");
      return;
    }
    void Clipboard.writeText(picked).catch(() => undefined);
    props.onCopied?.(picked);
    finish();
  }

  return (
    <View style={{ alignSelf: "stretch", gap: 6 }}>
      {/* The text is laid out twice: here, invisible, in the layout's own flow — it is what gives
          the box its height, wrapped at this column's width by the text engine — and by the input,
          drawn over it. Sizing the input any other way left blank lines under the last line: a
          multiline input on Android reports its frame's height (the list row's estimate) as its
          content's, and it is its frame that then sticks at that size. */}
      <View style={{ alignSelf: "stretch" }}>
        <Text style={{ fontSize: size, lineHeight, opacity: 0 }}>{props.text}</Text>
        <Input
          testID="inline-select-body"
          ref={(n: InputRef | null) => {
            field = n;
          }}
          multiline={true}
          readonly={true}
          value={props.text}
          scrollbar={false}
          onSelectionChange={(e: { start: number; end: number }) => {
            start = e.start;
            end = e.end;
          }}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            fontSize: size,
            lineHeight,
            color: palette().text,
            backgroundColor: "transparent",
            paddingHorizontal: 0,
            paddingVertical: 0,
          }}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 11, lineHeight: 15, color: palette().muted, flex: 1 }}>
          长按选词，拖两端手柄逐字选；点「复制」复制并退出
        </Text>
        <View
          testID="inline-select-copy"
          accessibilityLabel="复制选中文字并退出"
          onPress={copyPicked}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().surface,
          }}
        >
          <Text style={{ fontSize: 12, lineHeight: 16, color: palette().text }}>复制</Text>
        </View>
      </View>
    </View>
  );
}
