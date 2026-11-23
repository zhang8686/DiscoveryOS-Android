// A tiny test-only app: asks the forum about one attachment the way a press on its download line
// does — is it a picture, and what is it called. Not part of the shipped app.
import { mount, signal, Text, View } from "nsh";
import { attachmentIsPicture, fetchAttachmentFile } from "../discuz/attachments";

const URL = "https://www.4d4y.com/forum/attachment.php?aid=9";
const state = signal("idle");

export default function DownloadHarness() {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View
        accessibilityLabel="下载"
        onPress={() => {
          state.set("busy");
          void (async () => {
            const picture = await attachmentIsPicture(URL);
            if (picture) {
              state.set("picture");
              return;
            }
            const file = await fetchAttachmentFile(URL, "下载");
            state.set(`file:${file.name}:${file.bytes.length}`);
          })().catch((e) => state.set(`error:${e instanceof Error ? e.message : String(e)}`));
        }}
        style={{ padding: 16, borderWidth: 1, borderColor: "#cccccc" }}
      >
        <Text>下载</Text>
      </View>
      <Text>{state()}</Text>
    </View>
  );
}

mount(DownloadHarness);
