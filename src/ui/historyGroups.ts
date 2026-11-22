import type { Post } from "../discuz/parse";

/** A thread opened in the app: the thread as its list showed it, and when it was opened (ms since the epoch). */
export interface HistoryEntry {
  post: Post;
  viewed: number;
}

/** A section of the history: its title and its threads, newest first. */
export interface HistorySection {
  title: string;
  posts: Post[];
}

const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

/** The section a view opened at `viewed` falls in, as `now` sees it: Today, Yesterday, This week,
 * Last week, This month, Last month, then each earlier month as "September 2026". */
export function browseSection(viewed: number, now: Date): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const sinceMonday = (now.getDay() + 6) % 7;
  if (viewed >= at(y, m, d)) return "今天";
  if (viewed >= at(y, m, d - 1)) return "昨天";
  if (viewed >= at(y, m, d - sinceMonday)) return "本周";
  if (viewed >= at(y, m, d - sinceMonday - 7)) return "上周";
  if (viewed >= at(y, m, 1)) return "本月";
  if (viewed >= at(y, m - 1, 1)) return "上月";
  return new Date(viewed).toLocaleString("en-US", { month: "long", year: "numeric" });
}

/** The history in sections, in the order the entries are given: a section starts where the
 * next entry falls in a different section. Entries are sorted newest first before grouping. */
export function groupHistory(entries: HistoryEntry[], now: Date): HistorySection[] {
  const sorted = [...entries].sort((a, b) => b.viewed - a.viewed);
  const sections: HistorySection[] = [];
  for (const e of sorted) {
    const title = browseSection(e.viewed, now);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.posts.push(e.post);
    else sections.push({ title, posts: [e.post] });
  }
  return sections;
}
