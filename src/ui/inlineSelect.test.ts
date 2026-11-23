import { expect, open, test } from "nsh/test";
import { createFinish, selectedSlice } from "./InlineTextSelect";

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
  // The copy row ends it; a press on the card around the input does too.
  await app.press("label:楼层标题");
  await app.waitFor("text:长按这段正文");
  expect(app.shows("id:inline-select-body")).toBe(false);
});

test("the copy row stays when nothing is selected, so a tap that missed is not the way out", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  await app.press("id:inline-select-copy");
  await new Promise((r) => setTimeout(r, 400));
  // No selection, so nothing was copied and nothing closed: the field is still there to select in.
  expect(app.shows("id:inline-select-body")).toBe(true);
  expect(app.shows("text:已复制：")).toBe(false);
});

test("a selection's text is the run between its ends, in either order", () => {
  expect(selectedSlice("第一行\n第二行 abc", 0, 3)).toBe("第一行");
  // A handle dragged past the other end reports them swapped.
  expect(selectedSlice("第一行\n第二行 abc", 3, 0)).toBe("第一行");
  // A caret selects nothing.
  expect(selectedSlice("第一行\n第二行 abc", 2, 2)).toBe("");
  // Offsets past the text (a stale report) stop at its end.
  expect(selectedSlice("abc", -5, 99)).toBe("abc");
});

test("closing waits for the touch to finish, then drops the selection before the field goes", async () => {
  const calls: string[] = [];
  const finish = createFinish(() => calls.push("clear"), () => calls.push("done"));
  finish();
  // Nothing happens inside the tap's own dispatch: that is what left the page deaf to touches.
  expect(calls).toEqual([]);
  // Twice is one close: the second would start a second state change on a gone field.
  finish();
  await new Promise((r) => setTimeout(r, 30));
  expect(calls).toEqual(["clear"]);
  await new Promise((r) => setTimeout(r, 300));
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
  await new Promise((r) => setTimeout(r, 300));
  expect(calls).toEqual(["done"]);
});
