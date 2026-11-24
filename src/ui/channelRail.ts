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
 * A window narrower than {@link RAIL_BELOW} has one state only (the rail, folded
 * or not), so a swipe there asks for nothing: it must not leave a fold saved
 * that nothing on screen shows.
 */
export function foldSwipeIntent(dx: number, vx: number, windowWidth: number): "open" | "fold" | null {
  if (windowWidth < RAIL_BELOW) return null;
  if (dx > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) return "open";
  if (dx < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) return "fold";
  return null;
}
