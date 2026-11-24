import { expect, test } from "nsh/test";
import { channelsRailed, foldSwipeIntent, RAIL_BELOW } from "./channelRail";

test("a wide window with the column open shows the full column", () => {
  expect(channelsRailed(1200, false)).toBe(false);
});

test("a folded column is a rail at any width", () => {
  expect(channelsRailed(1200, true)).toBe(true);
});

test("a window narrower than the breakpoint is a rail even when not folded", () => {
  expect(channelsRailed(RAIL_BELOW - 1, false)).toBe(true);
  expect(channelsRailed(RAIL_BELOW, false)).toBe(false);
});

test("a right swipe opens the column and a left one folds it", () => {
  expect(foldSwipeIntent(80, 0, 1200)).toBe("open");
  expect(foldSwipeIntent(0, 900, 1200)).toBe("open");
  expect(foldSwipeIntent(-80, 0, 1200)).toBe("fold");
  expect(foldSwipeIntent(0, -900, 1200)).toBe("fold");
});

test("a short, slow drag asks for nothing", () => {
  expect(foldSwipeIntent(40, 300, 1200)).toBe(null);
  expect(foldSwipeIntent(-40, -300, 1200)).toBe(null);
  expect(foldSwipeIntent(0, 0, 1200)).toBe(null);
});

test("a narrow window has no fold to swing: a swipe there asks for nothing", () => {
  expect(foldSwipeIntent(200, 1200, RAIL_BELOW - 1)).toBe(null);
  expect(foldSwipeIntent(-200, -1200, RAIL_BELOW - 1)).toBe(null);
});
