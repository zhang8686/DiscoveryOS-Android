// A full-screen picture viewer: the inline image is the fast thumbnail, this
// one loads the original. Pinch to zoom, zoom buttons for touch-only devices,
// and a save button that writes the original through the Downloads helper.
import { Image, Scroll, signal, Text, View, windowSize } from "nsh";
import { downloadAttachment } from "./downloads";

type Shown = { url: string; name: string };
export const viewerImage = signal<Shown | null>(null);

function fileName(url: string): string {
  const last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  return last && /^[\w.\- ]{1,80}$/.test(last) ? last : "图片.jpg";
}

/** Opens the viewer on the original; `thumb` only supplies a fallback name. */
export function openImageViewer(url: string, thumb?: string): void {
  if (!url) return;
  const n = fileName(url);
  viewerImage.set({ url, name: n === "图片.jpg" ? fileName(thumb ?? "") : n });
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

export function ImageViewer() {
  const zoom = signal(1);
  const clamp = (z: number) => zoom.set(Math.max(1, Math.min(4, Math.round(z * 10) / 10)));
  const w = Math.max(260, windowSize().width - 24);
  return viewerImage() ? (
    <View
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        backgroundColor: "#101114", alignItems: "stretch", justifyContent: "flex-start",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 8, backgroundColor: "#1b1d22", flexWrap: "wrap" }}>
        <ToolButton label="关闭" onPress={() => { zoom.set(1); viewerImage.set(null); }} />
        <Text style={{ flex: 1, fontSize: 12, color: "#e8eaed", numberOfLines: 1 }}>{viewerImage()!.name}</Text>
        <ToolButton label="缩小" onPress={() => clamp(zoom() - 0.5)} />
        <ToolButton label="放大" onPress={() => clamp(zoom() + 0.5)} />
        <ToolButton label="复位" onPress={() => zoom.set(1)} />
        <ToolButton label="保存" onPress={() => void downloadAttachment(viewerImage()!.url, viewerImage()!.name)} />
      </View>
      <Scroll
        style={{ flex: 1 }}
        minimumZoomScale={1}
        maximumZoomScale={4}
        zoomScale={zoom()}
        zoomable={true}
        centerContent={true}
        contentStyle={{ alignItems: "center", justifyContent: "center", padding: 12 }}
      >
        <Image src={viewerImage()!.url} fadeDuration={0} objectFit="contain" style={{ width: w, height: Math.round(w * 0.75), borderRadius: 6 }} />
      </Scroll>
    </View>
  ) : null;
}
