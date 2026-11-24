import { cleanup, createAnimatedValue, createMotion, effect, Image, reduceMotion, Scroll, Share, signal, Text, View, WebView, windowSize } from "nsh";
import { mkdir, writeFile } from "fs/promises";
import process from "process";
import { fetchAttachment, safeFileName, splitFileName } from "../discuz/attachments";
import { pixelSize } from "./pixelSize";
import { notify } from "./toast";
import { openLink } from "./links";
import { imageDataUrl, scanPage } from "./qrScanner";
import { warmImages } from "./imageWarm";

export type Shown = {
  /** The original file, which Save writes and the viewer looks the picture up by. */
  url: string;
  name: string;
  /** What is drawn: the page's display copy when there is one — the original can be
   *  several thousand pixels wide, and decoding it into the screen fails on Android. */
  display: string;
};

/** The pictures shown and the one in front: one post's pictures, so the reader can step through
 *  them without closing the viewer and opening the next one. */
export type Gallery = { items: Shown[]; index: number };

export const viewerState = signal<Gallery | null>(null);

/** Whether the viewer is open (App mounts it while this is true). */
export function viewerOpen(): boolean {
  return viewerState() !== null;
}

function fileName(url: string): string {
  let last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  try { last = decodeURIComponent(last); } catch {  }
  return last && last.length <= 80 && !/[\/\\:*?"<>|\x00-\x1f]/.test(last) ? last : "图片.jpg";
}

/** The extensions a picture may carry; anything else a name ends with is not one. */
const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|bmp)$/i;

/**
 * The extension the bytes themselves name, by their signature — `null` when they are not a
 * picture at all (the forum's sign-in page, say). A name taken from the address is no proof of
 * what a file holds: the forum's attachments come as `attachment.php` or `forum.php?mod=…`, and
 * a saver that trusts such a name writes `attachment.jpeg.txt`.
 */
export function imageExtension(bytes: Uint8Array): ".jpg" | ".png" | ".gif" | ".webp" | ".bmp" | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return ".jpg";
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return ".png";
  if (bytes.length >= 4 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return ".gif";
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46
    && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return ".webp";
  if (bytes.length >= 2 && at(0) === 0x42 && at(1) === 0x4d) return ".bmp";
  return null;
}

/** Names that say nothing about the picture: the forum's script names. */
const GENERIC_STEM = /^(?:attachment|forum|image|img|download|file|图片|图像)$/i;

function stamp(at: number): string {
  const d = new Date(at);
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/**
 * The name the picture is written and shared under: its own where it says something, else a
 * timestamped one, with the extension its bytes prove. `attachment.php` becomes
 * `图片-20261123-181500.jpg`, never `…jpeg.txt`.
 */
export function pictureFileName(name: string, bytes: Uint8Array, at = Date.now()): string {
  const safe = safeFileName(name);
  const { stem } = splitFileName(safe);
  const base = GENERIC_STEM.test(stem) || stem.length < 2 ? `图片-${stamp(at)}` : stem;
  const ext = imageExtension(bytes) ?? safe.match(IMAGE_EXT)?.[0]?.toLowerCase() ?? ".jpg";
  return `${base}${ext}`;
}

function shown(url: string, thumb?: string): Shown {
  const n = fileName(url);
  return {
    url,
    display: thumb && thumb.length > 0 ? thumb : url,
    name: n === "图片.jpg" ? fileName(thumb ?? "") : n,
  };
}

/** Opens the viewer on one picture (what Save writes), drawing `thumb` — the page's display copy —
 *  when the post had one. */
export function openImageViewer(url: string, thumb?: string): void {
  if (!url) return;
  viewerState.set({ items: [shown(url, thumb)], index: 0 });
}

/** Opens the viewer at `index` of a post's pictures, so the reader can step to the others. */
export function openGallery(items: Shown[], index: number): void {
  if (items.length === 0) return;
  viewerState.set({ items, index: Math.max(0, Math.min(items.length - 1, index)) });
}

/** Shows the picture before (`step` -1) or after (step 1) this one, staying on the same post. */
export function stepImage(step: 1 | -1): void {
  const g = viewerState();
  if (!g) return;
  const next = g.index + step;
  if (next < 0 || next >= g.items.length) return;
  viewerState.set({ items: g.items, index: next });
}

const LINKED_IMAGE = /<a\b[^>]*\bhref="([^"]+)"[^>]*>\s*<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi;
const PLAIN_IMAGE = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi;

/**
 * The pictures of one post, in the order they appear, as the viewer steps through them. It reads
 * the post's transformed HTML (the same string the text view draws), so what the reader taps is
 * exactly what the gallery holds.
 */
export function postImages(html: string): Shown[] {
  const out: Shown[] = [];
  const seen = new Set<string>();
  const add = (url: string, display: string) => {
    const full = url || display;
    if (!full || /smilies\//i.test(full)) return;
    if (seen.has(full)) return;
    seen.add(full);
    out.push(shown(full, display));
  };
  for (const m of html.matchAll(LINKED_IMAGE)) add(m[1], m[2]);
  for (const m of html.matchAll(PLAIN_IMAGE)) {
    const src = m[1];
    if (!out.some((p) => p.display === src || p.url === src)) add(src, src);
  }
  return out;
}

function ToolButton(props: { label: string; title?: string; onPress: () => void; disabled?: boolean; round?: boolean }) {
  return (
    <View
      onPress={props.disabled ? undefined : props.onPress}
      accessibilityLabel={props.title ?? props.label}
      style={{
        minHeight: 44, minWidth: props.round ? 44 : 68,
        alignItems: "center", justifyContent: "center",
        borderRadius: 22,
        backgroundColor: "rgba(18, 20, 24, 0.45)", borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.24)",
        opacity: props.disabled ? 0.3 : 1,
      }}
    >
      <Text style={{ fontSize: props.round ? 22 : 13, color: "#ffffff", lineHeight: props.round ? 24 : undefined }}>{props.label}</Text>
    </View>
  );
}

/**
 * Saves the picture. On Android NSH's `fs` does no file I/O at all and there is no media-store API,
 * so writing into the phone's gallery is not something the app can do itself: the original is
 * handed to the system browser, where a long press saves the picture (the browser's own doing).
 */
/** Guardrails for the optional full-resolution view: the original can be thousands of pixels
 *  wide and decoding it is what fails on Android. A picture beyond either limit is refused. */
const FULL_MAX_EDGE = 5000;
const FULL_MAX_PIXELS = 20_000_000;

/** Load the original after checking it is safe to decode. The bytes are fetched once to read the
 *  header (`pixelSize`); the `<Image>` then loads that same URL. Small enough originals switch in,
 *  too large ones are refused with a message instead of risking an out-of-memory crash. */
async function showOriginal(url: string, name: string, onAllowed: () => void): Promise<void> {
  notify("image-full", "正在检查原图尺寸…");
  try {
    const bytes = await fetchAttachment(url, name);
    const size = pixelSize(bytes);
    if (!size) {
      notify("image-full", "无法识别原图格式，继续使用缩略图。");
      return;
    }
    if (size.width > FULL_MAX_EDGE || size.height > FULL_MAX_EDGE || size.width * size.height > FULL_MAX_PIXELS) {
      notify("image-full", `原图 ${size.width}×${size.height} 过大，已拒绝加载以避免内存不足。`);
      return;
    }
    onAllowed();
  } catch (e) {
    const reason = e instanceof Error ? e.message : "未知错误";
    notify("image-full", `无法加载原图：${reason}`);
  }
}

/** Whether this platform can write a file at all, probed once and remembered.
 *
 *  `fs/promises` needs the host's file system: the desktops and the mobile runtimes that have it
 *  write into `dataDir`; an older runtime rejects every call with "native filesystem unavailable
 *  on this platform". Asking once keeps that failure out of the tap. */
let filesWritable: boolean | undefined;
async function canWriteFiles(): Promise<boolean> {
  if (filesWritable !== undefined) return filesWritable;
  try {
    const dir = `${process.dataDir}/shared`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/.probe`, "1");
    filesWritable = true;
  } catch {
    filesWritable = false;
  }
  return filesWritable;
}

/** Saves the picture as a file of its own and shares that file.
 *
 *  The bytes are fetched with the forum's cookies (the browser has none: the picture's address
 *  answers with a sign-in page there, which is why a browser's save came out as a `.txt`), written
 *  into the app's own storage under a name the bytes prove, and handed to the share sheet as a
 *  file — so WeChat and the rest receive a picture, not its address. Where the platform has no
 *  file system (an older runtime), the address is shared instead and the person is told so. */
async function sharePicture(url: string, name: string): Promise<void> {
  notify("image-save", "正在准备图片…");
  try {
    if (!(await canWriteFiles())) {
      const result = await Share.show({ url, title: name });
      if (result.action === "dismissed") notify("image-save", "已取消分享。");
      else notify("image-save", "这个运行时不支持写出图片文件，只能分享图片链接。");
      return;
    }
    const bytes = await fetchAttachment(url, name);
    if (!imageExtension(bytes)) throw new Error("下载到的不是图片，请确认已登录论坛");
    const file = pictureFileName(name, bytes);
    const dir = `${process.dataDir}/shared`;
    await mkdir(dir, { recursive: true });
    const path = `${dir}/${file}`;
    await writeFile(path, bytes);
    const result = await Share.show({ files: [path], title: file });
    if (result.action === "dismissed") notify("image-save", "已取消分享。");
    else notify("image-save", `已分享图片 ${file}`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "未知错误";
    notify("image-save", `分享失败：${reason}`);
  }
}

export function ImageViewer() {
  const win = windowSize();
  const availW = Math.max(200, win.width - 24);
  const availH = Math.max(220, win.height - 130);
  const entrance = createMotion();
  // A downward drag closes the viewer; a sideways one steps to the post's other pictures.
  const dismissPan = createAnimatedValue(0);
  const stepPan = createAnimatedValue(0);
  // A long press on the picture offers what can be done with it, so the picture keeps the screen
  // to itself and no Save button sits over it.
  const menuOpen = signal(false);
  // Whether the current picture has been switched to its full-resolution original (after the
  // size guard). Reset on every step so a big original is never carried into the next picture.
  const fullImage = signal(false);
  // Stepping through a post's pictures is a sideways push inside the picture's box. The screen
  // behind — the black, the name bar, the counter and the buttons — does not move at all.
  const leavingX = createAnimatedValue(0);
  const enteringX = createAnimatedValue(0);
  // The picture sliding out, while a step plays: `null` when the one shown is the only one drawn.
  const leaving = signal<number | null>(null);
  // The viewer is entered once per opening: the opening zoom belongs to the first picture, not to
  // every step (replaying it on each step is what made the whole screen flash).
  let opened = false;
  let shownIndex = 0;
  let stepSeq = 0;
  effect(() => {
    const g = viewerState();
    if (!g) { opened = false; leaving.set(null); fullImage.set(false); return; }
    if (!opened) {
      opened = true;
      shownIndex = g.index;
      fullImage.set(false);
      void entrance.play("zoomIn", { duration: 180, easing: "easeOut" });
      return;
    }
    if (g.index === shownIndex) return;
    fullImage.set(false);
    const direction = g.index > shownIndex ? 1 : -1;
    const from = shownIndex;
    shownIndex = g.index;
    const seq = ++stepSeq;
    const travel = availW;
    if (reduceMotion()) {
      leaving.set(null);
      leavingX.set(0);
      enteringX.set(0);
      return;
    }
    // Forward: the old picture leaves to the left, the new one arrives from the right.
    leaving.set(from);
    leavingX.set(0);
    enteringX.set(direction * travel);
    void leavingX.timing(-direction * travel, { duration: 220, easing: "easeOut" }).catch(() => undefined);
    void enteringX.timing(0, { duration: 220, easing: "easeOut" }).then(() => {
      // Compare against the latest step, not the index captured this round: a quick 0→1→2→1
      // would otherwise let the first callback clear the third step's outgoing picture.
      if (seq !== stepSeq) return;
      leaving.set(null);
      leavingX.set(0);
    }).catch(() => undefined);
  });
  // The pictures on either side of the one shown are read while it is looked at, so a step draws
  // from the cache instead of waiting on the network. Warming keeps no view: bytes go into the
  // same cache the picture reads, with nothing to make, lay out or decode on the way — which is
  // what the three hidden 1×1 images this used to mount cost.
  effect(() => {
    const g = viewerState();
    if (!g || g.items.length < 2) return;
    const near = [g.index - 1, g.index + 1, g.index + 2].filter((i) => i >= 0 && i < g.items.length);
    warmImages(near.map((i) => g.items[i].display), 3);
  });
  const gallery = () => viewerState();
  const current = () => gallery()?.items[gallery()!.index];

  // Reading a QR code out of the picture. The platform has no barcode API and no way for the app to
  // read a picture's pixels, so the decoding runs where the pixels are: a web view with a canvas,
  // running jsQR over the picture and posting the text back. The picture reaches that page as a
  // data URL, so the canvas is never tainted and a picture from the forum needs no CORS header.
  // The page exists only while a scan runs and is taken away as soon as it answers.
  const scanPageHtml = signal<string | null>(null);
  const scanning = signal(false);
  let scanTimer: ReturnType<typeof setTimeout> | undefined;

  function finishScan(text: string | null, failure?: string): void {
    // onMessage and onError (or two messages) can both arrive; the first answer wins.
    if (!scanning()) return;
    if (scanTimer !== undefined) { clearTimeout(scanTimer); scanTimer = undefined; }
    scanning.set(false);
    scanPageHtml.set(null);
    if (!text) {
      notify("image-scan", failure ?? "没有在图片里找到二维码。");
      return;
    }
    const value = text.trim();
    // A code that carries a link opens it; a bare domain ("www.4d4y.com") is taken as the link it
    // means; anything else (a Wi-Fi key, a line of text) is shown rather than opened.
    const link = /^https?:\/\//i.test(value) ? value
      : /^[\w-]+(?:\.[\w-]+)+\/?\S*$/.test(value) ? `https://${value}`
      : null;
    if (link) { void openLink(link); return; }
    notify("image-scan", `二维码内容：${value.length > 40 ? `${value.slice(0, 40)}…` : value}`);
  }

  async function scanPicture(item: Shown): Promise<void> {
    if (scanning()) return;
    scanning.set(true);
    notify("image-scan", "正在识别二维码…");
    scanTimer = setTimeout(() => finishScan(null, "没有在图片里找到二维码。"), 12000);
    try {
      let bytes: Uint8Array;
      try {
        bytes = await fetchAttachment(item.url, item.name);
      } catch {
        bytes = await fetchAttachment(item.display, item.name);
      }
      if (!scanning()) return; 
      scanPageHtml.set(scanPage(imageDataUrl(bytes, item.name)));
    } catch {
      finishScan(null, "这张图片读不出来，无法扫码。");
    }
  }
  effect(() => {
    const g = viewerState();
    if (!g) finishScan(null);
  });
  cleanup(() => {
    if (scanTimer !== undefined) clearTimeout(scanTimer);
    scanTimer = undefined;
    scanning.set(false);
  });

  return gallery() ? (
    <View
      onPress={() => viewerState.set(null)}
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        backgroundColor: "#101114",
      }}
    >
      <View style={{ flex: 1, alignItems: "stretch", justifyContent: "flex-start", opacity: entrance.opacity }}>
        {
}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, backgroundColor: "#1b1d22" }}>
          <Text style={{ fontSize: 12, color: "#e8eaed", flex: 1, numberOfLines: 1 }}>{current()?.name ?? ""}</Text>
          {gallery()!.items.length > 1 ? (
            <Text style={{ fontSize: 12, color: "#aeb4bd" }}>{`${gallery()!.index + 1} / ${gallery()!.items.length}`}</Text>
          ) : null}
        </View>
        {/* The drag surface sits AROUND the zoomable scroll, never inside it.
            Inside, the scroll claimed the drag: its content was a little taller than its viewport
            (`win.height - 8` in a column that also holds the name bar), so the platform's scroll
            view took the touch over and cancelled the pan — a swipe or a downward pull reached
            `onPanEnd` as `cancelled` and did nothing. Here the pan owns the drag, and the picture
            is the scroll's only content: at 1× there is nothing to scroll, so the scroll never
            claims a touch, while a pinch still zooms it 1×–4×. */}
        <View
          pan={{ y: dismissPan, x: stepPan }}
          panActivation={{ activeOffsetX: 40, activeOffsetY: 40 }}
          onPanEnd={(e: any) => {
            const dx = e?.translation?.x ?? 0;
            const vx = e?.velocity?.x ?? 0;
            const dy = e?.translation?.y ?? 0;
            if (Math.abs(dx) > Math.abs(dy) && !e?.cancelled && (dx < -50 || vx < -600)) stepImage(1);
            else if (Math.abs(dx) > Math.abs(dy) && !e?.cancelled && (dx > 50 || vx > 600)) stepImage(-1);
            else if (!e?.cancelled && dy > 90) viewerState.set(null);
            dismissPan.set(0);
            stepPan.set(0);
          }}
          style={{ flex: 1, alignItems: "stretch" }}
        >
          {/* The picture is centred in a zoomable scroll: two fingers pinch it 1×–4×. */}
          <Scroll
            style={{ flex: 1 }}
            minimumZoomScale={1}
            maximumZoomScale={4}
            zoomable={true}
            centerContent={true}
            contentStyle={{ alignItems: "center", justifyContent: "center" }}
          >
            <View
              onPress={() => undefined}
              onLongPress={() => menuOpen.set(true)}
              accessibilityLabel="长按查看图片选项"
              style={{ width: availW, height: availH, overflow: "hidden", backgroundColor: "#101114" }}
            >
              {/* The picture shown keeps this first position in the box for its whole life, so a
                  step never remounts (and re-decodes) it: the one being left is drawn after it,
                  under it, for as long as the step plays. */}
              <Image
                src={fullImage() ? current()!.url : current()!.display}
                // No fade: one on top of the slide would show the box through the arriving picture.
                fadeDuration={0}
                style={{
                  width: availW, height: availH, objectFit: "contain", borderRadius: 6,
                  transform: [{ translateX: enteringX }], zIndex: 2,
                }}
              />
              {leaving() !== null ? (
                <Image
                  src={gallery()!.items[leaving()!].display}
                  fadeDuration={0}
                  style={{
                    position: "absolute", left: 0, top: 0, width: availW, height: availH,
                    objectFit: "contain", borderRadius: 6,
                    transform: [{ translateX: leavingX }], zIndex: 1,
                  }}
                />
              ) : null}
            </View>
          </Scroll>
        </View>
        {/* The next and previous pictures are read while this one is shown (the effect above),
            so a step has the bytes already. */}
        {/* Previous, Close and next, within thumb reach, with the two steps reduced to arrows. */}
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, zIndex: 20 }}>
          {gallery()!.items.length > 1 ? (
            <ToolButton label="‹" title="上一张" round disabled={gallery()!.index === 0} onPress={() => stepImage(-1)} />
          ) : null}
          <ToolButton label="关闭" onPress={() => viewerState.set(null)} />
          {gallery()!.items.length > 1 ? (
            <ToolButton label="›" title="下一张" round disabled={gallery()!.index === gallery()!.items.length - 1} onPress={() => stepImage(1)} />
          ) : null}
        </View>
        {/* Long press on the picture: what can be done with it, without a button on it. */}
        {menuOpen() ? (
          <View
            onPress={() => menuOpen.set(false)}
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.45)", zIndex: 30 }}
          >
            <View style={{ width: 232 }}>
              <View
                onPress={() => undefined}
                style={{ paddingVertical: 6, borderRadius: 14, backgroundColor: "#232529", overflow: "hidden" }}
              >
                {!fullImage() && current()!.url !== current()!.display ? (
                  <>
                    <View
                      onPress={() => {
                        const item = current();
                        menuOpen.set(false);
                        if (item) void showOriginal(item.url, item.name, () => fullImage.set(true));
                      }}
                      accessibilityLabel="查看原图"
                      style={{ paddingVertical: 14, alignItems: "center" }}
                    >
                      <Text style={{ fontSize: 15, color: "#ffffff" }}>查看原图</Text>
                    </View>
                    <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />
                  </>
                ) : null}
                <View
                  onPress={() => { menuOpen.set(false); void sharePicture(current()!.url, current()!.name); }}
                  accessibilityLabel="分享/保存图片"
                  style={{ paddingVertical: 14, alignItems: "center" }}
                >
                  <Text style={{ fontSize: 15, color: "#ffffff" }}>分享 / 保存图片</Text>
                </View>
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />
                <View
                  onPress={() => {
                    const item = current();
                    menuOpen.set(false);
                    if (item) void scanPicture(item);
                  }}
                  accessibilityLabel="扫描二维码"
                  style={{ paddingVertical: 14, alignItems: "center" }}
                >
                  <Text style={{ fontSize: 15, color: "#ffffff" }}>扫描二维码</Text>
                </View>
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />
                <View
                  onPress={() => menuOpen.set(false)}
                  accessibilityLabel="取消"
                  style={{ paddingVertical: 14, alignItems: "center" }}
                >
                  <Text style={{ fontSize: 15, color: "#aeb4bd" }}>取消</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}
        {/* The code reader: a web view of its own, two points square and invisible, because the
            app has no way to read a picture's pixels itself. It posts the text back and is taken
            away as soon as it answers. */}
        {scanPageHtml() ? (
          <View style={{ position: "absolute", left: 0, bottom: 0, width: 2, height: 2, opacity: 0, zIndex: 1 }}>
            <WebView
              html={scanPageHtml()!}
              baseUrl="https://www.4d4y.com/"
              javaScriptEnabled={true}
              onMessage={(e: { data: string }) => {
                let text: string | null = null;
                let failure: string | undefined;
                try {
                  const answer = JSON.parse(e.data) as { text?: string; error?: string };
                  text = answer.text ? answer.text : null;
                  if (!text) failure = answer.error ? "这张图片读不出来，无法扫码。" : "没有在图片里找到二维码。";
                } catch {
                  failure = "扫码没有成功。";
                }
                finishScan(text, failure);
              }}
              onError={() => finishScan(null, "这里打不开扫码页面。")}
              style={{ width: 2, height: 2 }}
            />
          </View>
        ) : null}
      </View>
    </View>
  ) : null;
}
