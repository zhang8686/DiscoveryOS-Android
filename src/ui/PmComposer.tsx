import { Input } from "nsh/base";
import { colorScheme, signal, Text, View, windowSize } from "nsh";
import { sendPm } from "../discuz/forum";
import { notify } from "./toast";
import { palette } from "./appearance";

/** The sheet follows the theme: the card on `surface`, its field on the page colour, and the text
 *  on `text`/`muted`, so it reads the same in light, dark and the warm beige palette. */
const CARD_BG = () => palette().surface;
const CARD_BORDER = () => palette().border;
const TITLE = () => palette().text;
const FIELD_BG = () => palette().bg;
const FIELD_TEXT = () => palette().text;
const FIELD_PLACEHOLDER = () => palette().muted;
const CANCEL_TEXT = () => palette().text;
const SEND_BG = () => palette().link;

export function PmComposer(props: { uid: string; name: string; onClose: () => void }) {
  const text = signal("");
  const busy = signal(false);

  async function send(): Promise<void> {
    const body = text().trim();
    if (!body || busy()) return;
    busy.set(true);
    try {
      await sendPm(props.uid, "", body);
      notify("pm", `短消息已发给 ${props.name}。`);
      props.onClose();
    } catch (e) {
      notify("pm", `发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy.set(false);
    }
  }

  return (
    <View
      onPress={props.onClose}
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.3)", zIndex: 45,
      }}
    >
      <View
        onPress={() => undefined}
        style={{
          width: Math.min(440, windowSize().width - 24),
          padding: 16, gap: 10, borderRadius: 12, borderWidth: 1,
          borderColor: CARD_BORDER(),
          backgroundColor: CARD_BG(),
        }}
      >
        <Text style={{ fontSize: 14, color: TITLE() }}>{`发给 ${props.name}`}</Text>
        <Input
          placeholder="短消息内容"
          multiline={true}
          value={text()}
          onChange={({ value: v }: { value: string }) => text.set(v)}
          style={{ minHeight: 150, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, borderRadius: 8, backgroundColor: FIELD_BG(), color: FIELD_TEXT(), placeholderColor: FIELD_PLACEHOLDER(), caretColor: SEND_BG() }}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <View
            onPress={props.onClose}
            accessibilityLabel="取消"
            style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: CARD_BORDER() }}
          >
            <Text style={{ fontSize: 13, color: CANCEL_TEXT() }}>取消</Text>
          </View>
          <View
            onPress={busy() ? undefined : () => void send()}
            accessibilityLabel="发送"
            style={{ paddingVertical: 6, paddingHorizontal: 16, borderRadius: 6, backgroundColor: SEND_BG(), opacity: busy() ? 0.6 : 1 }}
          >
            <Text style={{ fontSize: 13, color: palette().buttonText }}>{busy() ? "发送中…" : "发送"}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
