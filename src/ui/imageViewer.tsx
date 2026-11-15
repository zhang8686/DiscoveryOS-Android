// A full-screen picture viewer: the page's display copy is what it draws, the
// original is what Save writes. Pinch to zoom, and the picture sits centred in
// what the top bar leaves. The bar's Save button saves it; a tap on the bar's
// Close button, or on the black around the picture, closes the viewer.
import { createMotion, effect, Image, Scroll, signal, Text, View, windowSize } from "nsh";
import process from "process";
import { fetchAttachment } from "../discuz/attachments";
import { saveToDownloads } from "./downloads";
import { notify } from "./toast";
import { openLink } from "./links";

type Shown = {
  /** The original file, which Save writes. */
  url: string;
  name: string;
  /** What is drawn: the page's display copy when there is one — the original can be
   *  several thousand pixels wide, and decoding it into the screen fails on Android. */
  display: string;
};

export const viewerImage = signal<Shown | null>(null);

function fileName(url: string): string {
  const last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  return last && /^[\w.\- ]{1,80}$/.test(last) ? last : "图片.jpg";
}

/** Opens the viewer on `url` (what Save writes), drawing `thumb` — the page's
 * display copy — when the post had one. */
export function openImageViewer(url: string, thumb?: string): void {
  if (!url) return;
  const n = fileName(url);
  viewerImage.set({
    url,
    display: thumb && thumb.length > 0 ? thumb : url,
    name: n === "图片.jpg" ? fileName(thumb ?? "") : n,
  });
}

function ToolButton(props: { label: string; onPress: () => void }) {
  return (
    <View
      onPress={props.onPress}
      style={{ minHeight: 36, minWidth: 52, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#2b2e35" }}
    >
      <Text style={{ fontSize: 13, color: "#ffffff" }}>{props.label}</Text>
    </View>
  );
}

/**
 * Saves the picture. On Android and iOS NSH's `fs` does no file I/O at all — a call
 * rejects with ERR_FEATURE_UNAVAILABLE_ON_PLATFORM (those apps keep data with
 * `Storage`) — and there is no media-store API, so writing into the phone's gallery
 * is not something the app can do itself. The original is therefore handed to the
 * system browser: a long press there saves the picture into the gallery (the
 * browser's own doing), and the Back key returns to the app. Android gives an app no
 * way to know the browser finished saving, so it cannot jump back by itself. On a
 * desktop the file is written where the app may write it.
 */
async function savePicture(url: string, name: string): Promise<void> {
  if (process.platform !== "android" && process.platform !== "ios") {
    notify("image-save", "正在保存图片…");
    try {
      const bytes = await fetchAttachment(url, name);
      const path = await saveToDownloads(name, bytes);
      notify("image-save", `已保存 ${path.split("/").pop()}。`);
      return;
    } catch {
      /* fall through to the browser */
    }
  }
  notify("image-save", "已打开原图：长按图片保存到相册，然后按返回键回到应用。");
  await openLink(url);
}

export function ImageViewer() {
  const win = windowSize();
  const availW = Math.max(200, win.width - 24);
  const availH = Math.max(220, win.height - 120);
  // A native opacity-only entrance: a full-screen black panel appearing in one
  // frame felt abrupt. `createMotion()` rests at opacity 1, so if the motion is
  // skipped (reduced motion, or a platform that cannot play it) the viewer is
  // still fully visible — never stuck transparent.
  const entrance = createMotion();
  effect(() => {
    if (viewerImage()) void entrance.play("fadeIn", { duration: 200 });
  });
  return viewerImage() ? (
    <View
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        backgroundColor: "#101114", alignItems: "stretch", justifyContent: "flex-start",
        opacity: entrance.opacity,
      }}
    >
      {/* The status bar is drawn over the top of the window here, so the bar's own
          buttons need room under it or the system takes their taps. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 26, paddingBottom: 8, backgroundColor: "#1b1d22", flexWrap: "wrap" }}>
        <ToolButton label="关闭" onPress={() => viewerImage.set(null)} />
        <Text style={{ flex: 1, fontSize: 12, color: "#e8eaed", numberOfLines: 1 }}>{viewerImage()!.name}</Text>
        <ToolButton label="保存" onPress={() => void savePicture(viewerImage()!.url, viewerImage()!.name)} />
      </View>
      {/* The picture is centred in a zoomable scroll: two fingers pinch it 1×–4×.
          `objectFit: "contain"` is a style key (not a prop) that fits the whole
          picture into its box without cropping. */}
      <Scroll
        style={{ flex: 1 }}
        minimumZoomScale={1}
        maximumZoomScale={4}
        zoomable={true}
        centerContent={true}
        contentStyle={{ alignItems: "center", justifyContent: "center", padding: 12 }}
      >
        <Image
          src={viewerImage()!.display}
          fadeDuration={160}
          style={{ width: availW, height: availH, objectFit: "contain", borderRadius: 6 }}
        />
      </Scroll>
    </View>
  ) : null;
}
