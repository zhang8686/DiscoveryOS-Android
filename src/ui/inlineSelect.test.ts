import { expect, open, test } from "nsh/test";
import { createDoubleTap, createFinish } from "./InlineTextSelect";

test("a long press on the body opens the floor's text in a read-only input", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  expect(app.shows("id:inline-select-body")).toBe(false);
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  expect(app.value("id:inline-select-body")).toBe("第一行\n第二行 abc");
  // Read-only: the platform selects and copies, the person cannot change it.
  expect(app.enabled("id:inline-select-body")).toBe(false);
});

test("the input is as tall as its text, not as the row it replaced", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // Two lines of the default body (15pt, ×1.5) is 46 points, and the input takes the text's own
  // height — what the bug left was the list row's whole height: hundreds of points of blank under
  // the last line.
  const box = app.layout("id:inline-select-body");
  expect(box).not.toBe(null);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeLessThanOrEqual(52);
});

test("a press outside the input puts the rich body back", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // No button to press: the card around the input hears the press and closes the selection.
  await app.press("label:楼层标题");
  await app.waitFor("text:长按这段正文");
  expect(app.shows("id:inline-select-body")).toBe(false);
});

test("a tap that moved is a handle drag, not half a double tap", () => {
  let done = 0;
  const taps = createDoubleTap(() => done++);
  // A drag (a selection handle, or the text scrolled) never counts, and it clears the pair.
  taps.start(10, 10);
  taps.move(10, 80);
  expect(taps.end(10, 80, 1_000)).toBe(false);
  taps.start(10, 80);
  expect(taps.end(10, 80, 1_050)).toBe(false);
  expect(done).toBe(0);
  // Two taps in the same place, a moment apart, do.
  taps.start(20, 20);
  expect(taps.end(20, 20, 1_400)).toBe(false);
  taps.start(22, 21);
  expect(taps.end(22, 21, 1_550)).toBe(true);
  expect(done).toBe(1);
  // Far apart, or slow, they are two taps of their own.
  taps.start(20, 20);
  expect(taps.end(20, 20, 2_000)).toBe(false);
  taps.start(20, 200);
  expect(taps.end(20, 200, 2_100)).toBe(false);
  taps.start(20, 200);
  expect(taps.end(20, 200, 3_000)).toBe(false);
  expect(done).toBe(1);
});

test("closing drops the selection first, and takes the field away a moment later", async () => {
  const calls: string[] = [];
  const finish = createFinish(() => calls.push("clear"), () => calls.push("done"));
  finish();
  // Twice is one close: the second would start a second state change on a gone field.
  finish();
  expect(calls).toEqual(["clear"]);
  await new Promise((r) => setTimeout(r, 200));
  expect(calls).toEqual(["clear", "done"]);
});

test("a field already gone still reports the close, so the body comes back", async () => {
  const calls: string[] = [];
  const finish = createFinish(
    () => {
      throw new Error("gone");
    },
    () => calls.push("done"),
  );
  finish();
  await new Promise((r) => setTimeout(r, 200));
  expect(calls).toEqual(["done"]);
});
