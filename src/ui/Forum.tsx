import { BackHandler } from "nsh/mobile";
import { cleanup, computed, createAnimatedValue, createMotion, effect, LayoutAnimation, lifecycle, Overlay, reduceMotion, type ViewRef, type ListRef, List, Scroll, signal, Storage, Text, untracked, View, windowSize, type JSX } from "nsh";
import { Dialog } from "nsh/base";
import { hideThread, isHidden } from "./hiddenThreads";
import { onEscape } from "./escape";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { shortcutRows, useCommand } from "./commands";
import { DEMO, clearReplyPageCache, loadBookmarks, loadChannels, loadMyReplies, loadMyThreads, loadPmUsers, loadPosts, loadReplyPage, searchThreads, loadNotices} from "../discuz/forum";
import { avatarUrlForUid } from "../discuz/avatarUrl";
import { userAvatar } from "../discuz/avatarCache";
import { loadNoticeCounts, markNoticesRead } from "../discuz/notifications";
import { cleanChannelTitle, mergePage, parseChannels, type Channel, type Post } from "../discuz/parse";
import { BUILTIN_CHANNELS, mergeChannels } from "../discuz/channels";
import { Thread } from "./Thread";
import { NewThread } from "./NewThread";
import { Conversation } from "./Conversation";
import { LoadingBar } from "./LoadingBar";
import { channelIcon } from "./channelIcon";
import { PencilIcon, RefreshIcon, SidebarIcon } from "./icons";
import { LineIcon, type IconName } from "./lineIcons";
import { hint } from "./Hint";
import { palette } from "./appearance";
import { loadLastPlace, saveLastPlace } from "./lastPlace";
import { Placeholder } from "./Placeholder";
import { PixelDino } from "./PixelArt";
import { displaySettings } from "./settings";
import { notify } from "./toast";
import { ThreadRow } from "./ThreadRow";
import { clearFavoriteIds, isFavorite, reconcileFavorites } from "./favorites";
import { historyEntries, isViewed, recordView } from "./history";
import { groupHistory } from "./historyGroups";
import { channelsCollapsed, channelsRailed, FULL_WIDTH, RAIL_BELOW, RAIL_WIDTH, toggleChannelsCollapsed } from "./channelRail";
import { titleBar } from "./platform";
import { animateSearchChange, SearchControl, TitleBar, titleBarShown, type SearchProps } from "./TitleBar";
import { lateralSlide, M3, settleBack } from "./pageSlide";

function avatarName(p: Post): string | undefined {
  return p.author ?? p.lastReplyBy;
}

const avatarSignals = new Map<string, ReturnType<typeof signal<string>>>();
function avatarSignal(name: string): ReturnType<typeof signal<string>> {
  let s = avatarSignals.get(name);
  if (!s) {
    s = signal("");
    avatarSignals.set(name, s);
  }
  return s;
}
const avatarPending = new Set<string>();
const avatarQueue: string[] = [];
let avatarActive = 0;
const AVATAR_CONCURRENCY = 3;
function resolveAvatarByName(name: string | undefined): void {
  if (!name || avatarPending.has(name) || avatarSignal(name)() !== "") return;
  avatarPending.add(name);
  avatarQueue.push(name);
  pumpAvatars();
}
function pumpAvatars(): void {
  while (avatarActive < AVATAR_CONCURRENCY && avatarQueue.length > 0) {
    const name = avatarQueue.shift()!;
    avatarActive++;
    userAvatar(name)
      .then((url) => avatarSignal(name).set(url ?? ""))
      .catch(() => avatarSignal(name).set(""))
      .finally(() => { avatarPending.delete(name); avatarActive--; pumpAvatars(); });
  }
}

/** A row's avatar URL: by uid when known, else by the poster's name once resolved. */
function avatarFor(p: Post): string | undefined {
  return avatarUrlForUid(p.uid) ?? avatarOfName(avatarName(p));
}

/** The picture resolved for `name` (a row without a uid), `undefined` until it arrives. */
function avatarOfName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return avatarSignal(name)() || undefined;
}

/** A count in short form: 999 stays, 2389 reads as "2.4k". */
function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.floor(n / 100) / 10;
  return `${k}k`;
}

/** A row of the threads column: a section's title, or a thread. */
type ListRow = { kind: "header"; title: string } | { kind: "post"; post: Post };
type HistoryRow = ListRow;

/** The thread a row shows. A title row has none: it is never drawn as a thread, so the empty
 * thread here only keeps the types whole. */
const postOf = (r: ListRow): Post => (r.kind === "post" ? r.post : { id: "", title: "" });
const titleOf = (r: ListRow): string => (r.kind === "header" ? r.title : "");

/** A failed load: what to say, and what Retry does. */
interface Failed {
  message: string;
  retry: () => void;
}

// The first page of each list as it last loaded, keyed by list. Opening a list again
// shows it at once while its refresh runs. Cleared on sign-out: an account sees more.
// The newest lists are also kept in storage, so a launch shows the board read last time before
// the network answers; the refresh then replaces them (stale-while-revalidate).
type CachedList = { items: Post[]; more: boolean; at: number };
const listCache = new Map<string, CachedList>();
const LIST_CACHE_STORE = "visual:list-cache";
const LIST_CACHE_KEEP = 6;
const LIST_CACHE_MEMORY = 12;
const LIST_CACHE_TTL = 24 * 60 * 60 * 1000;
Storage.getItem(LIST_CACHE_STORE).then((saved) => {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as Record<string, CachedList>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && Array.isArray(entry.items) && now - (entry.at ?? 0) < LIST_CACHE_TTL) listCache.set(key, entry);
    }
  } catch { /* a stale store is dropped */ }
}).catch(() => undefined);

let listCacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveListCache(): void {
  if (listCacheSaveTimer) clearTimeout(listCacheSaveTimer);
  listCacheSaveTimer = setTimeout(() => {
    const newest = [...listCache.entries()].sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, LIST_CACHE_KEEP);
    const out: Record<string, CachedList> = {};
    for (const [key, entry] of newest) out[key] = entry;
    Storage.setItem(LIST_CACHE_STORE, JSON.stringify(out)).catch(() => undefined);
  }, 600);
}

// The channel list changes rarely: drawing the last one at launch makes the boards pane instant
// while the new list loads.
const CHANNELS_STORE = "visual:channels";
const cachedChannels = signal<Channel[] | null>(null);
Storage.getItem(CHANNELS_STORE).then((saved) => {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as Channel[];
    if (Array.isArray(parsed) && parsed.length > 0) cachedChannels.set(parsed);
  } catch { /* a stale store is dropped */ }
}).catch(() => undefined);

const FAVORITES_KEY = "favorites";
const MY_THREADS_KEY = "my-threads";
const MY_REPLIES_KEY = "my-replies";
const MESSAGES_KEY = "messages";
const NOTICES_KEY = "notices";
/** A board's list order: by its threads' start time, or by their last reply (the default). */
type SortOrder = "dateline" | "lastpost";

// Each board keeps its own order, remembered between runs: one board read by post time stays so
// while another stays on last-reply order. A board with no setting uses last-reply order.
const sortOrders = signal<Record<string, SortOrder>>({});
Storage.getItem("visual:sort-orders").then((saved) => {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const orders: Record<string, SortOrder> = {};
      for (const [fid, order] of Object.entries(parsed as Record<string, unknown>)) {
        if (order === "dateline" || order === "lastpost") orders[fid] = order;
      }
      sortOrders.set(orders);
    }
  } catch { /* a stale value simply falls back to last-reply order */ }
}).catch(() => undefined);

const sortFor = (fid?: string | null): SortOrder =>
  fid && sortOrders()[fid] === "dateline" ? "dateline" : "lastpost";

/** Remembers a board's order. */
function setSortFor(fid: string, order: SortOrder) {
  sortOrders.set({ ...sortOrders(), [fid]: order });
  Storage.setItem("visual:sort-orders", JSON.stringify(sortOrders())).catch(() => undefined);
}

const forumKey = (fid: string) => `forum:${fid}:${sortFor(fid)}`;

/** Persisted view option: sort by thread start or last reply. */
let DEMO_PREVIEW_OPENED = false;
// Whether the last render used the 3-2-1 panes: a portrait window, or a phone's (its narrow side
// under 600 pt, whichever way it is held). Event handlers use this: `windowSize()` inside a
// callback can report the platform's default size instead of the window's.
let panesNow = false;

// Where the threads list was left (the row at the viewport's start and how far into it), so the
// pane opened over a thread shows the list exactly where it was. Kept per list title.
let listViewport: { key: string; y: number } | null = null;
// When a pane was last shown: a swipe still travelling from the pane below must not step it again.
let paneOpenedAt = 0;
let listPrefetchAt = 0;
// How far the list is from its end, as of the last scroll event: read when scrolling stops.
let listRest = Number.POSITIVE_INFINITY;
// Ask for the next page while ~25 rows are still below the viewport (a 64 pt row plus its 3 pt
// gap). This is the mobile app's scheme: the request is made at onScrollEnd (finger stopped) or
// onLoadMore (end reached), never mid-scroll, so a merge cannot re-lay out the rows under the
// reader's finger. ONE shared lock covers both triggers, so the same page is never fetched
// twice — a duplicate page merges to zero new rows and makes the list claim "没有更多帖子了".
const PREFETCH_AHEAD_PT = 25 * 67;
// The list counts as moving for this long after its last scroll event. A page that arrives inside
// that window waits for the list to rest (heldRows): inserting it mid-fling rebuilds the rows and
// the restore that follows fights the gesture — the "pause" one feels while scrolling.
const SCROLL_IDLE_MS = 200;
// The popover's list node (portrait), kept so reopening the pane can restore the reader's place.
let paneThreadsList: ListRef | undefined;
// The list in the column (landscape row / full-screen pane). Both nodes are kept because the
// two never tell us which one is on screen; restoring an offset on a hidden node is harmless.
let columnThreadsList: ListRef | undefined;
// ROOT CAUSE, measured on the device: nsh's virtualized List rebuilds its rows whenever
// `each` is handed a new array, and a rebuild starts from offset ~0 — not just when a page is
// appended, but on any rows rebuild (a hidden/viewed change rebuilds listRows too). Measured:
// 1008 -> 2, 2909 -> 7.7, 4885 -> 10.7, the last one 26 s after the page arrived.
// Restoring on the NEXT scroll event was one frame too late: that frame had already painted
// the first page, which is the "it jumps to page 1, then comes back" flash. So the offset is
// written back in the SAME turn as `posts.set()` (the native rebuild runs after the JS turn,
// so its very first layout is already at the right place) and re-asserted for a few frames in
// case the native list settles later. holdReadingPosition() does both.
let lastReadingY = 0;
// A new list legitimately starts at its top: no restore while it opens or refreshes.
let guardCooldownUntil = 0;
// A restore is in flight: the bogus 0 the rebuild reports must not become the reading position.
let restoringOffset = false;
// Where a merge is holding the list, and until when. The reader may keep scrolling while a
// merge settles, so the hold follows them instead of pinning the old offset.
let holdY = 0;
let holdUntil = 0;
// When a page was last merged: the pull-to-refresh guard ignores the settle right after it.
let appendedAt = 0;
// When the list last moved. A page that arrives while this is recent is held back: handing the
// list a new array mid-scroll rebuilds its rows and resets the offset, and the restore that
// repairs it lands in the middle of a fling — that repair is the hitch one feels. Rows are only
// changed once the list is still, where the rebuild is invisible.
let lastScrollAt = 0;
let heldRows: { key: string; items: Post[]; more: boolean; page: number } | null = null;

/** Portrait only: the two list columns stay out of the row and come back as panes. Landscape
 * keeps the three columns in the row. */
const wantsPanes = () => windowSize().height > windowSize().width;
const searchKey = (term: string) => `search:${term}`;

/** One channel in the list: its icon and title with its new-post count, or in the rail its
 * icon with the count as a badge. Hovering and being selected fade a tint in and out. */
function ChannelRow(props: {
  channel: Channel;
  selected: () => boolean;
  railed: () => boolean;
  delay: number;
  onPress: () => void;
  sorting: () => boolean;
  /** Kept out of the column; drawn dimmed while arranging, where the eye brings it back. */
  hiddenBoard?: boolean;
  onToggleHidden?: () => void;
  onLongPress: () => void;
  onDragStart: (y: number) => void;
  onDragMove: (y: number) => void;
  onDragEnd: () => void;
}) {
  // Touch devices have no hover and no entrance transition: 19 channel rows
  // each owning two animated values, a motion and an effect made the sidebar
  // visibly janky. Selection and dragging are plain static styles now.
  const c = props.channel;
  const pillWidth = Math.min(22, Math.ceil(compactCount(c.newPosts).length * 5.2) + 4);
  const sorting = props.sorting;
  return (
    <View
      onPress={sorting() ? undefined : props.onPress}
      // No long press while arranging: a long-pressable row lets the system's drag
      // enhancement take the gesture over, which cuts a drag off after the first move.
      onLongPress={sorting() ? undefined : props.onLongPress}
      onStartShouldSetResponder={sorting() ? () => false : undefined}
      onMoveShouldSetResponder={sorting() ? (e: any, g: any) => {
        // `g.y0` is the gesture's start; without it, the event's own page is the best start.
        props.onDragStart(g?.y0 ?? e?.nativeEvent?.pageY ?? e?.pageY ?? 0);
        return true;
      } : undefined}
      onResponderGrant={sorting() ? () => true : undefined}
      onResponderMove={sorting() ? (e: any) => {
        // The pointer is under `nativeEvent`; older shapes put it on the event itself. Read
        // all of them, so a drag is never fed `undefined` (which used to become NaN).
        const y = e?.pageY ?? e?.nativeEvent?.pageY ?? e?.nativeEvent?.touches?.[0]?.pageY;
        if (typeof y === "number") props.onDragMove(y);
      } : undefined}
      onResponderRelease={sorting() ? () => props.onDragEnd() : undefined}
      onResponderTerminate={sorting() ? () => props.onDragEnd() : undefined}
      accessibilityLabel={c.title}
      style={{
        minHeight: 36, justifyContent: "center",
        paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6,
        alignItems: props.railed() ? "center" : undefined,
        backgroundColor: props.selected() ? palette().selected : "transparent",
      }}
    >
      {props.railed() ? (
        <View>
          <View><LineIcon name={channelIcon(c.title)} size={17} /></View>
          {sorting() ? <LineIcon name="grip" size={12} /> : null}
          {c.newPosts > 0 ? (
            <View style={{ position: "absolute", top: -4, left: 6, width: pillWidth, height: 13,
                           borderRadius: 6.5, overflow: "hidden", backgroundColor: palette().surface }}>
              <Text style={{ numberOfLines: 1, fontSize: 9, color: palette().muted, paddingLeft: 2, lineHeight: 13 }}>
                {compactCount(c.newPosts)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: sorting() ? 4 : 6 }}>
          {sorting() ? <LineIcon name="grip" size={12} /> : null}
          <View style={{ width: sorting() ? 18 : 20, alignItems: "center" }}>
            <LineIcon name={channelIcon(c.title)} size={17} />
          </View>
          <Text style={{ fontSize: displaySettings().board, color: props.hiddenBoard ? palette().muted : palette().text, flex: 1, numberOfLines: 1 }}>{cleanChannelTitle(c.title) || `板块 ${c.id}`}</Text>
          {/* The eye only appears while arranging: it hides a board from the column, or brings
              a dimmed one back. Nothing else is taken from the title's width. */}
          {sorting() ? (
            <View
              onPress={props.onToggleHidden}
              accessibilityLabel={props.hiddenBoard ? "显示这个板块" : "隐藏这个板块"}
              style={{ width: 26, height: 28, alignItems: "center", justifyContent: "center",
                       borderRadius: 5, backgroundColor: palette().surface }}
            >
              <LineIcon name={props.hiddenBoard ? "eyeOff" : "eye"} size={15} />
            </View>
          ) : null}
          {!sorting() && c.newPosts > 0 ? <Text style={{ fontSize: 12, color: palette().muted }}>{compactCount(c.newPosts)}</Text> : null}
        </View>
      )}
    </View>
  );
}

// `user` is the signed-in name, or null. The forum lists channels and threads for
// everyone; signing in or out reloads the channel list, since an account sees more.
export function Forum(props: {
  footer?: (compact: boolean) => JSX.Element;
  user: () => string | null;
  onSignInNeeded?: () => void;
  /** The forum hands its 提醒 / 短消息 openers up, so the account card can call them directly. */
  onActions?: (api: { openNotices: () => void; openMessages: () => void }) => void;
  /** Where the forum reports its unread notice count, for the avatar's red dot. */
  noticesUnread?: { set(value: number): void };
}) {
  const channels = signal<Channel[] | null>(cachedChannels());
  // Portrait: the board column folds away so the list takes the whole pane (a « in its header).
  const boardsCollapsed = signal(false);
  // The cached list may finish loading after this component is built.
  effect(() => {
    const cached = cachedChannels();
    if (cached && !channels()) channels.set(cached);
  });
  const channel = signal<Channel | null>(null);
  // The open board's own order; a personal list has none (it keeps the forum's default).
  const sortOrder = () => sortFor(channel()?.id);
  const favorites = signal(false);
  // The signed-in user's own threads, shown like favorites: their own column-1 entry.
  const mine = signal(false);
  // The threads the user replied to: a third list in the same section.
  const replies = signal(false);
  // Private messages: a list of correspondents, and the one whose messages are open.
  const messages = signal(false);
  // The threads opened on this device, newest first and in sections by when they were opened.
  // Its rows are a snapshot taken when the list opens, so a thread opened from it keeps its place.
  const history = signal(false);
  const historyRows = signal<HistoryRow[]>([]);
  const peer = signal<Post | null>(null);
  // Writing a new thread in the channel open in the threads column; the thread column shows the form.
  const composing = signal(false);
  const thread = signal<Post | null>(null);
  // Threads opened from a 4d4y link in the open thread, the last one shown in its column; Back pops one.
  // The threads column and its selection stay as they were.
  // Threads opened from a link in the open thread, the last one shown. `focus` is the floor a link opened.
  const detour = signal<(Post & { focus?: string })[]>([]);
  const posts = signal<Post[]>([]);
  const page = signal(1);
  const more = signal(false);

  // Title search: the term whose results the threads column shows (null while browsing a
  // channel or favorites), whether the search field is open, and what it holds.
  const searchTerm = signal<string | null>(null);
  const searchOpen = signal(false);
  const searchDraft = signal("");
  // Counts up to move the focus into the search field (the `/` shortcut).
  const searchFocusTick = signal(0);
  // The shortcut list (`?`), open over the window. Its keys work with or without a thread open.
  const shortcutsOpen = signal(false);
  // Channels with no new posts sit under More. More opens as a menu; the channel the user
  // picks from it is pinned into the list until another channel opens.
  const moreOpen = signal(false);
  // The list shows every board the user keeps; which ones those are is set with the eye in
  // arranging mode. There is no fixed cut and no "show more" fold to expand.
  // Sort and pinned controls are used rarely: one small chip folds them away.
  const filtersOpen = signal(false);
  Storage.getItem("visual:filters-open").then((v) => {
    if (v === "0" || v === "1") filtersOpen.set(v === "1");
  }).catch(() => undefined);
  function toggleFilters() {
    const next = !filtersOpen();
    filtersOpen.set(next);
    Storage.setItem("visual:filters-open", next ? "1" : "0").catch(() => undefined);
  }
  const pinned = signal<string | null>(null);

  // Unread badges for the personal section: private messages (短消息) and
  // notice.php's post/user notices (提醒). Read from the forum's header while
  // signed in; 0 hides the badge. Polled, not pushed: the forum has no push channel.
  const pmUnread = signal(0);
  const noticeUnread = signal(0);
  // 提醒 has no row of its own in the column any more; its count goes up to the app, which puts
  // a red dot on the account avatar.
  effect(() => { props.noticesUnread?.set(noticeUnread()); });
  // 提醒 and 短消息 are two different pages (notice.php / pm.php). They share the
  // list column and its cache, but never its view state: `messages()` means the
  // conversation list, `noticesOpen()` means notice.php. Keeping them separate is
  // what stops a press on 提醒 from also selecting 短消息, and what lets a notice
  // row open its thread instead of being mistaken for a correspondent.
  const noticesOpen = signal(false);
  // A notice's "查看" link names a floor; open that post at the floor, as the
  // web page does. Cleared whenever another thread takes the column.
  const noticeFocusPid = signal<string | null>(null);
  // Coming back to the app is exactly when a notice may have been read elsewhere (the forum in a
  // browser): ask now instead of waiting for the 90 s tick, so the dot is never stale on return.
  let wasActive = lifecycle() === "active";
  effect(() => {
    const active = lifecycle() === "active";
    const returned = active && !wasActive;
    wasActive = active;
    if (returned && props.user()) void refreshNotify();
  });

  async function refreshNotify() {
    if (!props.user()) {
      pmUnread.set(0);
      noticeUnread.set(0);
      return;
    }
    const counts = await loadNoticeCounts();
    if (!counts) return; // keep whatever we had: no badge flashing to zero
    if (counts.pm >= 0) pmUnread.set(counts.pm);
    if (counts.notice >= 0) noticeUnread.set(counts.notice);
  }

  // Touch arrangement: the user's channel order, remembered between launches.
  const channelOrder = signal<string[]>([]);
  Storage.getItem("visual:channel-order").then((v) => {
    if (!v) return;
    try {
      const ids = JSON.parse(v) as unknown;
      if (Array.isArray(ids)) channelOrder.set(ids.filter((x): x is string => typeof x === "string"));
    } catch { /* a stale value simply falls back to the forum's own order */ }
  }).catch(() => undefined);
  const sortingMode = signal(false);
  // The thread a long press asked to hide; the confirm dialog shows while this is set.
  const pendingHide = signal<Post | null>(null);
  // A drag keeps its state in plain variables and never touches anything the channel list
  // rebuilds: the order, or a per-row highlight, used to regenerate the rows mid-drag and the
  // responder died with them after the first move. The slot is shown by one small label that
  // the list does not read, and the board is moved once, on release.
  const dragSlot = signal<number | null>(null);
  let dragSession: {
    id: string; from: number; at: number; target: number;
    /** The slots this row may take: its own group's span (shown rows / hidden rows). */
    min: number; max: number;
  } | null = null;
  // Row height (36) plus the list's 2 pt gap.
  const ROW_STEP = 38;
  // The board column's scroller. While arranging every row drags on touch, so the list cannot
  // be swiped to reach the hidden block at its end: these two buttons scroll it instead.
  let boardScroll: any = null;
  let boardOffsetY = 0;
  function scrollBoards(delta: number) {
    const to = Math.max(0, boardOffsetY + delta);
    boardScroll?.scrollTo?.({ y: to, animated: true });
  }

  /** Channels in the user's order; channels never arranged yet stay at the end. */
  const orderedChannels = () => {
    const all = channels() ?? [];
    const order = channelOrder();
    if (order.length === 0) return all;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...all].sort((a, b) => {
      const ra = rank.get(a.id) ?? 10000 + all.indexOf(a);
      const rb = rank.get(b.id) ?? 10000 + all.indexOf(b);
      return ra - rb;
    });
  };
  const currentOrder = () => orderedChannels().map((c) => c.id);
  function persistOrder(ids: string[]) {
    channelOrder.set(ids);
    Storage.setItem("visual:channel-order", JSON.stringify(ids)).catch(() => undefined);
  }
  function moveChannelTo(id: string, to: number) {
    // Arranging works on the grouped list (shown first, hidden last), so a drop lands where
    // the row was shown; every other path uses the plain order.
    const ids = sortingMode() ? arrangedIds() : currentOrder();
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    persistOrder(ids);
  }

  // Boards the user chose to keep out of the column. They keep their place in the order, and
  // arranging still shows them (dimmed) so they can be brought back with the same control.
  const hiddenChannelIds = signal<string[]>([]);
  Storage.getItem("visual:channel-hidden").then((v) => {
    if (!v) return;
    try {
      const ids = JSON.parse(v) as unknown;
      if (Array.isArray(ids)) hiddenChannelIds.set(ids.filter((x): x is string => typeof x === "string"));
    } catch { /* a stale value simply shows every board */ }
  }).catch(() => undefined);
  const isChannelHidden = (id: string) => hiddenChannelIds().includes(id);
  /** The boards the column draws; hidden ones are left out unless the user is arranging. */
  const visibleChannels = () => {
    const out = hiddenChannelIds();
    const all = orderedChannels();
    return out.length === 0 ? all : all.filter((c) => !out.includes(c.id));
  };
  /** Brings every board back at once — the way out if a board was hidden by mistake. */
  function showAllHiddenChannels() {
    hiddenChannelIds.set([]);
    Storage.setItem("visual:channel-hidden", "[]").catch(() => undefined);
    animateListChange();
  }
  function toggleChannelHidden(id: string) {
    const cur = hiddenChannelIds();
    let next: string[];
    if (cur.includes(id)) {
      next = cur.filter((x) => x !== id);
    } else {
      // One board must stay on screen, or the column would have nothing to open.
      if (visibleChannels().length <= 1) {
        notify("arrange", "至少要保留一个板块。");
        return;
      }
      next = [...cur, id];
    }
    hiddenChannelIds.set(next);
    Storage.setItem("visual:channel-hidden", JSON.stringify(next)).catch(() => undefined);
    animateListChange();
  }
  function toggleSortingMode() {
    const next = !sortingMode();
    sortingMode.set(next);
    if (next) {
      notify("arrange", "拖动可调整顺序；点行末的眼睛隐藏板块，再点一下恢复。点「完成」结束。");
    } else {
      // A drag cannot outlive arranging: drop anything it left behind.
      dragSession = null;
      dragSlot.set(null);
    }
  }
  // The width of the stack of icons, which decides how many fit.
  const stackWidth = signal(0);
  // The rows of the open stack, as the overlay that collapses it is anchored to.
  const listAnchor = signal<ViewRef | null>(null);
  const STACK_ICON = 26;
  // The distance between icons: wider in the full column, kept in the rail where space is short.
  const stackStep = () => (railed() ? 12 : 18);
  // While arranging, hidden boards sink to the bottom. Mixed in with the others they ended up
  // under the personal entries' bar, where their eye could never be reached; grouped at the
  // end they are always a short scroll away. Shown boards keep their own order above them.
  const arrangingGroups = () => {
    const all = orderedChannels();
    const off = new Set(hiddenChannelIds());
    return {
      shown: all.filter((c) => !off.has(c.id)),
      hidden: all.filter((c) => off.has(c.id)),
    };
  };
  const arrangedIds = () => {
    const g = arrangingGroups();
    return [...g.shown, ...g.hidden].map((c) => c.id);
  };
  // Every board the user keeps is listed, in their order. Which ones appear is their own call
  // (the eye while arranging) — there is no fixed "first four" any more.
  const listed = () => {
    if (sortingMode()) {
      const g = arrangingGroups();
      return [...g.shown, ...g.hidden];
    }
    return visibleChannels();
  };
  // Nothing is folded away, so there is never a "more" stack to fill.
  const hidden = (): Channel[] => [];

  // Opening or closing More, and pinning a channel, fades the list's change. Only
  // opacity is animated: moving 19 rows with a layout animation dropped frames on
  // tablets, while a compositor-only fade stays smooth and avoids a hard jump.
  // Touch targets still react at once — no position or size is ever animated.
  function animateListChange() {
    if (reduceMotion()) return;
    const curve = { type: "easeInEaseOut" as const };
    LayoutAnimation.configureNext({
      duration: 220,
      update: { ...curve, property: "opacity" },
      create: { ...curve, property: "opacity" },
      delete: { ...curve, property: "opacity" },
    });
  }
  // The Android back key: close the most recent overlay first, then step out
  // of the open thread, and only then let the system exit the app.
  try {
    BackHandler.on("press", () => {
      if (moreOpen()) { collapseMore(); return true; }
      if (searchTerm() !== null || searchOpen()) { closeSearch(); return true; }
      // Portrait's ladder steps back one rung: list → boards → away.
      if (portraitPane() !== null) { paneBack(); return true; }
      if (detour().length > 0) { backFromLink(); return true; }
      if (thread() || peer()) {
        // Portrait: Back opens the list pane over the body (3 → 2) instead of closing the thread.
        if (panesNow) { portraitPane.set("list"); return true; }
        thread.set(null); peer.set(null); return true;
      }
      return false;
    });
  } catch { /* desktop preview has no back key */ }

  function toggleMore() {
    animateListChange();
    moreOpen.set(!moreOpen());
  }
  // Going to any other channel or list closes More; picking from More keeps it open.
  function collapseMore() {
    if (!moreOpen()) return;
    animateListChange();
    moreOpen.set(false);
  }

  // The place saved by the last run, read once; it is applied once, after the
  // channel list first loads, and only if the user has not picked a place since.
  const savedPlace = loadLastPlace();

  // A landscape cold start draws the last board's cached first page before the channel list
  // arrives, saving a round-trip. Portrait opens on the boards, so it waits for the list.
  let shownFromCache = false;
  savedPlace.then((place) => {
    if (shownFromCache || wantsPanes()) return;
    const saved = place?.channel;
    if (!saved || channel() || favorites() || mine() || replies() || messages() || noticesOpen() || history()) return;
    const cached = listCache.get(forumKey(saved.id));
    if (!cached) return;
    shownFromCache = true;
    channel.set(saved);
    posts.set(cached.items);
    more.set(cached.more);
    page.set(1);
    listLoading.set(false);
  }).catch(() => undefined);
  let placeRestored = false;

  // The channel column: a rail of icons when folded or when the window is narrow.
  const railed = () => channelsRailed(windowSize().width, channelsCollapsed());
  const wide = () => windowSize().width >= RAIL_BELOW;
  // Portrait (height > width): the post-list column collapses to a rail while a thread is open,
  // mirroring how the board column folds on a narrow window. The detail then owns the width.
  const isPortrait = () => windowSize().height > windowSize().width;
  panesNow = wantsPanes();
  const threadListPopoverOpen = signal(false);
  const threadListAnchor = signal<ViewRef | null>(null);

  // Portrait gives the body the whole width, and navigates as a 3-2-1 ladder over it: the thread
  // (3), its list (2), the boards (1). A right swipe or Back opens the list over the body, again
  // opens the boards, again puts the panes away. Picking a board goes forward to its list; picking
  // a thread goes back to the body. A launch starts on the boards, as the tablet's first screen.
  const portraitPane = signal<"list" | "boards" | null>(null);
  // The pane follows a right swipe back up the ladder. Entry, exit and the gesture share ONE
  // value, the way the phone build does: the pane is moved only by `panePan`, and the dim only by
  // `paneFade`. Two channels (a motion's translateX plus a drag value) can leave a stale offset
  // behind when a pane is reused, which is what used to blank the screen after a swipe back.
  const panePan = createAnimatedValue(0);
  const paneFade = createAnimatedValue(1);
  // The pane is a forward navigation over the body: M3 enter = standard decelerate 250 ms,
  // exit = standard accelerate 200 ms (the tokens in pageSlide.ts).
  const PANE_IN_MS = M3.duration.enter;
  const PANE_OUT_MS = M3.duration.exit;
  // What is drawn follows `portraitPane` a step behind, so an exit can play before the pane is
  // taken away. `portraitPane` is what the app means; `paneShown` is what is on screen.
  const paneShown = signal<"list" | "boards" | null>(null);
  let paneExitRight = false;
  let paneSkipExit = false;
  // The pane at rest: on screen, opaque, undragged. Every animation path ends here — success or
  // failure — because a pane left off-screen or half-faded still spans the window and swallows
  // every touch and swipe over the body.
  const restPane = () => { panePan.set(0); paneFade.set(1); };
  /** Takes the ladder away at once: the body has covered it. */
  function closePaneAtOnce(): void {
    if (portraitPane() === null && paneShown() === null) {
      paneSkipExit = false;
      panePan.set(0);
      paneFade.set(1);
      return;
    }
    paneSkipExit = true;
    portraitPane.set(null);
  }
  effect(() => {
    const target = portraitPane();
    untracked(() => {
      if (target !== null) {
        if (paneShown() === target) return;
        const previous = paneShown();
        const w = windowSize().width;
        paneShown.set(target);
        // list ↔ boards swap their contents in place: there is no second screen to push, so no
        // slide. A pane opening over the body enters from the left, the way a right swipe backs out.
        if (previous !== null) return;
        paneFade.set(0.45);
        if (reduceMotion()) { panePan.set(0); paneFade.set(1); return; }
        panePan.set(-w);
        void panePan.timing(0, { duration: PANE_IN_MS, easing: M3.easing.standardDecelerate })
          .catch(restPane);
        void paneFade.timing(1, { duration: PANE_IN_MS, easing: M3.easing.standardDecelerate })
          .catch(restPane);
        return;
      }
      if (paneShown() === null) return;
      if (paneSkipExit) {
        paneSkipExit = false;
        paneShown.set(null);
        panePan.set(0);
        paneFade.set(1);
        return;
      }
      // Closing: out the way the finger was going (right for a swipe/back, left otherwise), then
      // unmount only once it is off screen.
      const out = paneExitRight ? windowSize().width : -windowSize().width;
      paneExitRight = false;
      if (reduceMotion()) {
        paneShown.set(null);
        panePan.set(0);
        paneFade.set(1);
        return;
      }
      void paneFade.timing(0, { duration: PANE_OUT_MS, easing: M3.easing.standardAccelerate }).catch(() => undefined);
      void panePan.timing(out, { duration: PANE_OUT_MS, easing: M3.easing.standardAccelerate }).then(() => {
        if (portraitPane() === null) {
          paneShown.set(null);
          restPane();
        } else if (portraitPane() === paneShown()) {
          // The dismissal was overtaken: something re-opened this very pane while the exit was
          // in flight. It must come back to rest, not be left faded and off-screen.
          restPane();
        }
      }).catch(() => {
        // A failed exit must not leave the pane half-out either: settle it the way a finished
        // one is — gone if nothing wants it, at rest if it was claimed back meanwhile.
        if (portraitPane() === null) paneShown.set(null);
        restPane();
      });
    });
  });
  effect(() => {
    if (!wantsPanes()) { portraitPane.set(null); return; }
    // Never the bare placeholder full screen: with no thread open, the board column shows.
    // A peer (a private-message conversation) is content too: the pane was just dismissed for
    // it, and claiming the screen back here would race the pane's exit animation — the pane
    // would end up neither dismissed nor on screen, invisibly eating every gesture (this is the
    // swipe-back-in-a-conversation bug). The body is never bare while a conversation is open.
    // A peer (a private-message conversation) and the composer are content too: the pane was
    // just dismissed for them, and claiming the screen back here would race the pane's exit
    // animation — the pane would end up neither dismissed nor on screen, invisibly eating every
    // gesture (this is the swipe-back-in-a-conversation bug, and it made the composer's keyboard
    // look like it never came up). The body is never bare while either is open.
    if (!thread() && !peer() && !composing() && portraitPane() === null) {
      portraitPane.set("boards");
      // The board column is what a launch shows: its unread counts are refreshed at once, with
      // the cached numbers on screen while the fresh ones arrive.
      untracked(() => reloadChannels(true));
    }
  });

  /** Steps back one rung of the portrait ladder. */
  function paneBack() {
    const pane = portraitPane();
    if (pane === "list") {
      paneOpenedAt = Date.now();
      portraitPane.set("boards");
      // The board column refreshes its unread counts when it comes back.
      void reloadChannels(true);
      return;
    }
    // A tap/back-key exit leaves to the left; a successful right swipe overrides this to the
    // right so the pane keeps going the way the finger moved.
    paneExitRight = false;
    portraitPane.set(null);
  }
  /** Shows a pane over the body; only portrait has panes. */
  function showPane(pane: "list" | "boards") {
    if (!panesNow) return;
    paneOpenedAt = Date.now();
    portraitPane.set(pane);
    // Coming back to the board column refreshes its unread counts at once.
    if (pane === "boards") void reloadChannels(true);
  }

  // Saves the channel and thread now open (favorites save no channel).
  function savePlace() {
    saveLastPlace({ channel: favorites() || mine() || replies() || messages() || noticesOpen() || history() ? null : channel(), thread: thread() });
  }

  function restorePlace(list: Channel[]) {
    if (placeRestored) return;
    placeRestored = true;
    // Portrait opens on the board column (the first rung), not on the thread read last time;
    // landscape keeps restoring the place, since all three columns are on screen there.
    if (panesNow) return;
    const nothingOpen = () => !favorites() && !mine() && !replies() && !messages() && !noticesOpen() && !history() && !channel() && !searchTerm() && !composing();
    savedPlace.then((place) => {
      const saved = place?.channel;
      const found = saved ? list.find((c) => c.id === saved.id) : undefined;
      // The cached first page may already have put this board on screen: refresh it rather than
      // treating it as "something else is open".
      const cachedBoardOpen = () => !!found && channel()?.id === found.id;
      if (found && (nothingOpen() || cachedBoardOpen())) {
        openChannel(found);
        if (place?.thread) {
          thread.set(place.thread);
          savePlace();
        }
        return;
      }
      // Nothing to restore (a first run, or the last place was a list): open the first board.
      // Otherwise the thread column opens on "选择一个版块" with nothing to pick from in portrait,
      // where the board column is out of the row until the drawer opens.
      if (nothingOpen() && list.length > 0) openChannel(list[0]);
    });
  }

  let loadingMore = false;
  const loadingMoreShown = signal(false);
  // A page after the first that fails is retried by the next scroll to the end. Only after
  // MORE_FAILURES in a row does the list's end show the failure with a Retry button.
  const MORE_FAILURES = 3;
  let moreFailures = 0;
  const moreError = signal<Failed | null>(null);
  // The first page of a channel or of favorites is loading and nothing is cached for it:
  // the column shows placeholder rows in place of the list. `listRequest` drops answers
  // that were overtaken by a later pick.
  const listLoading = signal(false);
  // True while page 1 of the open list is fetched, cached or not: the refresh icon spins.
  const refreshing = signal(false);
  // The list's own pull spinner: only a real pull gesture shows it. Page 1 also loads when a
  // board opens or the header button is pressed — the header icon spins for that, the list
  // must not drop a spinner over the first row.
  const pullRefreshing = signal(false);
  let listRequest = 0;
  // Identifies the page-N request that currently owns `loadingMore`. A page-1 refresh can
  // overtake a page-N fetch (it bumps `listRequest`), but only the owner releases the lock.
  let pagingToken = 0;

  // Loads page `n` of a list (a channel's threads or the favorites) and merges it in;
  // page 1 replaces the list and is cached under `key`.
  function fetchList(load: (n: number) => Promise<Post[]>, n: number, key: string, token = 0) {
    const request = n === 1 ? ++listRequest : listRequest;
    if (n === 1) refreshing.set(true);
    load(n)
      .then((list) => {
        if (request !== listRequest) return;
        moreFailures = 0;
        moreError.set(null);
        // The phone app's clean merge: page 1 replaces the rows, a later page appends them.
        const merged = n === 1 ? { items: list, more: list.length > 0 } : mergePage(posts(), list);
        if (n === 1) {
          more.set(merged.more);
          // A new list legitimately starts at its top: do not defend the old reading position.
          lastReadingY = 0;
          holdY = 0;
          heldRows = null;
          guardCooldownUntil = Date.now() + 1200;
          posts.set(merged.items);
        } else if (Date.now() - lastScrollAt < SCROLL_IDLE_MS) {
          // The finger is still moving: keep the rows aside and insert them when it stops.
          const heldKey = headerTitle();
          heldRows = { key: heldKey, items: merged.items, more: merged.more, page: n };
          // onScrollEnd is the normal hand-over point. A gesture that ends without it (a list
          // that lost focus, a scroll stopped by a tap) must not strand this page: retry once
          // the list has been still for a while — the check is what makes the retry safe.
          setTimeout(() => {
            if (!heldRows || heldRows.key !== heldKey) return;
            if (Date.now() - lastScrollAt >= SCROLL_IDLE_MS) flushHeldRows();
          }, SCROLL_IDLE_MS + 300);
        } else {
          applyRows(merged.items, merged.more);
        }
        if (n === 1) {
          listCache.set(key, { items: merged.items, more: merged.more, at: Date.now() });
          if (listCache.size > LIST_CACHE_MEMORY) {
            const oldest = [...listCache.entries()].sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0))[0];
            if (oldest) listCache.delete(oldest[0]);
          }
          saveListCache();
        }
        // The favorites loaded so far are saved, and saved favorites the list has dropped are pruned.
        if (key === FAVORITES_KEY) reconcileFavorites(merged.items, !merged.more);
        page.set(n);
        // A search with hits is done: its field hides, and the results and the header stay.
        if (n === 1 && list.length > 0 && key === searchKey(searchTerm() ?? "")) {
          animateSearchChange();
          searchOpen.set(false);
        }
        // Warm the first few reply pages after the list settles, one at a time: enough that opening
        // one of the first rows is instant, gentle enough not to compete with the list's own
        // pictures and avatars for the connection.
        if (n === 1 && !DEMO) {
          setTimeout(() => {
            let i = 0;
            const next = () => {
              if (i >= Math.min(5, list.length)) return;
              const p = list[i++];
              if (!p.id) { next(); return; }
              void loadReplyPage(p.id, 1).finally(() => setTimeout(next, 80));
            };
            next();
          }, 350);
        }
      })
      .catch((e) => {
        if (request !== listRequest) return;
        if (n === 1) {
          notify("list", "帖子加载失败，点此重试。", () => {
            listLoading.set(true);
            fetchList(load, 1, key);
          });
          return;
        }
        moreFailures++;
        if (moreFailures >= MORE_FAILURES) {
          moreError.set({ message: "加载更多帖子失败。", retry: () => loadMore() });
          notify("more", "加载更多帖子失败。 Tap to retry.", () => {
            moreError.set(null);
            moreFailures = 0;
            loadMore();
          });
        }
      })
      .finally(() => {
        listLoading.set(false);
        if (n === 1) {
          // An overtaken page-1 load must not stop the spinner owned by the newer one.
          if (request === listRequest) { refreshing.set(false); pullRefreshing.set(false); }
          return;
        }
        // Always release the paging lock owned by this request — even when a page-1 refresh
        // overtook it and `listRequest` has since changed. The old guard returned early here,
        // leaving `loadingMore` true forever: every later loadMore() became a no-op, so the
        // list stopped at 50 rows and the footer read "没有更多帖子了".
        if (token === pagingToken) {
          loadingMore = false;
          loadingMoreShown.set(false);
        }
      });
  }

  function loadMore(quiet = false) {
    // A page fetched while the list was moving is waiting to be inserted: insert it instead of
    // asking for the next one, which would skip a page and leave a gap in the rows.
    if (flushHeldRows()) return;
    // Search results and 提醒 are one page: there is no next page to fetch.
    if (searchTerm() !== null || noticesOpen()) return;
    // Once the end shows Retry, scrolling does not fetch again: the button does.
    // The single `loadingMore` lock covers the early (onScrollEnd) request and the
    // end-of-list (onLoadMore) request, so a page is never fetched twice.
    if (loadingMore || !more() || moreError()) return;
    // Claim the token only when a request really starts: history/notices have no next page.
    const begin = () => {
      pagingToken++;
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      return pagingToken;
    };
    // Favorites page the same way as a channel: the next page of the favorites.
    if (favorites()) {
      fetchList((p) => loadBookmarks(p), page() + 1, FAVORITES_KEY, begin());
    } else if (mine()) {
      fetchList((p) => loadMyThreads(p), page() + 1, MY_THREADS_KEY, begin());
    } else if (replies()) {
      fetchList((p) => loadMyReplies(p), page() + 1, MY_REPLIES_KEY, begin());
    } else if (messages()) {
      fetchList((p) => loadPmUsers(p), page() + 1, MESSAGES_KEY, begin());
    } else if (channel()) {
      const c = channel()!;
      fetchList((p) => loadPosts(c.id, p, sortFor(c.id)), page() + 1, forumKey(c.id), begin());
    }
  }

  // Opens a list: from the cache at once when it is there, placeholder rows otherwise;
  // either way its first page is fetched and replaces what is shown.
  function openList(key: string, load: (n: number) => Promise<Post[]>, keepPane = false) {
    lastReadingY = 0;
    holdY = 0;
    holdUntil = 0;
    restoringOffset = false;
    appendedAt = 0;
    heldRows = null;
    guardCooldownUntil = Date.now() + 1200;
    detour.set([]);
    // Board picks pass keepPane so the list loads into the column that is already on screen (the
    // boards pane's right half, or the landscape row). Personal lists still default to advancing
    // to the full-screen list pane in portrait.
    if (!keepPane) showPane("list");
    const cached = listCache.get(key);
    posts.set(cached ? cached.items : []);
    more.set(cached ? cached.more : true);
    page.set(1);
    moreFailures = 0;
    moreError.set(null);
    listLoading.set(!cached);
    fetchList(load, 1, key);
  }

  function showFavorites() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    pinned.set(null);
    favorites.set(true);
    mine.set(false);
    replies.set(false);
    messages.set(false);
    noticesOpen.set(false);
    history.set(false);
    channel.set(null);
    thread.set(null);
    openList(FAVORITES_KEY, (p) => loadBookmarks(p));
    savePlace();
  }

  function showMine() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    mine.set(true);
    favorites.set(false);
    replies.set(false);
    messages.set(false);
    noticesOpen.set(false);
    history.set(false);
    channel.set(null);
    thread.set(null);
    openList(MY_THREADS_KEY, (p) => loadMyThreads(p));
    savePlace();
  }

  function showReplies() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    replies.set(true);
    messages.set(false);
    noticesOpen.set(false);
    history.set(false);
    favorites.set(false);
    mine.set(false);
    channel.set(null);
    thread.set(null);
    openList(MY_REPLIES_KEY, (p) => loadMyReplies(p));
    savePlace();
  }

  function showMessages() {
    noticesOpen.set(false);
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    messages.set(true);
    history.set(false);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    channel.set(null);
    thread.set(null);
    peer.set(null);
    openList(MESSAGES_KEY, (p) => loadPmUsers(p));
    savePlace();
  }

  // The history, as sections of threads. Its rows are taken now, from the history as it stands,
  // and the threads column shows them with no further loading: every thread is already there.
  function showHistory() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    history.set(true);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    messages.set(false);
    noticesOpen.set(false);
    channel.set(null);
    thread.set(null);
    peer.set(null);
    snapshotHistory();
    // Portrait: the history is a list, so it opens the list pane over the boards.
    showPane("list");
    savePlace();
  }

  // Takes the history's rows as they stand now, for the list the threads column shows.
  function snapshotHistory() {
    const sections = groupHistory(historyEntries(), new Date());
    const rows: HistoryRow[] = [];
    for (const s of sections) {
      rows.push({ kind: "header", title: s.title });
      for (const p of s.posts) rows.push({ kind: "post", post: p });
    }
    detour.set([]);
    historyRows.set(rows);
    posts.set(sections.flatMap((s) => s.posts));
    more.set(false);
    moreError.set(null);
    listLoading.set(false);
    refreshing.set(false);
    pullRefreshing.set(false);
  }

  // Opening a board loads its posts into the list column where it already sits — the boards
  // pane shows both columns side by side, and a landscape row shows them together too. Advancing
  // to the full-screen list pane here is what made a board tap look like a page jump; keepPane
  // defaults to true so every board pick (tap, cold start, restore) stays in the two-column view.
  function openChannel(c: Channel, keepPane = true) {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    messages.set(false);
    noticesOpen.set(false);
    history.set(false);
    // Take the board as the merged list has it now: a channel opened from a stale cache may still
    // carry the index's dotted name ("…").
    channel.set(channels()?.find((x) => x.id === c.id) ?? c);
    // A channel from More stays in the list while it is open; any other pick sends it back.
    pinned.set(c.newPosts === 0 ? c.id : null);
    thread.set(null);
    openList(forumKey(c.id), (p) => loadPosts(c.id, p, sortFor(c.id)), keepPane);
    savePlace();
  }

  // Cold start: open the first board's threads rather than landing on an empty body. It happens
  // once, after a beat so a place restored from the last run (a thread, a list, a search) wins,
  // and it takes the board the user themselves put first in the column.
  let autoOpenedFirstBoard = false;
  let autoOpenScheduled = false;
  effect(() => {
    if (autoOpenedFirstBoard || autoOpenScheduled) return;
    const list = channels();
    if (!list || list.length === 0) return;
    autoOpenScheduled = true;
    setTimeout(() => {
      autoOpenedFirstBoard = true;
      if (channel() || thread() || favorites() || mine() || replies() || messages() || noticesOpen() || history() || searchTerm() !== null) return;
      const first = orderedChannels()[0];
      if (first) openChannel(first);
    }, 300);
  });

  function openThread(p: Post) {
    composing.set(false);
    // Only the conversation list opens a peer. A notice row is a thread, even
    // though its list shares the column: treating it as a peer showed an empty
    // "conversation" instead of the post it points at.
    if (messages()) {
      detour.set([]);
      peer.set(p);
      // Closed after the peer is set: closing it first let the "no thread" rule put the boards
      // pane straight back, which squeezed the conversation beside the first column.
      portraitPane.set(null);
      return;
    }
    if (noticesOpen() && !p.id) {
      notify("notice-no-thread", "这条提醒没有对应的帖子。");
      return;
    }
    // Opened from the history or 提醒, the thread shows as it does from its channel.
    detour.set([]);
    noticeFocusPid.set(noticesOpen() ? (p.focusPid ?? null) : null);
    if (noticesOpen()) peer.set(null);
    thread.set(p);
    // Portrait: picking a thread closes the pane and gives the body back. Set after the thread,
    // for the same reason: the pane rule must see a thread open.
    portraitPane.set(null);
    // A thread opened from a list is recorded. A 4d4y link's thread opens through openLinkedThread instead, and is not.
    recordView(p);
    savePlace();
  }

  // A 4d4y thread link pressed in the open thread: its thread replaces the column's, until Back.
  function openLinkedThread(tid: string, pid?: string) {
    noticeFocusPid.set(null);
    detour.set([...detour(), { id: tid, title: "", focus: pid }]);
  }

  function backFromLink() {
    detour.set(detour().slice(0, -1));
  }

  // Back from an open thread: drop the notice's floor marker as well, so a
  // later thread opened from a channel never starts at somebody else's post.
  function leaveThread() {
    noticeFocusPid.set(null);
    if (wantsPanes()) showPane("list");
    else thread.set(null);
  }

  // Shows the threads whose titles contain `term`, in the threads column. The channel or
  // favorites open before it stays selected in the column, and closing search returns to it.
  function openSearch(term: string) {
    composing.set(false);
    const t = term.trim();
    if (!t) return;
    searchTerm.set(t);
    searchOpen.set(true);
    searchDraft.set(t);
    openList(searchKey(t), () => searchThreads(t));
  }

  // Closes the search field. With results showing, the channel or favorites they replaced
  // comes back; an empty search only hides the field.
  function closeSearch() {
    const wasSearching = searchTerm() !== null;
    searchTerm.set(null);
    searchOpen.set(false);
    searchDraft.set("");
    if (!wasSearching) return;
    if (favorites()) {
      openList(FAVORITES_KEY, (p) => loadBookmarks(p));
    } else if (mine()) {
      openList(MY_THREADS_KEY, (p) => loadMyThreads(p));
    } else if (replies()) {
      openList(MY_REPLIES_KEY, (p) => loadMyReplies(p));
    } else if (noticesOpen()) {
      openList(NOTICES_KEY, () => loadNotices());
    } else if (messages()) {
      openList(MESSAGES_KEY, (p) => loadPmUsers(p));
    } else if (history()) {
      snapshotHistory();
    } else if (channel()) {
      const c = channel()!;
      openList(forumKey(c.id), (p) => loadPosts(c.id, p, sortFor(c.id)));
    } else {
      posts.set([]);
      more.set(false);
    }
  }

  // `/` searches and `?` lists the shortcuts, from anywhere in the Forum (signed in only for `/`,
  // as the search icon is). A key does not fire while a text field has the focus.
  const openSearchFromKey = () => {
    if (!props.user() || shortcutsOpen()) return;
    if (!searchOpen()) searchProps.onOpen();
    searchFocusTick.set(searchFocusTick() + 1);
  };
  useCommand("forum.search", {
    enabled: () => !!props.user() && !shortcutsOpen(),
    run: openSearchFromKey,
  });
  useCommand("forum.shortcuts", { run: () => shortcutsOpen.set(!shortcutsOpen()) });
  useCommand("forum.refresh", {
    enabled: () => !nothingPicked() && !shortcutsOpen(),
    run: () => refreshThreads(),
  });
  // `n` and `p` open the next and the previous thread of the list, from the thread shown (the first
  // or the last when none is shown). They wait while the shortcut list is open.
  function stepThread(step: 1 | -1) {
    if (shortcutsOpen()) return;
    const list = posts();
    if (list.length === 0) return;
    const at = list.findIndex((p) => p.id === thread()?.id);
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : at + step;
    if (next < 0 || next >= list.length) return;
    openThread(list[next]);
  }
  useCommand("forum.next", {
    enabled: () => !shortcutsOpen() && posts().length > 0,
    run: () => stepThread(1),
  });
  // A new thread goes into the channel open in the threads column: not into favorites, the user's own
  // posts or replies, messages, or the results of a title search.
  const canCompose = () => !!props.user() && !!channel() && !favorites() && !mine() && !replies() && !messages() && !noticesOpen() && !history() && searchTerm() === null;
  function openComposer() {
    if (!canCompose() || shortcutsOpen()) return;
    // Portrait: the list sits in a pane above the body, and the composer is body content. The
    // body switches FIRST (the order matters): closing the pane first let the no-body effect
    // — which saw an empty body — claim the screen back mid-exit, and the boards pane ended up
    // covering the form, eating every tap (the keyboard looked like it never came up).
    composing.set(true);
    if (wantsPanes()) portraitPane.set(null);
  }
  useCommand("forum.compose", {
    enabled: () => canCompose() && !shortcutsOpen(),
    run: openComposer,
  });
  // After a post: the channel's list reloads, and the new thread opens when the forum showed it.
  function threadPosted(thread: Post | undefined) {
    const c = channel();
    composing.set(false);
    // After publishing, show the refreshed list in place too: from the body (composing closed its
    // pane) that means advancing to the list pane so the new post is actually visible.
    if (c) openChannel(c, false);
    if (thread) openThread(thread);
  }
  useCommand("forum.prev", {
    enabled: () => !shortcutsOpen() && posts().length > 0,
    run: () => stepThread(-1),
  });
  cleanup(
    onEscape(() => {
      if (!shortcutsOpen()) return false;
      shortcutsOpen.set(false);
      return true;
    }),
  );

  // The search control, in the title bar or, where the platform draws none, the threads column's header.
  const searchProps: SearchProps = {
    open: searchOpen,
    draft: searchDraft,
    focusTick: () => searchFocusTick(),
    term: () => searchTerm() ?? "",
    signedIn: () => !!props.user(),
    onDraft: (text: string) => searchDraft.set(text),
    // Submitting searches; the field hides once the results arrive with hits (see fetchList).
    onSubmit: openSearch,
    onOpen: () => {
      animateSearchChange();
      searchOpen.set(true);
    },
    // A press outside the field: the field hides, and its draft goes back to the search shown.
    onHide: () => {
      animateSearchChange();
      searchOpen.set(false);
      searchDraft.set(searchTerm() ?? "");
    },
    onClose: () => {
      animateSearchChange();
      closeSearch();
    },
  };

  // The threads column's title: the search it shows, else the channel or list open.
  const headerTitle = () =>
    searchTerm() !== null ? `包含 “${searchTerm()}” 的帖子` : favorites() ? "收藏" : mine() ? "我的主题" : replies() ? "我的回复" : noticesOpen() ? "提醒" : messages() ? "短消息" : history() ? "历史" : channel() ? channel()!.title : "帖子";

  // Which list the column shows. A change here means the user switched boards (or to a personal
  // list / search); the list content slides in from the right so the swap reads as a page turn
  // instead of an instant replacement. Refreshing the same list does not change the key.
  const listIdentity = () =>
    searchTerm() !== null ? searchKey(searchTerm()!)
      : favorites() ? FAVORITES_KEY
      : mine() ? MY_THREADS_KEY
      : replies() ? MY_REPLIES_KEY
      : messages() ? MESSAGES_KEY
      : noticesOpen() ? NOTICES_KEY
      : history() ? "history"
      : channel() ? forumKey(channel()!.id)
      : "none";
  const listSlide = createMotion();
  let lastListIdentity: string | null = null;
  effect(() => {
    const key = listIdentity();
    if (key === lastListIdentity) return;
    const first = lastListIdentity === null;
    lastListIdentity = key;
    if (first || key === "none") return; // nothing to slide on the very first render or an empty body
    // Switching boards is a lateral move between peer destinations: slide on one axis, no fade.
    void lateralSlide(listSlide);
  });

  // Nothing is open yet (no channel, list or search), so the column has nothing to list.
  const nothingPicked = () =>
    searchTerm() === null && !favorites() && !mine() && !replies() && !messages() && !noticesOpen() && !history() && !channel();

  // A list is picked and loaded, but it has no rows. The column needs a kind word instead of a
  // blank page — otherwise switching to an empty board looks like a failed load. The wording
  // follows whichever list is open, so the placeholder never claims a board is empty when the
  // real cause is an empty favorites result or a search that matched nothing.
  const emptyMessage = () =>
    searchTerm() !== null ? "没有找到相关帖子。"
      : favorites() ? "还没有收藏帖子。"
      : mine() ? "还没有发布过帖子。"
      : replies() ? "还没有回复过帖子。"
      : messages() ? "还没有短消息。"
      : noticesOpen() ? "还没有提醒。"
      : history() ? "还没有浏览记录。"
      : "这个版块还没有帖子。";

  // The rows the threads column lists: the history's sections, or the threads as they are.
  // `computed` keeps the array stable until the posts (or the hidden set or the history) change,
  // so an unrelated re-render does not hand the list a new array and re-render every row.
  // Threads the user hid ("隐藏该贴") are left out.
  const listRows = computed(
    (): ListRow[] =>
      history()
        ? historyRows().filter((r) => (r.kind !== "post" ? true : !isHidden(r.post.id)))
        : posts().filter((p) => !isHidden(p.id)).map((post): ListRow => ({ kind: "post", post })),
  );

  // True while the channel list is being fetched: the refresh icon dims and ignores presses.
  const channelsLoading = signal(false);

  // Only the newest request may set the list, so an earlier answer cannot
  // replace a later one (a signed-out load finishing after a signed-in one).
  let channelsRequest = 0;

  // `quiet` drops a failure silently: after sign-out, the channel list may refuse
  // the signed-out view, and that is expected rather than an error to show.
  function reloadChannels(quiet = false) {
    if (channelsLoading()) return;
    channelsLoading.set(true);
    const request = ++channelsRequest;
    loadChannels()
      .then((list) => {
        if (request !== channelsRequest) return;
        // A page that carries no "今日" counts (all zeros) keeps the last numbers instead of
        // wiping them: the board column should not go blank between refreshes.
        const prev = new Map((channels() ?? []).map((c) => [c.id, c.newPosts]));
        const fresh = list.every((c) => c.newPosts === 0)
          ? list.map((c) => ({ ...c, newPosts: prev.get(c.id) ?? 0 }))
          : list;
        channels.set(fresh);
        cachedChannels.set(fresh);
        Storage.setItem(CHANNELS_STORE, JSON.stringify(fresh)).catch(() => undefined);
        restorePlace(fresh);
        // Preview only: open the first channel and thread so the three-column layout is visible.
        if (DEMO && list.length > 0 && !DEMO_PREVIEW_OPENED) {
          DEMO_PREVIEW_OPENED = true;
          openChannel(list.find((c) => c.title === "Discovery") ?? list[0]);
          setTimeout(() => { const first = posts()[0]; if (first) openThread(first); }, 350);
        }
      })
      .catch((e) => {
        if (request !== channelsRequest || quiet) return;
        // Signed out, a failed channel list is not an error to report: the sign-in dialog is what is needed.
        if (!props.user()) {
          props.onSignInNeeded?.();
          return;
        }
        notify("channels", "版块加载失败，点此重试。", () => reloadChannels());
      })
      .finally(() => {
        if (request === channelsRequest) channelsLoading.set(false);
      });
  }

  // Refresh the open list: favorites or the channel's threads, from page 1.
  // Only the header's refresh button starts this. The pull-to-refresh gesture was removed:
  // it duplicated the button, and a pull at the wrong moment reloaded page 1 mid-scroll and
  // threw the reader back to the first post.
  /** A pull is a refresh only from the very top of a loaded list. The offset alone is not
   *  enough: a rows rebuild reports ~0, and a bounce at the end can too — treating either as a
   *  pull reloads page 1, which is precisely the "thrown back to the first post" jump. So the
   *  distance to the end must still say "there is a lot below", no merge may be settling, and
   *  no restore may be in flight. */
  function atListTop(): boolean {
    if (restoringOffset || Date.now() < guardCooldownUntil) return false;
    if (Date.now() - appendedAt < 900) return false;
    const v = listViewport;
    // `listRest > 200` keeps a bounce at the END of a long list from counting as a pull; a list
    // that has no next page cannot bounce that way, and a short one has almost nothing below, so
    // the gesture stays available there too.
    if (!v || v.key !== headerTitle() || v.y >= 60) return false;
    return listRest > 200 || !more();
  }

  /** A pull from the very top of the list. The gesture is the only thing the list's own
   *  spinner is for; the header button refreshes without it. */
  function onPullRefresh(): void {
    if (!atListTop()) return;
    pullRefreshing.set(true);
    refreshThreads();
    // History and 提醒 load synchronously (no request to finish): drop the spinner at once.
    if (!refreshing()) pullRefreshing.set(false);
  }

  function refreshThreads() {
    // Refreshed in place: the rows stay until the new page replaces them, so the list does not
    // blink through an empty frame (the old path also cleared the thread and re-ran the layout
    // animation, which read as a flash while scrolling).
    const term = searchTerm();
    if (term !== null) { fetchList(() => searchThreads(term), 1, searchKey(term)); return; }
    if (favorites()) { fetchList((p) => loadBookmarks(p), 1, FAVORITES_KEY); return; }
    if (mine()) { fetchList((p) => loadMyThreads(p), 1, MY_THREADS_KEY); return; }
    if (replies()) { fetchList((p) => loadMyReplies(p), 1, MY_REPLIES_KEY); return; }
    if (noticesOpen()) { fetchList(() => loadNotices(), 1, NOTICES_KEY); void refreshNotify(); return; }
    if (messages()) { fetchList((p) => loadPmUsers(p), 1, MESSAGES_KEY); return; }
    if (history()) { snapshotHistory(); return; }
    const c = channel();
    if (c) fetchList((p) => loadPosts(c.id, p, sortFor(c.id)), 1, forumKey(c.id));
  }

  // Load the channel list on launch, and again on every sign-in or sign-out. Signing
  // out closes the open list and thread: a hidden channel, or favorites, needs an
  // account, so its threads must not stay on screen. A list still loading is dropped.
  // Whether the previous run saw a signed-in user: null on launch, so only a real sign-out is quiet.
  let notifyTimer: number | undefined;
  const wasSignedIn = signal<boolean | null>(null);
  effect(() => {
    const signedIn = !!props.user();
    untracked(() => {
      // Thread pages are per account too: sign-in and sign-out both drop them.
      clearReplyPageCache();
      if (!signedIn) {
        listRequest++;
        // Search needs an account: its field and results go with the sign-out.
        searchTerm.set(null);
        searchOpen.set(false);
        searchDraft.set("");
        // Cached lists are per account: they go with the sign-out.
        listCache.clear();
        Storage.removeItem(LIST_CACHE_STORE).catch(() => undefined);
        clearFavoriteIds();
        // The signed-in channel list goes too: the reload below brings the signed-out one.
        channels.set(null);
        favorites.set(false);
        mine.set(false);
        replies.set(false);
        messages.set(false);
        noticesOpen.set(false);
        history.set(false);
        channel.set(null);
        thread.set(null);
        peer.set(null);
        posts.set([]);
        page.set(1);
        more.set(false);
        listLoading.set(false);
        refreshing.set(false);
        pullRefreshing.set(false);
        loadingMoreShown.set(false);
        loadingMore = false;
        moreFailures = 0;
        moreError.set(null);
      }
      reloadChannels(wasSignedIn() === true && !signedIn);
      // Keep the unread badges fresh: once now, then every 90 s while signed in.
      if (notifyTimer !== undefined) { clearInterval(notifyTimer); notifyTimer = undefined; }
      if (signedIn) {
        // The list's own request goes first; the badges can arrive a moment later.
        setTimeout(() => { void refreshNotify(); }, 900);
        notifyTimer = setInterval(() => { void refreshNotify(); }, 90000);
      } else {
        pmUnread.set(0);
        noticeUnread.set(0);
      }
      wasSignedIn.set(signedIn);
    });
  });

  /** 提醒：notice.php 的列。它和短消息共用列表栏，但 `messages()` 必须为 false，
   *  否则点一行提醒会走私信分支（peer），正文就空了；两个红点也各管各的。 */
  function showNotices() {
    // A pm list still in flight is cancelled here, so its answer cannot settle
    // into the notices (`fetchList` drops answers older than `listRequest`).
    listRequest++;
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    messages.set(false);
    noticesOpen.set(true);
    history.set(false);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    channel.set(null);
    thread.set(null);
    peer.set(null);
    // Start from nothing: a cached list (or the conversations' array) must not show through the
    // notices.
    listCache.delete(NOTICES_KEY);
    posts.set([]);
    openList(NOTICES_KEY, () => loadNotices());
    savePlace();
    void markNoticesRead().finally(() => { void refreshNotify(); });
  }

  // One personal-section row: a line icon, a label and a 48dp touch target.
  // These stay visible when signed out; tapping offers the sign-in sheet.
  // Avatars for name-only rows (favorites, my threads): resolve each once when the
  // list changes. userAvatar dedups and caches, and untracked keeps this effect from
  // re-running when the names resolve.
  effect(() => {
    const ps = posts();
    untracked(() => {
      for (const p of ps) if (!p.uid) resolveAvatarByName(avatarName(p));
      // "My replies" rows carry no poster at all; they fall back to my own avatar.
      if (props.user()) resolveAvatarByName(props.user() ?? undefined);
    });
  });

  function requireSignIn(action: () => void) {
    if (!props.user()) {
      notify("sign-in", "登录后即可查看此项内容。");
      props.onSignInNeeded?.();
      return;
    }
    action();
  }

  // The account card carries 提醒 / 短消息 buttons, but the lists are this column's. It gets the
  // two openers directly, so a press runs the same code as the rows the column used to have.
  effect(() => {
    props.onActions?.({
      openNotices: () => requireSignIn(showNotices),
      openMessages: () => requireSignIn(showMessages),
    });
  });

  function navRow(o: { icon: IconName; label: string; active: () => boolean; onPress: () => void; badge?: () => number; railed?: () => boolean }): JSX.Element {
    const isRail = () => (o.railed ? o.railed() : railed());
    const size = isRail() ? 19 : 17;
    const count = o.badge ? o.badge() : 0;
    const badge = count > 0 ? (
      <View
        style={{
          position: "absolute", top: -5, left: size - 8,
          minWidth: 14, height: 14, paddingHorizontal: 3, borderRadius: 7,
          backgroundColor: "#e5484d", alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 9, color: "#ffffff", numberOfLines: 1 }}>
          {count > 99 ? "99+" : String(count)}
        </Text>
      </View>
    ) : null;
    const iconBlock = (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <LineIcon name={o.icon} size={size} />
        {badge}
      </View>
    );
    return (
      <View
        onPress={o.onPress}
        accessibilityLabel={count > 0 ? `${o.label}，${count} 条未读` : o.label}
        style={{
          minHeight: 36,
          justifyContent: "center",
          paddingVertical: 4,
          paddingHorizontal: isRail() ? 4 : 8,
          borderRadius: 6,
          backgroundColor: o.active() ? palette().selected : "transparent",
        }}
      >
        {isRail() ? (
          <View style={{ alignItems: "center" }}>{iconBlock}</View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {iconBlock}
            <Text style={{ fontSize: displaySettings().board, color: palette().text, flex: 1 }}>{o.label}</Text>
          </View>
        )}
      </View>
    );
  }

  // A channel row; `delay` staggers its entrance when the stack opens.
  function renderChannel(c: Channel, delay = 0, railedFn: () => boolean = railed) {
    const selected = () => searchTerm() === null && !favorites() && !mine() && !replies() && !messages() && !noticesOpen() && !history() && channel()?.id === c.id;
    return (
      <ChannelRow
        channel={c} selected={selected} railed={railedFn} delay={delay}
        onPress={() => openChannel(c)}
        sorting={() => sortingMode()}
        hiddenBoard={sortingMode() && isChannelHidden(c.id)}
        onToggleHidden={() => toggleChannelHidden(c.id)}
        onLongPress={() => { if (!sortingMode()) toggleSortingMode(); }}
        onDragStart={(y) => {
          // One row per gesture: a stray grant from a row sliding under the finger must never
          // take the drag over from the one the finger started on.
          if (dragSession) return;
          const ids = arrangedIds();
          const from = ids.indexOf(c.id);
          if (from < 0) return;
          // A board stays inside its own group: shown rows cannot be dropped among the hidden
          // ones (that would hide it by accident), and hidden rows stay in their end block.
          const g = arrangingGroups();
          const off = isChannelHidden(c.id);
          // The list itself must keep its rows: only the standalone slot label is updated.
          dragSession = {
            id: c.id, from, at: y, target: from,
            min: off ? g.shown.length : 0,
            max: off ? ids.length - 1 : g.shown.length - 1,
          };
          dragSlot.set(from);
        }}
        onDragMove={(y) => {
          const s = dragSession;
          if (!s || s.id !== c.id) return;
          // The slot the finger is over, measured from where the drag began: rows keep their
          // places while dragging, so a long drag arrives at any slot in one gesture.
          const to = Math.max(s.min, Math.min(s.max, s.from + Math.round((y - s.at) / ROW_STEP)));
          if (to !== s.target) {
            s.target = to;
            dragSlot.set(to);
          }
        }}
        onDragEnd={() => {
          const s = dragSession;
          if (!s) return;
          dragSession = null;
          dragSlot.set(null);
          // The order changes once, here: nothing under the finger shifts mid-drag.
          if (s.target !== s.from) {
            moveChannelTo(s.id, s.target);
            animateListChange();
          }
        }}
      />
    );
  }

  // The stack of icons for the channels under More. Each icon overlaps the one before it;
  // the ones that do not fit are left out, and the first of them fades.
  function stackCells() {
    const w = stackWidth();
    const step = stackStep();
    const fit = w >= STACK_ICON ? Math.floor((w - STACK_ICON) / step) + 1 : 0;
    // The first icon is on top: the cells are drawn last to first, so each one covers the next.
    return hidden()
      .slice(0, fit + 1)
      .map((c, i) => ({ c, i }))
      .reverse()
      .map(({ c, i }) => (
        <View
          style={{
            position: "absolute",
            top: 2,
            left: i * step,
            width: STACK_ICON,
            height: STACK_ICON,
            borderRadius: STACK_ICON / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette().surface,
          }}
        >
          <LineIcon name={channelIcon(c.title)} size={16} />
          {/* Later icons are paler: a surface-coloured veil over the icon, so each icon stays
              solid and the one before it still covers the next. The one that does not fit is
              veiled nearly out. */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: STACK_ICON / 2,
              backgroundColor: palette().surface,
              opacity: i < fit ? Math.min(0.7, i * 0.12) : 0.9,
            }}
          />
        </View>
      ));
  }

  // The thread the column shows: the last thread opened from a link, else the list's thread.
  const shownThread = () => (detour().length > 0 ? detour()[detour().length - 1] : thread());

  // The post-list column folds to a rail in portrait while a detail is open, for every list
  // (a channel's threads, favorites, my threads/replies, messages, history) so the detail owns
  // the width; a tap on the rail pops the list back as an overlay.
  // Portrait shows the list as a pane, never as a 56 pt rail, so this stays false.
  const threadRailed = () => false;

  /** Holds both list nodes on `y` across a rows rebuild. Called in the SAME turn as
   *  `posts.set()`, so the rebuild's first layout is already at `y` — the first page is never
   *  painted — and re-asserted for `settle` ms because the native list can finish its layout a
   *  frame or two later. A genuine scroll (an offset past the top) moves the hold with the
   *  reader instead of yanking them back, so a flick that continues through a merge is safe. */
  function holdReadingPosition(y: number, repeat = false, settle = 320): void {
    if (y <= 40) return;
    restoringOffset = true;
    holdY = y;
    holdUntil = Date.now() + settle;
    // The holds are re-asserted over the next frames; if the reader has opened another list in
    // the meantime (a board picked, favorites opened) they must not drag THAT list to this
    // offset — the title is what tells the lists apart.
    const key = headerTitle();
    const put = () => {
      if (headerTitle() !== key) return;
      columnThreadsList?.scrollToOffset({ offset: holdY, animated: false });
      paneThreadsList?.scrollToOffset({ offset: holdY, animated: false });
    };
    put();
    // One frame later, in case the native list runs its rebuild after this JS turn.
    setTimeout(put, 16);
    // The rebuild was actually seen (the guard below), so the native list settles its layout
    // over more than one frame: re-assert it. Not done for the speculative same-turn hold,
    // where extra programmatic scrolls would only cut a running fling short.
    if (repeat) {
      setTimeout(put, 60);
      setTimeout(put, 160);
    }
    setTimeout(() => {
      if (Date.now() >= holdUntil) restoringOffset = false;
    }, settle);
  }

  /** Replaces the rows while the list is still, and keeps the reader where they were: the offset
   *  is written in the same turn as the set, so the rebuild's first layout is already at the right
   *  place and the first page is never painted. */
  function applyRows(items: Post[], hasMore: boolean): void {
    const keepY = Math.max(lastReadingY, listViewport?.y ?? 0);
    more.set(hasMore);
    posts.set(items);
    appendedAt = Date.now();
    guardCooldownUntil = Math.max(guardCooldownUntil, Date.now() + 260);
    holdReadingPosition(keepY);
  }

  /** Inserts a page that was fetched while the list was still moving. False when there is none
   *  (or it belongs to a list that is no longer open). */
  function flushHeldRows(): boolean {
    const h = heldRows;
    heldRows = null;
    if (!h || h.key !== headerTitle()) return false;
    applyRows(h.items, h.more);
    return true;
  }

  // The list's scroll offset, taken from its own scroll events, kept for the pane to restore.
  // Measuring the position natively on every scroll is what made scrolling stutter.
  // Shared by both lists that render the rows (the column in the landscape row and the one in
  // the portrait pane): only one of them is on screen at a time.
  function rememberViewport(e: { offset?: { y?: number }; contentSize?: { height?: number }; size?: { height?: number } }): void {
    const y = e?.offset?.y ?? 0;
    // When the list last moved, so a page that arrives mid-fling can wait for the list to rest.
    lastScrollAt = Date.now();
    // This frame is the rebuild, not the reader: it fell from a deep offset straight to the
    // top in one step. A finger scrolling up passes through the offsets in between, so it is
    // never mistaken for this. (`anchor` is where the list should be right now.)
    const anchor = restoringOffset ? holdY : lastReadingY;
    if (y < 40 && anchor > 200 && Date.now() >= guardCooldownUntil) {
      holdReadingPosition(anchor, true);
    } else {
      if (!restoringOffset) lastReadingY = y;
      // A real scroll while a merge settles: follow it instead of fighting it.
      if (restoringOffset && y > 40) holdY = y;
    }
    // Reopening the list pane restores from this value: the bogus 0 must not become its anchor.
    listViewport = { key: headerTitle(), y: restoringOffset ? holdY : y };
    // How far the reader is from the end. This is a pure JS read of the scroll event: asking
    // the native list to measure its position on every scroll is what made scrolling stutter.
    listRest = (e?.contentSize?.height ?? 0) - ((e?.offset?.y ?? 0) + (e?.size?.height ?? 0));
  }

  // The next page is asked for once the finger stops, while ~25 rows are still below the
  // viewport: by the time the reader reaches the end, the rows are already there. Fetching
  // and inserting mid-scroll was what made the list stutter; `loadingMore` makes this early
  // request and the native list's onLoadMore mutually exclusive.
  function onListScrollEnd(): void {
    // The finger stopped: this is where a page fetched mid-scroll is allowed to enter the list.
    if (flushHeldRows()) return;
    if (listRest >= PREFETCH_AHEAD_PT) return;
    const now = Date.now();
    if (now - listPrefetchAt < 400) return;
    listPrefetchAt = now;
    void loadMore(true);
  }

  // The collapsed post-list rail (portrait + thread open): a tap opens the list as a popover.
  function CollapsedThreadRail(): JSX.Element {
    return (
      <View
        ref={(n: ViewRef | null) => threadListAnchor.set(n)}
        onPress={() => threadListPopoverOpen.set(true)}
        accessibilityLabel="帖子列表"
        style={{ flex: 1, alignItems: "center", gap: 6, paddingTop: 12 }}
      >
        <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: palette().surface }}>
          <LineIcon name="list" size={18} />
        </View>
        <Text style={{ fontSize: 10, color: palette().muted }}>帖子</Text>
      </View>
    );
  }

  // The list shown inside the portrait popover (and reused without the rail chrome).
  function ThreadListPopoverContent(): JSX.Element {
    return (
      <View style={{ flex: 1, alignSelf: "stretch" }}>
        <View style={{ padding: 10, flexDirection: "row", alignItems: "center", gap: 6, borderBottomWidth: 1, borderColor: palette().border }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: palette().text, flex: 1 }}>{headerTitle()}</Text>
        </View>
        {listLoading() ? (
          <View style={{ padding: 16, alignItems: "center" }}><LoadingBar /></View>
        ) : nothingPicked() ? (
          <Placeholder title="选择一个版块以查看帖子。" />
        ) : (
          <List
            style={{ flex: 1 }}
            contentStyle={{ padding: 6, gap: 3 }}
            each={listRows()}
            ref={(n: ListRef | null) => { paneThreadsList = n ?? undefined; }}
            onScroll={rememberViewport}
            onScrollEnd={onListScrollEnd}
            estimatedItemSize={64}
            onLoadMore={() => loadMore()}
            refreshing={pullRefreshing()}
            onRefresh={onPullRefresh}
            footer={() => <View style={{ height: 44, alignItems: "center", justifyContent: "center" }}>{loadingMoreShown() ? <LoadingBar /> : null}</View>}
          >
            {(row) => (
              row().kind === "header" ? (
                <Text style={{ fontSize: 11, color: palette().muted, paddingTop: 10, paddingBottom: 2, paddingHorizontal: 8 }}>{titleOf(row())}</Text>
              ) : (
                <ThreadRow
                  item={() => postOf(row())}
                  selected={() => (noticesOpen() ? thread() : messages() ? peer() : thread())?.id === postOf(row()).id}
                  avatar={() => avatarFor(postOf(row())) ?? (replies() ? (avatarOfName(props.user() ?? undefined)) : undefined)}
                  sortByDate={() => !!channel() && sortOrder() === "dateline"}
                  favorite={() => !favorites() && !!props.user() && isFavorite(postOf(row()).id)}
                  viewed={() => isViewed(postOf(row()).id)}
                  onPress={() => { openThread(postOf(row())); threadListPopoverOpen.set(false); }}
                  onLongPress={() => pendingHide.set(postOf(row()))}
                />
              )
            )}
          </List>
        )}
      </View>
    );
  }

  // The account row under the boards; `ChannelColumn` has its own `props`, so it reads this one.
  const forumFooter = props.footer;

  // Column 1 as an element: landscape keeps it in the row, portrait shows it in the drawer.
  function ChannelColumn(props: { full?: boolean; onCollapse?: () => void } = {}): JSX.Element {
    // The drawer opens with the boards' names (the narrow window would otherwise force the rail);
    // folding it by hand still turns it into the rail of icons and counts.
    const isRail = () => (props.full ? channelsCollapsed() : railed());
    return (
        <View style={{ width: isRail() ? RAIL_WIDTH : FULL_WIDTH, borderRightWidth: 1, borderColor: palette().border }}>
          {/* Board title + refresh / arrange / collapse buttons, back at the top of the column. */}
          <View
            style={{
              // Under the title bar the header sits flush against it; with no bar, it keeps the top inset.
              paddingTop: titleBarShown() ? 0 : 12,
              paddingHorizontal: isRail() ? 0 : 12,
              paddingBottom: 4,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: isRail() ? "center" : "space-between",
            }}
          >
            {isRail() ? null : <Text style={{ fontSize: 12, fontWeight: 600, color: palette().muted }}>版块</Text>}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              {isRail() ? null : (
                <View
                  onPress={channelsLoading() ? undefined : () => reloadChannels()}
                  accessibilityLabel="刷新版块"
                  tooltip={hint("刷新版块")}
                  style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
                >
                  <RefreshIcon size={14} enabled={!channelsLoading()} spinning={channelsLoading()} />
                </View>
              )}
              {isRail() ? null : (
                <View
                  onPress={toggleSortingMode}
                  accessibilityLabel={sortingMode() ? "完成排序" : "调整版块顺序"}
                  tooltip={hint(sortingMode() ? "完成排序" : "调整版块顺序")}
                  style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center",
                           borderRadius: 6, backgroundColor: sortingMode() ? palette().selected : "transparent" }}
                >
                  <LineIcon name={sortingMode() ? "check" : "sort"} size={16} />
                </View>
              )}
              {props.full || wide() ? (
                <View
                  onPress={toggleChannelsCollapsed}
                  accessibilityLabel={channelsCollapsed() ? "展开版块" : "收起版块"}
                  tooltip={hint(channelsCollapsed() ? "展开版块" : "收起版块")}
                  style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
                >
                  <SidebarIcon size={16} />
                </View>
              ) : null}
            </View>
          </View>
          {/* Arranging keeps extra room under the last row, so a hidden board sunk to the end
              can be scrolled clear of the personal entries' bar and its eye still tapped. */}
          <Scroll
            ref={(n: any) => { boardScroll = n; }}
            onScroll={(e: any) => { boardOffsetY = e?.nativeEvent?.contentOffset?.y ?? 0; }}
            style={{ flex: 1 }}
            contentStyle={{ paddingHorizontal: isRail() ? 4 : 8, paddingBottom: sortingMode() ? 56 : 6, gap: 2, flexGrow: 1 }}
          >
            {/* Sink the board list toward the bottom of the column, near the personal entries,
                so it sits within reach instead of hugging the title bar — in both the expanded
                list and the collapsed rail of icons. The spacer gives back all its height once
                the list fills the column (arranging shows every board), so nothing is pushed off
                and the drag's landing band stays aligned. */}
            {sortingMode() ? null : <View style={{ flex: 1 }} />}
            {/* The slot label is the only thing a drag redraws: it is not part of the row
                list, so the row under the finger keeps its responder for the whole gesture.
                The arrows scroll the column (a drag on a row would move it instead), which is
                how the hidden block at the end is reached. */}
            {sortingMode() && !isRail() ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 1 }}>
                <Text style={{ fontSize: 11, color: palette().link, flex: 1, numberOfLines: 1 }}>
                  {dragSlot() === null ? "拖动" : `第 ${(dragSlot() ?? 0) + 1} 位`}
                </Text>
                {hiddenChannelIds().length > 0 ? (
                  <View
                    onPress={showAllHiddenChannels}
                    accessibilityLabel="显示全部板块"
                    style={{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: palette().surface }}
                  >
                    <Text style={{ fontSize: 10, color: palette().link }}>隐藏 {hiddenChannelIds().length}</Text>
                  </View>
                ) : null}
                <View
                  onPress={() => scrollBoards(-240)}
                  accessibilityLabel="向上滚动板块"
                  style={{ width: 24, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: palette().surface }}
                >
                  <LineIcon name="chevronUp" size={13} />
                </View>
                <View
                  onPress={() => scrollBoards(240)}
                  accessibilityLabel="向下滚动板块"
                  style={{ width: 24, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: palette().surface }}
                >
                  <LineIcon name="chevronDown" size={13} />
                </View>
              </View>
            ) : null}
            {/* The landing slot: a tinted band with a top rule, laid over the list instead of
                inside a row. Rows are never touched while dragging, so the row under the finger
                keeps its responder and one gesture can still cross any number of slots. */}
            <View style={{ gap: 2 }}>
              {sortingMode() && dragSlot() !== null ? (
                // Drawn before the rows, so it sits under them: the tint can carry the
                // theme's selection colour at full strength without dimming the titles.
                <View
                  style={{
                    position: "absolute", left: 2, right: 2,
                    top: (dragSlot() ?? 0) * ROW_STEP - 1,
                    height: ROW_STEP, borderRadius: 6,
                    backgroundColor: palette().selected,
                  }}
                />
              ) : null}
              {listed().map((c) => renderChannel(c, 0, isRail))}
              {sortingMode() && dragSlot() !== null ? (
                // Above the rows: the rule is drawn in the theme's accent, so it stays crisp.
                <View
                  style={{
                    position: "absolute", left: 6, right: 6,
                    top: (dragSlot() ?? 0) * ROW_STEP + ROW_STEP - 3,
                    height: 2, borderRadius: 1,
                    backgroundColor: palette().link,
                  }}
                />
              ) : null}
            </View>
            {/* Channels without new posts: a stack of their icons; opening it lists them in place. */}
            {hidden().length > 0 ? (
              <View>
                {moreOpen() ? (
                  // The rows are the overlay's anchor: a press on them is not outside it, so it
                  // reaches the row's own press and picks the channel.
                  <View ref={(n) => listAnchor.set(n)}>{hidden().map((c, i) => renderChannel(c, i * 40, isRail))}</View>
                ) : (
                  <View
                    onPress={toggleMore}
                    accessibilityLabel="更多版块"
                    style={{ paddingVertical: 4, paddingHorizontal: isRail() ? 4 : 8, borderRadius: 6 }}
                  >
                    <View onLayout={({ bounds }) => stackWidth.set(bounds.size.width)} style={{ height: 30, overflow: "hidden" }}>
                      {stackCells()}
                    </View>
                  </View>
                )}
              </View>
            ) : null}
          </Scroll>
          <View style={{
            borderTopWidth: 1, borderColor: palette().border,
            paddingHorizontal: isRail() ? 4 : 8, paddingTop: 4, paddingBottom: 4,
            flexShrink: 0,
          }}>
            {/* Personal section: always visible on a tablet. Signed out, a tap
                opens the sign-in sheet instead of hiding the entry entirely. */}
            {/* The four personal entries carry the forum's unread counts: private messages on
                "私信", and notice.php's notices (system / friend / post messages) on the three
                thread lists. A count of 0 draws no badge. */}
            {/* 提醒 and 短消息 moved into the account card's own row: the column keeps the four
                lists that belong to the boards, and the avatar's red dot speaks for 提醒. */}
            {navRow({ railed: isRail, icon: "star", label: "收藏", active: () => favorites() && searchTerm() === null, onPress: () => requireSignIn(showFavorites) })}
            {navRow({ railed: isRail, icon: "doc", label: "我的主题", active: () => mine() && searchTerm() === null, onPress: () => requireSignIn(showMine) })}
            {navRow({ railed: isRail, icon: "bubble", label: "我的回复", active: () => replies() && searchTerm() === null, onPress: () => requireSignIn(showReplies) })}
            {navRow({ railed: isRail, icon: "clock", label: "历史", active: () => history() && searchTerm() === null, onPress: () => requireSignIn(showHistory) })}
          </View>
          {forumFooter ? forumFooter(isRail()) : null}
        </View>
    );
  }

  // The signed-in name, read by ThreadsColumn through the forum's props (its own are the pane's).
  const forumUser = props.user;

  // Column 2: the thread list. Landscape keeps it in the row; portrait shows it in a pane
  // over the body, so it is always the full 288 pt list rather than a rail.
  function ThreadsColumn(props: { onBack?: () => void; width?: number; onOpenBoards?: () => void } = {}): JSX.Element {
    let threadsList: ListRef | undefined;
    // Reopening the list pane over a thread puts the list back where it was: the same rows in the
    // same places. Without a saved position (a first open, or another list), the thread's row is
    // brought to the viewport's top instead.
    effect(() => {
      const pane = portraitPane();
      if (pane !== "list") return;
      untracked(() => {
        const saved = listViewport && listViewport.key === headerTitle() ? listViewport : null;
        const tid = thread()?.id;
        const index = tid ? listRows().findIndex((r) => r.kind === "post" && r.post.id === tid) : -1;
        setTimeout(() => {
          if (saved) threadsList?.scrollToOffset({ offset: saved.y, animated: false });
          else if (index >= 0) threadsList?.scrollToIndex({ index, animated: false });
        }, 80);
      });
    });
    return (
              <View style={{ width: props.width ?? 288, borderRightWidth: 1, borderColor: palette().border, overflow: "hidden", ...listSlide.style }}>
          {threadRailed() ? (
            <CollapsedThreadRail />
          ) : (
          <>
          <View style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
            {/* Portrait: a way back up the ladder to the boards, beside the list's name. */}
            {props.onOpenBoards ? (
              <View
                onPress={props.onOpenBoards}
                accessibilityLabel="展开板块栏"
                tooltip={hint("展开板块栏")}
                style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
              >
                <Text style={{ fontSize: 20, color: palette().muted }}>»</Text>
              </View>
            ) : null}
            {props.onBack ? (
              <View
                onPress={props.onBack}
                accessibilityLabel="返回板块栏"
                tooltip={hint("返回板块栏")}
                style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
              >
                <Text style={{ fontSize: 20, color: palette().muted }}>‹</Text>
              </View>
            ) : null}
            {/* The board's name stays put even while search is open: it keeps the same flex:1
                weight as the old spacer did, so the field and the compose/refresh icons still
                cluster at the right edge, but the user never loses the title they are reading.
                A small red dot rides along while notices or private messages wait. */}
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
              <Text style={{ fontSize: 15, color: palette().text, numberOfLines: 1, flexShrink: 1 }}>{headerTitle()}</Text>
              {noticeUnread() + pmUnread() > 0 ? (
                <View
                  accessibilityLabel="有未读提醒或短消息"
                  style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#e5484d" }}
                />
              ) : null}
            </View>
            {titleBarShown() ? null : <SearchControl {...searchProps} />}
            {canCompose() ? (
              <View onPress={openComposer} accessibilityLabel="发新帖" tooltip={hint("写新帖子 (c)")} style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                {/* A Canvas icon, not the SVG one: an `<Image>` child swallowed the press,
                    so the button next to search and refresh did nothing. */}
                <LineIcon name="pencil" size={16} />
              </View>
            ) : null}
            <View
              onPress={refreshing() || (!favorites() && !mine() && !replies() && !messages() && !noticesOpen() && !history() && !channel()) ? undefined : refreshThreads}
              accessibilityLabel="刷新帖子"
              tooltip={hint("刷新帖子")}
              style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
            >
              <RefreshIcon size={14} enabled={!refreshing() && (favorites() || mine() || replies() || messages() || noticesOpen() || history() || !!channel())} spinning={refreshing()} />
            </View>
          </View>
          {/* Only a board's threads carry an order setting, and each board remembers its own.
              Favorites, my threads/replies, messages, history and search results have none. */}
          {channel() && searchTerm() === null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingBottom: 6 }}>
              <View
                onPress={toggleFilters}
                accessibilityLabel={filtersOpen() ? "收起筛选" : "展开筛选"}
                style={{ width: 28, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: palette().surface }}
              >
                <LineIcon name={filtersOpen() ? "chevronUp" : "list"} size={14} />
              </View>
              {filtersOpen() ? (
                <>
                  <View onPress={() => { const c = channel(); if (c && sortOrder() !== "dateline") { setSortFor(c.id, "dateline"); refreshThreads(); } }}
                    accessibilityLabel="按发帖时间排序"
                    style={{ height: 26, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 5, backgroundColor: sortOrder() === "dateline" ? palette().selected : palette().surface }}>
                    <Text style={{ fontSize: 11, color: palette().text }}>发帖时间</Text>
                  </View>
                  <View onPress={() => { const c = channel(); if (c && sortOrder() !== "lastpost") { setSortFor(c.id, "lastpost"); refreshThreads(); } }}
                    accessibilityLabel="按回帖时间排序"
                    style={{ height: 26, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 5, backgroundColor: sortOrder() === "lastpost" ? palette().selected : palette().surface }}>
                    <Text style={{ fontSize: 11, color: palette().text }}>回帖时间</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Text style={{ fontSize: 10, color: palette().muted }}>长按帖子可隐藏</Text>
                </>
              ) : (
                <Text style={{ fontSize: 11, color: palette().muted, flex: 1 }}>
                  {sortOrder() === "dateline" ? "按发帖时间" : "按回帖时间"}
                </Text>
              )}
            </View>
          ) : null}
          {searchTerm() !== null && !listLoading() && posts().length === 0 ? (
            <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>没有找到包含 “{searchTerm()}” 的帖子。</Text>
          ) : null}
          {history() && searchTerm() === null && historyRows().length === 0 ? (
            <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>你打开过的帖子会显示在这里。</Text>
          ) : null}
          {listLoading() ? (
            <View style={{ flex: 1, alignItems: "center", paddingTop: 28 }}>
              <LoadingBar />
            </View>
          ) : nothingPicked() ? (
            <Placeholder
              title="选择一个版块以查看帖子。"
              detail={forumUser() ? undefined : "登录后即可查看收藏、主题、回复和私信。"}
            />
          ) : posts().length === 0 ? (
            // Picked and loaded, but nothing to show: a blank virtualized list reads as a bug.
            // The header's refresh and search stay available above this placeholder.
            <Placeholder title={emptyMessage()} />
          ) : (
          // A virtualized list: only the rows near the viewport exist, and they are reused as
          // the user scrolls. Its end (loading, failure, or "No more threads.") is the footer.
          <List
            style={{ flex: 1 }}
            contentStyle={{ padding: 6, gap: 3 }}
            each={listRows()}
            ref={(n: ListRef | null) => { threadsList = n ?? undefined; columnThreadsList = n ?? undefined; }}
            onScroll={rememberViewport}
            onScrollEnd={onListScrollEnd}
            estimatedItemSize={64}
            onLoadMore={() => loadMore()}
            refreshing={pullRefreshing()}
            onRefresh={onPullRefresh}
            footer={() => (
              // A fixed height: a footer that grows and shrinks by ~40 pt re-lays the list out
              // at the exact moment a page is merged, which adds to the rebuild churn.
              <View style={{ height: 44, alignItems: "center", justifyContent: "center" }}>
                {loadingMoreShown() ? <LoadingBar /> : null}
                {!more() && posts().length > 0 && !loadingMoreShown() ? (
                  <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center" }}>没有更多帖子了。</Text>
                ) : null}
              </View>
            )}
          >
            {(row) => (
              // A section title of the history, or a thread. The row's thread is read through `row()`, as ThreadRow reads its item.
              row().kind === "header" ? (
                <Text style={{ fontSize: 11, color: palette().muted, paddingTop: 10, paddingBottom: 2, paddingHorizontal: 8 }}>{titleOf(row())}</Text>
              ) : (
                <ThreadRow
                  item={() => postOf(row())}
                  selected={() => (noticesOpen() ? thread() : messages() ? peer() : thread())?.id === postOf(row()).id}
                  avatar={() => avatarFor(postOf(row())) ?? (replies() ? (avatarOfName(forumUser() ?? undefined)) : undefined)}
                  sortByDate={() => !!channel() && sortOrder() === "dateline"}
                  // The favorites list is all favorites, so its rows carry no star.
                  favorite={() => !favorites() && !!forumUser() && isFavorite(postOf(row()).id)}
                  viewed={() => isViewed(postOf(row()).id)}
                  onPress={() => openThread(postOf(row()))}
                  onLongPress={() => pendingHide.set(postOf(row()))}
                />
              )
            )}
          </List>
          )}
          </>)}
        </View>
    );
  }

  return (
    <View style={{ flex: 1, alignSelf: "stretch" }}>
      {titleBarShown() ? <TitleBar wide={wide} search={searchProps} /> : null}
      <View style={{ flex: 1, alignSelf: "stretch", flexDirection: "row" }}>
      {/* Any press while the channels are open collapses them; presses still reach what is under them. */}
      {moreOpen() && listAnchor() ? (
        <Overlay anchor={listAnchor()} onPressOutside={collapseMore}>
          <View style={{ width: 0, height: 0 }} />
        </Overlay>
      ) : null}
      {wantsPanes() ? null : <ChannelColumn />}
      {wantsPanes() ? null : <ThreadsColumn />}
      {/* Column 3: the open thread. Under the title bar it extends up into the bar (a negative top margin),
          so the thread's title sits in the bar's caption area. */}
      <View style={{ flex: 1, alignSelf: "stretch", marginTop: titleBarShown() ? -titleBar().height : 0 }}>
        {composing() && canCompose() ? (
          <NewThread
            fid={channel()!.id}
            channel={channel()!.title}
            onPosted={threadPosted}
            // Cancelled in portrait: back to the list it was started from, not the empty body.
            onClose={() => { composing.set(false); if (wantsPanes()) portraitPane.set("list"); }}
          />
        ) : messages() && !noticesOpen() && peer() && detour().length === 0 ? (
          <Conversation
            peer={() => peer()!}
            onOpenThread={openLinkedThread}
            onSwipeBack={() => { if (wantsPanes()) showPane("list"); else peer.set(null); }}
            onOpenSidebars={wantsPanes() ? () => showPane("boards") : undefined}
          />
        ) : shownThread() ? (
          <Thread
            // A thread from a link has no forum of its own here: its first page names it.
            fid={detour().length > 0 ? "" : (shownThread()!.fid ?? channel()?.id ?? "")}
            post={shownThread()!}
            signedIn={!!props.user()}
            onSignInNeeded={props.onSignInNeeded}
            focusPid={noticesOpen() && noticeFocusPid()
              ? noticeFocusPid()!
              : detour().length > 0 ? detour()[detour().length - 1].focus : undefined}
            onOpenThread={openLinkedThread}
            onOpenSidebars={wantsPanes() ? () => showPane("boards") : undefined}
            onBack={detour().length > 0 ? backFromLink : leaveThread}
            // A right swipe in the thread body goes back too (in portrait it returns to the list;
            // a thread opened from a link returns to the one before it).
            onSwipeBack={detour().length > 0 ? backFromLink : leaveThread}
            shortcutsOpen={() => shortcutsOpen()}
            onUnfavorited={() => {
              // In the favorites list, the removed thread leaves the list.
              if (favorites() && detour().length === 0) posts.set(posts().filter((p) => p.id !== thread()?.id));
            }}
          />
        ) : (
          <View
            onPress={wantsPanes() ? () => showPane("boards") : undefined}
            accessibilityLabel={wantsPanes() ? "打开版块与帖子列表" : undefined}
            style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}
          >
            <PixelDino size={120} />
            <Text style={{ fontSize: 13, color: palette().muted }}>选择一个帖子</Text>
            {wantsPanes() ? (
              <>
                <View
                  onPress={() => showPane("boards")}
                  accessibilityLabel="打开版块与帖子列表"
                  style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "transparent" }}
                >
                  <Text style={{ fontSize: 13, color: palette().link }}>浏览版块与帖子</Text>
                </View>
              </>
            ) : null}
          </View>
        )}
      </View>
      {/* Portrait's 3-2-1 ladder over the body: the list pane (2) or the boards pane (1). A right
          swipe steps back one rung (list → boards → away); the dimmed body does the same. Rendered
          from `paneShown`, which stays until the exit motion finishes (see the effect above). */}
      {wantsPanes() && paneShown() !== null ? (
        <>
          <View
            onPress={() => { paneExitRight = false; portraitPane.set(null); }}
            accessibilityLabel="关闭浮层，回到正文"
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.35)", zIndex: 25, opacity: paneFade }}
          />
          <View
            pan={{ x: panePan }}
            panActivation={{ activeOffsetX: 18, failOffsetY: 10 }}
            onPanEnd={(e: any) => {
              // A cancelled swipe springs back to rest (M3 predictive back), rather than jumping.
              const settle = () => { void settleBack(panePan); };
              // The swipe that opened this pane is still travelling: only a new one steps back.
              if (Date.now() - paneOpenedAt < 350) { settle(); return; }
              const dx = e?.translation?.x ?? 0;
              const vx = e?.velocity?.x ?? 0;
              // A right swipe steps back one rung of the ladder rather than tearing the pane
              // down: the full-screen list goes back to the boards+list home; the boards home
              // then closes to the body — leaving to the RIGHT, the way the finger moved. This is
              // the same ladder the Back control uses, so a gesture and a tap never diverge.
              const right = !e?.cancelled && (dx > 60 || vx > 700);
              const left = !e?.cancelled && (dx < -60 || vx < -700);
              if (right) {
                // The boards pane is the ROOT of the portrait ladder: a right swipe here must
                // never close it back onto the body. The thread stays open underneath (leaving it
                // only shows a pane), so closing would reveal the thread again and launch effect
                // would reopen the boards — 正文→列表→双栏→正文, an endless loop. With the rail
                // folded, open the boards; once open the home is already fully shown, so bounce.
                if (paneShown() === "boards") {
                  if (channelsCollapsed()) toggleChannelsCollapsed();
                  settle();
                  return;
                }
                // Only the full-screen list steps back to the boards home (an in-place swap).
                // Closing the last pane is left to the dim, the Back key and the list's back button.
                paneBack();
              } else if (left) {
                // Left swipes never close the pane; they just put it back.
                void settle(); return;
              }
              settle();
            }}
            style={{
              position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 26,
              width: windowSize().width,
              flexDirection: "row",
              backgroundColor: palette().bg,
              borderRightWidth: 1, borderColor: palette().border,
              opacity: paneFade,
            }}
          >
            {/* Portrait: the boards come with the list beside them, filling the window; the body
                stays behind them untouched. The list alone takes the window once a board opens. */}
            {paneShown() === "list" ? (
              <ThreadsColumn onBack={paneBack} width={windowSize().width} />
            ) : (
              <>
                <ChannelColumn full />
                <ThreadsColumn width={windowSize().width - (channelsCollapsed() ? RAIL_WIDTH : FULL_WIDTH)} />
              </>
            )}
          </View>
        </>
      ) : null}
      </View>
      {shortcutsOpen() ? <ShortcutsHelp keys={shortcutRows()} onClose={() => shortcutsOpen.set(false)} /> : null}
      {threadListPopoverOpen() && threadListAnchor() ? (
        <Overlay
          anchor={threadListAnchor()!}
          placement="right"
          align="start"
          offset={4}
          onPressOutside={() => threadListPopoverOpen.set(false)}
        >
          <View
            style={{
              width: 360,
              // Reach nearly the full portrait height so the overlay lists many more topics than before.
              height: Math.max(360, windowSize().height - 16),
              backgroundColor: palette().surface,
              borderWidth: 1,
              borderColor: palette().border,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <ThreadListPopoverContent />
          </View>
        </Overlay>
      ) : null}
      {pendingHide() ? (
        // The same centered card style as the thread's delete dialog.
        <Dialog
          animation="fade"
          onCancel={() => pendingHide.set(null)}
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
          backdropStyle={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.3)" }}
        >
          <View style={{ width: 320, padding: 20, gap: 12, borderRadius: 12, backgroundColor: palette().bg }}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>隐藏该贴？</Text>
            <Text style={{ fontSize: 13, color: palette().muted, numberOfLines: 2 }}>{pendingHide()!.title}</Text>
            <Text style={{ fontSize: 12, color: palette().muted }}>隐藏后不再显示在此帖子列表中。</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <View
                onPress={() => pendingHide.set(null)}
                accessibilityLabel="取消"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: palette().border }}
              >
                <Text style={{ fontSize: 13, color: palette().text }}>取消</Text>
              </View>
              <View
                onPress={() => { const p = pendingHide(); if (p) hideThread(p.id); pendingHide.set(null); }}
                accessibilityLabel="隐藏该贴"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, backgroundColor: palette().danger }}
              >
                <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>隐藏该贴</Text>
              </View>
            </View>
          </View>
        </Dialog>
      ) : null}
    </View>
  );
}
