// A thread's replies, pages, quote and reply draft (`PostDetailView` of the
// Swift app). The draft is kept per thread in the app's storage.
import { Clipboard, createAnimatedValue, keymap, List, signal, Storage, Text, View, windowSize, type PasteEvent, type ListRef } from "nsh";
import { Dialog, TextView } from "nsh/base";
import { currentUser, deletePost, editPost, HOST, loadEditForm, postReply, ReplyRefused, uploadAttachment, uploadEditAttachment, type EditForm } from "../discuz/client";
import { bookmarkPost, clearThreadReplyPages, loadFloorPage, loadReplyPage, removeBookmark } from "../discuz/forum";
import { absolutize, absoluteUrl, attachmentLinks, fixDiscuzMarkup, fixImages, floorFromLink, isAttachmentUrl, mergePage, threadIdFromLink, trimLeadingBlanks, type Post, type Reply } from "../discuz/parse";
import { draftToPost, postToDraft, replyQuoteInDraft } from "../discuz/quote";
import { downloadAttachment } from "./downloads";
import { DISCUZ_EXTENSIONS, renderDiscuzNode } from "./discuzMarkup";
import { useCommand } from "./commands";
import { openLink } from "./links";
import { timeAgo } from "../discuz/timeAgo";
import { LoadingBar } from "./LoadingBar";
import { notify } from "./toast";
import { palette } from "./appearance";
import { openImageViewer } from "./imageViewer";
import { titleBarShown } from "./TitleBar";
import { BrowserIcon, BubbleIcon, LinkIcon, PencilIcon, StarIcon, TrashIcon } from "./icons";
import { ReplyCard } from "./ReplyCard";
import { ReplyBox } from "./ReplyBox";
import { attachmentTag, createAttachments } from "./attachments";
import type { Attached } from "./ReplyBox";
import { hint } from "./Hint";
import { canSendReply } from "./replyGate";
import { bilibiliRefs } from "../bilibili/links";
import { BiliPlayer, BiliShortPlayer } from "./BiliPlayer";
import { douyinRefs } from "../douyin/links";
import { DouyinPlayer, DouyinShortPlayer } from "./DouyinPlayer";
import { xiaohongshuNoteLinks } from "../xiaohongshu/links";
import { videoLinksIn } from "../video/links";
import { VideoLinkPlayer } from "./VideoLinkPlayer";
import { XhsCard } from "./XhsCard";

// A picture by its name or its type; anything else is a file.
import { isFavorite, markFavorite } from "./favorites";

const draftKey = (tid: string) => `draft:${tid}`;

// How long a `g` waits for the second `g` of `gg`.
const G_WAIT_MS = 1000;

// The heavy HTML transform (fixDiscuzMarkup + fixImages + absolutize) per reply id, cached at
// module scope so it survives component remounts and re-renders: scrolling, re-rendering rows on
// hover, and re-opening a thread do not re-parse every body. Cleared on a full (page 1) reload,
// which is exactly when the forum may have sent fresh bodies (after a reply or an edit).
const htmlCache = new Map<string, string>();

// The thread's title shows in the header at the large size; the first post's
// own heading (its title, in the body) takes the small size the header had.
const OP_TITLE_STYLES = {
  heading: { fontSize: 16, fontWeight: 500 },
  heading1: { fontSize: 16, fontWeight: 500 },
  heading2: { fontSize: 16, fontWeight: 500 },
  heading3: { fontSize: 16, fontWeight: 500 },
} as const;

// `signedIn` gates what needs an account: the favorite star, quoting and replying.
// `onOpenThread` takes a press on a link to another 4d4y thread; `onBack` shows a Back control
// (a thread opened from a link, whose title and forum come from its first page).
// `shortcutsOpen` says the Forum's shortcut list is open, which pauses these keys.
export function Thread(props: {
  fid: string;
  post: Post;
  signedIn?: boolean;
  onUnfavorited?: () => void;
  onSignInNeeded?: () => void;
  /** Opens a thread; with `pid`, at that floor (a floor link to another thread). */
  onOpenThread?: (tid: string, pid?: string) => void;
  onBack?: () => void;
  /** A right swipe in the body goes back (a thread opened from a link, or the list in portrait). */
  onSwipeBack?: () => void;
  shortcutsOpen?: () => boolean;
  /** The floor a link opened in this thread, shown first. */
  focusPid?: string;
}) {
  // The title and forum: the post's own, or those the first page names for a thread opened from a link.
  const title = signal(props.post.title);
  const fid = signal(props.fid);
  const replies = signal<Reply[]>([]);
  const page = signal(1);
  const more = signal(true);
  // The page whose load failed (its message and Refresh button show in the thread), or null.
  const failedPage = signal<number | null>(null);
  // Messages for actions that failed (a reply, a picture, favorites): one plain line each.
  // The page whose load failed, so Retry asks for that page again.
  const draft = signal("");
  const sending = signal(false);
  // Whether the thread is in the favorites: the shared list, which the thread lists star from.
  const saved = () => isFavorite(props.post.id);
  // The thread's page on the forum, for the browser.
  const threadUrl = () => `${HOST}viewthread.php?tid=${props.post.id}`;

  // The header bar's height in landscape, where it floats over the body. NSH animates only
  // `opacity` and `transform` natively (not `height`/`maxHeight`), so the bar cannot shrink its
  // box; instead it is an overlay that slides up via `translateY`. The list keeps the full height
  // behind it (its content only starts below the bar via a padding), so as the bar slides away the
  // scrolling text flows into the space it vacates — the bar truly gives the room to the body.
  const TITLE_H = 84;
  // Landscape: tuck the title bar away while scrolling the posts, to give the body more room.
  // NSH's `List` has no `onScroll`; it feeds the scroll offset into `scrollValue`, which we
  // interpolate into the bar's translate and opacity so it slides away as you scroll down
  // and returns as you scroll back to the top. Portrait keeps the bar in the normal layout.
  const scrollOffset = createAnimatedValue(0);
  const isLandscape = () => windowSize().width > windowSize().height;
  const titleShift = () =>
    isLandscape()
      ? scrollOffset.interpolate({ inputRange: [0, 80], outputRange: [0, -TITLE_H], extrapolate: "clamp" })
      : 0;
  const titleOpacity = () =>
    isLandscape()
      ? scrollOffset.interpolate({ inputRange: [0, 80], outputRange: [1, 0], extrapolate: "clamp" })
      : 1;

  // A right swipe in the body goes back. `panActivation` fails the gesture on a small vertical move
  // (so the list still scrolls and small gestures do not trigger it); only a clear, long rightward
  // swipe counts, so it is not easy to fire by accident.
  const backPan = createAnimatedValue(0);
  const onSwipeEnd = (e: any) => {
    const dx = e?.translation?.x ?? 0;
    const vx = e?.velocity?.x ?? 0;
    if (!e?.cancelled && (dx > 150 || vx > 1700)) props.onSwipeBack?.();
    backPan.set(0);
  };

  // (The HTML transform cache is module-level, declared above the component, so it survives
  // remounts and makes re-rendering rows and re-opening a thread instant.)
  function bodyHtml(r: Reply): string {
    let h = htmlCache.get(r.id);
    if (h === undefined) {
      h = absolutize(trimLeadingBlanks(fixDiscuzMarkup(fixImages(r.body))), HOST);
      htmlCache.set(r.id, h);
    }
    return h;
  }

  // True until the first reply page has loaded (or failed), so the thread shows a spinner instead of blank.
  const firstLoad = signal(true);

  let loadingMore = false;
  const loadingMoreShown = signal(false);

  function fetchPage(n: number) {
    loadReplyPage(props.post.id, n)
      .then(({ title: pageTitle, fid: pageFid, replies: list }) => {
        if (n === 1 && pageTitle) title.set(pageTitle);
        if (pageFid && !fid()) fid.set(pageFid);
        const merged = n === 1 ? { items: list, more: list.length > 0 } : mergePage(replies(), list);
        replies.set(merged.items);
        more.set(merged.more);
        page.set(n);
        failedPage.set(null);
        if (n === 1) {
          firstLoad.set(false);
          // A fresh thread starts at the top with its title showing. The transform cache is KEPT:
          // a cached reply page carries the same bodies, so re-transforming every reply on each
          // open only made opening a thread slower. It is cleared when a reply, edit or delete
          // changes the bodies (see send/saveEdit/removeReply, which call it before reloading).
          scrollOffset.set(0);
        }
      })
      .catch((e) => {
        failedPage.set(n);
        if (n === 1) firstLoad.set(false);
      })
      .finally(() => {
        loadingMore = false;
        loadingMoreShown.set(false);
      });
  }

  function loadMore() {
    if (loadingMore || !more()) return;
    loadingMore = true;
    loadingMoreShown.set(true);
    fetchPage(page() + 1);
  }

  async function setDraft(text: string) {
    draft.set(text);
    // A draft that cannot be saved (storage full) is a convenience lost, not a failed action.
    await Storage.setItem(draftKey(props.post.id), text).catch(() => undefined);
  }

  async function send() {
    if (!canSendReply(draft()) || sending() || uploading()) return;
    // The reply's text, then the pictures as their tags.
    const body = [draftToPost(draft(), HOST), ...attachments().map(attachmentTag)].join("\n");
    sending.set(true);
    try {
      await postReply(fid(), props.post.id, body);
      notify("reply", "回复已发布。");
      attachments.set([]);
      await setDraft("");
    } catch (e) {
      // The forum's own refusal (e.g. the 30-second limit) is shown as it words it.
      notify("reply-error", e instanceof ReplyRefused ? e.message : "回复发送失败，请重试。");
    } finally {
      sending.set(false);
    }
    // Reload the replies whether or not the post reported success: the server may have kept
    // the reply even when its answer was unclear, and the list should show what it holds.
    // The thread's cached pages are stale now, so they are asked again.
    clearThreadReplyPages(props.post.id);
    htmlCache.clear();
    replies.set([]);
    more.set(true);
    fetchPage(1);
  }

  // Pictures and files pasted or dropped into the reply: uploaded to the thread, sent as tags with the reply.
  const { attachments, uploading, onPaste, onFileDrop, addFiles } = createAttachments(
    (file, kind) => {
      // While a reply is edited, its pictures go through the edit form's own upload box.
      const current = editing();
      return current ? uploadEditAttachment(current.form, file, kind) : uploadAttachment(fid(), props.post.id, file, kind);
    },
    (name) => `无法上传 ${name}，请重试。`,
    "无法添加这个文件，请点「附件」重新选择。",
  );

  function quote(r: Reply) {
    const text = replyQuoteInDraft(r, props.post.id);
    setDraft(draft() ? `${text}\n\n${draft()}` : `${text}\n`);
  }

  // Shows floor `pid` of this thread: when the list does not have it, its page replaces the
  // replies (the posts after it load from there), then the list scrolls to the floor.
  async function showFloor(pid: string) {
    if (!replies().some((r) => r.id === pid)) {
      try {
        const found = await loadFloorPage(props.post.id, pid);
        if (found.title) title.set(found.title);
        if (found.fid && !fid()) fid.set(found.fid);
        replies.set(found.replies);
        htmlCache.clear();
        page.set(found.page);
        more.set(found.replies.length > 0);
        firstLoad.set(false);
      } catch (e) {
        firstLoad.set(false);
        notify("floor-error", "无法打开该帖。");
        return;
      }
    }
    const index = replies().findIndex((r) => r.id === pid);
    if (index < 0) return;
    // The list lays out the replies it was given before it can scroll to one of them.
    setTimeout(() => repliesList?.scrollToIndex({ index, viewPosition: 0 }), 0);
  }

  // A link to a floor: in this thread the floor is shown here; in another, that thread opens at it.
  function openFloor(pid: string, tid: string) {
    if (tid === props.post.id) void showFloor(pid);
    else props.onOpenThread?.(tid, pid);
  }

  // The reply the box is editing: its loaded edit form and the text in the box. While it is set, the
  // box edits that reply instead of composing a new one; the reply draft is kept aside.
  const editing = signal<{ pid: string; seq: number; form: EditForm; text: string } | null>(null);
  // Only the signed-in user's own replies can be edited.
  const isOwn = (r: Reply) => !!props.signedIn && currentUser() === r.author.name;

  // The reply's own pictures, set aside while an edit is open; the edit has its own.
  let replyPictures: Attached[] = [];

  async function startEdit(r: Reply) {
    if (sending() || uploading() || editing()) return;
    try {
      const form = await loadEditForm(fid(), props.post.id, r.id, 1);
      replyPictures = attachments();
      attachments.set([]);
      // The box shows the quotes as `>` lines; saving turns them back into the forum's quotes.
      editing.set({ pid: r.id, seq: r.seq, form, text: postToDraft(form.message) });
      replyField?.focus();
    } catch (e) {
      notify("edit-error", e instanceof ReplyRefused ? e.message : "无法编辑该回复，请重试。");
    }
  }

  function endEdit() {
    editing.set(null);
    attachments.set(replyPictures);
    replyPictures = [];
  }

  // The reply waiting for its delete to be confirmed in the dialog, or null.
  const pendingDelete = signal<{ pid: string; seq: number } | null>(null);

  // Deletes the confirmed reply, then shows the thread as the forum now holds it.
  async function removeReply() {
    const target = pendingDelete();
    pendingDelete.set(null);
    if (!target || sending() || uploading()) return;
    sending.set(true);
    try {
      const form = await loadEditForm(fid(), props.post.id, target.pid, 1);
      await deletePost(fid(), props.post.id, target.pid, 1, form);
      notify("delete", "回复已删除。");
    } catch (e) {
      notify("delete-error", e instanceof ReplyRefused ? e.message : "删除回复失败，请重试。");
    } finally {
      sending.set(false);
    }
    clearThreadReplyPages(props.post.id);
    htmlCache.clear();
    replies.set([]);
    more.set(true);
    fetchPage(1);
  }

  function cancelEdit() {
    // A picture still uploading would land in the reply's list, so the edit waits for it.
    if (uploading()) return;
    endEdit();
  }

  async function saveEdit() {
    const current = editing();
    if (!current || !canSendReply(current.text) || sending() || uploading()) return;
    // The pictures go with the text as tags, as a reply's do.
    const body = [draftToPost(current.text, HOST), ...attachments().map(attachmentTag)].join("\n");
    sending.set(true);
    try {
      await editPost(fid(), props.post.id, current.pid, 1, current.form, body);
      notify("edit", "回复已修改。");
      endEdit();
    } catch (e) {
      // The forum's own refusal is shown as it words it; the box keeps the text for another try.
      notify("edit-error", e instanceof ReplyRefused ? e.message : "保存修改失败，请重试。");
    } finally {
      sending.set(false);
    }
    // Reload the replies whether or not the save reported success, as after a reply: the cached
    // pages hold the old text, so they are dropped and the thread is asked again.
    clearThreadReplyPages(props.post.id);
    htmlCache.clear();
    replies.set([]);
    more.set(true);
    fetchPage(1);
  }

  // Adds the thread to the favorites, or removes it when it is saved.
  async function toggleFavorite() {
    try {
      if (saved()) {
        if (await removeBookmark(props.post.id)) {
          markFavorite(props.post.id, false);
          notify("favorite", "已取消收藏。");
          props.onUnfavorited?.();
        } else {
          notify("favorite-error", "取消收藏失败，请重试。");
        }
      } else if (await bookmarkPost(props.post.id)) {
        markFavorite(props.post.id, true, props.post.lastReplyAt ?? props.post.at);
        notify("favorite", "已加入收藏。");
      }
    } catch (e) {
      notify("favorite-error", "收藏失败，请重试。");
    }
  }

  // The post page's keys (the Forum's `?` lists them). A single key never fires while a text field
  // has the focus, so typing a reply is safe; they are off while the list is open.
  // The reply under the pointer is highlighted; `q` quotes it.
  const hovered = signal<number | null>(null);
  // The thread's author (楼主) is the poster of floor #1, once the first page has loaded.
  const opId = () => replies().find((r) => r.seq === 1)?.author.id;
  // The Forum's shortcut list, open over the window: the keys are off while it is.
  const keysOn = () => !props.shortcutsOpen?.();
  let replyField: { focus(): void } | undefined;
  let repliesList: ListRef | undefined;
  let gPending: ReturnType<typeof setTimeout> | undefined;

  const goTop = () => repliesList?.scrollToOffset({ offset: 0, animated: true });
  // `g g` is a chord of two presses, so it is bound here rather than through the command's keys.
  keymap.bind(
    "g",
    () => {
      if (!keysOn()) return;
      if (gPending !== undefined) {
        clearTimeout(gPending);
        gPending = undefined;
        goTop();
        return;
      }
      gPending = setTimeout(() => {
        gPending = undefined;
      }, G_WAIT_MS);
    },
    { when: "notEditing" },
  );
  useCommand("thread.top", { enabled: keysOn, run: goTop });
  useCommand("thread.bottom", {
    enabled: keysOn,
    run: () => repliesList?.scrollToEnd({ animated: true }),
  });
  useCommand("thread.reply", {
    enabled: () => keysOn() && !!props.signedIn,
    run: () => replyField?.focus(),
  });
  useCommand("thread.favorite", {
    enabled: () => keysOn() && !!props.signedIn,
    checked: saved,
    run: () => void toggleFavorite(),
  });
  useCommand("thread.quote", {
    enabled: () => keysOn() && !!props.signedIn && !editing() && replies().some((r) => r.seq === hovered()),
    run: () => {
      const target = replies().find((r) => r.seq === hovered());
      if (!target) return;
      quote(target);
      replyField?.focus();
    },
  });
  // `e` edits the highlighted reply, when it is the signed-in user's own (the same reply `q` quotes).
  useCommand("thread.edit", {
    enabled: () => {
      const target = replies().find((r) => r.seq === hovered());
      return keysOn() && !editing() && !!target && isOwn(target);
    },
    run: () => {
      const target = replies().find((r) => r.seq === hovered());
      if (target) void startEdit(target);
    },
  });

  // Load the first page and the saved draft once.
  if (props.focusPid) void showFloor(props.focusPid);
  else fetchPage(1);
  Storage.getItem(draftKey(props.post.id))
    .then((text) => draft.set(postToDraft(text ?? "")))
    .catch(() => undefined);

  return (
    <View
      pan={props.onSwipeBack ? { x: backPan } : undefined}
      panActivation={props.onSwipeBack ? { activeOffsetX: 48, failOffsetY: 12 } : undefined}
      onPanEnd={props.onSwipeBack ? onSwipeEnd : undefined}
      style={{ flex: 1, alignSelf: "stretch", overflow: "hidden" }}
    >
      {/* Under the title bar the title sits in the bar's caption area (the column extends up into it), centred
          on the bar's 44pt; it drags the window where nothing presses. With no bar, it keeps the top inset. */}
      <View
        desktop={{ windowDrag: true }}
        style={{
          // Landscape: float the bar over the body (so the body keeps the full height) so it can
          // slide away on scroll and let the text take its place. Portrait: a normal bar above.
          ...(isLandscape() ? { position: "absolute", left: 0, right: 0, top: 0, zIndex: 10 } : {}),
          height: isLandscape() ? TITLE_H : undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: isLandscape() ? 0 : 8,
          paddingTop: isLandscape() ? 0 : titleBarShown() ? 18 : 20,
          backgroundColor: palette().bg,
          transform: [{ translateY: titleShift() }],
          opacity: titleOpacity(),
          overflow: "hidden",
        }}
      >
        {/* Back sits in the row, first, so the icons after it move right with it. */}
        {props.onBack ? (
          <View onPress={props.onBack} accessibilityLabel="返回" style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>{"‹ 返回"}</Text>
          </View>
        ) : null}
        {/* The icons sit at the left, bottom-aligned with the title: the favorite star, and the thread's
            browser icon, which opens the thread in the system browser. */}
        {/* Three equal 32dp boxes with one gap: the icons are centred and evenly
            spaced however wide their own glyphs are. */}
        <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 4, flexShrink: 0 }}>
          <View
            onPress={props.signedIn ? toggleFavorite : () => props.onSignInNeeded?.()}
            accessibilityLabel={!props.signedIn ? "登录后收藏" : saved() ? "取消收藏" : "加入收藏"}
            style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            {saved() ? <StarIcon size={17} filled={true} /> : <StarIcon size={17} />}
          </View>
          <View
            onPress={() => void openLink(threadUrl())}
            accessibilityLabel="在浏览器中打开帖子"
            style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <BrowserIcon size={17} />
          </View>
          <View
            onPress={() => {
              Clipboard.writeText(threadUrl());
              notify("copy-link", "链接已复制。");
            }}
            accessibilityLabel="复制帖子链接"
            style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <LinkIcon size={17} />
          </View>
        </View>
        {/* The title is centred in the space right of the icons; a long one is cut off at the icons' edge,
            and fades out over its first stretch there. */}
        <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <Text style={{ numberOfLines: 1, textAlign: "center", fontSize: 22, fontWeight: 600, color: palette().text }}>{title()}</Text>
          <View
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: 36,
              backgroundImage: `linear-gradient(to right, ${palette().bg}, transparent)`,
            }}
          />
        </View>
      </View>
      {/* A virtualized list: only the replies near the viewport exist, and their views are
          reused as the user scrolls. Each row reads its reply through `item()`. */}
      <List
        style={{ flex: 1 }}
        contentStyle={{ padding: 12, gap: 12, paddingTop: isLandscape() ? TITLE_H + 4 : 12 }}
        each={replies()}
        estimatedItemSize={180}
        scrollValue={scrollOffset}
        onLoadMore={loadMore}
        footer={() => <View>{loadingMoreShown() ? <LoadingBar /> : null}</View>}
        ref={(n: ListRef | null) => {
          repliesList = n ?? undefined;
        }}
      >
        {(item) => (
          <ReplyCard
            avatar={item().author.avatar ? absoluteUrl(item().author.avatar!, HOST) : undefined}
            name={item().author.name}
            isOp={opId() !== undefined && item().author.id === opId()}
            meta={`#${item().seq} · ${timeAgo(item().at)}`}
            highlighted={() => hovered() === item().seq}
            onHoverIn={() => hovered.set(item().seq)}
            onHoverOut={() => {
              if (hovered() === item().seq) hovered.set(null);
            }}
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {props.signedIn && isOwn(item()) ? (
                  <View onPress={() => void startEdit(item())} accessibilityLabel="编辑"
                    style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                    <PencilIcon size={16} />
                  </View>
                ) : null}
                {props.signedIn && isOwn(item()) && item().seq !== 1 ? (
                  <View onPress={() => pendingDelete.set({ pid: item().id, seq: item().seq })} accessibilityLabel="删除"
                    style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                    <TrashIcon size={16} />
                  </View>
                ) : null}
                <View onPress={() => props.signedIn ? quote(item()) : props.onSignInNeeded?.()}
                  accessibilityLabel="引用"
                  style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                  <BubbleIcon size={16} />
                </View>
              </View>
            }
            body={
              <View style={{ gap: 12, alignSelf: "stretch" }}>
                <TextView
                  html={bodyHtml(item())}
                  styles={item().seq === 1 ? OP_TITLE_STYLES : undefined}
                  extensions={DISCUZ_EXTENSIONS}
                  renderCustom={renderDiscuzNode}
                  onImagePress={(e: any) => {
                    // A picture not in a link opens the zoomable viewer. The original (full-size)
                    // URL the page carried rides in `title`; `src` is the compressed display copy.
                    const img = e?.image ?? e;
                    const src: string = img?.src ?? "";
                    const full: string = img?.title || src;
                    if (full || src) openImageViewer(full || src, src);
                  }}
                  onLinkPress={(e: any) => {
                    // A 4d4y thread link opens in this column; a file the post attaches is saved to Downloads;
                    // any other link opens in the system browser. A picture (or its attachment) opens the zoomable viewer.
                    // A quote's arrow goes to its floor (see `openFloor`).
                    const url: string | undefined = e?.url ?? e?.href ?? e?.link;
                    if (!url) return;
                    const floor = floorFromLink(url);
                    if (floor) {
                      openFloor(floor.pid, floor.ptid);
                      return;
                    }
                    // A picture, or a Discuz attachment that is really an image, opens the zoomable viewer.
                    if (/\.(?:jpg|jpeg|png|gif|webp|bmp)(?:[?#]|$)/i.test(url) || isAttachmentUrl(url)) {
                      openImageViewer(url);
                      return;
                    }
                    const tid = threadIdFromLink(url);
                    if (tid && props.onOpenThread) {
                      props.onOpenThread(tid);
                    } else if (isAttachmentUrl(url)) {
                      const file = attachmentLinks(item().body).find((a) => absoluteUrl(a.url, HOST) === url);
                      void downloadAttachment(url, file?.name ?? "download");
                    } else {
                      void openLink(url);
                    }
                  }}
                />
                {/* Bilibili videos the post links to play under its text (the text view cannot show a player). */}
                {bilibiliRefs(item().body).map((ref) => ("url" in ref ? <BiliShortPlayer url={ref.url} /> : <BiliPlayer video={ref} />))}
                {douyinRefs(item().body).map((ref) => ("url" in ref ? <DouyinShortPlayer url={ref.url} /> : <DouyinPlayer id={ref.id} />))}
                {videoLinksIn(item().body).map((url) => (
                  <VideoLinkPlayer url={url} />
                ))}
                {xiaohongshuNoteLinks(item().body).map((link) => (
                  <XhsCard link={link} />
                ))}
              </View>
            }
          />
        )}
      </List>
      {/* Loading and failure show centred over the list (which is empty while they show). */}
      {firstLoad() && replies().length === 0 && failedPage() === null ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <View style={{ alignItems: "center", paddingVertical: 16, gap: 8 }}>
            <LoadingBar />
            <Text style={{ fontSize: 12, color: palette().muted }}>正在加载帖子…</Text>
          </View>
        </View>
      ) : null}
      {failedPage() !== null ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <View style={{ alignItems: "center", padding: 16, gap: 8 }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>回复加载失败。</Text>
            <View
              onPress={() => fetchPage(failedPage()!)}
              accessibilityLabel="刷新"
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: palette().border }}
            >
              <Text style={{ fontSize: 13, color: palette().text }}>刷新</Text>
            </View>
          </View>
        </View>
      ) : null}
      {/* The reply box is always visible, as on the desktop. Signed out, sending
        a reply opens the sign-in sheet instead of silently doing nothing. */}
      <View style={{ alignSelf: "stretch" }}>
        {/* Shown while the box edits a reply: which floor, and that Send saves the edit. */}
        {editing() ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingTop: 12 }}>
              <Text style={{ fontSize: 12, color: palette().muted }}>{`正在编辑 #${editing()!.seq}`}</Text>
            </View>
        ) : null}
        {/* The box edits the reply under edit, and composes a new reply otherwise. */}
        <ReplyBox
            onFileDrop={onFileDrop}
            onAttach={addFiles}
            draft={() => editing()?.text ?? draft()}
            onDraft={(text) => {
              const current = editing();
              if (current) editing.set({ ...current, text });
              else setDraft(text);
            }}
            sending={() => sending()}
            uploading={() => uploading()}
            attachments={() => attachments()}
            canSend={() => canSendReply(editing()?.text ?? draft())}
            onSend={() => {
              if (!props.signedIn) { props.onSignInNeeded?.(); return; }
              if (editing()) void saveEdit(); else void send();
            }}
            onPaste={onPaste}
            onCancel={cancelEdit}
            cancelShown={() => editing() !== null}
            fieldRef={(field) => {
              replyField = field;
            }}
        />
      </View>
      {/* Deleting asks first. The button is red: the reply cannot be brought back. */}
      {pendingDelete() ? (
        // The popup fills the window and centres the card, which a dialog would otherwise leave at its top left.
        <Dialog
          animation="fade"
          onCancel={() => pendingDelete.set(null)}
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
          backdropStyle={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.3)" }}
        >
          <View style={{ width: 320, padding: 20, gap: 12, borderRadius: 12, backgroundColor: palette().bg }}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>{`删除 #${pendingDelete()!.seq} 这条回复？`}</Text>
            <Text style={{ fontSize: 13, color: palette().muted }}>删除后无法恢复。</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <View
                onPress={() => pendingDelete.set(null)}
                accessibilityLabel="取消"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: palette().border }}
              >
                <Text style={{ fontSize: 13, color: palette().text }}>取消</Text>
              </View>
              <View
                onPress={() => void removeReply()}
                accessibilityLabel="删除"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, backgroundColor: palette().danger }}
              >
                <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>删除</Text>
              </View>
            </View>
          </View>
        </Dialog>
      ) : null}
    </View>
  );
}
