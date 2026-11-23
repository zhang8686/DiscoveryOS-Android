import { Text, View, type GestureResponderEvent, type InputRef } from "nsh";
import { Input } from "nsh/base";
import { palette } from "./appearance";
import { displaySettings } from "./settings";

/** A tap on the input that lifts where it landed, tracked so two of them close together are a
 *  double tap. A finger that moved is no tap: that is a handle being dragged, or the text scrolled. */
export function createDoubleTap(onDouble: () => void, gapMs = 350) {
  let lastAt = 0;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let dragged = false;
  return {
    start(x: number, y: number): void {
      downX = x;
      downY = y;
      dragged = false;
    },
    move(x: number, y: number): void {
      if (Math.abs(x - downX) > 10 || Math.abs(y - downY) > 10) dragged = true;
    },
    /** Whether the tap that just ended was the second of a double one (which runs `onDouble`). */
    end(x: number, y: number, at = Date.now()): boolean {
      if (dragged) {
        lastAt = 0;
        return false;
      }
      const doubled = lastAt > 0 && at - lastAt <= gapMs
        && Math.abs(x - lastX) <= 40 && Math.abs(y - lastY) <= 40;
      if (doubled) {
        lastAt = 0;
        onDouble();
        return true;
      }
      lastAt = at;
      lastX = x;
      lastY = y;
      return false;
    },
  };
}

/**
 * How a selection screen closes: `clear` drops the platform's selection first (the field's
 * selection collapsed and its focus given up), and `done` — which takes the field away — runs a
 * moment later, so the platform has finished its own selection UI (the handles, and the floating
 * Copy / Select All toolbar) before the field it belongs to is gone.
 *
 * That order matters on Android. A text selection's toolbar is a window of its own, tied to the
 * field that started it; a field unmounted while the toolbar is still up can leave it attached to
 * nothing, on top of the window, where it swallows every touch that comes after — the whole app
 * stops responding until it is relaunched. Closing on the touch that ended the selection also runs
 * inside the event's own dispatch, so the state change is put off the gesture altogether.
 *
 * Calling it twice does nothing the second time: the state change it starts is already under way.
 */
export function createFinish(clear: () => void, done: () => void, delayMs = 80) {
  let closed = false;
  return function finish(): void {
    if (closed) return;
    closed = true;
    try {
      clear();
    } catch {
      // The field can already be gone (a second close): nothing left to clear.
    }
    setTimeout(done, delayMs);
  };
}

/** What a selection screen lets the page around it do: close it, the way a double tap does. */
export type InlineTextSelectApi = { finish: () => void };

/** The finger a touch event is about: the one lifted, else the one still down. */
function pointOf(e: GestureResponderEvent) {
  return e.changedTouches?.[0] ?? e.touches?.[0];
}

/**
 * A floor's text as a read-only native input, in the floor's own place: a long press on a post
 * swaps its rich body for this, so the platform's own selection is the one at work — a long press
 * picks a word, and the two handles then move the ends character by character, with the system's
 * Copy / Select All menu. `readonly` keeps `EditText.setTextIsSelectable` on Android, which is the
 * character-precise selection `nsh/base`'s text view does not offer there.
 *
 * The text is plain: a picture's place is left out and the markup is gone, so the floor shows no
 * picture while it is open. A press anywhere outside the input puts the rich body back (the floor
 * around it, or any other floor, hears the press, through `onApi`'s `finish`), and so does a
 * double tap on the text itself.
 */
export function InlineTextSelect(props: {
  text: string;
  onDone?: () => void;
  /** Handed to the page around it, so a press elsewhere closes the selection the way a double tap does. */
  onApi?: (api: InlineTextSelectApi) => void;
}) {
  const size = displaySettings().body;
  const lineHeight = Math.round(size * displaySettings().spacing);
  let field: InputRef | null = null;
  // Both ways out — a double tap on the text, a press on anything around it — go through here.
  const finish = createFinish(
    () => {
      field?.setSelection(0, 0);
      field?.blur();
    },
    () => props.onDone?.(),
  );
  props.onApi?.({ finish });
  // The input is a native text field: it keeps the taps that select and the handles' drags. Touch
  // events still reach the view around it (the finger's hit path runs outwards), which is where a
  // double tap is looked for — watching, not taking, so selection and the handles work as before.
  const taps = createDoubleTap(finish);
  return (
    <View style={{ alignSelf: "stretch", gap: 4 }}>
      {/* The text is laid out twice: here, invisible, in the layout's own flow — it is what gives
          the box its height, wrapped at this column's width by the text engine — and by the input,
          drawn over it. Sizing the input any other way left blank lines under the last line: a
          multiline input on Android reports its frame's height (the list row's estimate) as its
          content's, and it is its frame that then sticks at that size. */}
      <View
        style={{ alignSelf: "stretch" }}
        onTouchStart={(e: GestureResponderEvent) => {
          const p = pointOf(e);
          if (p) taps.start(p.pageX, p.pageY);
        }}
        onTouchMove={(e: GestureResponderEvent) => {
          const p = pointOf(e);
          if (p) taps.move(p.pageX, p.pageY);
        }}
        onTouchEnd={(e: GestureResponderEvent) => {
          const p = pointOf(e);
          if (p) taps.end(p.pageX, p.pageY, p.timestamp ?? Date.now());
        }}
      >
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
      <Text style={{ fontSize: 11, lineHeight: 15, color: palette().muted }}>
        长按选词，拖两端手柄逐字选；双击或点其他位置完成
      </Text>
    </View>
  );
}
