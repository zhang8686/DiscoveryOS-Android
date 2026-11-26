import { cleanup, effect, signal, Text, View, windowSize } from "nsh";
import { AppSettings } from "nsh/mobile";
import { cacheBytes, clearCaches, formatBytes } from "../cache";
import { palette } from "./appearance";
import { displaySettings, setDisplay, type DisplaySettings } from "./settings";
import { rewarmAvatars } from "./imageWarm";
import { notify } from "./toast";

function Stepper(props: {
  label: string;
  value: () => number;
  min: number;
  max: number;
  step: number;
  digits: number;
  onChange: (value: number) => void;
}) {
  const round = (n: number) => Math.min(props.max, Math.max(props.min, Math.round(n * 10) / 10));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ flex: 1, fontSize: 13, color: palette().text }}>{props.label}</Text>
      <View
        onPress={() => props.onChange(round(props.value() - props.step))}
        accessibilityLabel={`${props.label}减小`}
        style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface, borderWidth: 1, borderColor: palette().border }}
      >
        <Text style={{ fontSize: 16, color: palette().text }}>−</Text>
      </View>
      <Text style={{ width: 40, textAlign: "center", fontSize: 13, color: palette().text }}>{props.value().toFixed(props.digits)}</Text>
      <View
        onPress={() => props.onChange(round(props.value() + props.step))}
        accessibilityLabel={`${props.label}增大`}
        style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface, borderWidth: 1, borderColor: palette().border }}
      >
        <Text style={{ fontSize: 16, color: palette().text }}>+</Text>
      </View>
    </View>
  );
}

export function SettingsSheet(props: { onClose: () => void }) {
  // The panel's own copy: a press shows at once, the app's text is re-laid out once the presses
  // pause (a thread body re-parsing on every press made the steppers stutter).
  const draft = signal<DisplaySettings>({ ...displaySettings() });
  let applyTimer: ReturnType<typeof setTimeout> | undefined;
  function change(patch: Partial<DisplaySettings>): void {
    draft.set({ ...draft(), ...patch });
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => setDisplay(draft()), 180);
  }
  function close(): void {
    if (applyTimer) clearTimeout(applyTimer);
    setDisplay(draft());
    props.onClose();
  }
  // A panel taken away without close() (the window changing under it) still must not fire its
  // last debounce at the app afterwards.
  cleanup(() => { if (applyTimer) clearTimeout(applyTimer); });
  // The image cache's size, read when the panel opens and after each cleanup. `null` until the
  // first read answers: the row then shows nothing rather than a size it does not know yet.
  const cache = signal<number | null>(null);
  const clearing = signal(false);
  const readCache = (): void => {
    cacheBytes()
      .then((bytes) => cache.set(bytes))
      .catch(() => cache.set(null));
  };
  effect(() => {
    readCache();
  });
  function clearCache(): void {
    if (clearing()) return;
    clearing.set(true);
    clearCaches()
      .then(({ bytes, cleared }) => {
        if (cleared) {
          cache.set(0);
          // The faces on screen were just deleted with everything else: ask for them again now, so
          // a list that is scrolled next does not fade them in one round trip at a time.
          rewarmAvatars();
          notify("cache", bytes > 0 ? `已清理缓存 ${formatBytes(bytes)}` : "没有可清理的缓存");
          return;
        }
        // The platform keeps us out of its cache directory. Its own "clear cache" still works and
        // never touches the sign-in, so open the page that has it rather than a dead end.
        notify("cache", "已转到系统设置，点「清除缓存」即可");
        return AppSettings.open().catch(() => {
          notify("cache", "未能清理，请在系统设置中清除本应用的缓存");
        });
      })
      .catch(() => notify("cache", "未能清理，请在系统设置中清除本应用的缓存"))
      .then(() => clearing.set(false));
  }
  return (
    <View
      onPress={close}
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.35)", zIndex: 40,
      }}
    >
      <View
        onPress={() => undefined}
        style={{
          width: Math.min(320, windowSize().width - 40),
          padding: 16, gap: 12, borderRadius: 12, borderWidth: 1,
          borderColor: palette().border, backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>显示设置</Text>
        <Stepper label="板块字号" value={() => draft().board} min={10} max={16} step={0.5} digits={1} onChange={(v) => change({ board: v })} />
        <Stepper label="列表字号" value={() => draft().list} min={10} max={16} step={0.5} digits={1} onChange={(v) => change({ list: v })} />
        <Stepper label="正文字号" value={() => draft().body} min={13} max={22} step={1} digits={0} onChange={(v) => change({ body: v })} />
        <Stepper label="正文行距" value={() => draft().spacing} min={1.2} max={2.2} step={0.1} digits={1} onChange={(v) => change({ spacing: v })} />
        {/* A rule between the type the reader tunes and the storage they empty: the two are
            different kinds of setting, and the row below acts at once, not on 完成. */}
        <View style={{ height: 1, backgroundColor: palette().border, marginVertical: 4 }} />
        {/* The image cache is the only thing the app downloads and keeps; the size rides on the
            row so a reader can see what a cleanup would free before pressing it. */}
        <View style={{ gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 13, color: palette().text }}>清除缓存</Text>
            {cache() !== null ? (
              <Text style={{ fontSize: 12, color: palette().muted }}>{formatBytes(cache() ?? 0)}</Text>
            ) : null}
            <View
              onPress={clearCache}
              accessibilityLabel="清除缓存"
              style={{
                paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6,
                backgroundColor: palette().surface, borderWidth: 1, borderColor: palette().border,
                opacity: clearing() ? 0.5 : 1,
              }}
            >
              <Text style={{ fontSize: 12, color: palette().text }}>{clearing() ? "清理中…" : "清理"}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 11, color: palette().muted }}>图片与附件缓存，不会退出登录</Text>
        </View>
        <View
          onPress={close}
          accessibilityLabel="完成"
          style={{ alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 16, borderRadius: 6, backgroundColor: palette().link }}
        >
          <Text style={{ fontSize: 13, color: "#ffffff" }}>完成</Text>
        </View>
      </View>
    </View>
  );
}
