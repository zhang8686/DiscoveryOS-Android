import { Clipboard, cleanup, colorScheme, createAnimatedValue, createMotion, effect, keymap, List, pixelRatio, signal, Storage, Text, View, windowSize, type PasteEvent, type ListRef, type JSX } from "nsh";
import { settleBack, settleExit, slideIn } from "./pageSlide";
import { Dialog, TextView } from "nsh/base";
import { currentUser, deletePost, editPost, HOST, loadEditForm, postReply, ReplyRefused, uploadAttachment, uploadEditAttachment, type EditForm } from "../discuz/client";
import { bookmarkPost, clearThreadReplyPages, loadFloorPage, loadReplyPage, removeBookmark } from "../discuz/forum";
import { absolutize, absoluteUrl, attachmentLinks, fixDiscuzMarkup, fixImages, floorFromLink, htmlToText, isAttachmentUrl, linkifyBareUrls, mergePage, showAttachedPictures, threadIdFromLink, trimLeadingBlanks, type Post, type Reply } from "../discuz/parse";
import { attachmentIsPicture } from "../discuz/attachments";
import { draftToPost, postToDraft, replyQuoteInDraft, splitDraftQuote } from "../discuz/quote";
import { replyToChip, replyToHeader, replyToNotice, type ReplyTarget } from "../discuz/replyTo";
import { downloadAttachment } from "./downloads";
import { DISCUZ_EXTENSIONS, renderDiscuzNode } from "./discuzMarkup";
import { useCommand } from "./commands";
import { openLink } from "./links";
import { timeAgo } from "../discuz/timeAgo";
import { LoadingBar } from "./LoadingBar";
import { notify } from "./toast";
import { palette } from "./appearance";
import { LineIcon } from "./lineIcons";
import { openGallery, openImageViewer, postImages } from "./imageViewer";
import { titleBarShown } from "./TitleBar";
import { BrowserIcon, BubbleIcon, EnvelopeIcon, LinkIcon, PencilIcon, QuoteIcon, StarIcon, TrashIcon } from "./icons";
import { ReplyCard } from "./ReplyCard";
import { ReplyBox } from "./ReplyBox";
import { bodyPicturePx, clearWarmedImages, warmImages } from "./imageWarm";
import { ThreadSkeleton } from "./Skeleton";
import { attachmentTag, createAttachments } from "./attachments";
import type { Attached } from "./ReplyBox";
import { hint } from "./Hint";
import { displaySettings } from "./settings";
import { PmComposer } from "./PmComposer";
import { ProfileSheet } from "./ProfileSheet";
import { attachedPicture, attachedPictureKnown, attachedPictureRevision } from "./attachPictures";
import { canSendReply } from "./replyGate";
import { clampDockY, loadDockY, saveDockY } from "./threadDock";

import { isFavorite, markFavorite } from "./favorites";

const draftKey = (tid: string) => `draft:${tid}`;
// The floor a reply is aimed at is kept apart from the draft: the draft stays just the reader's
// words, while the target survives a restart as a small chip above the field.
const replyTargetKey = (tid: string) => `reply-to:${tid}`;

// How long a `g` waits for the second `g` of `gg`.
const G_WAIT_MS = 1000;

// The heavy HTML transform (fixDiscuzMarkup + fixImages + absolutize) per reply id, cached at
// module scope so it survives component remounts and re-renders: scrolling, re-rendering rows on
// hover, and re-opening a thread do not re-parse every body. Cleared on a full (page 1) reload,
// which is exactly when the forum may have sent fresh bodies (after a reply or an edit). The
// cache is bounded: browsing many threads would otherwise keep every floor's HTML forever.
const htmlCache = new Map<string, string>();
// A virtualized list keeps well under 20 floors on screen at once; 160 parsed bodies
// is enough for re-opening a thread and recent scrolling, without holding every
// floor of every thread ever visited (each body is a full HTML string).
const HTML_CACHE_LIMIT = 120;

/** Reads a reply's parsed HTML, or parses and stores it; evicts the oldest entries past the limit. */
function cachedBodyHtml(id: string, parse: () => string): string {
  const hit = htmlCache.get(id);
  if (hit !== undefined) {
    // Refresh its recency so the cache keeps the entries still in use.
    htmlCache.delete(id);
    htmlCache.set(id, hit);
    return hit;
  }
  const html = parse();
  htmlCache.set(id, html);
  if (htmlCache.size > HTML_CACHE_LIMIT) {
    // Drop the oldest quarter: the first entries are the longest-untouched.
    const drop = Math.floor(HTML_CACHE_LIMIT / 4);
    let n = 0;
    for (const key of htmlCache.keys()) {
      if (n++ >= drop) break;
      htmlCache.delete(key);
    }
  }
  return html;
}

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
// A round, translucent action disc. The thread's own actions and the jump buttons share one look,
// so the column's bottom right reads as one cluster.
function ActionDisc(props: { label: string; onPress: () => void; active?: boolean; faint?: boolean; children: JSX.Element }) {
  // `faint` is the lighter wash used across the whole action cluster — the always-visible discs,
  // the folded menu too — so it covers less of the post behind it. Active state stays opaque.
  const wash = () => {
    if (props.active) return palette().selected;
    if (colorScheme() === "dark") return props.faint ? "rgba(22, 27, 34, 0.42)" : "rgba(22, 27, 34, 0.72)";
    return props.faint ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.82)";
  };
  return (
    <View
      onPress={props.onPress}
      accessibilityLabel={props.label}
      tooltip={hint(props.label)}
      style={{
        width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
        backgroundColor: wash(),
        borderWidth: 1, borderColor: palette().border,
      }}
    >
      {props.children}
    </View>
  );
}

// The thread's actions, folded under the round control: the star, the browser and the link. A short
// upward entrance makes them rise out of it; `createMotion` rests at its end state, so a skipped
// motion still shows them.
function ThreadActions(props: { saved: boolean; onFavorite: () => void; onBrowser: () => void; onLink: () => void }) {
  const entrance = createMotion({ enter: "fadeInUp" });
  return (
    <View style={entrance.style}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <ActionDisc faint label={props.saved ? "取消收藏" : "加入收藏"} onPress={props.onFavorite}>
          <StarIcon size={17} filled={props.saved} />
        </ActionDisc>
        <ActionDisc faint label="在浏览器中打开帖子" onPress={props.onBrowser}>
          <BrowserIcon size={17} />
        </ActionDisc>
        <ActionDisc faint label="复制帖子链接" onPress={props.onLink}>
          <LinkIcon size={17} />
        </ActionDisc>
      </View>
    </View>
  );
}

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
  /** Portrait: opens the boards and thread list, which stay out of the body's way there. */
  onOpenSidebars?: () => void;
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
  // The quoted passage, kept apart from what the reader writes: it shows above the field, drops on
  // its own, and is put back in front of the words when the reply is sent or the draft is saved
  // (so a saved draft keeps the `>`-line form older builds wrote).
  const quoted = signal("");
  // A targeted reply (`reppost`) is mutually exclusive with a quote: one header at the top of a
  // post, never both. Its chip shows `回复 22# mrky`, and it is stored on its own key.
  const replyTarget = signal<ReplyTarget | null>(null);
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
  // The bar floats over the body in both orientations and slides away on scroll, so the text takes
  // the whole screen: 44pt where the window's title bar supplies the caption, 86 where the bar is
  // its own (status inset, two lines and padding).
  const titleShift = () =>
    scrollOffset.interpolate({ inputRange: [0, 80], outputRange: [0, -(isLandscape() ? TITLE_H : 86)], extrapolate: "clamp" });
  const titleOpacity = () =>
    scrollOffset.interpolate({ inputRange: [0, 80], outputRange: [1, 0], extrapolate: "clamp" });

  // A right swipe in the body goes back — and ONLY a right swipe. The pan is kept to that one way
  // (`direction: "right"` below), so a leftward drag fails it in the native tracker before it
  // starts: the body never slides left and a swipe that way never leaves the thread. A left swipe
  // is how the body is read (turning pages of a picture, dragging a selection, flicking a table),
  // and none of that should end up closing the thread. `panActivation` also fails the gesture on a
  // small vertical move, so the list still scrolls, and only a clear, long rightward swipe counts,
  // so it is not easy to fire by accident. A selection in the text turns it off, as that is a drag
  // too — checked when the gesture ends rather than by taking the pan away, which would render the
  // body again mid-gesture.
  const backPan = createAnimatedValue(0);
  const onSwipeEnd = (e: any) => {
    const dx = e?.translation?.x ?? 0;
    const vx = e?.velocity?.x ?? 0;
    // The default-level gesture: a short rightward drag (or a light flick) is enough. The old
    // 150 pt / 1700 pt/s pair made the back action feel like it needed a deliberate haul.
    // The page has been following the finger throughout the drag (see the transform below); on
    // release it either carries on out the same side, or springs back if the swipe did not commit.
    if (!e?.cancelled && (dx > 60 || vx > 700)) void leave(() => props.onSwipeBack?.());
    else void settleBack(backPan);
  };

  // A thread arrives as a page sliding in from the right (and leaves to the left, below). The
  // transform is compositor-only: it never re-measures the list underneath. `createMotion()`
  // rests at identity, so a motion skipped for reduce-motion still shows the thread at once.
  const entrance = createMotion();
  effect(() => {
    void slideIn(entrance);
  });

  // Leaving carries the page on out toward the right — the edge it entered from — before telling the
  // forum to close the thread, so it never vanishes in one frame and never reverses. A drag leaves
  // from wherever the finger had already moved it to (backPan); the Back control has no drag, so it
  // starts from rest. `leaving` stops a second gesture/render from starting a second exit; the
  // callback differs (a link's thread pops the detour, a normal one leaves the board).
  let leaving = false;
  async function leave(onDone?: () => void) {
    if (leaving) return;
    leaving = true;
    try {
      await settleExit(backPan, entrance.opacity, windowSize().width, 1);
    } finally {
      // The exit is done, so a later swipe must work again: in portrait this page stays mounted
      // under the list pane and the next thread reuses this very instance — a flag left set here
      // would silently kill the swipe back of every page opened after the first one.
      leaving = false;
    }
    onDone?.();
  }

  /** How wide a body picture is drawn, in device pixels: the column's width at this screen's
   *  density, clamped so a tablet does not ask for a needlessly large copy. Shared with the
   *  warm-up, so a picture fetched ahead is exactly the one this transform asks for. */
  function bodyImagePx(): number {
    return bodyPicturePx();
  }

  // (The HTML transform cache is module-level, declared above the component, so it survives
  // remounts and makes re-rendering rows and re-opening a thread instant. The width is part of
  // the key: a rotation asks for the column's new pixel width, not the old one's copy.)
  function bodyHtml(r: Reply): string {
    const px = bodyImagePx();
    // Keep the post body as ONE continuous block: nsh's selectable view scopes a selection to a
    // block ("each block on its own"), so splitting every <br> into its own <p> trapped the
    // selection in a single line — long press picked a word but the handles could not reach text
    // on the next line ("whole line only"). A plain <br> is a soft break inside the same block;
    // nsh 0.6 renders it as a newline and its selection hit-test walks wrapped lines, so handles
    // can now be dragged across the whole post to copy any run of characters.
    return cachedBodyHtml(`${r.id}@${px}`, () =>
      absolutize(trimLeadingBlanks(linkifyBareUrls(fixDiscuzMarkup(fixImages(r.body, px)))), HOST));
  }

  // The pictures a post shows, read from the same transformed HTML the text view draws, so what
  // the reader taps is exactly what the viewer's gallery holds. Answers about attachments arrive
  // over time and each one redraws the floors, so the map is kept PER ANSWER: entries from an
  // earlier answer name the body as it was drawn then, are never asked for again, and would
  // otherwise stay for as long as the thread is open (one gallery per floor per answer).
  const galleryOf = new Map<string, ReturnType<typeof postImages>>();
  let galleryRevision = -1;
  function postPictures(r: Reply) {
    const revision = attachedPictureRevision();
    if (revision !== galleryRevision) {
      galleryRevision = revision;
      galleryOf.clear();
    }
    const key = `${r.id}@${revision}`;
    const hit = galleryOf.get(key);
    if (hit) return hit;
    const list = postImages(drawnBody(r));
    galleryOf.set(key, list);
    return list;
  }

  /** The body as drawn: a picture the author attached without putting it in the text shows where
   *  its download line was. An attachment's answer arrives after the floor first draws, so this
   *  reads the revision signal to be drawn again with the picture. */
  function drawnBody(r: Reply): string {
    attachedPictureRevision();
    return showAttachedPictures(bodyHtml(r), attachedPicture);
  }

  /** Opens the viewer at one of a post's pictures: the one tapped when its HTML names it, and on
   *  its own when it does not (an attachment link, or a picture the transform dropped). */
  function openPostImage(r: Reply, full: string, display: string) {
    const list = postPictures(r);
    const index = list.findIndex((p) => p.url === full || p.display === display || p.display === full);
    if (index >= 0) openGallery(list, index);
    else openImageViewer(full, display);
  }

  /**
   * A press on a Discuz attachment (`attachment.php`): a picture opens the viewer, a file is
   * downloaded. The forum answers which it is with the file's own type, asked once per address and
   * remembered (the body asks the same while it draws a picture in place), so a zip is never
   * handed to the picture viewer and a screenshot is never saved as a file.
   */
  async function openAttachment(r: Reply, url: string) {
    const known = attachedPictureKnown(url);
    // Not asked yet: the forum's type decides, and the answer takes a round trip.
    if (known === undefined) notify("attachment-open", "正在打开附件…");
    const picture = known ?? (await attachmentIsPicture(url));
    if (picture) {
      openPostImage(r, url, url);
      return;
    }
    const file = attachmentLinks(r.body).find((a) => absoluteUrl(a.url, HOST) === url);
    void downloadAttachment(url, file?.name ?? "附件");
  }

  /** Loads the first pictures a page's floors will draw, in reading order, so their bytes are in
   *  memory while the text lays itself out instead of one round trip after the words appear. The
   *  faces of the floors are left to their own `Avatar`s (small, and drawn at once), and the rest
   *  of a page's pictures ask for themselves as the view reaches them.
   *
   *  A thread's own pictures come before whatever the list left queued: the queue is cleared as the
   *  page arrives, so a picture the reader is now looking at is never behind one they scrolled
   *  past. Downloading is not interrupted (the runtime's pool finishes those), only the waiting. */
  function warmPageImages(list: Reply[]): void {
    const urls: string[] = [];
    for (const r of list) {
      for (const m of bodyHtml(r).matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
        if (m[1]) urls.push(m[1]);
        if (urls.length >= 12) break;
      }
      if (urls.length >= 12) break;
    }
    clearWarmedImages();
    warmImages(urls, 12);
  }

  // The pictures a reply shows (block images carry the original in `title`), so a
  // floor's header can offer a reliable "view pictures" entry — the text view's
  // own image press does not fire on the tablet.


  // True until the first reply page has loaded (or failed), so the thread shows a spinner instead of blank.
  const firstLoad = signal(true);
  // A first page that is still missing after a few seconds says "slow", not "broken"; the
  // spinner and the data-driven failure/retry below are unchanged.
  const slowFirst = signal(false);
  let slowFirstTimer: ReturnType<typeof setTimeout> | null = null;
  function markSlowFirst(on: boolean) {
    if (slowFirstTimer) { clearTimeout(slowFirstTimer); slowFirstTimer = null; }
    if (on) slowFirstTimer = setTimeout(() => slowFirst.set(true), 4000);
    else slowFirst.set(false);
  }
  markSlowFirst(true);
  cleanup(() => { if (slowFirstTimer) clearTimeout(slowFirstTimer); });
  // Pull-to-refresh on the reply list (at the top): reload this thread's pages.
  const refreshingThread = signal(false);

  let loadingMore = false;
  const loadingMoreShown = signal(false);
  // The thread's last page, as its pager reports it. `undefined` on a page with no pager.
  const lastPage = signal<number | undefined>(undefined);
  // A jump to the last page is one request; a second press waits for it.
  const jumping = signal(false);
  // The thread's actions (favorite, browser, link) folded under the round control at the bottom right.
  const toolboxOpen = signal(false);
  // The bottom-right cluster can be dragged up or down the right edge. `dockY` is where it rests
  // (pixels lifted from its default bottom); `dockPan` follows the finger during a drag. The
  // live translate and the resting bottom add up, so the discs stay under the finger throughout.
  const dockY = signal(0);
  const dockPan = createAnimatedValue(0);
  // The resting spot is remembered across threads and restarts. Read it on entry, clamped to
  // this window; a drag that starts before the read finishes wins, so the old value cannot land
  // on top of where the reader just put the group.
  let dockTouched = false;
  loadDockY().then((saved) => {
    if (saved !== null && !dockTouched) dockY.set(clampDockY(saved, windowSize().height));
  });
  // A press on a floor's avatar: first a "短信息" button, then the message sheet.
  const pmTarget = signal<{ id: string; name: string } | null>(null);
  const pmWriting = signal(false);

  // A scroll pauses a video playing in the thread, so it never plays on off screen. Throttled:
  // the pause reaches the page at most a few times a second while the finger keeps moving.
  function onThreadScroll(e?: { offset?: { y?: number }; contentSize?: { height?: number }; size?: { height?: number } }): void {
    // The next page starts before the end of the thread is reached (the viewport is `size`).
    const rest = (e?.contentSize?.height ?? 0) - ((e?.offset?.y ?? 0) + (e?.size?.height ?? 0));
    if (rest < 1500) void loadMore();
  }

  function fetchPage(n: number) {
    return loadReplyPage(props.post.id, n)
      .then(({ title: pageTitle, fid: pageFid, lastPage: pageLast, replies: list }) => {
        if (n === 1 && pageTitle) title.set(pageTitle);
        if (pageFid && !fid()) fid.set(pageFid);
        if (pageLast !== undefined) lastPage.set(pageLast);
        const merged = n === 1 ? { items: list, more: list.length > 0 } : mergePage(replies(), list);
        replies.set(merged.items);
        more.set(merged.more);
        page.set(n);
        failedPage.set(null);
        // The page's pictures are warmed now, in parallel with the layout that draws them: the
        // text arrives first and the pictures fill in, which is what the reader was waiting for.
        warmPageImages(merged.items);
        if (n === 1) {
          firstLoad.set(false);
          markSlowFirst(false);
          // A fresh thread starts at the top with its title showing. The transform cache is KEPT:
          // a cached reply page carries the same bodies, so re-transforming every reply on each
          // open only made opening a thread slower. It is cleared when a reply, edit or delete
          // changes the bodies (see send/saveEdit/removeReply, which call it before reloading).
          scrollOffset.set(0);
        }
        // Warm the next page in the background (after the first screen's pictures
        // start loading) so scrolling to "load more" — and its images — continues
        // without a network wait.
        if (merged.more) {
          const nextPage = n + 1;
          setTimeout(() => { void loadReplyPage(props.post.id, nextPage).catch(() => undefined); }, 800);
        }
      })
      .catch((e) => {
        failedPage.set(n);
        if (n === 1) { firstLoad.set(false); markSlowFirst(false); }
      })
      .finally(() => {
        loadingMore = false;
        loadingMoreShown.set(false);
      });
  }

  function refreshThread() {
    // A pull that starts while the thread is already reloading is dropped: the answers would race
    // and the list would settle on whichever came last.
    if (refreshingThread()) return;
    refreshingThread.set(true);
    clearThreadReplyPages(props.post.id);
    void fetchPage(1)
      .then(() => {
        // `fetchPage` keeps its own failure in `failedPage` instead of throwing, so the outcome is
        // read from the state it left behind.
        notify("thread-refresh", failedPage() === null && replies().length > 0 ? "已刷新。" : "刷新失败，请重试。");
      })
      .catch(() => notify("thread-refresh", "刷新失败，请重试。"))
      .finally(() => refreshingThread.set(false));
  }

  function loadMore() {
    if (loadingMore || !more()) return;
    loadingMore = true;
    loadingMoreShown.set(true);
    fetchPage(page() + 1);
  }

  // One press to the first floor: the first page is always the list's start, so this is a scroll.
  function toFirstFloor() {
    repliesList?.scrollToOffset({ offset: 0, animated: true });
  }

  // One press to the last floor: still on an earlier page, ask for the thread's last page and
  // append it, then scroll to its end. The pages in between are not fetched (a long thread would
  // otherwise make this wait for dozens of requests); a pull-to-refresh starts the thread over.
  async function toLastFloor() {
    if (jumping()) return;
    const last = lastPage();
    if (last !== undefined && last > page()) {
      jumping.set(true);
      try {
        await fetchPage(last);
        // The last page is the end: no further "load more" past it.
        more.set(false);
      } finally {
        jumping.set(false);
      }
      // The rows need a layout pass before the list can scroll to its new end.
      setTimeout(() => repliesList?.scrollToEnd({ animated: true }), 120);
    } else {
      repliesList?.scrollToEnd({ animated: true });
    }
  }

  /** Quoted passage followed by the reader's own words, in the draft's `>`-line form. */
  function replyText(): string {
    return quoted() ? `${quoted()}\n\n${draft()}` : draft();
  }

  async function setDraft(text: string) {
    draft.set(text);
    // A draft that cannot be saved (storage full) is a convenience lost, not a failed action.
    await Storage.setItem(draftKey(props.post.id), quoted() ? `${quoted()}\n\n${text}` : text).catch(() => undefined);
  }

  async function send() {
    if (!canSendReply(replyText()) || sending() || uploading()) return;
    // A targeted reply starts with the forum's own `回复 22# mrky` line, then the reader's words.
    // The header is added after `draftToPost` so its BBCode is never read as a `>`-line; the hidden
    // notice fields go with it, as on the web's reply form. No target: the body is as before.
    const target = replyTarget();
    const text = draftToPost(replyText(), HOST);
    const body = [target ? replyToHeader(target, HOST) + text : text, ...attachments().map(attachmentTag)].join("\n");
    sending.set(true);
    try {
      await postReply(fid(), props.post.id, body, target ? replyToNotice(target, HOST) : undefined);
      notify("reply", "回复已发布。");
      attachments.set([]);
      quoted.set("");
      replyTarget.set(null);
      void Storage.removeItem(replyTargetKey(props.post.id)).catch(() => undefined);
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

  // The quote shown above the field, with a × that drops it alone (the words and attachments stay).
  const quotePart = () => quoted();
  function dropQuote() {
    quoted.set("");
    void setDraft(draft());
  }

  // A reply to a floor is the other header the forum writes: one header per reply, so taking it
  // clears a pending quote (and vice versa). Its chip holds only the floor and author.
  function dropReplyTarget() {
    replyTarget.set(null);
    void Storage.removeItem(replyTargetKey(props.post.id)).catch(() => undefined);
  }

  function replyToFloor(r: Reply) {
    quoted.set("");
    void setDraft(draft());
    const target: ReplyTarget = {
      pid: r.id,
      ptid: props.post.id,
      seq: r.seq,
      uid: r.author.id,
      name: r.author.name,
      message: htmlToText(r.body),
    };
    replyTarget.set(target);
    void Storage.setItem(replyTargetKey(props.post.id), JSON.stringify(target)).catch(() => undefined);
  }

  function quote(r: Reply) {
    if (replyTarget()) dropReplyTarget();
    // The floor's own text goes with the attribution, as the web forum's 引用 does: a quote the
    // forum is left to draw with only an author and a time reads as an empty quote there (the
    // body is what the `[quote]` carries, not something the attribution implies). Plain text, so
    // the floor's markup is not posted back as HTML; a picture-only floor has none to quote and
    // keeps the one-line quote it always had.
    quoted.set(replyQuoteInDraft(r, props.post.id, htmlToText(r.body)));
    void setDraft(draft());
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

  // The member whose card is open, from a floor's avatar.
  const profileTarget = signal<{ uid?: string; name: string; avatar?: string } | null>(null);

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
  Storage.getItem(replyTargetKey(props.post.id))
    .then((text) => {
      if (!text) return;
      const t = JSON.parse(text) as ReplyTarget;
      if (!t || !t.pid || !t.name || typeof t.seq !== "number") return;
      replyTarget.set(t);
      // One header per reply: an older draft may still have `>`-lines, but the target wins.
      quoted.set("");
    })
    .catch(() => undefined);
  Storage.getItem(draftKey(props.post.id))
    .then((text) => {
      // A draft saved with a quote in front of it reads back as a quote bar plus the words.
      const parts = splitDraftQuote(postToDraft(text ?? ""));
      if (parts.quoted && !replyTarget()) quoted.set(parts.quoted);
      draft.set(parts.own);
    })
    .catch(() => undefined);

  return (
    <View
      pan={props.onSwipeBack ? { x: backPan } : undefined}
      // `direction: "right"`: the pan activates on a rightward drag only — a leftward one fails it
      // in the native tracker, so the body neither follows a left swipe nor closes on one.
      panActivation={props.onSwipeBack ? { activeOffsetX: 18, failOffsetY: 10, direction: "right" } : undefined}
      onPanEnd={props.onSwipeBack ? onSwipeEnd : undefined}
      style={{
        flex: 1, alignSelf: "stretch", overflow: "hidden",
        opacity: entrance.opacity,
        // The translateX channel is the entrance slide PLUS the live drag, so the page follows
        // the finger as it swipes (rather than the drag value going nowhere). The other motion
        // channels stay at rest and are kept from entrance.transform.
        transform: [{ translateX: entrance.translateX.add(backPan) }, ...entrance.transform.slice(1)],
      }}
    >
      {/* Under the title bar the title sits in the bar's caption area (the column extends up into it), centred
          on the bar's 44pt; it drags the window where nothing presses. With no bar, it keeps the top inset. */}
      <View
        desktop={{ windowDrag: true }}
        style={{
          // The bar floats over the body in both orientations, so it can slide away on scroll and
          // let the text take its place.
          position: "absolute", left: 0, right: 0, top: 0, zIndex: 10,
          height: isLandscape() ? TITLE_H : undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: isLandscape() ? 0 : 8,
          paddingTop: isLandscape() ? 0 : titleBarShown() ? 18 : 20,
          // Two lines of a long title need the room; the title itself is drawn over the row.
          minHeight: isLandscape() ? TITLE_H : 58,
          backgroundColor: palette().bg,
          transform: [{ translateY: titleShift() }],
          opacity: titleOpacity(),
          overflow: "hidden",
        }}
      >
        {/* Portrait: the two list columns are hidden, so this opens them as an overlay. */}
        {props.onOpenSidebars ? (
          <View
            onPress={props.onOpenSidebars}
            accessibilityLabel="版块与帖子列表"
            tooltip={hint("版块与帖子列表")}
            style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <LineIcon name="grip" size={17} />
          </View>
        ) : null}
        {/* Back sits in the row, first, so the icons after it move right with it. */}
        {props.onBack ? (
          <View onPress={() => leave(props.onBack)} accessibilityLabel="返回" style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>{"‹ 返回"}</Text>
          </View>
        ) : null}
        {/* The title is centred on the whole bar (a short one sits in the middle), and a long one
            wraps to a second line that starts at the first line's left edge. */}
        <View style={{ position: "absolute", left: 126, right: 12, top: 0, bottom: 0, justifyContent: "center", pointerEvents: "none" }}>
          <Text style={{ numberOfLines: 2, textAlign: "left", fontSize: 15, lineHeight: 19, fontWeight: 600, color: palette().text }}>{title()}</Text>
        </View>
      </View>
      {/* A virtualized list: only the replies near the viewport exist, and their views are
          reused as the user scrolls. Each row reads its reply through `item()`. */}
      <List
        style={{ flex: 1 }}
        contentStyle={{ padding: 12, gap: 9, paddingTop: isLandscape() ? TITLE_H + 4 : 90 }}
        each={replies()}
        estimatedItemSize={320}
        scrollValue={scrollOffset}
        onScroll={onThreadScroll}
        onLoadMore={loadMore}
        refreshing={refreshingThread()}
        onRefresh={() => refreshThread()}
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
            onAvatarPress={
              // The face opens the member's card: their details, a way to their page and to a
              // private message, rather than the message sheet straight away.
              () => profileTarget.set({ uid: item().author.id, name: item().author.name, avatar: item().author.avatar })
            }
            meta={`#${item().seq} · ${timeAgo(item().at)}`}
            highlighted={() => hovered() === item().seq}
            onHoverIn={() => hovered.set(item().seq)}
            onHoverOut={() => {
              if (hovered() === item().seq) hovered.set(null);
            }}
            trailing={
              // Quote sits before Reply so the quote glyph is never the last item pushed past the
              // card edge on a narrow screen; tighter discs and gap give the four-icon row room.
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
                {props.signedIn && isOwn(item()) ? (
                  <View onPress={() => void startEdit(item())} accessibilityLabel="编辑"
                    style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                    <PencilIcon size={15} />
                  </View>
                ) : null}
                {props.signedIn && isOwn(item()) && item().seq !== 1 ? (
                  <View onPress={() => pendingDelete.set({ pid: item().id, seq: item().seq })} accessibilityLabel="删除"
                    style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                    <TrashIcon size={15} />
                  </View>
                ) : null}
                <View onPress={() => props.signedIn ? quote(item()) : props.onSignInNeeded?.()}
                  accessibilityLabel="引用"
                  tooltip={hint("引用这一楼")}
                  style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                  <QuoteIcon size={15} />
                </View>
                <View onPress={() => props.signedIn ? replyToFloor(item()) : props.onSignInNeeded?.()}
                  accessibilityLabel="回复"
                  tooltip={hint("回复这一楼")}
                  style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                  <BubbleIcon size={15} />
                </View>
              </View>
            }
            body={
              // The body is the selection surface itself. A long press picks a word where the finger
              // is, the platform's two handles then move the ends character by character across
              // paragraphs, and the floating menu (Copy, Select all, Share) is Android's. Nothing of
              // the page is swapped for a field, so the selection state draws with the very text the
              // reader sees: the same type, leading, paragraph sums above blocks, margins, alignment
              // and line breaks — no second renderer to keep in step, and no empty line where one
              // would have parted the two.
              <View style={{ gap: 12, alignSelf: "stretch" }}>
                <TextView
                  html={drawnBody(item())}
                  selectable={true}
                  styles={{
                    root: {
                      fontSize: displaySettings().body,
                      lineHeight: Math.round(displaySettings().body * displaySettings().spacing),
                      // The system blue Android draws its own selection in (Pixel's accent).
                      selectionColor: "#4285F4",
                    },
                    ...(item().seq === 1 ? OP_TITLE_STYLES : {}),
                  }}
                  extensions={DISCUZ_EXTENSIONS}
                  renderCustom={renderDiscuzNode}
                  onImagePress={(e: any) => {
                    // A picture not in a link opens the zoomable viewer. The original (full-size)
                    // URL the page carried rides in `title`; `src` is the compressed display copy.
                    const img = e?.image ?? e;
                    const src: string = img?.src ?? "";
                    const full: string = img?.title || src;
                    if (full || src) openPostImage(item(), full || src, src);
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
                    if (isAttachmentUrl(url)) {
                      void openAttachment(item(), url);
                      return;
                    }
                    if (/\.(?:jpg|jpeg|png|gif|webp|bmp)(?:[?#]|$)/i.test(url)) {
                      openPostImage(item(), url, url);
                      return;
                    }
                    const tid = threadIdFromLink(url);
                    if (tid && props.onOpenThread) {
                      props.onOpenThread(tid);
                    } else {
                      void openLink(url);
                    }
                  }}
                />
                {/* External media (Bilibili, Douyin, Xiaohongshu, video sites) is not parsed or
                    played inside the app: a press on such a link goes through onLinkPress above
                    and opens it outside — the site's own app when one is registered for the
                    link, the browser otherwise, the system player for a video file. */}
              </View>
            }
          />
        )}
      </List>
      {/* While the first page is on the wire, the thread's own shape is drawn: the floors it is
          about to hold, at their height, so the page settles into place instead of jumping from a
          spinner. The line under the spinner says how it is going (a slow link is named). */}
      {firstLoad() && replies().length === 0 && failedPage() === null ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 6 }}>
            <LoadingBar />
            <Text style={{ fontSize: 12, color: palette().muted }}>{slowFirst() ? "网络较慢，正在加载…" : "正在加载帖子…"}</Text>
          </View>
          <ThreadSkeleton rows={3} />
        </View>
      ) : null}
      {/* A press on an avatar offers a private message; the sheet writes it. */}
      {pmTarget() && !pmWriting() ? (
        <View
          onPress={() => pmTarget.set(null)}
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.28)", zIndex: 44 }}
        >
          <View
            onPress={() => pmWriting.set(true)}
            accessibilityLabel={`给 ${pmTarget()!.name} 发短信息`}
            style={{ paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.25)", backgroundColor: "rgba(20, 22, 26, 0.82)" }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <EnvelopeIcon size={14} />
              <Text style={{ fontSize: 13, color: "#ffffff" }}>短消息</Text>
            </View>
          </View>
        </View>
      ) : null}
      {profileTarget() ? (
        <ProfileSheet
          uid={profileTarget()!.uid}
          name={profileTarget()!.name}
          avatar={profileTarget()!.avatar}
          onMessage={() => {
            const t = profileTarget();
            profileTarget.set(null);
            if (!t?.uid) return;
            // Straight into the message editor: the card's button is the intent to write.
            pmWriting.set(true);
            pmTarget.set({ id: t.uid, name: t.name });
          }}
          onClose={() => profileTarget.set(null)}
        />
      ) : null}
      {pmWriting() && pmTarget() ? (
        <PmComposer
          uid={pmTarget()!.id}
          name={pmTarget()!.name}
          onClose={() => { pmWriting.set(false); pmTarget.set(null); }}
        />
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
      {/* The bottom-right cluster, clear of the reply box: the thread's actions folded under a round
          control, then the two jump buttons. The action discs rise out above the control (absolutely
          positioned, so the jump buttons never move). A press anywhere else folds them away. */}
      {toolboxOpen() ? (
        <View
          onPress={() => toolboxOpen.set(false)}
          accessibilityLabel="收起帖子操作"
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 19 }}
        />
      ) : null}
      {/* The cluster is dragged by any of its discs. Only a clearly vertical drag activates the
          pan, so a tap still reaches the disc underneath (the 8pt threshold is below a tap's
          slop). The panel of actions, when open, is part of this group and moves with it. */}
      <View
        pan={{ y: dockPan }}
        panActivation={{ activeOffsetY: 8, failOffsetX: 12 }}
        onPanEnd={(e: any) => {
          const dy = e?.translation?.y ?? 0;
          if (!e?.cancelled) {
            // Up is positive: dragging up lifts the group (a larger resting bottom). Clamp so it
            // stays between the title bar and the reply box, whatever the window height.
            const next = clampDockY(dockY() - dy, windowSize().height);
            if (next !== dockY()) {
              dockTouched = true;
              dockY.set(next);
              saveDockY(next);
            }
          }
          dockPan.set(0);
        }}
        style={{
          position: "absolute", right: 14, bottom: 104 + dockY(), alignItems: "center", gap: 8, zIndex: 20,
          transform: [{ translateY: dockPan }],
        }}
      >
          {toolboxOpen() ? (
            <View style={{ position: "absolute", right: 0, bottom: replies().length > 0 ? 136 : 48, alignItems: "center" }}>
              <ThreadActions
                saved={saved()}
                onFavorite={() => {
                  toolboxOpen.set(false);
                  if (props.signedIn) toggleFavorite();
                  else props.onSignInNeeded?.();
                }}
                onBrowser={() => {
                  toolboxOpen.set(false);
                  void openLink(threadUrl());
                }}
                onLink={() => {
                  toolboxOpen.set(false);
                  Clipboard.writeText(threadUrl());
                  notify("copy-link", "链接已复制。");
                }}
              />
            </View>
          ) : null}
          <ActionDisc faint
            label={toolboxOpen() ? "收起帖子操作" : "帖子操作"}
            active={toolboxOpen()}
            onPress={() => toolboxOpen.set(!toolboxOpen())}
          >
            <LineIcon name="grip" size={18} />
          </ActionDisc>
          {/* Jump buttons only once there are floors to jump between. */}
          {replies().length > 0 ? (
            <>
              <ActionDisc faint label="回到第一楼" onPress={toFirstFloor}>
                <LineIcon name="chevronUp" size={18} />
              </ActionDisc>
              <View style={{ opacity: jumping() ? 0.5 : 1 }}>
                <ActionDisc faint label="跳到最后一楼" onPress={jumping() ? () => undefined : () => void toLastFloor()}>
                  <LineIcon name="chevronDown" size={18} />
                </ActionDisc>
              </View>
            </>
          ) : null}
        </View>
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
            quote={() => (editing() ? "" : quotePart())}
            onClearQuote={dropQuote}
            replyTo={() => (editing() || !replyTarget() ? "" : replyToChip(replyTarget()!))}
            onClearReplyTo={dropReplyTarget}
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
