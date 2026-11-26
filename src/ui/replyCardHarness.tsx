// A test-only app: one reply in a list, as wide as a phone, to see how wide the card and its
// text come out. Not part of the shipped app.
import { mount, View } from "nsh";
import { TextView } from "nsh/base";
import { ReplyCard } from "./ReplyCard";

const BODY = `
<p>2013-10-2，geka 发布iOS客户端，最新版 Android 简洁论坛客户端【上架Play和Cop</p>
<blockquote><p>现在用gkd</p><p>mrky 发表于 2026-11-26 10:07</p></blockquote>
<p><a href="https://www.4d4y.com/forum/viewthread.php?tid=1234567&amp;extra=page%3D1">https://www.4d4y.com/forum/viewthread.php?tid=1234567&amp;extra=page%3D1</a></p>
<p>全新安卓客户端DBer来袭 新瓶装旧酒，还是熟悉的配方，还是熟悉的味道。</p>
<p>https://www.4d4y.com/forum/viewthread.php?tid=1234567890&amp;extra=page%3D1&amp;highlight=verylongunbreakablerun</p>
`;

/** The muted color the app gives a quote, as the shipped thread does. */
export const QUOTE_COLOR = "#6E5C46";

export default function OverflowHarness() {
  return (
    <View style={{ flex: 1, padding: 12 }}>
      <View accessibilityLabel="cell" style={{ flexDirection: "column" }}>
        <ReplyCard
          name="socode"
          meta="#1"
          body={
            // The shape Thread.tsx draws: the column stretches, the text view takes its width from
            // it, and no width is set anywhere but the card's own.
            <View accessibilityLabel="body" style={{ gap: 12, alignSelf: "stretch", minWidth: 0 }}>
              <TextView
                html={BODY}
                styles={{
                  root: { fontSize: 17, lineHeight: 26, textAlign: "justify" },
                  blockquote: { color: QUOTE_COLOR },
                }}
              />
            </View>
          }
        />
      </View>
    </View>
  );
}

mount(OverflowHarness);
