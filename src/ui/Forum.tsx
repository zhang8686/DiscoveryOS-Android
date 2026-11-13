// The signed-in screens in three columns, as the Swift app's split view:
// channels | a channel's threads (or favorites) | the open thread.
// Components run once, so the views switch inside JSX, not by early return.
import { BackHandler } from "nsh/mobile";
import { cleanup, effect, Overlay, type ViewRef, List, Scroll, signal, Storage, Text, untracked, View, windowSize, type JSX } from "nsh";
import { onEscape } from "./escape";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { shortcutRows, useCommand } from "./commands";
import { DEMO, clearReplyPageCache, loadBookmarks, loadChannels, loadMyReplies, loadMyThreads, loadPmUsers, loadPosts, searchThreads } from "../discuz/forum";
import { avatarPicture, userAvatar } from "../discuz/avatarCache";
import { mergePage, parseChannels, type Channel, type Post } from "../discuz/parse";
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
import { ThreadSkeleton } from "./Skeleton";
import { Placeholder } from "./Placeholder";
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
const FAVORITES_KEY = "favorites";
const MY_THREADS_KEY = "my-threads";
const MY_REPLIES_KEY = "my-replies";
const MESSAGES_KEY = "messages";
const forumKey = (fid: string) => `forum:${fid}:${sortOrder()}`;

/** Persisted view options: sort by thread start or last reply; show or hide pinned threads. */
let DEMO_PREVIEW_OPENED = false;
const sortOrder = signal<"dateline" | "lastpost">("lastpost");
const showPinned = signal<boolean>(true);
Storage.getItem("visual:sort-order").then((v) => {
  if (v === "dateline" || v === "lastpost") sortOrder.set(v);
}).catch(() => undefined);
Storage.getItem("visual:show-pinned").then((v) => {
  if (v === "0" || v === "1") showPinned.set(v === "1");
}).catch(() => undefined);
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
  const pillWidth = Math.min(30, Math.ceil(compactCount(c.newPosts).length * 6.5) + 6);
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
            <View style={{ position: "absolute", top: -2, left: 16, width: pillWidth, height: 14,
                           borderRadius: 7, overflow: "hidden", backgroundColor: palette().surface }}>
              <Text style={{ numberOfLines: 1, fontSize: 11, color: palette().muted, paddingLeft: 3, lineHeight: 14 }}>
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
          <Text style={{ fontSize: 12.5, color: palette().text, flex: 1, numberOfLines: 1 }}>{c.title}</Text>
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
  const channels = signal<Channel[] | null>(null);
  const channel = signal<Channel | null>(null);
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
  // Author avatars for the thread rows, looked up once per author.
  const avatars = signal<Record<string, string>>({});
  const asked = new Set<string>();
  const listCache = new Map<string, { items: Post[]; more: boolean }>();
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
  // A tablet has room for the whole channel list: show all of them by default,
  // with one clearly labelled row to fold down to "new posts only".
  const showAllChannels = signal(true);
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
  const listed = () => {
    const all = orderedChannels();
    if (showAllChannels()) return all;
    if (DEMO) return all.slice(0, 4);
    return all.filter((c) => c.newPosts > 0 || c.id === pinned());
  };
  const hidden = () => {
    const all = orderedChannels();
    if (showAllChannels()) return [];
    if (DEMO) return [];
    return all.filter((c) => c.newPosts === 0 && c.id !== pinned());
  };

  // Opening or closing More, and pinning a channel, animate the list's change.
  function animateListChange() {
    // Touch targets should react at once: a 200 ms layout animation over the
    // whole channel column drops frames on tablets.
  }
  // The Android back key: close the most recent overlay first, then step out
  // of the open thread, and only then let the system exit the app.
  try {
    BackHandler.on("press", () => {
      if (moreOpen()) { collapseMore(); return true; }
      if (searchTerm() !== null || searchOpen()) { closeSearch(); return true; }
      if (detour().length > 0) { backFromLink(); return true; }
      if (thread() || peer()) { thread.set(null); peer.set(null); return true; }
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
  let placeRestored = false;

  // The channel column: a rail of icons when folded or when the window is narrow.
  const railed = () => channelsRailed(windowSize().width, channelsCollapsed());
  const wide = () => windowSize().width >= RAIL_BELOW;

  // Saves the channel and thread now open (favorites save no channel).
  function savePlace() {
    saveLastPlace({ channel: favorites() || mine() || replies() || messages() || history() ? null : channel(), thread: thread() });
  }

  function restorePlace(list: Channel[]) {
    if (placeRestored) return;
    placeRestored = true;
    savedPlace.then((place) => {
      const saved = place?.channel;
      if (!saved || favorites() || mine() || replies() || messages() || history() || channel()) return;
      const found = list.find((c) => c.id === saved.id);
      if (!found) return;
      openChannel(found);
      if (place?.thread) {
        thread.set(place.thread);
        savePlace();
      }
    });
  }

  // Avatars are decoration, not content. A 50-thread page used to fire two
  // requests per distinct author and call `avatars.set` once per image, each
  // set rebuilding the virtualized list. Cap concurrency and batch the results.
  const AVATARS_PER_PAGE = 8;
  const AVATAR_CONCURRENCY = 2;
  const avatarQueue: string[] = [];
  let avatarRunning = 0;
  let avatarBatch: Record<string, string> = {};
  let avatarFlush: ReturnType<typeof setTimeout> | null = null;

  function flushAvatars(): void {
    avatarFlush = null;
    if (Object.keys(avatarBatch).length === 0) return;
    avatars.set({ ...avatars(), ...avatarBatch });
    avatarBatch = {};
  }

  function pumpAvatars(): void {
    while (avatarRunning < AVATAR_CONCURRENCY && avatarQueue.length > 0) {
      const name = avatarQueue.shift()!;
      avatarRunning++;
      userAvatar(name)
        .then((url) => (url ? avatarPicture(url) : undefined))
        .then((picture) => {
          if (!picture) return;
          avatarBatch[name] = picture;
          if (!avatarFlush) avatarFlush = setTimeout(flushAvatars, 150);
        })
        .catch(() => undefined)
        .finally(() => { avatarRunning--; pumpAvatars(); });
    }
  }

  function loadAvatars(list: Post[]) {
    let added = 0;
    for (const p of list) {
      if (added >= AVATARS_PER_PAGE) break;
      const name = avatarName(p);
      if (!name || asked.has(name)) continue;
      asked.add(name);
      avatarQueue.push(name);
      added++;
    }
    pumpAvatars();
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
        if (n === 1) listCache.set(key, { items: merged.items, more: merged.more });
        // The favorites loaded so far are saved, and saved favorites the list has dropped are pruned.
        if (key === FAVORITES_KEY) reconcileFavorites(merged.items, !merged.more);
        loadAvatars(list);
        page.set(n);
        // A search with hits is done: its field hides, and the results and the header stay.
        if (n === 1 && list.length > 0 && key === searchKey(searchTerm() ?? "")) {
          animateSearchChange();
          searchOpen.set(false);
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

  function loadMore() {
    // Search results are one page: there is no next page to fetch.
    if (searchTerm() !== null) return;
    // Once the end shows Retry, scrolling does not fetch again: the button does.
    if (loadingMore || !more() || moreError()) return;
    // Favorites page the same way as a channel: the next page of the favorites.
    if (favorites()) {
      loadingMore = true;
      loadingMoreShown.set(true);
      fetchList((p) => loadBookmarks(p), page() + 1, FAVORITES_KEY);
    } else if (mine()) {
      loadingMore = true;
      loadingMoreShown.set(true);
      fetchList((p) => loadMyThreads(p), page() + 1, MY_THREADS_KEY);
    } else if (replies()) {
      loadingMore = true;
      loadingMoreShown.set(true);
      fetchList((p) => loadMyReplies(p), page() + 1, MY_REPLIES_KEY);
    } else if (messages()) {
      loadingMore = true;
      loadingMoreShown.set(true);
      fetchList((p) => loadPmUsers(p), page() + 1, MESSAGES_KEY);
    } else if (channel()) {
      const c = channel()!;
      loadingMore = true;
      loadingMoreShown.set(true);
      fetchList((p) => loadPosts(c.id, p, sortOrder()), page() + 1, forumKey(c.id));
    }
  }

  // Opens a list: from the cache at once when it is there, placeholder rows otherwise;
  // either way its first page is fetched and replaces what is shown.
  function openList(key: string, load: (n: number) => Promise<Post[]>) {
    detour.set([]);
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

  function openChannel(c: Channel) {
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
    openList(forumKey(c.id), (p) => loadPosts(c.id, p, sortOrder()));
    savePlace();
  }

  function openThread(p: Post) {
    composing.set(false);
    if (messages()) {
      detour.set([]);
      peer.set(p);
      return;
    }
    // Opened from the history, the thread shows as it does from its channel.
    detour.set([]);
    thread.set(p);
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
      openList(forumKey(c.id), (p) => loadPosts(c.id, p, sortOrder()));
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
  const listRows = (): ListRow[] =>
    history() ? historyRows() : posts().filter((p) => showPinned() || !p.pinned).map((post): ListRow => ({ kind: "post", post }));

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
        channels.set(list);
        restorePlace(list);
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
    if (searchTerm() !== null) openSearch(searchTerm()!);
    else if (favorites()) showFavorites();
    else if (mine()) showMine();
    else if (replies()) showReplies();
    else if (messages()) showMessages();
    else if (history()) snapshotHistory();
    else if (channel()) openChannel(channel()!);
  }

  // Load the channel list on launch, and again on every sign-in or sign-out. Signing
  // out closes the open list and thread: a hidden channel, or favorites, needs an
  // account, so its threads must not stay on screen. A list still loading is dropped.
  // Whether the previous run saw a signed-in user: null on launch, so only a real sign-out is quiet.
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
      wasSignedIn.set(signedIn);
    });
  });

  // One personal-section row: a line icon, a label and a 48dp touch target.
  // These stay visible when signed out; tapping offers the sign-in sheet.
  function requireSignIn(action: () => void) {
    if (!props.user()) {
      notify("sign-in", "登录后即可查看此项内容。");
      props.onSignInNeeded?.();
      return;
    }
    action();
  }

  function navRow(o: { icon: IconName; label: string; active: () => boolean; onPress: () => void }): JSX.Element {
    return (
      <View
        onPress={o.onPress}
        accessibilityLabel={o.label}
        style={{
          minHeight: 36,
          justifyContent: "center",
          paddingVertical: 4,
          paddingHorizontal: railed() ? 4 : 8,
          borderRadius: 6,
          backgroundColor: o.active() ? palette().selected : "transparent",
        }}
      >
        {railed() ? (
          <View style={{ alignItems: "center" }}><LineIcon name={o.icon} size={19} /></View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <LineIcon name={o.icon} size={17} />
            <Text style={{ fontSize: 12.5, color: palette().text, flex: 1 }}>{o.label}</Text>
          </View>
        )}
      </View>
    );
  }

  // A channel row; `delay` staggers its entrance when the stack opens.
  function renderChannel(c: Channel, delay = 0) {
    const selected = () => searchTerm() === null && !favorites() && !mine() && !replies() && !messages() && !history() && channel()?.id === c.id;
    return (
      <ChannelRow
        channel={c} selected={selected} railed={railed} delay={delay}
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
      {/* Column 1: channels and favorites, or a rail of their icons */}
      <View style={{ width: railed() ? RAIL_WIDTH : FULL_WIDTH, borderRightWidth: 1, borderColor: palette().border }}>
        <View
          style={{
            // Under the title bar the header sits flush against it; with no bar, it keeps the top inset.
            paddingTop: titleBarShown() ? 0 : 12,
            paddingHorizontal: railed() ? 0 : 12,
            paddingBottom: 4,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: railed() ? "center" : "space-between",
          }}
        >
          {railed() ? null : <Text style={{ fontSize: 12, fontWeight: 600, color: palette().muted }}>版块</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            {railed() ? null : (
              <View
                onPress={channelsLoading() ? undefined : () => reloadChannels()}
                accessibilityLabel="刷新版块"
                tooltip={hint("刷新版块")}
                style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
              >
                <RefreshIcon size={14} enabled={!channelsLoading()} spinning={channelsLoading()} />
              </View>
            )}
            {wide() && !titleBarShown() ? (
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
        <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: railed() ? 4 : 8, paddingBottom: 6, gap: 2 }}>
          {/* Channels with new posts, then More: the rest, shown when More is opened. */}
          {/* Fold chip + arrange chip, side by side at the top of the list. */}
          {(channels()?.length ?? 0) > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4,
                           justifyContent: railed() ? "center" : "flex-start" }}>
              {railed() ? null : (
                <View
                  onPress={toggleShowAllChannels}
                  accessibilityLabel={showAllChannels() ? "只看有更新的版块" : "显示全部版块"}
                  style={{ flex: 1, minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6,
                           paddingHorizontal: 6, borderRadius: 6, backgroundColor: palette().surface }}
                >
                  <LineIcon name={showAllChannels() ? "chevronUp" : "list"} size={14} />
                  <Text style={{ fontSize: 11, color: palette().muted, flex: 1, numberOfLines: 1 }}>
                    {showAllChannels() ? `全部 ${channels()?.length ?? 0} 个 · 收起` : `显示 ${channels()?.length ?? 0} 个版块`}
                  </Text>
                </View>
              )}
              <View
                onPress={toggleSortingMode}
                accessibilityLabel={sortingMode() ? "完成排序" : "调整版块顺序"}
                style={{ minWidth: railed() ? 40 : 44, height: 30, alignItems: "center", justifyContent: "center",
                         borderRadius: 6, backgroundColor: sortingMode() ? palette().selected : palette().surface }}
              >
                {railed() ? <LineIcon name="grip" size={14} /> : (
                  <Text style={{ fontSize: 11, color: sortingMode() ? palette().link : palette().muted }}>
                    {sortingMode() ? "完成" : "排序"}
                  </Text>
                )}
              </View>
            </View>
          ) : null}
          {listed().map((c) => renderChannel(c))}
          {/* Channels without new posts: a stack of their icons; opening it lists them in place. */}
          {hidden().length > 0 ? (
            <View>
              {moreOpen() ? (
                // The rows are the overlay's anchor: a press on them is not outside it, so it
                // reaches the row's own press and picks the channel.
                <View ref={(n) => listAnchor.set(n)}>{hidden().map((c, i) => renderChannel(c, i * 40))}</View>
              ) : (
                <View
                  onPress={toggleMore}
                  accessibilityLabel="更多版块"
                  style={{ paddingVertical: 4, paddingHorizontal: railed() ? 4 : 8, borderRadius: 6 }}
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
          paddingHorizontal: railed() ? 4 : 8, paddingTop: 4, paddingBottom: 4,
          flexShrink: 0,
        }}>
          {/* Personal section: always visible on a tablet. Signed out, a tap
              opens the sign-in sheet instead of hiding the entry entirely. */}
          {navRow({ icon: "star", label: "收藏", active: () => favorites() && searchTerm() === null, onPress: () => requireSignIn(showFavorites) })}
          {navRow({ icon: "doc", label: "我的主题", active: () => mine() && searchTerm() === null, onPress: () => requireSignIn(showMine) })}
          {navRow({ icon: "bubble", label: "我的回复", active: () => replies() && searchTerm() === null, onPress: () => requireSignIn(showReplies) })}
          {navRow({ icon: "mail", label: "私信", active: () => messages() && searchTerm() === null, onPress: () => requireSignIn(showMessages) })}
          {navRow({ icon: "clock", label: "历史", active: () => history() && searchTerm() === null, onPress: () => requireSignIn(showHistory) })}
        </View>
        {props.footer ? props.footer(railed()) : null}
      </View>

      {/* Column 2: threads of the channel, or favorites */}
      <View style={{ width: 288, borderRightWidth: 1, borderColor: palette().border }}>
        <View style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          {searchOpen() && !titleBarShown() ? null : (
            <Text style={{ fontSize: 15, color: palette().text, flex: 1 }}>{headerTitle()}</Text>
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
        {/* Rare controls stay folded: one 26dp chip shows the current order,
            tapping it opens the three compact toggles. */}
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
              <View onPress={() => { if (sortOrder() !== "dateline") { sortOrder.set("dateline"); Storage.setItem("visual:sort-order", "dateline").catch(() => undefined); refreshThreads(); } }}
                accessibilityLabel="按发帖时间排序"
                style={{ height: 26, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 5, backgroundColor: sortOrder() === "dateline" ? palette().selected : palette().surface }}>
                <Text style={{ fontSize: 11, color: palette().text }}>发帖时间</Text>
              </View>
              <View onPress={() => { if (sortOrder() !== "lastpost") { sortOrder.set("lastpost"); Storage.setItem("visual:sort-order", "lastpost").catch(() => undefined); refreshThreads(); } }}
                accessibilityLabel="按回帖时间排序"
                style={{ height: 26, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 5, backgroundColor: sortOrder() === "lastpost" ? palette().selected : palette().surface }}>
                <Text style={{ fontSize: 11, color: palette().text }}>回帖时间</Text>
              </View>
              <View style={{ flex: 1 }} />
              <View onPress={() => { const n = !showPinned(); showPinned.set(n); Storage.setItem("visual:show-pinned", n ? "1" : "0").catch(() => undefined); }}
                accessibilityLabel="切换置顶帖显示"
                style={{ height: 26, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 5, borderWidth: 1, borderColor: palette().border }}>
                <Text style={{ fontSize: 11, color: palette().muted }}>{showPinned() ? "隐藏置顶" : "显示置顶"}</Text>
              </View>
            </>
          ) : (
            <Text style={{ fontSize: 11, color: palette().muted, flex: 1 }}>
              {sortOrder() === "dateline" ? "按发帖时间" : "按回帖时间"}{showPinned() ? "" : " · 已隐藏置顶"}
            </Text>
          )}
        </View>
        {searchTerm() !== null && !listLoading() && posts().length === 0 ? (
          <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>没有找到包含 “{searchTerm()}” 的帖子。</Text>
        ) : null}
        {history() && searchTerm() === null && historyRows().length === 0 ? (
          <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>你打开过的帖子会显示在这里。</Text>
        ) : null}
        {listLoading() ? (
          <Scroll style={{ flex: 1 }}>
            <ThreadSkeleton />
          </Scroll>
        ) : nothingPicked() ? (
          <Placeholder
            title="选择一个版块以查看帖子。"
            detail={props.user() ? undefined : "登录后即可查看收藏、主题、回复和私信。"}
          />
        ) : (
        // A virtualized list: only the rows near the viewport exist, and they are reused as
        // the user scrolls. Its end (loading, failure, or "No more threads.") is the footer.
        <List
          style={{ flex: 1 }}
          contentStyle={{ padding: 6, gap: 3 }}
          each={listRows()}
          estimatedItemSize={64}
          onLoadMore={loadMore}
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
                avatar={() => {
                  const name = avatarName(postOf(row()));
                  return name ? avatars()[name] : undefined;
                }}
                // The favorites list is all favorites, so its rows carry no star.
                favorite={() => !favorites() && !!props.user() && isFavorite(postOf(row()).id)}
                viewed={() => isViewed(postOf(row()).id)}
                onPress={() => openThread(postOf(row()))}
              />
            )
          )}
        </List>
        )}
      </View>

      {/* Column 3: the open thread. Under the title bar it extends up into the bar (a negative top margin),
          so the thread's title sits in the bar's caption area. */}
      <View style={{ flex: 1, alignSelf: "stretch", marginTop: titleBarShown() ? -titleBar().height : 0 }}>
        {composing() && canCompose() ? (
          <NewThread fid={channel()!.id} channel={channel()!.title} onPosted={threadPosted} onClose={() => composing.set(false)} />
        ) : messages() && peer() && detour().length === 0 ? (
          <Conversation peer={() => peer()!} onOpenThread={openLinkedThread} />
        ) : shownThread() ? (
          <Thread
            // A thread from a link has no forum of its own here: its first page names it.
            fid={detour().length > 0 ? "" : (shownThread()!.fid ?? channel()?.id ?? "")}
            post={shownThread()!}
            signedIn={!!props.user()}
            onSignInNeeded={props.onSignInNeeded}
            focusPid={detour().length > 0 ? detour()[detour().length - 1].focus : undefined}
            onOpenThread={openLinkedThread}
            onBack={detour().length > 0 ? backFromLink : undefined}
            shortcutsOpen={() => shortcutsOpen()}
            onUnfavorited={() => {
              // In the favorites list, the removed thread leaves the list.
              if (favorites() && detour().length === 0) posts.set(posts().filter((p) => p.id !== thread()?.id));
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>选择一个帖子</Text>
          </View>
        )}
      </View>
      </View>
      {shortcutsOpen() ? <ShortcutsHelp keys={shortcutRows()} onClose={() => shortcutsOpen.set(false)} /> : null}
    </View>
  );
}
