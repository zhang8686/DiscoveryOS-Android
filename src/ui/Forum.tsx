// The signed-in screens in three columns, as the Swift app's split view:
// channels | a channel's threads (or favorites) | the open thread.
// Components run once, so the views switch inside JSX, not by early return.
import { BackHandler } from "nsh/mobile";
import { cleanup, computed, createAnimatedValue, createMotion, effect, LayoutAnimation, Overlay, reduceMotion, type ViewRef, type ListRef, List, Scroll, signal, Storage, Text, untracked, View, windowSize, type JSX } from "nsh";
import { Dialog } from "nsh/base";
import { hideThread, isHidden } from "./hiddenThreads";
import { onEscape } from "./escape";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { shortcutRows, useCommand } from "./commands";
import { DEMO, clearReplyPageCache, loadBookmarks, loadChannels, loadMyReplies, loadMyThreads, loadPmUsers, loadPosts, loadReplyPage, searchThreads } from "../discuz/forum";
import { avatarUrlForUid } from "../discuz/avatarUrl";
import { userAvatar } from "../discuz/avatarCache";
import { loadNoticeCounts } from "../discuz/notifications";
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

// The name whose avatar a row shows: a channel's thread author. Favorites rows
// carry no author, so they show the last replier's avatar instead.
function avatarName(p: Post): string | undefined {
  return p.author ?? p.lastReplyBy;
}

// Rows that carry only a poster's name (favorites, my threads) cannot build an
// avatar URL directly — that needs a numeric uid. Resolve it through the user's
// profile once (cached a day in avatarCache), keep it here so the synchronous row
// prop can read it, and re-render when it arrives. "" remembers a miss.
const avatarByName = signal<Record<string, string>>({});
const avatarPending = new Set<string>();
const avatarQueue: string[] = [];
let avatarActive = 0;
// Cap concurrent profile lookups so a list of many names cannot crowd out the
// thread/list requests the user is waiting on.
const AVATAR_CONCURRENCY = 3;
function resolveAvatarByName(name: string | undefined): void {
  if (!name || avatarPending.has(name) || avatarByName()[name] !== undefined) return;
  avatarPending.add(name);
  avatarQueue.push(name);
  pumpAvatars();
}
function pumpAvatars(): void {
  while (avatarActive < AVATAR_CONCURRENCY && avatarQueue.length > 0) {
    const name = avatarQueue.shift()!;
    avatarActive++;
    userAvatar(name)
      .then((url) => { avatarByName.set({ ...avatarByName(), [name]: url ?? "" }); })
      .catch(() => { avatarByName.set({ ...avatarByName(), [name]: "" }); })
      .finally(() => { avatarPending.delete(name); avatarActive--; pumpAvatars(); });
  }
}

/** A row's avatar URL: by uid when known, else by the poster's name once resolved. */
function avatarFor(p: Post): string | undefined {
  return avatarUrlForUid(p.uid) ?? (avatarByName()[avatarName(p) ?? ""] || undefined);
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
// The list's title (its cache key) and when the next page was last asked for: set while rendering,
// read from the scroll handler, so a scroll event does not touch signals.
let listTitleKey = "";
let listPrefetchAt = 0;
// How far the list is from its end, as of the last scroll event: read when scrolling stops.
let listRest = Number.POSITIVE_INFINITY;

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
  dragging: () => boolean;
  onLongPress: () => void;
  onDragStart: (y: number) => void;
  onDragMove: (y: number) => void;
  onDragEnd: () => void;
  onNudge: (delta: number) => void;
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
      onLongPress={props.onLongPress}
      onStartShouldSetResponder={sorting() ? () => false : undefined}
      onMoveShouldSetResponder={sorting() ? (_e: any, g: any) => { props.onDragStart(g.y0); return true; } : undefined}
      onResponderGrant={sorting() ? () => true : undefined}
      onResponderMove={sorting() ? (e: any) => props.onDragMove(e.pageY) : undefined}
      onResponderRelease={sorting() ? () => props.onDragEnd() : undefined}
      onResponderTerminate={sorting() ? () => props.onDragEnd() : undefined}
      accessibilityLabel={c.title}
      style={{
        minHeight: 36, justifyContent: "center",
        paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6,
        alignItems: props.railed() ? "center" : undefined,
        backgroundColor: props.dragging() || props.selected() ? palette().selected : "transparent",
        opacity: props.dragging() ? 0.85 : 1,
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
          <Text style={{ fontSize: displaySettings().board, color: palette().text, flex: 1, numberOfLines: 1 }}>{cleanChannelTitle(c.title) || `板块 ${c.id}`}</Text>
          {sorting() ? (
            <>
              <View onPress={() => props.onNudge(-1)} accessibilityLabel="上移一个位置"
                style={{ width: 20, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: palette().surface }}>
                <Text style={{ fontSize: 13, color: palette().muted }}>↑</Text>
              </View>
              <View onPress={() => props.onNudge(1)} accessibilityLabel="下移一个位置"
                style={{ width: 20, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: palette().surface }}>
                <Text style={{ fontSize: 13, color: palette().muted }}>↓</Text>
              </View>
            </>
          ) : (c.newPosts > 0 ? <Text style={{ fontSize: 12, color: palette().muted }}>{compactCount(c.newPosts)}</Text> : null)}
        </View>
      )}
    </View>
  );
}

// `user` is the signed-in name, or null. The forum lists channels and threads for
// everyone; signing in or out reloads the channel list, since an account sees more.
export function Forum(props: { footer?: (compact: boolean) => JSX.Element; user: () => string | null; onSignInNeeded?: () => void }) {
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
  // Keep the list short by default: show the first four boards (the user's own
  // order, so the ones they drag up are the ones they see). The rest tuck under
  // the "More" stack and one clearly labelled row expands them all.
  const showAllChannels = signal(false);
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
  Storage.getItem("visual:channels-all").then((v) => {
    if (v === "0" || v === "1") showAllChannels.set(v === "1");
  }).catch(() => undefined);
  function toggleShowAllChannels() {
    const next = !showAllChannels();
    showAllChannels.set(next);
    Storage.setItem("visual:channels-all", next ? "1" : "0").catch(() => undefined);
    if (!next) moreOpen.set(false);
    animateListChange();
  }
  const pinned = signal<string | null>(null);

  // Unread badges for the personal section: private messages, and replies to my
  // own threads ("帖子消息"). Read from the forum's header while signed in;
  // 0 hides the badge. Polled, not pushed: the forum has no push channel.
  const pmUnread = signal(0);
  const noticeUnread = signal(0);
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
  const draggingId = signal<string | null>(null);
  let dragStartY = 0;
  let dragStartIndex = 0;
  const ROW_STEP = 38;

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
    const ids = currentOrder();
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    persistOrder(ids);
  }
  function nudgeChannel(id: string, delta: number) {
    const ids = currentOrder();
    moveChannelTo(id, ids.indexOf(id) + delta);
  }
  function toggleSortingMode() {
    const next = !sortingMode();
    sortingMode.set(next);
    if (next) notify("arrange", "按住版块上下拖动即可调整顺序，点「完成」保存。");
  }
  // The width of the stack of icons, which decides how many fit.
  const stackWidth = signal(0);
  // The rows of the open stack, as the overlay that collapses it is anchored to.
  const listAnchor = signal<ViewRef | null>(null);
  const STACK_ICON = 26;
  // The distance between icons: wider in the full column, kept in the rail where space is short.
  const stackStep = () => (railed() ? 12 : 18);
  // Folded: the first four boards, plus the board the user last opened from More
  // (it stays pinned to the list until another board opens). Expanded: all of them.
  const FOLDED_COUNT = 4;
  const listed = () => {
    const all = orderedChannels();
    if (showAllChannels()) return all;
    const top = all.slice(0, FOLDED_COUNT);
    const pin = pinned();
    if (pin && !top.some((c) => c.id === pin)) {
      const picked = all.find((c) => c.id === pin);
      if (picked) return [...top, picked];
    }
    return top;
  };
  const hidden = () => {
    const all = orderedChannels();
    if (showAllChannels()) return [];
    const shown = new Set(listed().map((c) => c.id));
    return all.filter((c) => !shown.has(c.id));
  };

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
    if (!saved || channel() || favorites() || mine() || replies() || messages() || history()) return;
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
  // The pane follows a right swipe back up the ladder.
  const panePan = createAnimatedValue(0);
  // The pane fades in instead of appearing in one frame; an opacity-only motion keeps the lists
  // from re-laying out as it opens.
  // The pane is drawn at once: the fade read as the board column flashing in on a phone.
  const drawerMotion = createMotion();
  effect(() => {
    if (!wantsPanes()) { portraitPane.set(null); return; }
    // Never the bare placeholder full screen: with no thread open, the board column shows.
    if (!thread() && portraitPane() === null) {
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
    saveLastPlace({ channel: favorites() || mine() || replies() || messages() || history() ? null : channel(), thread: thread() });
  }

  function restorePlace(list: Channel[]) {
    if (placeRestored) return;
    placeRestored = true;
    // Portrait opens on the board column (the first rung), not on the thread read last time;
    // landscape keeps restoring the place, since all three columns are on screen there.
    if (panesNow) return;
    const nothingOpen = () => !favorites() && !mine() && !replies() && !messages() && !history() && !channel() && !searchTerm() && !composing();
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
  let listRequest = 0;

  // Loads page `n` of a list (a channel's threads or the favorites) and merges it in;
  // page 1 replaces the list and is cached under `key`.
  function fetchList(load: (n: number) => Promise<Post[]>, n: number, key: string) {
    const request = n === 1 ? ++listRequest : listRequest;
    if (n === 1) refreshing.set(true);
    load(n)
      .then((list) => {
        if (request !== listRequest) return;
        moreFailures = 0;
        moreError.set(null);
        const merged = n === 1 ? { items: list, more: list.length > 0 } : mergePage(posts(), list);
        more.set(merged.more);
        posts.set(merged.items);
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
        loadingMore = false;
        loadingMoreShown.set(false);
        if (request === listRequest) listLoading.set(false);
        if (n === 1 && request === listRequest) refreshing.set(false);
      });
  }

  function loadMore(quiet = false) {
    // Search results are one page: there is no next page to fetch.
    if (searchTerm() !== null) return;
    // Once the end shows Retry, scrolling does not fetch again: the button does.
    if (loadingMore || !more() || moreError()) return;
    // Favorites page the same way as a channel: the next page of the favorites.
    if (favorites()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadBookmarks(p), page() + 1, FAVORITES_KEY);
    } else if (mine()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadMyThreads(p), page() + 1, MY_THREADS_KEY);
    } else if (replies()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadMyReplies(p), page() + 1, MY_REPLIES_KEY);
    } else if (messages()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadPmUsers(p), page() + 1, MESSAGES_KEY);
    } else if (channel()) {
      const c = channel()!;
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadPosts(c.id, p, sortFor(c.id)), page() + 1, forumKey(c.id));
    }
  }

  // Opens a list: from the cache at once when it is there, placeholder rows otherwise;
  // either way its first page is fetched and replaces what is shown.
  function openList(key: string, load: (n: number) => Promise<Post[]>, keepPane = false) {
    detour.set([]);
    // Portrait: a board or personal list opens as the list pane over the body (unless the launch
    // fills it in place, keeping the boards beside it).
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
    history.set(false);
    favorites.set(false);
    mine.set(false);
    channel.set(null);
    thread.set(null);
    openList(MY_REPLIES_KEY, (p) => loadMyReplies(p));
    savePlace();
  }

  function showMessages() {
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
  }

  function openChannel(c: Channel, keepPane = false) {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    messages.set(false);
    history.set(false);
    channel.set(c);
    // A channel from More stays in the list while it is open; any other pick sends it back.
    pinned.set(c.newPosts === 0 ? c.id : null);
    thread.set(null);
    openList(forumKey(c.id), (p) => loadPosts(c.id, p, sortFor(c.id)), keepPane);
    savePlace();
  }

  function openThread(p: Post) {
    composing.set(false);
    if (messages()) {
      detour.set([]);
      peer.set(p);
      // Closed after the peer is set: closing it first let the "no thread" rule put the boards
      // pane straight back, which squeezed the conversation beside the first column.
      portraitPane.set(null);
      return;
    }
    // Opened from the history, the thread shows as it does from its channel.
    detour.set([]);
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
    detour.set([...detour(), { id: tid, title: "", focus: pid }]);
  }

  function backFromLink() {
    detour.set(detour().slice(0, -1));
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
  const canCompose = () => !!props.user() && !!channel() && !favorites() && !mine() && !replies() && !messages() && !history() && searchTerm() === null;
  function openComposer() {
    if (!canCompose() || shortcutsOpen()) return;
    composing.set(true);
  }
  useCommand("forum.compose", {
    enabled: () => canCompose() && !shortcutsOpen(),
    run: openComposer,
  });
  // After a post: the channel's list reloads, and the new thread opens when the forum showed it.
  function threadPosted(thread: Post | undefined) {
    const c = channel();
    composing.set(false);
    if (c) openChannel(c);
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
    searchTerm() !== null ? `包含 “${searchTerm()}” 的帖子` : favorites() ? "收藏" : mine() ? "我的主题" : replies() ? "我的回复" : messages() ? "私信" : history() ? "历史" : channel() ? channel()!.title : "帖子";

  // Nothing is open yet (no channel, list or search), so the column has nothing to list.
  const nothingPicked = () =>
    searchTerm() === null && !favorites() && !mine() && !replies() && !messages() && !history() && !channel();

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
  function refreshThreads() {
    // Refreshed in place: the rows stay until the new page replaces them, so the list does not
    // blink through an empty frame (the old path also cleared the thread and re-ran the layout
    // animation, which read as a flash while scrolling).
    const term = searchTerm();
    if (term !== null) { fetchList(() => searchThreads(term), 1, searchKey(term)); return; }
    if (favorites()) { fetchList((p) => loadBookmarks(p), 1, FAVORITES_KEY); return; }
    if (mine()) { fetchList((p) => loadMyThreads(p), 1, MY_THREADS_KEY); return; }
    if (replies()) { fetchList((p) => loadMyReplies(p), 1, MY_REPLIES_KEY); return; }
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
        history.set(false);
        channel.set(null);
        thread.set(null);
        posts.set([]);
        page.set(1);
        more.set(false);
        listLoading.set(false);
        refreshing.set(false);
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
    const selected = () => searchTerm() === null && !favorites() && !mine() && !replies() && !messages() && !history() && channel()?.id === c.id;
    return (
      <ChannelRow
        channel={c} selected={selected} railed={railedFn} delay={delay}
        onPress={() => openChannel(c)}
        sorting={() => sortingMode()}
        dragging={() => draggingId() === c.id}
        onLongPress={() => { if (!sortingMode()) toggleSortingMode(); }}
        onDragStart={(y) => {
          dragStartY = y;
          draggingId.set(c.id);
          dragStartIndex = currentOrder().indexOf(c.id);
        }}
        onDragMove={(y) => {
          const id = draggingId();
          if (!id) return;
          const n = currentOrder().length;
          const to = Math.max(0, Math.min(n - 1, dragStartIndex + Math.round((y - dragStartY) / ROW_STEP)));
          moveChannelTo(id, to);
        }}
        onDragEnd={() => draggingId.set(null)}
        onNudge={(d) => nudgeChannel(c.id, d)}
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
            estimatedItemSize={94}
            onLoadMore={loadMore}
            refreshing={refreshing()}
            onRefresh={() => refreshThreads()}
            footer={() => <View>{loadingMoreShown() ? <LoadingBar /> : null}</View>}
          >
            {(row) => (
              row().kind === "header" ? (
                <Text style={{ fontSize: 11, color: palette().muted, paddingTop: 10, paddingBottom: 2, paddingHorizontal: 8 }}>{titleOf(row())}</Text>
              ) : (
                <ThreadRow
                  item={() => postOf(row())}
                  selected={() => (messages() ? peer() : thread())?.id === postOf(row()).id}
                  avatar={() => avatarFor(postOf(row())) ?? (replies() ? (avatarByName()[props.user() ?? ""] || undefined) : undefined)}
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
          <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: isRail() ? 4 : 8, paddingBottom: 6, gap: 2 }}>
            {/* Channels with new posts, then More: the rest, shown when More is opened. */}
            {/* Fold chip + arrange chip, side by side at the top of the list. */}
            {(channels()?.length ?? 0) > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4,
                             justifyContent: isRail() ? "center" : "flex-start" }}>
                {isRail() ? null : (
                  <View
                    onPress={toggleShowAllChannels}
                    accessibilityLabel={showAllChannels() ? "收起，只看前四个版块" : "展开全部版块"}
                    style={{ flex: 1, minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6,
                             paddingHorizontal: 6, borderRadius: 6, backgroundColor: palette().surface }}
                  >
                    <LineIcon name={showAllChannels() ? "chevronUp" : "list"} size={14} />
                    <Text style={{ fontSize: 11, color: palette().muted, flex: 1, numberOfLines: 1 }}>
                      {showAllChannels()
                        ? `收起 · 前 ${FOLDED_COUNT} 个`
                        : `展开全部 ${channels()?.length ?? 0} 个`}
                    </Text>
                  </View>
                )}
                <View
                  onPress={toggleSortingMode}
                  accessibilityLabel={sortingMode() ? "完成排序" : "调整版块顺序"}
                  style={{ minWidth: isRail() ? 40 : 44, height: 30, alignItems: "center", justifyContent: "center",
                           borderRadius: 6, backgroundColor: sortingMode() ? palette().selected : palette().surface }}
                >
                  {isRail() ? <LineIcon name="grip" size={14} /> : (
                    <Text style={{ fontSize: 11, color: sortingMode() ? palette().link : palette().muted }}>
                      {sortingMode() ? "完成" : "排序"}
                    </Text>
                  )}
                </View>
              </View>
            ) : null}
            {listed().map((c) => renderChannel(c, 0, isRail))}
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
            {navRow({ railed: isRail, icon: "star", label: "收藏", active: () => favorites() && searchTerm() === null, onPress: () => requireSignIn(showFavorites), badge: () => noticeUnread() })}
            {navRow({ railed: isRail, icon: "doc", label: "我的主题", active: () => mine() && searchTerm() === null, onPress: () => requireSignIn(showMine), badge: () => noticeUnread() })}
            {navRow({ railed: isRail, icon: "bubble", label: "我的回复", active: () => replies() && searchTerm() === null, onPress: () => requireSignIn(showReplies), badge: () => noticeUnread() })}
            {navRow({ railed: isRail, icon: "mail", label: "私信", active: () => messages() && searchTerm() === null, onPress: () => requireSignIn(showMessages), badge: () => pmUnread() })}
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
    listTitleKey = headerTitle();
    // The list's scroll offset, taken from its own scroll events, kept for the pane to restore.
    // Measuring the position natively on every scroll is what made scrolling stutter.
    function rememberViewport(e: { offset?: { y?: number }; contentSize?: { height?: number }; size?: { height?: number } }): void {
      listViewport = { key: listTitleKey, y: e?.offset?.y ?? 0 };
      // Prefetch: the next page starts two screens before the list's end, so scrolling keeps
      // flowing. Throttled: a scroll event arrives every frame, and the check is cheap but the
      // load is not — one ask every 250 ms is plenty.
      listRest = (e?.contentSize?.height ?? 0) - ((e?.offset?.y ?? 0) + (e?.size?.height ?? 0));
    }

    // The next page is asked for once the finger stops: fetching and inserting rows mid-scroll
    // was what made the list stutter. Two screens ahead, so it is there before the end is reached.
    function onListScrollEnd(): void {
      if (listRest >= 2000) return;
      const now = Date.now();
      if (now - listPrefetchAt < 400) return;
      listPrefetchAt = now;
      void loadMore(true);
    }
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
              <View style={{ width: props.width ?? 288, borderRightWidth: 1, borderColor: palette().border }}>
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
            {searchOpen() && !titleBarShown() ? null : (
              // The board's name, with a small red dot while notices or private messages wait:
              // the same count the personal rows carry, in the place the user reads first.
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
                <Text style={{ fontSize: 15, color: palette().text, numberOfLines: 1, flexShrink: 1 }}>{headerTitle()}</Text>
                {noticeUnread() + pmUnread() > 0 ? (
                  <View
                    accessibilityLabel="有未读提醒或短消息"
                    style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#e5484d" }}
                  />
                ) : null}
              </View>
            )}
            {titleBarShown() ? null : <SearchControl {...searchProps} />}
            {canCompose() ? (
              <View onPress={openComposer} accessibilityLabel="发新帖" tooltip={hint("写新帖子 (c)")} style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                <PencilIcon size={16} />
              </View>
            ) : null}
            <View
              onPress={refreshing() || (!favorites() && !mine() && !replies() && !messages() && !history() && !channel()) ? undefined : refreshThreads}
              accessibilityLabel="刷新帖子"
              tooltip={hint("刷新帖子")}
              style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
            >
              <RefreshIcon size={14} enabled={!refreshing() && (favorites() || mine() || replies() || messages() || history() || !!channel())} spinning={refreshing()} />
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
          ) : (
          // A virtualized list: only the rows near the viewport exist, and they are reused as
          // the user scrolls. Its end (loading, failure, or "No more threads.") is the footer.
          <List
            style={{ flex: 1 }}
            contentStyle={{ padding: 6, gap: 3 }}
            each={listRows()}
            ref={(n: ListRef | null) => { threadsList = n ?? undefined; }}
            onScroll={rememberViewport}
            onScrollEnd={onListScrollEnd}
            estimatedItemSize={94}
            onLoadMore={loadMore}
            refreshing={refreshing()}
            onRefresh={() => refreshThreads()}
            footer={() => (
              <View>
                {loadingMoreShown() ? <LoadingBar /> : null}
                {!more() && posts().length > 0 && !loadingMoreShown() ? (
                  <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>没有更多帖子了。</Text>
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
                  selected={() => (messages() ? peer() : thread())?.id === postOf(row()).id}
                  avatar={() => avatarFor(postOf(row())) ?? (replies() ? (avatarByName()[forumUser() ?? ""] || undefined) : undefined)}
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
          <NewThread fid={channel()!.id} channel={channel()!.title} onPosted={threadPosted} onClose={() => composing.set(false)} />
        ) : messages() && peer() && detour().length === 0 ? (
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
            focusPid={detour().length > 0 ? detour()[detour().length - 1].focus : undefined}
            onOpenThread={openLinkedThread}
            onOpenSidebars={wantsPanes() ? () => showPane("boards") : undefined}
            onBack={detour().length > 0 ? backFromLink : (wantsPanes() ? () => showPane("list") : () => thread.set(null))}
            // A right swipe in the thread body goes back too (in portrait it returns to the list;
            // a thread opened from a link returns to the one before it).
            onSwipeBack={detour().length > 0 ? backFromLink : () => { if (wantsPanes()) showPane("list"); else thread.set(null); }}
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
          swipe steps back one rung (list → boards → away); the dimmed body does the same. */}
      {wantsPanes() && portraitPane() !== null ? (
        <>
          <View
            onPress={() => portraitPane.set(null)}
            accessibilityLabel="关闭浮层，回到正文"
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.35)", zIndex: 25, opacity: drawerMotion.opacity }}
          />
          <View
            pan={{ x: panePan }}
            panActivation={{ activeOffsetX: 18, failOffsetY: 10 }}
            onPanEnd={(e: any) => {
              // The swipe that opened this pane is still travelling: only a new one steps back.
              if (Date.now() - paneOpenedAt < 350) { panePan.set(0); return; }
              const dx = e?.translation?.x ?? 0;
              const vx = e?.velocity?.x ?? 0;
              if (!e?.cancelled && (dx > 60 || vx > 700)) paneBack();
              panePan.set(0);
            }}
            style={{
              position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 26,
              width: windowSize().width,
              flexDirection: "row",
              backgroundColor: palette().bg,
              borderRightWidth: 1, borderColor: palette().border,
              opacity: drawerMotion.opacity,
            }}
          >
            {/* Portrait: the boards come with the list beside them, filling the window; the body
                stays behind them untouched. The list alone takes the window once a board opens. */}
            {portraitPane() === "list" ? (
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
