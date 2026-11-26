
import { forumTime } from "./timeAgo";

/** `String.captureGroups(regex:skipFirst:)`. */
export function captureGroups(text: string, pattern: string, skipFirst = false): string[] {
  const re = new RegExp(pattern, "gs");
  const matches = [...text.matchAll(re)];
  if (matches.length > 1) return matches.map((m) => m[0]);
  const match = matches[0];
  if (!match) return [];
  return Array.from(match).slice(skipFirst ? 1 : 0).map((g) => g ?? "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML entities a Discuz title can carry. */
export function htmlDecode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** `removingPercentEncoding`: the text, or itself when it is not valid escapes. */
export function removePercentEncoding(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export type Channel = { id: string; title: string; description: string; newPosts: number };
export type Post = {
  id: string;
  title: string;
  /** A coloured thread title, as the forum posted it (`<font color>` or a style). */
  color?: string;
  uid?: string;
  author?: string;
  at?: string;
  /** The reply count, when the page shows it (the user's own threads do not). */
  replies?: number;
  views?: number;
  lastReplyBy?: string;
  lastReplyAt?: string;
  /** The forum (channel) the thread is in, when the page names it. */
  fid?: string;
  /** A pinned (sticky) thread: its forum page lists it above the others, whatever its reply time. */
  pinned?: boolean;
  /** The start of the user's own reply, as the page shows it (My Replies). */
  excerpt?: string;
  /** A notice's "查看" link points at this floor of the thread it names. */
  focusPid?: string;
  /** The list marks a thread that carries attachments (pictures), so its row can say so. */
  hasImages?: boolean;
  /** Discuz's agree.gif on the title: the post was awarded points ("帖子被加分"). */
  agreed?: boolean;
};

/**
 * The mark Discuz puts beside a thread that carries attachments: an `attachimg.gif` (or an
 * attachment-classed icon), a picture-type icon, or the word "附件"/"图片" in an alt text.
 * Skins differ in the file they use, so any of them counts. A row without one simply has no
 * `hasImages`, and the list draws no picture mark for it.
 */
const ATTACH_MARK =
  /attachimg\.gif|attach\.gif|image_s\.gif|attachicons\/(?:image|img)[^"]*\.gif|class="[^"]*\battach\b[^"]*"|alt="[^"]*(?:附件|图片)[^"]*"/i;

/** The channels on the index page (`DiscuzAPI.loadChannels`). */
/** A board's name, cleared of what a served page leaves on it: a trailing count (a parsing
 * leftover such as "iPhone 16 PM 23545"), and characters the device font has no glyph for
 * (they draw as boxes). */
export function cleanChannelTitle(raw: string): string {
  const cleaned = htmlDecode(raw)
    .replace(/\s*\d{3,}\s*$/, "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{FFFD}\u{E000}-\u{F8FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return /^[.…·\-—\s]*$/.test(cleaned) ? htmlDecode(raw).replace(/\s*\d{3,}\s*$/, "").trim() : cleaned;
}

export function parseChannels(html: string): Channel[] {
  const channels: Channel[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(row, 'forumdisplay\\.php\\?fid=(\\d+)[^>]*>([^<]+)</a>.*?<p>((?:[^<]+)?)<', true);
    if (col.length === 0) continue;
    const field = captureGroups(row, "今日: <strong>(\\d+)", true);
    const newPosts = field.length === 1 ? Number(field[0]) || 0 : 0;
    channels.push({ id: col[0], title: cleanChannelTitle(col[1]), description: col[2], newPosts });
  }
  return channels;
}

/** Channel links from any served page. Guests cannot read `index.php` (it is
 * challenged), but every forum page carries the channel nav in its links. */
export function parseChannelLinks(html: string): Channel[] {
  const found = new Map<string, Channel>();
  for (const m of html.matchAll(/forumdisplay\.php\?fid=(\d+)[^>]*>([^<]{1,60})<\/a>/g)) {
    const title = cleanChannelTitle(m[2]);
    if (!m[1] || !title || /^[\d\s&]+$/.test(title)) continue;
    if (!found.has(m[1])) found.set(m[1], { id: m[1], title, description: "", newPosts: 0 });
  }
  return [...found.values()];
}

/** Discuz's "post was awarded points" marker on a thread title. */
const AGREE_MARK = /agree\.gif|alt="[^"]*加分[^"]*"|title="[^"]*加分[^"]*"/i;

/** The threads on a forum page (`DiscuzAPI.loadPosts`).
 * `fid` is the board being shown: the forum page names the board in its navigation, not in each
 * row, so the caller passes it from the channel. It lets a row carry a stable board colour. */
export function parsePosts(html: string, order: "dateline" | "lastpost" = "lastpost", fid?: string): Post[] {
  const posts: Post[] = [];
  const stickyIds = new Set<string>();
  for (const m of html.matchAll(/<tbody id="stickythread_(\d+)"/g)) stickyIds.add(m[1]);
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      '<span[^>]*><a href="[^"]*viewthread\\.php\\?tid=(\\d+)[^>]*>([\\s\\S]*?)</a>.*?href="[^"]*space\\.php\\?uid=(\\d+)">([^<]+)</a>.*<em>(\\d{4}-\\d{1,2}-\\d{1,2})</em>.*<td class="nums"><strong>(\\d+)</strong>/<em>(\\d+)</em></td>.*[^"]*space\\.php\\?username=[^"]+">([^<]+)<.*lastpost">([^<]+)<',
      true,
    );
    if (col.length === 0) continue;
    const authorCell = /<td[^>]*class="author"[^>]*>([\s\S]*?)<\/td>/i.exec(row)?.[1] ?? "";
    const atFull = /title="(\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)"/.exec(authorCell)?.[1]?.trim();
    const rawTitle = col[1];
    // Discuz puts a highlighted title's colour on the <a> tag's style, not in the title text.
    // A row can hold several <a> tags for the same tid (title / "new window" / page links);
    // scan them all so the coloured one is not missed, and fall back to a colour in the title
    // markup itself (e.g. <em style="color:red">).
    const linkTags = [...row.matchAll(new RegExp(`<a\\b[^>]*href="[^"]*viewthread\\.php\\?tid=${col[0]}[^"]*"[^>]*>`, "gi"))]
      .map((m) => m[0]).join(" ");
    const COLOR_RE = /color\s*[:=]\s*["']?(#[0-9a-f]{3,8}|[a-z]+)/i;
    const titleColor = COLOR_RE.exec(linkTags)?.[1] ?? COLOR_RE.exec(rawTitle)?.[1];
    posts.push({
      id: col[0],
      title: htmlDecode(rawTitle.replace(/<[^>]*>/g, "")),
      color: titleColor,
      uid: col[2],
      author: removePercentEncoding(col[3]),
      at: atFull ?? col[4],
      replies: Number(col[5]) || 0,
      views: Number(col[6]) || 0,
      lastReplyBy: removePercentEncoding(col[7]),
      lastReplyAt: col[8],
      pinned: stickyIds.has(col[0]) || undefined,
      ...(fid ? { fid } : {}),
      ...(AGREE_MARK.test(row) ? { agreed: true } : {}),
      // agree.gif carries class="attach"; it is a points marker, not a picture attachment.
      ...(ATTACH_MARK.test(row) && !AGREE_MARK.test(row) ? { hasImages: true } : {}),
    });
  }
  if (order === "dateline") return posts;
  return stickyIds.size > 0 ? posts : markPinned(posts);
}

/**
 * Marks the pinned threads of a forum page. The page is sorted by last reply, newest first,
 * so a pinned thread shows up as an old one above a newer one. The pinned threads are the
 * top run before the last place where a thread's last reply is newer than the one above it.
 */
export function markPinned(posts: Post[]): Post[] {
  const times = posts.map((p) => forumTime(p.lastReplyAt));
  let boundary = 0;
  for (let i = 1; i < posts.length; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (a !== null && b !== null && b > a) boundary = i;
  }
  return posts.map((p, i) => ({ ...p, pinned: i < boundary || undefined }));
}

/**
 * The threads a title search returns (`search.php`). Its rows differ from a
 * forum page's: the title link sits in `th.subject`, the forum is named, and
 * the keyword's highlight tags are stripped from the title.
 */
export function parseSearchResults(html: string): Post[] {
  const posts: Post[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const id = /viewthread\.php\?tid=(\d+)/.exec(row)?.[1];
    const rawTitle = /<th class="subject">[\s\S]*?<a href="viewthread\.php\?tid=\d+[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(row)?.[1];
    if (!id || rawTitle === undefined) continue;
    const forum = /<td class="forum"><a href="forumdisplay\.php\?fid=(\d+)"/.exec(row)?.[1];
    const author = /<td class="author">[\s\S]*?<a href="space\.php\?uid=(\d+)">([^<]*)<\/a>[\s\S]*?<em>([^<]*)<\/em>/.exec(row);
    const nums = /<td class="nums"><strong>(\d+)<\/strong> \/ <em>(\d+)<\/em>/.exec(row);
    const last = /<td class="lastpost">[\s\S]*?<cite><a href="space\.php\?username=[^"]*">([^<]*)<\/a><\/cite>\s*<em><a[^>]*>([^<]*)<\/a><\/em>/.exec(row);
    posts.push({
      id,
      title: htmlDecode(rawTitle.replace(/<[^>]+>/g, "")).trim(),
      fid: forum,
      uid: author?.[1],
      author: author ? removePercentEncoding(author[2]) : undefined,
      at: author?.[3],
      replies: Number(nums?.[1]) || 0,
      views: Number(nums?.[2]) || 0,
      lastReplyBy: last ? removePercentEncoding(last[1]) : undefined,
      lastReplyAt: last?.[2],
      ...(AGREE_MARK.test(row) ? { agreed: true } : {}),
      ...(ATTACH_MARK.test(row) && !AGREE_MARK.test(row) ? { hasImages: true } : {}),
    });
  }
  return posts;
}

/**
 * The address of a search's next page, or undefined when the pager has none.
 *
 * Discuz keeps the whole query in the pager's own href — including the `searchid` the site
 * insists on before it will serve page 2 — so following that href is safer than rebuilding the
 * query from the parameters we happen to know. The forward link is marked `nxt` on the default
 * skin; a skin that only labels it is read by its text instead.
 */
export function searchNextHref(html: string): string | undefined {
  for (const tag of captureGroups(html, "<a\\b[^>]*>[\\s\\S]*?</a>")) {
    const href = /href="([^"]*)"/i.exec(tag)?.[1];
    if (!href) continue;
    const link = htmlDecode(href);
    if (!/search\.php\?/i.test(link)) continue;
    if (/\bnxt\b/i.test(tag) || /下一页|下页/.test(tag)) return link;
  }
  return undefined;
}

export type Author = { id: string; name: string; avatar: string };
export type Reply = {
  id: string;
  author: Author;
  at: string;
  /** The floor number (`#` in the page). */
  seq: number;
  /** The post's HTML body, as the page has it (Discuz's own markup). */
  body: string;
};

/** The replies on a thread page (`DiscuzAPI.loadReplies`). Bodies stay HTML:
 * the `TextView` renders HTML, so no Markdown conversion is needed. */
export function parseReplies(html: string): Reply[] {
  const replies: Reply[] = [];
  for (const row of html.split('<td class="postcontent postbottom">')) {
    const col = captureGroups(
      row,
      '<table id="pid(\\d+)".*?space\\.php\\?uid=(\\d+).*?>([^<]+)</a>.*href="space\\.php\\?uid=.*?<img src="([^"]+)".*<em>(\\d+)</em><sup>#</sup>.*<em id=.*?>发表于 ([^<]+)</em>.*(<div class="postmessage.*)$',
      true,
    );
    if (col.length === 0) continue;
    replies.push({
      id: col[0],
      author: { id: col[1], name: col[2], avatar: col[3] },
      at: col[5],
      seq: Number(col[4]) || -1,
      body: unescapeNumericEntities(col[6]),
    });
  }
  return replies;
}

/**
 * Undoes a second escaping of numeric character references (`&amp;#129309;` ->
 * `&#129309;`), which the reply pages use for emoji. Other text is left alone.
 */
export function unescapeNumericEntities(html: string): string {
  return html.replace(/&amp;(#x?[0-9a-fA-F]+;)/g, "&$1");
}

/** Makes relative `src` / `href` paths absolute against `base`, as the Swift
 * app's Markdown did with `baseURL`. Absolute, protocol-relative, `#` and
 * `javascript:` links are left alone. */
export function absolutize(html: string, base: string): string {
  return html.replace(/(src|href)="(?![a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)([^"]*)"/g, (_, attr: string, path: string) => {
    return `${attr}="${new URL(path, base).href}"`;
  });
}

/** The favorites page's threads (`DiscuzAPI.loadBookmarks`). */
export function parseBookmarks(html: string): Post[] {
  const posts: Post[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      '<a href="viewthread\\.php\\?tid=(\\d+).*?>([^<]+)</a>.*?<a href="forumdisplay\\.php\\?fid=(\\d+).*?>([^<]+)</a>.*?<td class="nums">(\\d+)</td>.*?space\\.php\\?username[^>]+>([^<]+)</a>.*?lastpost">([^<]+)</a>',
      true,
    );
    if (col.length === 0) continue;
    // The row's author cell links the poster's space by uid; that uid builds the avatar URL
    // directly, instead of resolving the name through a profile page (which often comes back
    // without a picture, leaving the row a blank grey square).
    const uid = /space\.php\?uid=(\d+)/.exec(row)?.[1];
    posts.push({
      id: col[0],
      title: htmlDecode(col[1]),
      fid: col[2],
      uid,
      replies: Number(col[4]) || 0,
      lastReplyBy: removePercentEncoding(col[5]),
      lastReplyAt: col[6],
      ...(ATTACH_MARK.test(row) ? { hasImages: true } : {}),
    });
  }
  return posts;
}

/**
 * The threads the signed-in user started (`my.php?item=threads`). A row names the
 * thread, its forum, and its last poster and date; the page shows no reply count.
 */
/**
 * The notices on `notice.php` (`ul.feed`). 4d4y's feed mixes several kinds of
 * row in that one list: `f_quote`, `f_manage`, `f_rate`, `f_reply`, `f_pin`,
 * `f_digest`, … (the site's CSS names fifteen `f_*` kinds) and plain rows
 * (a group change, etc.). Every kind gets a row; only rows with a thread link
 * can be opened as a thread, others are shown with their own text.
 * The list is deliberately scoped to `ul.feed`: the page also carries the
 * private messages' `ul.pm_list`, which is a different page entirely.
 */
export function parseNotices(html: string): Post[] {
  const out: Post[] = [];
  const seen = new Set<string>();
  const feed = /<ul class="feed">([\s\S]*?)<\/ul>/.exec(html)?.[1];
  if (!feed) return out;
  const param = (href: string, key: string): string =>
    new RegExp(`(?:[?&])${key}=([^&#]+)`).exec(href)?.[1] ?? "";
  for (const item of feed.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const body = item[1];
    // A notice's row opens with its own div (f_quote / f_manage / f_rate, or a
    // plain div). A row opening with an avatar link belongs to ul.pm_list.
    const open = /^\s*(?:<[^>]+>\s*)*<div\b([^>]*)>/.exec(body);
    if (!open) continue;
    const cls = /class="([^"]*)"/.exec(open[1])?.[1]?.trim() ?? "";
    const kind = cls.split(/\s+/).find((c) => /^f_[a-z]+$/.test(c)) ?? "";
    const author = /<a href="[^"]*space\.php[^"]*uid=\d+"[^>]*>([^<]+)<\/a>/.exec(body)?.[1] ?? "";
    const links = [...body.matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)]
      .map((m) => ({ href: m[1].replace(/&amp;/g, "&"), text: m[2].trim() }));
    const tid = /viewthread\.php[^"]*tid=(\d+)/.exec(body)?.[1] ?? "";
    // The "查看" link of a quote names the exact floor; "回复" and the thread
    // link only name the thread. Use the floor when the feed offers it.
    const findpost = links.find((l) => /redirect\.php/.test(l.href) && l.href.includes("goto=findpost"));
    const pid = findpost ? param(findpost.href, "pid") : "";
    const threadId = tid || (findpost ? param(findpost.href, "ptid") : "");
    const threadTitle = links.find((l) => /viewthread\.php/.test(l.href))?.text ?? "";
    const at = /<em>([^<]+)<\/em>/.exec(body)?.[1]?.trim() ?? "";
    const excerpt = [...body.matchAll(/<dd>([\s\S]*?)<\/dd>/g)]
      .map((m) => htmlDecode(m[1].replace(/<[^>]+>/g, "")).replace(/&nbsp;/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    // The row's own words, with the time, the links and the quoted summary
    // removed. A plain row (a group change) has nothing else to name it.
    const words = htmlToText(body
      .replace(/<em>[\s\S]*?<\/em>/g, "")
      .replace(/<dl\b[\s\S]*?<\/dl>/g, "")
      .replace(/<p\b[\s\S]*?<\/p>/g, "")
      .replace(/<\/?a\b[^>]*>/g, "")).trim();
    const key = `${threadId}|${kind}|${at}|${excerpt.slice(0, 24)}|${words.slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ACTIONS: Record<string, string> = {
      f_quote: "引用了您的帖子", f_manage: "对您的主题有管理操作", f_rate: "给您的帖子评分",
      f_reply: "回复了您的帖子", f_thread: "发布了新主题", f_buddy: "好友动态",
      f_pin: "您的主题被置顶", f_digest: "您的主题被加精", f_magic: "主题有道具动态",
      f_trade: "主题有交易动态", f_activity: "主题有活动动态", f_reward: "主题有悬赏动态",
      f_task: "有任务提醒", f_credit: "有积分动态", f_icon: "有新动态",
    };
    const action = ACTIONS[kind] ?? words ?? "有新提醒";
    const head = author && ACTIONS[kind] ? `${author} ${action}` : action;
    const detail = excerpt || (ACTIONS[kind] ? "" : words);
    out.push({
      id: threadId,
      title: head + (threadTitle ? ` · ${threadTitle}` : ""),
      author: author || "提醒",
      at,
      lastReplyAt: at,
      replies: 0,
      views: 0,
      excerpt: detail && detail !== head ? detail : undefined,
      ...(pid ? { focusPid: pid } : {}),
    });
  }
  return out;
}

export function parseMyThreads(html: string): Post[] {
  const posts: Post[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      'viewthread\\.php\\?tid=(\\d+)[^"]*"[^>]*>([^<]+)</a>.*?forumdisplay\\.php\\?fid=(\\d+)"[^>]*>([^<]+)</a>.*?space\\.php\\?username=([^"]*)"[^>]*>([^<]+)</a>.*?goto=lastpost#lastpost"[^>]*>([^<]+)</a>',
      true,
    );
    if (col.length === 0) continue;
    // As on the favorites page, the row's space link carries the uid that names the avatar.
    const uid = /space\.php\?uid=(\d+)/.exec(row)?.[1];
    posts.push({
      id: col[0],
      title: htmlDecode(col[1]).trim(),
      fid: col[2],
      uid,
      lastReplyBy: removePercentEncoding(col[5]),
      lastReplyAt: col[6],
      ...(ATTACH_MARK.test(row) ? { hasImages: true } : {}),
    });
  }
  return posts;
}

/**
 * The threads the signed-in user replied to (`my.php?item=posts`). Each reply is two
 * table rows: the first names the thread (its `redirect` link carries the thread id
 * `ptid`), its forum, and the reply time; the next row holds the start of the reply
 * in a `th.lighttxt` cell spanning the columns.
 */
export function parseMyReplies(html: string): Post[] {
  const posts: Post[] = [];
  let last: Post | undefined;
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      'redirect\\.php\\?goto=findpost(?:&amp;|&)pid=\\d+(?:&amp;|&)ptid=(\\d+)"[^>]*>([^<]+)</a>.*?forumdisplay\\.php\\?fid=(\\d+)"[^>]*>[^<]*</a>.*?(\\d{4}-\\d{1,2}-\\d{1,2} \\d{1,2}:\\d{2})',
      true,
    );
    if (col.length > 0) {
      last = {
        id: col[0], title: htmlDecode(col[1]).trim(), fid: col[2], at: col[3], excerpt: "",
        ...(ATTACH_MARK.test(row) ? { hasImages: true } : {}),
      };
      posts.push(last);
      continue;
    }
    const text = /<th[^>]*class="lighttxt"[^>]*>([\s\S]*?)<\/th>/.exec(row)?.[1];
    // The list escapes the reply's entities twice (`&amp;#128077;`), so a second pass
    // turns them into the characters they stand for.
    if (last && text !== undefined) last.excerpt = htmlDecode(htmlDecode(text.replace(/<[^>]+>/g, ""))).trim();
  }
  return posts;
}

/** One private message in a conversation: its sender, when, its HTML body, and the sender's avatar. */
export type PmMessage = { author: string; at: string; body: string; avatar?: string };

const PM_TIME = /\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}/;

/**
 * The correspondents in the private messages (`pm.php?filter=privatepm`): one row per
 * person, with the time of the latest message. Shaped as thread rows, so the list shows
 * them the same way; the row's title is the person's name.
 */
export function parsePmUsers(html: string): Post[] {
  const posts: Post[] = [];
  // 4d4y's pm.php shows the correspondents in ul.pm_list. `filter=newpm` is the
  // unread-only view (and is empty when nothing is unread); `privatepm` is the
  // full conversation list. Either way, no other li on the page is a contact.
  const list = /<ul class="pm_list">([\s\S]*?)<\/ul>/.exec(html)?.[1];
  if (!list) return posts;
  for (const item of captureGroups(list, "<li[^>]*>.*?</li>")) {
    const uid = /pm\.php\?uid=(\d+)(?:&amp;|&)filter=privatepm/.exec(item)?.[1];
    // The name is the link in `cite`; the latest message's time follows it.
    const name = /<cite><a href="space\.php\?uid=\d+"[^>]*>([^<]+)<\/a><\/cite>/.exec(item)?.[1];
    const at = PM_TIME.exec(item)?.[0];
    if (!uid || !name || !at) continue;
    const decoded = htmlDecode(name).trim();
    posts.push({ id: uid, uid, title: decoded, author: decoded, at, excerpt: "" });
  }
  return posts;
}

/**
 * The messages with one correspondent (`pm.php?uid=N`), in the order the page lists them.
 * Each message is an `li`: its sender in `cite`, the time after it, the text in
 * `div.summary`, and the sender's avatar image. Date headings are `li`s without a sender.
 */
export function parsePmConversation(html: string): PmMessage[] {
  const messages: PmMessage[] = [];
  const list = /<ul class="pm_list">([\s\S]*?)<\/ul>/.exec(html)?.[1];
  if (!list) return messages;
  for (const item of captureGroups(list, "<li[^>]*>.*?</li>")) {
    const author = /<cite>([\s\S]*?)<\/cite>/.exec(item)?.[1];
    const at = PM_TIME.exec(item)?.[0];
    const summary = /<div class="summary">([\s\S]*?)<\/div>/.exec(item)?.[1];
    if (!author || !at || summary === undefined) continue;
    const avatar = /<img src="([^"]+)"/.exec(item)?.[1];
    messages.push({
      author: htmlToText(author),
      at,
      // Line breaks in the source are layout whitespace; only `<br>` makes a new line.
      // The body stays HTML, as a thread reply's does, so both views decode it the same way.
      body: unescapeNumericEntities(summary),
      avatar: avatar ? htmlDecode(avatar) : undefined,
    });
  }
  return messages;
}

/** A login page's security questions (`logging.php?action=login`): the value the form posts as
 * `questionid`, and the question it asks. The forum's own list is used when the page has one. */
export function parseLoginQuestions(html: string): { id: number; text: string }[] {
  const select = /<select[^>]*name="questionid"[^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1];
  if (!select) return [];
  const questions: { id: number; text: string }[] = [];
  for (const m of select.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/gi)) {
    const text = htmlDecode(m[2]).trim();
    if (text) questions.push({ id: Number(m[1]), text });
  }
  return questions;
}

/** The user page's UID and avatar (`DiscuzAPI.loadUser`). Reads the two
 * independently so their order on the page does not matter. */
export function parseUser(html: string, name: string): Author | undefined {
  // Discuz prints `(UID: 123)`, but the space page's own markup varies; a bare `UID: 123`
  // or a `space.php?uid=` link names the same member, and either is enough for the avatar URL.
  const uid =
    /\(UID: (\d+)\)/.exec(html)?.[1] ??
    /\bUID:\s*(\d+)/.exec(html)?.[1] ??
    /space\.php\?uid=(\d+)/.exec(html)?.[1] ??
    "";
  const avatar =
    /<div class="avatar">\s*<img[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1] ??
    /class="avatar"[^>]*>[\s\S]*?<img[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1] ??
    "";
  if (!uid && !avatar) return undefined;
  return { id: uid, name, avatar: avatar ? htmlDecode(avatar) : "" };
}

/** What a user's profile page says about them, for the account menu. A field the page lacks is absent. */
export type Profile = {
  avatar?: string;
  group?: string;
  registered?: string;
  lastVisit?: string;
  lastPost?: string;
  postLevel?: string;
  readPermission?: string;
  posts?: string;
  dailyPosts?: string;
  essence?: string;
  pageViews?: string;
  onlineTotal?: string;
  onlineThisMonth?: string;
  credits?: string;
  prestige?: string;
  money?: string;
};

/** The profile page's fields (`space.php?username=`), each read from its own line. */
export function parseProfile(html: string, name: string): Profile {
  const field = (pattern: string): string | undefined => {
    const value = captureGroups(html, pattern, true)[0]?.trim();
    return value ? htmlDecode(value) : undefined;
  };
  return {
    avatar: parseUser(html, name)?.avatar,
    group: field('用户组: <a[^>]*>([^<]+)</a>'),
    registered: field('<li>注册日期: ([^<]+)</li>'),
    lastVisit: field('<li>上次访问: ([^<]+)</li>'),
    lastPost: field('<li>最后发表: ([^<]+)</li>'),
    postLevel: field('<li>发帖数级别: ([^<]*?)\\s*(?:<img[^>]*>\\s*)?</li>'),
    readPermission: field('<li>阅读权限: ([^<]+)</li>'),
    posts: field('<li>帖子: (\\d+) 篇'),
    dailyPosts: field('平均每日发帖: ([^<]+?) 篇'),
    essence: field('<li>精华: (\\d+) 篇'),
    pageViews: field('<li>页面访问量: (\\d+)'),
    onlineTotal: field('总计在线 <em>([^<]+)</em> 小时'),
    onlineThisMonth: field('本月在线 <em>([^<]+)</em> 小时'),
    credits: field('<h3 class="blocktitle lightlink">积分: (\\d+)</h3>'),
    prestige: field('威望: (\\d+)'),
    money: field('金钱: (\\d+)'),
  };
}

/**
 * A page's HTML as plain text, for quoting (the Swift app quotes Markdown). Whitespace
 * reads as a browser shows it: the line breaks and indentation in the markup are spaces,
 * `<br>` and block ends are line breaks, and runs of blank lines collapse to one.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/\r?\n/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return htmlDecode(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The floor a 4d4y `findpost` link opens (`redirect.php?goto=findpost&pid=…&ptid=…`, the arrow
 * of a quote): its post and thread. Any other link gives `undefined`.
 */
export function floorFromLink(href: string): { pid: string; ptid: string } | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.hostname !== "4d4y.com" && !url.hostname.endsWith(".4d4y.com")) return undefined;
  if (!/(^|\/)redirect\.php$/.test(url.pathname) || url.searchParams.get("goto") !== "findpost") return undefined;
  const pid = url.searchParams.get("pid");
  const ptid = url.searchParams.get("ptid");
  if (!pid || !ptid || !/^\d+$/.test(pid) || !/^\d+$/.test(ptid)) return undefined;
  return { pid, ptid };
}

/**
 * Appends a fetched page to the list. Paging ends when a page is empty, or when
 * its first item is already loaded: past its end, Discuz serves the last page
 * again. A short page is not an end, since the page size is the forum's own
 * setting and not always the same as the one asked for.
 */
export function mergePage<T extends { id: string }>(
  loaded: T[],
  incoming: T[],
): { items: T[]; more: boolean } {
  if (incoming.length === 0) return { items: loaded, more: false };
  // Discuz repeats its sticky threads at the top of every page, so a page can start with a
  // thread already listed and still hold new ones. The list ends only when nothing is new
  // (a page past the end repeats the last one it has).
  const seen = new Set(loaded.map((x) => x.id));
  const fresh = incoming.filter((x) => !seen.has(x.id));
  if (fresh.length === 0) return { items: loaded, more: false };
  return { items: [...loaded, ...fresh], more: true };
}

/** An absolute URL for a path on the forum (`DiscuzAPI`'s relative paths). */
export function absoluteUrl(path: string, base: string): string {
  return new URL(path, base).href;
}

/**
 * The thread a 4d4y link opens: `viewthread.php?tid=` or `forum.php?mod=viewthread&tid=`
 * on `4d4y.com` or one of its subdomains. Any other link gives `undefined`.
 */
export function threadIdFromLink(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.hostname !== "4d4y.com" && !url.hostname.endsWith(".4d4y.com")) return undefined;
  const isThread =
    /(^|\/)viewthread\.php$/.test(url.pathname) || (/(^|\/)forum\.php$/.test(url.pathname) && url.searchParams.get("mod") === "viewthread");
  const tid = url.searchParams.get("tid");
  if (!isThread || !tid || !/^\d+$/.test(tid)) return undefined;
  return tid;
}

/**
 * A thread page's title and forum (`fid`), as the page names them: the subject
 * heading, else the page `<title>` (`subject - channel - site`) without its
 * site and channel suffixes.
 */
export function parseThreadPageInfo(html: string): { title?: string; fid?: string; lastPage?: number } {
  const subject = /<span id="thread_subject">([\s\S]*?)<\/span>/.exec(html)?.[1];
  const pageTitle = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const fid = /forumdisplay\.php\?fid=(\d+)/.exec(html)?.[1];
  let fromTitle = pageTitle?.replace(/\s+-\s+[^-]*$/, "");
  const channel = fid ? new RegExp(`forumdisplay\\.php\\?fid=${fid}"[^>]*>([^<]+)</a>`).exec(html)?.[1]?.trim() : undefined;
  if (fromTitle && channel) {
    const suffix = ` - ${htmlDecode(channel)}`;
    if (htmlDecode(fromTitle).endsWith(suffix)) fromTitle = htmlDecode(fromTitle).slice(0, -suffix.length);
  }
  const title = subject ? htmlDecode(subject.replace(/<[^>]*>/g, "")).trim() : fromTitle ? htmlDecode(fromTitle).trim() : undefined;
  // Only add the key when the pager names it, so a page without one keeps the shape callers knew.
  const lastPage = parseLastPage(html);
  return { title: title || undefined, fid, ...(lastPage !== undefined ? { lastPage } : {}) };
}

/**
 * A thread's last page. Discuz's pager prints `当前页/总页数` in
 * `<em id="page">2/9</em>`; failing that, the largest `page=` a pager link asks
 * for. `undefined` when the page carries no pager (a one-page thread, or a
 * signed-out notice), so the jump-to-last control simply scrolls to the end.
 */
export function parseLastPage(html: string): number | undefined {
  const marked = /<em[^>]*id="page"[^>]*>\s*\d+\s*\/\s*(\d+)\s*<\/em>/i.exec(html)?.[1];
  let last = marked ? Number(marked) : 0;
  for (const m of html.matchAll(/(?:[?&]|&amp;)page=(\d+)/gi)) last = Math.max(last, Number(m[1]));
  return last > 0 ? last : undefined;
}

/** Drops the empty lines a post starts with (`<br>`, or empty paragraphs and
 * blocks), which would otherwise show as a blank band under the author line. */
export function trimLeadingBlanks(html: string): string {
  let out = html;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/^\s*(?:<br\s*\/?>|<(p|div|span)\b[^>]*>(?:\s|&nbsp;)*<\/\1>)/i, "");
  } while (out !== previous);
  return out;
}

/** A copy of `src` that is sharp enough for `px` device pixels, from what the forum can serve.
 *
 *  `…&size=300x300` (a Discuz that resizes on demand): raise the number to the column's width, so
 *  the picture is sharp at 1:1 and still a resized copy. 4D4Y runs Discuz! 7.2 and serves one
 *  fixed thumbnail instead — `name.jpg.thumb.jpg`, measured at 800x600 and 55-86 KB — with the
 *  3-5 MB upload behind `zoom()`. That thumbnail is kept: it is 1.3x from the column's width on a
 *  phone, and swapping in the upload to remove that last bit of softness would cost tens of times
 *  the bytes and memory. The upload is what the zoomable viewer opens, where sharpness matters.
 *  Anything else is left alone: a size we cannot control must not be guessed at. */
function sharperCopy(src: string, px: number): string {
  const sized = /([?&]size=)(\d+)(?:x(\d+))?/i.exec(src);
  if (!sized) return src;
  const width = Number(sized[2]);
  if (!Number.isFinite(width) || width >= px) return src;
  return src.slice(0, sized.index) + `${sized[1]}${px}x${px}` + src.slice(sized.index + sized[0].length);
}

/** A link typed as plain text ("https://m.tb.cn/…", "www.example.com") is not an anchor, so the
 *  text view reports no press on it and the app cannot open it. Wrap those in an anchor: only the
 *  text between tags is touched, and text already inside an anchor is left as it is, so a link the
 *  forum wrote is never wrapped twice. A trailing punctuation mark stays outside the anchor.
 */
export function linkifyBareUrls(html: string): string {
  const parts = html.split(/(<[^>]*>)/);
  let open = 0;
  let out = "";
  for (const part of parts) {
    if (part.startsWith("<")) {
      if (/^<a\b/i.test(part)) open++;
      else if (/^<\/a\s*>/i.test(part)) open = Math.max(0, open - 1);
      out += part;
      continue;
    }
    out += open > 0 ? part : linkifySegment(part);
  }
  return out;
}

// A URL in running text: the scheme (or a bare `www.`), then everything that cannot end one.
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>"'`\u3000-\u303f\uff01-\uff5e]+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

function linkifySegment(text: string): string {
  return text.replace(BARE_URL, (match: string) => {
    const url = match.replace(TRAILING, "");
    if (!url || url.length < 8) return match;
    const href = (url.startsWith("www.") ? `https://${url}` : url).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const tail = match.slice(url.length);
    return `<a href="${href}">${url}</a>${tail}`;
  });
}

/** The pictures of a Discuz post. Discuz wraps a picture as
 * `<a href="javascript:;"><img onclick="zoom(this, 'full.jpg')" src="thumb">`;
 * the full picture is in `zoom`, else `file=`, else `src=` (a placeholder such
 * as a loading image is skipped for `file=`). A picture is its own block that
 * fills the column; smilies keep their size. */
export function fixImages(html: string, displayPx = 0): string {
  // Discuz's hidden attachment spans and their menus are not content: the
  // TextView does not hide `display: none`, so they would show (as the small
  // attachment icons).
  // Discuz lays the body out in a table: a picture's percentage width would
  // then resolve against the cell's content, so the table becomes plain blocks.
  const flat = html.replace(/<(table|tr|td|th)\b[^>]*>/gi, "<div>").replace(/<\/(table|tr|td|th)>/gi, "</div>");
  const visible = flat
    .replace(/<span\b[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "")
    // A block that links a file is kept: the file's link is how the post offers it.
    .replace(/<div class="t_attach"[\s\S]*?<\/div>\s*<\/div>/gi, (block) => (attachmentLinks(block).length > 0 ? block : ""));
  // A script-only link around a picture is just the picture.
  const unwrapped = visible.replace(/<a\b[^>]*href="javascript:[^"]*"[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi, "$1");
  return unwrapped.replace(/<img\b([^>]*)>/gi, (whole, attrs: string) => {
    const src = /\bsrc="([^"]*)"/i.exec(attrs)?.[1];
    const file = /\bfile="([^"]+)"/i.exec(attrs)?.[1];
    const zoom = /zoom\(this,\s*'([^']+)'/i.exec(attrs)?.[1];
    const placeholder = !src || /loading|none\.gif|common\/|smilies\//i.test(src);
    // `zoom()` points at the multi-megabyte original. The page already carries
    // a small copy for display; use it here and keep the original only for the
    // full-screen viewer, so a picture appears quickly on a phone connection.
    const small = placeholder ? (file ?? src) : src;
    const full = zoom ?? small;
    if (!small) return whole;
    if (/images\/(default|attachicons|common)\//i.test(small)) return "";
    if (/smilies\//i.test(small)) {
      const kept = attrs
        .replace(/\bsrc="[^"]*"/i, "")
        .replace(/\bfile="[^"]*"/i, "")
        .replace(/\bonclick="[^"]*"/i, "")
        .replace(/\s+/g, " ").trim();
      return `<img src="${small}"${kept ? " " + kept : ""}>`;
    }
    // A picture fills the column, so it is drawn at that column's pixel width. The page's copy is
    // sized for a desktop sidebar — a 300-pixel thumbnail stretched over a 1000-pixel column is
    // exactly what read as "soft". Ask for a copy that fits the column instead (sharper at 1:1,
    // still a resized copy so it stays fast). A tap opens the original in the zoomable viewer.
    // No inline style: the text view's HTML reader did not take it, and a body laid out at the
    // picture's own size pushed the players out of reach.
    const body = displayPx > 0 ? sharperCopy(small, displayPx) : small;
    const original = absoluteUrl(full ?? small, HOST_BASE);
    const kept = attrs
      .replace(/\bsrc="[^"]*"/i, "")
      .replace(/\bfile="[^"]*"/i, "")
      .replace(/\bonclick="[^"]*"/i, "")
      .replace(/\s(width|height)="[^"]*"/gi, "")
      .replace(/\s+/g, " ").trim();
    return `<p><a href="${original}"><img src="${body}"${kept ? " " + kept : ""} width="100%"></a></p>`;
  });
}

// Discuz's `[size=N]` as the pixel size of the font (1 to 7).
const FONT_SIZES = [10, 13, 16, 18, 24, 32, 48];

/** Index just past the `</div>` that closes the `<div>` whose content starts at `from`, or -1. */
function closingDivEnd(html: string, from: number): number {
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = from;
  let depth = 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A URL for an HTML attribute value: `&`, `"`, `<` and `>` escaped so a query string survives. */
const escapeAttr = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The lines of a Discuz `[code]` block: each `<li>` is a line (closing tag optional), with the
 * copy button's label dropped and the newlines the markup puts around each line removed. */
function codeLines(inner: string): string[] {
  const withoutButton = inner.replace(/<([a-z]+)\b[^>]*>\s*复制代码\s*<\/\1>/gi, "").replace(/复制代码/g, "");
  const parts = withoutButton.split(/<li\b[^>]*>/i);
  const lines =
    parts.length > 1
      ? parts.slice(1).map((part) => part.replace(/<\/li\s*>[\s\S]*$/i, "").replace(/<\/?ol\b[^>]*>[\s\S]*$/i, ""))
      : withoutButton.replace(/<br\s*\/?>/gi, "\n").split("\n").filter((line) => line.trim() !== "");
  return lines.map((line) => htmlDecode(line.replace(/<[^>]+>/g, "")).replace(/^[\r\n]+|[\r\n]+$/g, ""));
}

/** Discuz's `[code]` block as one monospace block, every line kept as written. */
function codeBlockHtml(inner: string): string {
  return `<pre><code>${escapeHtml(codeLines(inner).join("\n"))}</code></pre>`;
}

/** Discuz's `[code]` (a `div.blockcode` of numbered lines) rewritten as a `<pre><code>` block, which the
 * TextView shows in monospace with its line breaks kept. The other BBCode the forum renders as HTML (`<font>`
 * for color and size, links, pictures, quotes) is left for the TextView's extensions and its own parsing.
 * Run after `fixImages`. */
export function fixDiscuzMarkup(html: string): string {
  let out = "";
  let at = 0;
  const codeOpen = /<div\b[^>]*class="blockcode"[^>]*>/gi;
  for (let m = codeOpen.exec(html); m; m = codeOpen.exec(html)) {
    const end = closingDivEnd(html, m.index + m[0].length);
    if (end < 0) break;
    const inner = html.slice(m.index + m[0].length, end - "</div>".length);
    out += html.slice(at, m.index) + codeBlockHtml(inner);
    at = end;
    codeOpen.lastIndex = end;
  }
  return (out + html.slice(at))
    // A media embed (an iframe, or the forum's [media] BBCode left as text) draws as nothing in
    // the text view: a link stands in its place, and the player under the post plays it.
    .replace(/<iframe\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/iframe>/gi, (_, src: string) => `<p><a href="${src}">▶ ${src}</a></p>`)
    .replace(/\[media(?:=[^\]]*)?\]([\s\S]*?)\[\/media\]/gi, (_, body: string) => `<p><a href="${body.trim()}">▶ ${body.trim()}</a></p>`);
}

/** The style of a Discuz `<font>` (`[color=…]` and `[size=N]`): a hex or a plain color name, and the font size in pixels. */
export function discuzFontStyle(attributes: Record<string, string>): { color?: string; fontSize?: number } {
  const color = attributes.color?.trim() ?? "";
  const size = Number(attributes.size);
  const style: { color?: string; fontSize?: number } = {};
  if (/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(color)) style.color = color;
  if (Number.isInteger(size) && size >= 1 && size <= FONT_SIZES.length) style.fontSize = FONT_SIZES[size - 1];
  return style;
}

/** A post's file attachment: the link's address (as the page has it) and the file name it shows. */
export type Attachment = { url: string; name: string };

// `<a href="…">name</a>` whose text has no picture in it.
const LINK_WITH_TEXT = /<a\b[^>]*?\bhref="([^"]*)"[^>]*>((?:(?!<img\b)[\s\S])*?)<\/a>/gi;

/**
 * The file attachments a post links to. Discuz links each one to its download page
 * (`attachment.php?aid=` or `forum.php?mod=attachment&aid=`), named by its link text. A
 * picture's link wraps an `<img>`, so it is not a file and is left to `fixImages`.
 */
export function attachmentLinks(html: string): Attachment[] {
  const files: Attachment[] = [];
  for (const [, href, inner] of html.matchAll(LINK_WITH_TEXT)) {
    const url = htmlDecode(href);
    if (!isAttachmentUrl(url)) continue;
    const name = htmlDecode(inner.replace(/<[^>]*>/g, "")).trim();
    if (name) files.push({ url, name });
  }
  return files;
}

/**
 * Whether a link is a Discuz attachment download on `4d4y.com` (or a subdomain), over http
 * or https. A relative link is the forum's own (resolved against `HOST_BASE`).
 */
export function isAttachmentUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, HOST_BASE);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.hostname !== "4d4y.com" && !url.hostname.endsWith(".4d4y.com")) return false;
  return /(^|\/)(attachment|attach)\.php$/.test(url.pathname) || url.searchParams.get("mod") === "attachment";
}

/** The forum's base URL, for relative paths (`DiscuzAPI.host`). */
export const HOST_BASE = "https://www.4d4y.com/forum/";

/** The attachment id Discuz gives a block (`aid123`) or its link (`aid=123`), if either is there. */
function attachmentId(html: string): string | undefined {
  return /\bid="aid(\d+)"/i.exec(html)?.[1] ?? /\baid=(\d+)/i.exec(html)?.[1];
}

/** The first attachment a fragment links to, whether or not its link carries a name. */
function firstAttachmentUrl(html: string): string | undefined {
  const files = attachmentLinks(html);
  if (files.length > 0) return files[0].url;
  for (const [, href] of html.matchAll(LINK_WITH_TEXT)) {
    const url = htmlDecode(href);
    if (isAttachmentUrl(url)) return url;
  }
  return undefined;
}

/** A picture that fills the column and opens its own picture on a press, as `fixImages` draws one. */
function pictureBlock(url: string): string {
  const src = escapeAttr(absoluteUrl(url, HOST_BASE));
  return `<p><a href="${src}"><img src="${src}" width="100%"></a></p>`;
}

/** A fragment's attachment links that are pictures, each replaced by the picture itself. */
function anchorsToPictures(html: string, isPicture: (url: string) => boolean): string {
  return html.replace(LINK_WITH_TEXT, (whole: string, href: string) => {
    const url = htmlDecode(href);
    if (!isAttachmentUrl(url) || !isPicture(url)) return whole;
    return pictureBlock(url);
  });
}

/**
 * A post's attachments that are pictures, drawn in the post where Discuz only offers their
 * download: a picture the author attached without putting it in the text (`[attach]` rather than
 * `[attachimg]`) arrives as a line reading 下载 (310.76 KB) and its date, the forum's own menu for
 * the attachment — nothing to look at. Such a block, and a bare link to the same, becomes the
 * picture. `isPicture` answers whether an attachment at that address is a picture the app can
 * load (see `attachPictures`), so a file stays the download it was; a picture the post already
 * shows (`aimg_<id>`) is left alone, never drawn twice.
 *
 * Run last, on the HTML the text view draws: the addresses are absolute by then.
 */
export function showAttachedPictures(html: string, isPicture: (url: string) => boolean): string {
  let out = "";
  let at = 0;
  const blocks = /<div\b[^>]*\bclass=(?:"[^"]*\bt_attach\b[^"]*"|'[^']*\bt_attach\b[^']*')[^>]*>/gi;
  for (const m of html.matchAll(blocks)) {
    const start = m.index ?? 0;
    const end = closingDivEnd(html, start + m[0].length);
    if (end < 0) continue;
    out += anchorsToPictures(html.slice(at, start), isPicture);
    const block = html.slice(start, end);
    const url = firstAttachmentUrl(block);
    const id = attachmentId(block);
    const shown = id ? html.includes(`aimg_${id}`) : false;
    out += url && !shown && isPicture(url) ? pictureBlock(url) : block;
    at = end;
  }
  return out + anchorsToPictures(html.slice(at), isPicture);
}
