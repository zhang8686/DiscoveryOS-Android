import { request } from "./client";

export interface NoticeCounts {
  /** 短消息未读：私人消息 + 公共消息. -1 when neither count was on the page. */
  pm: number;
  /** 提醒未读：系统消息 + 好友消息 + 帖子消息. -1 when none were on the page. */
  notice: number;
}

const PRIVATE = /私人消息\s*\((\d+)\)/;
const PUBLIC = /公共消息\s*\((\d+)\)/;
const SYSTEM = /系统消息\s*\((\d+)\)/;
const FRIEND = /好友消息\s*\((\d+)\)/;
const THREAD = /帖子消息\s*\((\d+)\)/;

function num(re: RegExp, html: string): number {
  const m = re.exec(html);
  return m ? Number(m[1]) : -1;
}

/** The two aggregated unread counts on a page, or null when none were present. */
export function parseNoticeCounts(html: string): NoticeCounts | null {
  const priv = num(PRIVATE, html);
  const pub = num(PUBLIC, html);
  const sys = num(SYSTEM, html);
  const fri = num(FRIEND, html);
  const thr = num(THREAD, html);
  const pm = priv < 0 && pub < 0 ? -1 : Math.max(priv, 0) + Math.max(pub, 0);
  const notice = sys < 0 && fri < 0 && thr < 0 ? -1 : Math.max(sys, 0) + Math.max(fri, 0) + Math.max(thr, 0);
  if (pm < 0 && notice < 0) return null;
  return { pm, notice };
}

/** Reads the counts, trying the index first (it carries all five) and falling
 * back to notice.php (提醒) and pm.php (短消息) so one blocked page cannot hide
 * the other badge. Returns null on total failure so the caller keeps what it had
 * (no badge flashes to 0). */
export async function loadNoticeCounts(): Promise<NoticeCounts | null> {
  let pm = -1;
  let notice = -1;
  for (const path of ["", "notice.php", "pm.php?filter=privatepm"]) {
    if (pm >= 0 && notice >= 0) break;
    try {
      const counts = parseNoticeCounts(await request("GET", path));
      if (!counts) continue;
      if (pm < 0 && counts.pm >= 0) pm = counts.pm;
      if (notice < 0 && counts.notice >= 0) notice = counts.notice;
    } catch {
    }
  }
  if (pm < 0 && notice < 0) return null;
  return { pm, notice };
}

/** Marks every notice read, so the badge clears for good (the web page clears with it). The link
 *  is read from the notice page: Discuz skins name the action differently. */
export async function markNoticesRead(): Promise<void> {
  try {
    const page = await request("GET", "notice.php");
    const found = page.match(/href="([^"]*markread[^"]*)"/i);
    if (!found) return;
    const link = found[1].replace(/&amp;/g, "&").replace(/^https?:\/\/[^/]+/, "").replace(/^\//, "");
    await request("GET", link);
  } catch {
  }
}
