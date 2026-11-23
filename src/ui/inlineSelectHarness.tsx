// A tiny test-only app: a floor's body that opens the inline selection on a long press, inside a
// card whose own press puts it back. Not part of the shipped app.
import { mount, signal, Text, View } from "nsh";
import { InlineTextSelect } from "./InlineTextSelect";

const TEXT = "第一行\n第二行 abc";

export default function InlineSelectHarness() {
  const open = signal(false);
  // As a floor does: a press on the card outside the text ends the selection, through the screen's
  // own `finish` (it waits for the platform's selection to be done before the text goes away).
  let closeSelect = () => open.set(false);
  return (
    <View
      style={{ flex: 1, padding: 16 }}
      onPress={open() ? () => closeSelect() : undefined}
    >
      <Text accessibilityLabel="楼层标题">楼层标题</Text>
      {open() ? (
        <InlineTextSelect
          text={TEXT}
          onDone={() => open.set(false)}
          onApi={(api) => {
            closeSelect = api.finish;
          }}
        />
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
