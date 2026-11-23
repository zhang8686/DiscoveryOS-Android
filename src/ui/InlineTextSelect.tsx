import { Text, View, type GestureResponderEvent } from "nsh";
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
 * around it, or any other floor, hears the press), and so does a double tap on the text itself.
 */
export function InlineTextSelect(props: { text: string; onDone?: () => void }) {
  const size = displaySettings().body;
  const lineHeight = Math.round(size * displaySettings().spacing);
  // The input is a native text field: it keeps the taps that select and the handles' drags. Touch
  // events still reach the view around it (the finger's hit path runs outwards), which is where a
  // double tap is looked for — watching, not taking, so selection and the handles work as before.
  const taps = createDoubleTap(() => props.onDone?.());
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
