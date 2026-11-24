import { Storage, signal } from "nsh";

const KEY = "visual:channels-collapsed";

/** Below this window width the channel column is always a rail. */
export const RAIL_BELOW = 900;
export const FULL_WIDTH = 168;
export const RAIL_WIDTH = 56;

const collapsed = signal(false);

Storage.getItem(KEY)
  .then((saved) => collapsed.set(saved === "1"))
  .catch(() => undefined);

/** Whether the user has folded the channel column (tracked). */
export const channelsCollapsed = () => collapsed();

/** Folds the channel column, or opens it again, and remembers it. */
export function toggleChannelsCollapsed(): void {
  const next = !collapsed();
  collapsed.set(next);
  Storage.setItem(KEY, next ? "1" : "0").catch(() => undefined);
}

/** Whether the channel column shows as a rail: folded by the user, or the window
 * is too narrow for the full column. */
export function channelsRailed(windowWidth: number, folded: boolean): boolean {
  return folded || windowWidth < RAIL_BELOW;
}

/** How far (dp) a swipe must travel, or how fast (dp/s) it must be, to count as
 * meant: below this a drag is a scroll that started sideways. */
const SWIPE_DISTANCE = 60;
const SWIPE_VELOCITY = 700;

/**
 * What a horizontal swipe over the home's columns asks for: a right swipe opens
 * the folded column and a left one folds it again, the two being the mirror of
 * each other.
 *
 * The width is the caller's business: the side-by-side home only shows the fold
 * when the window is wide enough for the full column, while portrait's boards
 * pane lays the column out either way and folds there too.
 */
export function foldSwipeIntent(dx: number, vx: number): "open" | "fold" | null {
  if (dx > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) return "open";
  if (dx < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) return "fold";
  return null;
}
