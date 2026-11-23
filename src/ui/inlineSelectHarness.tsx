// A tiny test-only app: a floor's body that opens the inline selection on a long press, inside a
// card whose own press puts it back. Not part of the shipped app.
import { mount, signal, Text, View } from "nsh";
import { InlineTextSelect } from "./InlineTextSelect";

const TEXT = "第一行\n第二行 abc";

export default function InlineSelectHarness() {
  const open = signal(false);
  return (
    <View
      style={{ flex: 1, padding: 16 }}
      // As a floor does: a press on the card outside the input ends the selection.
      onPress={open() ? () => open.set(false) : undefined}
    >
      <Text accessibilityLabel="楼层标题">楼层标题</Text>
      {open() ? (
        <InlineTextSelect text={TEXT} onDone={() => open.set(false)} />
      ) : (
        <View
          accessibilityLabel="正文"
          onLongPress={() => open.set(true)}
          style={{ padding: 16, borderWidth: 1, borderColor: "#cccccc" }}
        >
          <Text>长按这段正文</Text>
        </View>
      )}
    </View>
  );
}

mount(InlineSelectHarness);
