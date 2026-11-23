import { effect, Image, LayoutAnimation, Picker, reduceMotion, signal, Text, untracked, View, type PasteEvent } from "nsh";
import { LineIcon } from "./lineIcons";
import { notify } from "./toast";
import { useCommand } from "./commands";
import { Input } from "nsh/base";
import { palette } from "./appearance";
import { keyboardIsOpen, textFieldFocused } from "./keyboard";
import { PlaneIcon, RefreshIcon } from "./icons";
import { hint } from "./Hint";
import { quoteAttribution } from "../discuz/quote";
import type { PixelSize } from "./pixelSize";

export type Attached = { id: string; kind: "image" | "file"; name: string; preview: string; size: PixelSize | null };

const SCALE = 0.5;
const MAX_HEIGHT = 300;
const SQUARE = 128;

function Thumb(props: { src: string; size: PixelSize | null; maxHeight?: number }) {
  const limit = props.maxHeight ?? MAX_HEIGHT;
  const box = props.size && props.size.height > 0
    ? (() => {
        const height = Math.min(props.size!.height * SCALE, limit);
        return { width: (props.size!.width * height) / props.size!.height, height };
      })()
    : (() => {
        const side = Math.min(SQUARE, limit);
        return { width: side, height: side };
      })();
  return (
    <View style={{ width: box.width, height: box.height, borderRadius: 6, overflow: "hidden" }}>
      <Image src={props.src} style={{ width: box.width, height: box.height, objectFit: "contain" }} />
    </View>
  );
}

const MIN_FIELD = 56;
const MAX_FIELD = 354;
const ONE_LINE = 34;
const IME_FIELD_MAX = 120;
const IME_ATTACH_MAX = 64;
const CHIP_RADIUS = 25;

export function ReplyBox(props: {
  draft: () => string;
  onDraft: (text: string) => void;
  sending: () => boolean;
  uploading?: () => boolean;
  attachments?: () => Attached[];
  /** Whether the reply may be sent now. By default, any text. */
  canSend?: () => boolean;
  /** The quote the draft starts with. Only the attribution is shown above the field. */
  quote?: () => string;
  /** Drops the quote, keeping the reader's own words and attachments. */
  onClearQuote?: () => void;
  onSend: () => void;
  onPaste?: (e: PasteEvent) => void;
  /** Local files dropped on the box, as `file:` URLs. */
  onFileDrop?: (uris: string[]) => void;
  /** Files chosen from the system picker. When absent, no picker buttons show
   * (private messages, for instance, have no attachment upload). */
  onAttach?: (files: File[]) => void;
  /** The text field's handle, for the app to focus it (the `r` shortcut). */
  fieldRef?: (field: { focus(): void }) => void;
  /** The field's placeholder; "回复" by default. */
  placeholder?: string;
  /** The field's height when the box is open, and the height it grows to; the reply's by default. */
  minField?: number;
  maxField?: number;
  /** Whether the box folds to a chip while empty and unfocused (true by default). */
  collapsible?: boolean;
  /** A Cancel button to the left of the send button, when given. */
  onCancel?: () => void;
  /** Whether the Cancel button shows now, when it is given (it shows by default). */
  cancelShown?: () => boolean;
}) {
  const sendable = () => (props.canSend ? props.canSend() : props.draft().length > 0) && !props.sending() && !props.uploading?.();
  const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
  async function picked(files: File[]) {
    const usable = files.filter((f) => f.size <= MAX_ATTACH_BYTES);
    if (files.length > usable.length) notify("attach-size", "有文件超过 10 MB，已跳过。");
    if (usable.length > 0) props.onAttach?.(usable);
  }
  async function pickImages() {
    try {
      const list = await Picker.pickImages({ multiple: true, limit: 5, maxDimension: 1600, quality: 0.85 });
      await picked(list.map((p) => p.file));
    } catch {
      notify("attach-pick", "无法打开图片选择器。");
    }
  }
  async function pickFiles() {
    try {
      const list = await Picker.pickFiles({ multiple: true, limit: 5 });
      await picked(list.map((p) => p.file).filter((f): f is File => f !== null));
    } catch {
      notify("attach-pick", "无法打开文件选择器。");
    }
  }
  useCommand("reply.send", { enabled: sendable, run: () => props.onSend() });
  const pictures = () => props.attachments?.() ?? [];
  const floor = props.minField ?? MIN_FIELD;
  const ceiling = props.maxField ?? MAX_FIELD;
  const imeOpen = keyboardIsOpen;
  const fieldCeiling = () => imeOpen() ? Math.min(ceiling, Math.max(IME_FIELD_MAX, floor)) : ceiling;
  const attachCeiling = () => imeOpen() ? IME_ATTACH_MAX : MAX_HEIGHT;
  const quoteText = () => props.quote?.() ? quoteAttribution(props.quote!()) : "";
  const fieldHeight = signal(floor);
  const focused = signal(false);
  const collapsed = () =>
    props.collapsible !== false && !focused() && !props.quote?.() && props.draft().length === 0 && pictures().length === 0 && !props.uploading?.();
  let field: { focus(): void; blur(): void } | undefined;
  let wasSending = false;
  effect(() => {
    const now = props.sending();
    untracked(() => {
      if (wasSending && !now && props.draft().length === 0) field?.blur();
      wasSending = now;
    });
  });
  let lastCollapsed: boolean | null = null;
  effect(() => {
    const now = collapsed();
    untracked(() => {
      if (lastCollapsed !== null && now !== lastCollapsed && !reduceMotion()) {
        const curve = { type: "easeInEaseOut" as const };
        LayoutAnimation.configureNext({
          duration: 240,
          update: curve,
          create: { ...curve, property: "opacity" },
          delete: { ...curve, property: "opacity" },
        });
      }
      lastCollapsed = now;
    });
  });
  let inserted: string | null = null;
  const pathOf = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));
  const takeBack = (text: string) => {
    const old = props.draft();
    const taken = inserted;
    inserted = null;
    props.onDraft(text);
    if (taken && text.length === old.length + taken.length && text.includes(taken)) {
      setTimeout(() => props.onDraft(old), 0);
    }
  };

  return (
    <View
      onFileDrop={(e: { uris: string[] }) => {
        inserted = e.uris.map(pathOf).join("\n");
        props.onFileDrop?.(e.uris);
      }}
      style={{
        alignSelf: "stretch",
        flexShrink: 0,
        margin: 12,
        padding: 8,
        gap: 4,
        borderRadius: collapsed() ? CHIP_RADIUS : 8,
        backgroundColor: palette().surface,
        opacity: props.sending() ? 0.5 : 1,
      }}
    >
      {pictures().length > 0 ? (
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 4, maxHeight: attachCeiling() }}>
          {pictures().map((p) =>
            p.kind === "image" ? (
              <Thumb src={p.preview} size={p.size} maxHeight={attachCeiling()} />
            ) : (
              <View style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: palette().border, maxHeight: attachCeiling(), justifyContent: "center" }}>
                <Text style={{ fontSize: 13, color: palette().text, numberOfLines: 1, maxHeight: attachCeiling() }}>{p.name}</Text>
              </View>
            ),
          )}
        </View>
      ) : null}
      {
}
      {quoteText() ? (
        <View
          accessibilityLabel="引用的作者与时间，只读"
          style={{
            flexDirection: "row", gap: 8, marginHorizontal: 4, paddingVertical: 6, paddingHorizontal: 10,
            borderRadius: 6, backgroundColor: palette().bg,
            borderLeftWidth: 3, borderLeftColor: palette().link,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 12, lineHeight: 17, color: palette().link, numberOfLines: 1 }}>
              {quoteText()}
            </Text>
          </View>
          {props.onClearQuote ? (
            <View
              onPress={props.onClearQuote}
              accessibilityLabel="取消引用"
              tooltip={hint("取消引用")}
              style={{ width: 24, height: 24, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
            >
              <Text style={{ fontSize: 17, lineHeight: 20, color: palette().muted }}>×</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {}
      <View style={{ flexDirection: "row", alignItems: collapsed() ? "center" : "flex-end", gap: 8, flexShrink: 0 }}>
        <Input
          ref={(n) => {
            field = n as unknown as { focus(): void; blur(): void };
            if (n) props.fieldRef?.(field);
          }}
          placeholder={props.placeholder ?? "回复"}
          multiline={true}
          value={props.draft()}
          onChange={({ value: text }: { value: string }) => takeBack(text)}
          onPaste={(e: PasteEvent) => {
            if (e.files.length > 0 || e.uris.length > 0) inserted = e.text || null;
            props.onPaste?.(e);
          }}
          onFocus={() => { focused.set(true); textFieldFocused.set(true); }}
          onBlur={() => { focused.set(false); textFieldFocused.set(false); }}
          onContentSizeChange={({ size }: { size: { height: number } }) =>
            fieldHeight.set(Math.min(ceiling, Math.max(floor, Math.ceil(size.height) + 8)))
          }
          style={{
            flex: 1,
            height: collapsed() ? ONE_LINE : Math.min(fieldHeight(), fieldCeiling()),
            padding: 4,
            paddingLeft: 7,
            paddingVertical: collapsed() ? (ONE_LINE - 17) / 2 : 4,
            fontSize: 14,
            color: palette().text,
            placeholderColor: palette().muted,
            caretColor: palette().link,
            backgroundColor: "transparent",
          }}
        />
        {props.draft().length > 0 ? (
          <View
            onPress={() => {
              inserted = null;
              props.onDraft("");
              field?.focus();
            }}
            accessibilityLabel="清空"
            tooltip={hint("清空输入")}
            style={{ width: 32, height: 28, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface }}
          >
            <Text style={{ fontSize: 18, color: palette().muted }}>×</Text>
          </View>
        ) : null}
        {props.onAttach ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <View onPress={pickImages} accessibilityLabel="添加图片" tooltip={hint("添加图片")}
              style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface }}>
              <LineIcon name="image" size={17} />
            </View>
            <View onPress={pickFiles} accessibilityLabel="添加附件" tooltip={hint("添加附件")}
              style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface }}>
              <LineIcon name="paperclip" size={17} />
            </View>
          </View>
        ) : null}
        {props.uploading?.() ? (
          <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 12, color: palette().muted }}>正在上传…</Text>
            <RefreshIcon size={12} spinning={true} />
          </View>
        ) : null}
        {pictures().length > 0 && !props.uploading?.() ? (
          <View style={{ height: 26, justifyContent: "center" }}>
            <Text style={{ fontSize: 12, color: palette().muted }}>
              {`已添加 ${pictures().length} 个附件`}
            </Text>
          </View>
        ) : null}
        {props.onCancel && (props.cancelShown?.() ?? true) ? (
          <View onPress={props.onCancel} accessibilityLabel="取消" style={{ height: 26, justifyContent: "center", paddingHorizontal: 6 }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>取消</Text>
          </View>
        ) : null}
        <View
          onPress={sendable() ? props.onSend : undefined}
          accessibilityLabel="发送"
          tooltip={hint("发送 (⌘Enter)")}
          style={{ padding: 4, paddingRight: 7 }}
        >
          {props.sending() ? <RefreshIcon size={18} spinning={true} /> : <PlaneIcon size={18} enabled={() => sendable()} />}
        </View>
      </View>
    </View>
  );
}
