// A Bilibili video linked from a post: a tap-to-play card that loads Bilibili's
// own player in a WebView. Members-only videos need the sign-in panel below it.
import { signal, Text, View, WebView, type WebViewRef } from "nsh";
import { type BiliVideoId } from "../bilibili/links";
import { resolveBiliShort } from "../bilibili/resolve";
import { biliSignedIn, loadBiliSession } from "../bilibili/session";
import { palette } from "./appearance";
import { BiliLogin } from "./BiliLogin";
import { ShortLinkPlayer } from "./ShortLinkPlayer";

// The "blackboard" HTML5 mobile player: Bilibili's embed that is just the video player (no "下载 App"
// bar of `player.html`), though it still draws a small top promo bar on mobile.
const playerUrl = (video: BiliVideoId) =>
  `https://www.bilibili.com/blackboard/html5mobileplayer.html?${"bvid" in video ? `bvid=${video.bvid}` : `aid=${video.aid}`}&page=1&autoplay=0&danmaku=0&high_quality=1`;
const videoLabel = (video: BiliVideoId) => ("bvid" in video ? video.bvid : `av${video.aid}`);

// The box is a fixed 16:11 (a little taller than 16:9) so the player's top bar has room AND the video
// still shows whole, and — crucially — the height is known when the layer is laid out, so the thread's
// list measures the card at this height at once. A height set later from JS (width measured after
// layout) was NOT re-measured by the list, so the card clipped the bottom (the "layer frame" cut it).
const ASPECT = 16 / 11;

// Runs inside the page: keeps the video contained so nothing is cropped.
const FIT_SCRIPT = `(() => {
  const st = document.createElement('style');
  st.textContent = 'html,body{margin:0!important;padding:0!important;height:100%!important;overflow:hidden!important;background:#000!important;}'
    + 'video{object-fit:contain!important;max-width:100%!important;max-height:100%!important;}';
  (document.head || document.documentElement).appendChild(st);
})();`;

/** A short link (b23.tv) to a Bilibili video: resolved to the video, then shown as a BiliPlayer. */
export function BiliShortPlayer(props: { url: string }) {
  return (
    <ShortLinkPlayer
      url={props.url}
      resolve={resolveBiliShort}
      play={(video) => <BiliPlayer video={video} />}
      fallbackSize={{ aspectRatio: ASPECT }}
    />
  );
}

export function BiliPlayer(props: { video: BiliVideoId }) {
  const started = signal(false);
  const loginShown = signal(false);
  let player!: WebViewRef;
  loadBiliSession();

  const size = () => ({ aspectRatio: ASPECT, backgroundColor: "#000", borderRadius: 8 });

  return (
    <View style={{ gap: 8, alignSelf: "stretch" }}>
      {started() ? (
        <WebView ref={player} src={playerUrl(props.video)} injectedJavaScript={FIT_SCRIPT} style={size()} />
      ) : (
        <View
          onPress={() => started.set(true)}
          accessibilityLabel={`Play Bilibili video ${videoLabel(props.video)}`}
          style={{ ...size(), alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: 16, color: "#fff" }}>{`▶ 播放 B 站视频 ${videoLabel(props.video)}`}</Text>
        </View>
      )}
      <View onPress={() => loginShown.set(!loginShown())} accessibilityLabel="B 站登录">
        <Text style={{ fontSize: 12, color: palette().link }}>{biliSignedIn() ? "B 站已登录（点击查看）" : "登录 B 站（会员视频需要）"}</Text>
      </View>
      {loginShown() ? (
        <BiliLogin
          onSignedIn={() => {
            loginShown.set(false);
            // A player already loaded before signing in still shows the signed-out page: reload it.
            if (started()) player.reload();
          }}
        />
      ) : null}
    </View>
  );
}
