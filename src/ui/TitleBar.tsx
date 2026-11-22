import { cleanup, effect, LayoutAnimation, Overlay, reduceMotion, signal, Text, untracked, View, type ViewRef } from "nsh";
import { Input } from "nsh/base";
import { hint } from "./Hint";
import { isAvailable, Menu, titleBar, Window } from "./platform";
import { platform } from "nsh";
import { palette } from "./appearance";
import { menuBar } from "./commands";
import { onEscape } from "./escape";
import { channelsCollapsed, toggleChannelsCollapsed } from "./channelRail";
import { SearchIcon, SidebarIcon } from "./icons";

/** Hides the system's title bar, so the app draws its own (`TitleBar`). Call once at launch. */
export function hideSystemTitleBar(): void {
  if (isAvailable) Window.get("main")?.set({ titleBar: { style: "hidden", height: 44 } });
}

/** Fades the next change of the search field: 240 ms, opacity only, so nothing slides or moves while the
 * field and icon come and go; unless the system asks for reduced motion. Call it before the change. */
export function animateSearchChange(): void {
  if (reduceMotion()) return;
  const curve = { type: "easeInEaseOut" as const };
  LayoutAnimation.configureNext({
    duration: 240,
    update: { ...curve, property: "opacity" },
    create: { ...curve, property: "opacity" },
    delete: { ...curve, property: "opacity" },
  });
}

/** Whether the app draws the title bar: a desktop whose window hides its own. */
export function titleBarShown(): boolean {
  return isAvailable && titleBar().height > 0;
}

/** What the search control shows and does: the field when open, else its icon (signed in only). */
export type SearchProps = {
  open: () => boolean;
  draft: () => string;
  signedIn: () => boolean;
  onDraft: (text: string) => void;
  onSubmit: (term: string) => void;
  onOpen: () => void;
  /** Hides the field on a press outside it; the search and its results stay. */
  onHide: () => void;
  onClose: () => void;
  /** Counts up each time the field should take the focus (the `/` shortcut); the field focuses on a change. */
  focusTick?: () => number;
  /** The search the threads show ("" for none): beside the icon while the field is closed. */
  term: () => string;
};

function Glyph(props: { label: string; title: string; onPress: () => void; size?: number }) {
  return (
    <View
      onPress={props.onPress}
      accessibilityLabel={props.title}
      tooltip={hint("关闭搜索 (Esc)")}
      style={{ width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: palette().muted, fontSize: props.size ?? 22 }}>{props.label}</Text>
    </View>
  );
}

/** The search field, opened from its icon: Return searches, ✕ closes it. */
export function SearchControl(props: SearchProps) {
  const field = signal<ViewRef | null>(null);
  const input = signal<ViewRef | null>(null);
  const focused = signal(false);
  const focusSoon = () => setTimeout(() => input()?.focus(), 0);
  const openAndFocus = () => {
    props.onOpen();
    focusSoon();
  };
  let lastTick = 0;
  effect(() => {
    const tick = props.focusTick?.() ?? 0;
    untracked(() => {
      if (tick === lastTick) return;
      lastTick = tick;
      focusSoon();
    });
  });
  cleanup(
    onEscape(() => {
      if (!focused() || !props.open()) return false;
      props.onHide();
      return true;
    }),
  );
  return (
    <>
      {
}
      {props.signedIn() ? (
        <View
          onPress={props.open() ? undefined : openAndFocus}
          accessibilityLabel="搜索帖子"
          tooltip={hint("搜索帖子 (/)")}
          style={
            props.open()
              ? { width: 0, padding: 0, opacity: 0, overflow: "hidden" }
              : { padding: 4, borderRadius: 6, opacity: 1, flexDirection: "row", alignItems: "center", gap: 6 }
          }
        >
          <SearchIcon size={16} />
          {}
          {!props.open() && props.term().length > 0 ? (
            <Text style={{ numberOfLines: 1, fontSize: 13, color: palette().text, maxWidth: 200 }}>
              {props.term()}
            </Text>
          ) : null}
        </View>
      ) : null}
      {props.open() ? (
        <View
          ref={(n) => field.set(n)}
          style={{
            flex: 1,
            maxWidth: 220,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            height: 32,
            paddingLeft: 3,
            paddingRight: 2,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().surface,
          }}
        >
          <SearchIcon size={16} />
          <Input
            ref={(n: ViewRef | null) => input.set(n)}
            onFocus={() => focused.set(true)}
            onBlur={() => {
              focused.set(false);
              if (props.open()) props.onHide();
            }}
            placeholder="搜索帖子"
            value={props.draft()}
            onChange={({ value: text }: { value: string }) => props.onDraft(text)}
            onSubmit={({ text }: { text: string }) => props.onSubmit(text)}
            returnKeyType="search"
            accessibilityLabel="搜索帖子"
            style={{ flex: 1, height: 26, fontSize: 13, borderWidth: 0, backgroundColor: "transparent" }}
          />
          <Glyph label="✕" title="关闭搜索" onPress={props.onClose} size={13} />
        </View>
      ) : null}
      {}
      {props.open() && field() ? (
        <Overlay anchor={field()} onPressOutside={props.onHide}>
          <View style={{ width: 0, height: 0 }} />
        </Overlay>
      ) : null}
    </>
  );
}

/** The title bar: it drags the window (double-click maximizes, as the system's does). */
export function TitleBar(props: { wide: () => boolean; search: SearchProps }) {
  return (
    <View
      desktop={{ windowDrag: true }}
      style={{
        height: titleBar().height,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: titleBar().left + 14,
        paddingRight: titleBar().right + 14,
      }}
    >
      {}
      {platform.os === "windows" || platform.os === "linux" ? (
        <View
          onPress={() => {
            Menu.popup(menuBar()).catch(() => undefined);
          }}
          accessibilityLabel="DiscoveryOSX"
          tooltip={hint("菜单")}
          style={{ padding: 4, borderRadius: 6 }}
        >
          <Text style={{ fontSize: 13, color: palette().text }}>DiscoveryOSX</Text>
        </View>
      ) : null}
      {props.wide() ? (
        <View
          onPress={toggleChannelsCollapsed}
          accessibilityLabel={channelsCollapsed() ? "展开版块" : "收起版块"}
          tooltip={hint(channelsCollapsed() ? "展开版块" : "收起版块")}
          style={{ padding: 4, borderRadius: 6 }}
        >
          <SidebarIcon size={16} />
        </View>
      ) : null}
      {}
      <View style={{ flexDirection: "row", width: props.search.open() ? 224 : undefined }}>
        <SearchControl {...props.search} />
      </View>
      <View style={{ flex: 1 }} />
    </View>
  );
}
