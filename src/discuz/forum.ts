import { currentFormHash, currentUser, findFloor, isLoginRequired, pageSize, request } from "./client";
import { parseBookmarks, parseChannels, parseChannelLinks, parseMyReplies, parseMyThreads, parseNotices, parsePmConversation, parsePmUsers, parsePosts, parseProfile, parseReplies, parseSearchResults, parseThreadPageInfo, parseUser, type Author, type Channel, type PmMessage, type Post, type Profile, type Reply } from "./parse";
import { formEncodeGb, htmlEntities } from "./encoding";
import { BUILTIN_CHANNELS, mergeChannels } from "./channels";

export const DEMO_REPLIES: import("./parse").Reply[] = [
  { id: "1", author: { id: "1", name: "管理员", avatar: "" }, at: "2026-10-01 10:00", seq: 1, body: "欢迎来到 DiscoveryOS 论坛客户端。这里是置顶帖的正文示例，用于展示三栏布局中的正文区域。" },
  { id: "2", author: { id: "2", name: "原味", avatar: "" }, at: "2026-11-12 09:15", seq: 2, body: "平板横屏下正文确实宽了不少，长段落读起来舒服多了。" },
  { id: "3", author: { id: "3", name: "设计控", avatar: "" }, at: "2026-11-13 11:20", seq: 3, body: "按发帖时间和按回帖时间切换很实用，隐藏置顶之后列表干净很多。" },
];

/** Preview-only sample data. The release APK sets DEMO to false. */
export const DEMO = false;
export const DEMO_POSTS: import("./parse").Post[] = [
  { id: "3473784", title: "置顶 · 论坛版规与新手指引", author: "管理员", at: "2026-10-01", lastReplyAt: "2026-11-12 09:15", replies: 128, views: 20541, pinned: true },
  { id: "3457415", title: "聊聊最近入手的 LCD 屏备用机", author: "原味", at: "2026-11-13", lastReplyAt: "2026-11-13 11:42", replies: 36, views: 1203 },
  { id: "3452476", title: "家里的工具更加齐全了", author: "lyk175551", at: "2026-06-12", lastReplyAt: "2026-11-12 21:53", replies: 214, views: 9850 },
  { id: "3175769", title: "分享一个轻量的论坛阅读客户端", author: "Discovery", at: "2023-05-18", lastReplyAt: "2026-11-11 18:41", replies: 87, views: 6602 },
  { id: "3471001", title: "平板横屏三栏布局该怎么分配宽度", author: "设计控", at: "2026-11-10", lastReplyAt: "2026-11-10 14:20", replies: 19, views: 431 },
  { id: "3469002", title: "GB18030 编码踩坑记录", author: "码农甲", at: "2026-11-08", lastReplyAt: "2026-11-09 08:03", replies: 42, views: 1877 },
];

/**
 * index.php is behind Cloudflare Managed Challenge. Other Discuz pages are served,
 * so use the built-in channel list and enrich it from a served page when possible.
 */
export async function loadChannels(): Promise<Channel[]> {
  if (DEMO) return mergeChannels(BUILTIN_CHANNELS.map((c) => ({ ...c })));
  try {
    const html = await request("GET", "index.php", { retry: false });
    const found = parseChannels(html);
    if (found.length > 0) {
      const named = new Map(parseChannelLinks(html).map((c) => [c.id, c.title]));
      for (const c of found) {
        if (/^[.…·\-\s]*$/.test(c.title) && named.has(c.id)) c.title = named.get(c.id)!;
      }
      return mergeChannels(found);
    }
  } catch {  }
  try {
    const html = await request("GET", "forumdisplay.php", { query: [["fid", "2"]], retry: false });
    const found = parseChannelLinks(html);
    if (found.length > 0) return mergeChannels(found);
  } catch {  }
  return BUILTIN_CHANNELS.map((c) => ({ ...c }));
}

/** Sort by thread start ("dateline") or last reply ("lastpost"), newest first. */
export type SortOrder = "dateline" | "lastpost";

export async function loadPosts(fid: string, page = 1, order: SortOrder = "lastpost"): Promise<Post[]> {
  if (DEMO) return DEMO_POSTS.filter((p) => order === "dateline" ? true : true)
    .sort((a, b) => (order === "dateline" ? String(b.at ?? "") : String(b.lastReplyAt ?? ""))
      .localeCompare(order === "dateline" ? String(a.at ?? "") : String(a.lastReplyAt ?? "")));
  const query: [string, string][] = [
    ["fid", fid],
    ["page", String(page)],
    ["orderby", order],
    ["filter", order === "lastpost" ? "2592000" : ""],
    ["ppp", String(pageSize)],
  ];
  const html = await request("GET", "forumdisplay.php", { query });
  return parsePosts(html, order);
}

/**
 * The threads whose titles contain `keyword`, in every channel (`search.php`,
 * newest reply first). The site answers signed-out searches with a notice, not
 * a list, so that is reported as a sign-in error. The site returns one page.
 */
export async function searchThreads(keyword: string): Promise<Post[]> {
  const html = await request("GET", "search.php", {
    query: [
      ["srchtype", "title"],
      ["srchtxt", keyword],
      ["searchsubmit", "true"],
      ["st", "on"],
      ["srchuname", ""],
      ["srchfilter", "all"],
      ["srchfrom", "0"],
      ["before", ""],
      ["orderby", "lastpost"],
      ["ascdesc", "desc"],
    ],
  });
  if (html.includes("您还未登录")) throw new Error(currentUser() ? "搜索需要重新登录" : "登录后才能搜索");
  const posts = parseSearchResults(html);
  return posts;
}

type ReplyPage = { title?: string; fid?: string; lastPage?: number; replies: Reply[] };

const REPLY_PAGE_TTL_MS = 10 * 60 * 1000;
const REPLY_PAGE_LIMIT = 32;
const replyPageCache = new Map<string, { page: ReplyPage; at: number }>();
const replyPageInFlight = new Map<string, Promise<ReplyPage>>();
let replyPageGeneration = 0;
const threadGenerations = new Map<string, number>();

/** Stores a freshly loaded page, dropping stale pages and evicting the oldest past the limit. */
function storeReplyPage(key: string, page: ReplyPage): void {
  const now = Date.now();
  for (const [k, entry] of replyPageCache) {
    if (now - entry.at >= REPLY_PAGE_TTL_MS) replyPageCache.delete(k);
  }
  replyPageCache.set(key, { page, at: now });
  if (replyPageCache.size <= REPLY_PAGE_LIMIT) return;
  const drop = Math.floor(REPLY_PAGE_LIMIT / 4);
  const oldest = [...replyPageCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [k] of oldest.slice(0, drop)) replyPageCache.delete(k);
}

/**
 * Forgets every cached thread page. Replies differ by account, so this runs on sign-in and sign-out.
 */
export function clearReplyPageCache(): void {
  replyPageGeneration++;
  replyPageCache.clear();
  replyPageInFlight.clear();
}

/** The cache keys (`tid:page`) of thread `tid` among `keys`: all of its pages. */
export function threadPageKeys(keys: Iterable<string>, tid: string): string[] {
  return [...keys].filter((key) => key.split(":")[0] === tid);
}

/**
 * Forgets every cached page of the thread, and the requests for them under way. A reply, an
 * edit or a delete changes any page of the thread, so all of them are asked again.
 */
export function clearThreadReplyPages(tid: string): void {
  threadGenerations.set(tid, (threadGenerations.get(tid) ?? 0) + 1);
  for (const key of threadPageKeys(replyPageCache.keys(), tid)) replyPageCache.delete(key);
  for (const key of threadPageKeys(replyPageInFlight.keys(), tid)) replyPageInFlight.delete(key);
}

/** A thread page's replies, with the thread's title and forum when the page names them. */
export function loadReplyPage(tid: string, page = 1): Promise<ReplyPage> {
  const key = `${tid}:${page}`;
  const hit = replyPageCache.get(key);
  if (hit && Date.now() - hit.at < REPLY_PAGE_TTL_MS) return Promise.resolve({ ...hit.page, replies: [...hit.page.replies] });
  const pending = replyPageInFlight.get(key);
  if (pending) return pending;
  const generation = replyPageGeneration;
  const threadGeneration = threadGenerations.get(tid) ?? 0;
  const request = fetchReplyPage(tid, page)
    .then((result) => {
      // Failures are not stored (they throw above), so the next open asks again. A request
      // whose in-flight entry was forgotten (a reply posted meanwhile) is not stored either.
      const current = generation === replyPageGeneration && threadGeneration === (threadGenerations.get(tid) ?? 0);
      if (current && replyPageInFlight.get(key) === request) storeReplyPage(key, result);
      return { ...result, replies: [...result.replies] };
    })
    .finally(() => {
      if (replyPageInFlight.get(key) === request) replyPageInFlight.delete(key);
    });
  replyPageInFlight.set(key, request);
  return request;
}

async function fetchReplyPage(tid: string, page: number): Promise<ReplyPage> {
  if (DEMO) return { title: DEMO_POSTS.find((p) => p.id === tid)?.title ?? "帖子正文", fid: "2", replies: DEMO_REPLIES };
  const html = await request("GET", "viewthread.php", { query: [["tid", tid], ["page", String(page)]] });
  // Still the login page after the automatic sign-in (or with none): not a thread, so it fails.
  if (isLoginRequired(html)) throw new Error("阅读帖子需要登录");
  return { ...parseThreadPageInfo(html), replies: parseReplies(html) };
}

/** The thread page holding floor `pid` of thread `tid`, with its replies and the thread's title and forum. */
export async function loadFloorPage(tid: string, pid: string): Promise<{ page: number; title?: string; fid?: string; replies: Reply[] }> {
  const { html, page } = await findFloor(tid, pid);
  return { ...parseThreadPageInfo(html), page, replies: parseReplies(html) };
}

export async function loadReplies(tid: string, page = 1): Promise<Reply[]> {
  return (await loadReplyPage(tid, page)).replies;
}

export async function loadBookmarks(page = 1): Promise<Post[]> {
  return parseBookmarks(await request("GET", "my.php", { query: [["item", "favorites"], ["type", "thread"], ["page", String(page)]] }));
}

/** The threads the signed-in user started, newest first (`my.php?item=threads`). */
export async function loadMyThreads(page = 1): Promise<Post[]> {
  return parseMyThreads(await request("GET", "my.php", { query: [["item", "threads"], ["page", String(page)]] }));
}

/** The threads the signed-in user replied to, newest reply first (`my.php?item=posts`). */
export async function loadMyReplies(page = 1): Promise<Post[]> {
  return parseMyReplies(await request("GET", "my.php", { query: [["item", "posts"], ["page", String(page)]] }));
}

/** The notices on `notice.php`, as list rows (`parseNotices`). */
export async function loadNotices(): Promise<Post[]> {
  // parseNotices already stays inside ul.feed and names each kind of notice, so
  // a second title filter would throw away the group-change and rating rows.
  return parseNotices(await request("GET", "notice.php"));
}

export async function loadPmUsers(page = 1): Promise<Post[]> {
  return parsePmUsers(await request("GET", "pm.php", { query: [["filter", "privatepm"], ["page", String(page)]] }));
}

/** The messages with one correspondent, all of them (`pm.php?uid=N`). */
export async function loadPmConversation(uid: string): Promise<PmMessage[]> {
  return parsePmConversation(await request("GET", "pm.php", { query: [["uid", uid], ["filter", "privatepm"], ["daterange", "5"]] }));
}

/**
 * Sends a private message to `uid` (`pm.php?action=send`), as the conversation's reply box
 * does, then reads the conversation back. `lastDay` is the day of the latest message shown
 * (`2026-6-24`), which the page sends along. Rejects when the new message is not in the
 * conversation after sending.
 */
export async function sendPm(uid: string, lastDay: string, content: string): Promise<PmMessage[]> {
  const hash = currentFormHash();
  if (!hash) throw new Error("尚未登录");
  const message = htmlEntities(content.replace(/\n/g, "\r\n"));
  await request("POST", `pm.php?action=send&uid=${uid}&pmsubmit=yes&infloat=yes&inajax=1`, {
    form: [["formhash", hash], ["handlekey", "pmreply"], ["lastdaterange", lastDay], ["message", message]],
  });
  const list = await loadPmConversation(uid);
  const first = htmlEntities(content.split("\n")[0].trim()).slice(0, 12);
  if (first && !list.some((m) => m.body.includes(first))) throw new Error("消息未能发送");
  return list;
}

/** Adds a thread to the favorites (`DiscuzAPI.bookmarkPost`). */
export async function bookmarkPost(tid: string): Promise<boolean> {
  const text = await request("GET", "my.php", { query: [["item", "favorites"], ["tid", tid], ["inajax", "1"], ["ajaxtarget", "favorite_msg"]] });
  return text.includes("此主题已成功添加到收藏夹中");
}

/** Removes a thread from the favorites (the site's own "remove" request). */
export async function removeBookmark(tid: string): Promise<boolean> {
  const text = await request("GET", "my.php", {
    query: [["item", "favorites"], ["action", "remove"], ["tid", tid], ["inajax", "1"], ["ajaxtarget", "favorite_msg"]],
  });
  return text.includes("此主题已成功从您的收藏夹中移除");
}

/** The user's UID and avatar (`DiscuzAPI.loadUser`). */
export async function loadUser(name: string): Promise<Author | undefined> {
  const html = await request("GET", "space.php", { query: [["username", name]] });
  return parseUser(html, name);
}

/** The user's profile page: the account menu's fields and avatar. */
export async function loadProfile(name: string): Promise<Profile> {
  const html = await request("GET", "space.php", { query: [["username", name]] });
  return parseProfile(html, name);
}
