import { expect, test } from "nsh/test";
import { clampDockY } from "./threadDock";

test("a short window has no room to lift the cluster", () => {
  expect(clampDockY(500, 300)).toBe(0);
  expect(clampDockY(40, 300)).toBe(0);
});

test("a tall window allows lifting up to just below the title bar", () => {
  const height = 1000;
  const top = height - 104 - 160 - 56;
  expect(clampDockY(top + 100, height)).toBe(top);
  expect(clampDockY(top - 10, height)).toBe(top - 10);
});

test("the saved spot never drops past the reply box", () => {
  expect(clampDockY(-100, 1000)).toBe(-32);
  expect(clampDockY(-20, 1000)).toBe(-20);
  expect(clampDockY(0, 1000)).toBe(0);
});
