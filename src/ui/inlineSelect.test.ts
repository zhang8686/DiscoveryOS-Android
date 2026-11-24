import { expect, open, test } from "nsh/test";
import { createFinish, createSelectionEnd, toRuns } from "./InlineTextSelect";

test("a long press on the body opens the floor's text as an input the platform selects in", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  expect(app.shows("id:inline-select-body")).toBe(false);
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // The whole floor's text, whole: the platform's own selection moves by character in a field.
  expect(app.shows("text:第一行\n第二行 abc")).toBe(true);
});

test("the floor keeps its height, and the field fills it", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // Two lines of the default body (15pt, ×1.5) is 46 points: the floor is that tall both before
  // and after the swap — what the bug left was the list row's whole height under the text.
  const block = app.layout("id:inline-select-block");
  expect(block).not.toBe(null);
  expect(block!.height).toBeGreaterThanOrEqual(44);
  expect(block!.height).toBeLessThanOrEqual(52);
  // The field takes the floor's whole height, which is the leading the platform spreads its lines
  // over: its text then sits line for line where the body's was.
  const box = app.layout("id:inline-select-body");
  expect(box).not.toBe(null);
  expect(box!.height).toBe(block!.height);
});

test("a press outside the text puts the rich body back", async () => {
  const app = await open("./inlineSelectHarness.tsx");
  await app.longPress("label:正文");
  await app.waitFor("id:inline-select-body", { timeout: 10000 });
  // No button of the app's: the card around the text hears the press and closes the selection.
  await app.press("label:楼层标题");
  await app.waitFor("text:长按这段正文");
  expect(app.shows("id:inline-select-body")).toBe(false);
});

test("a copy ends the selection: the platform collapses it, and the body comes back", () => {
  let closes = 0;
  const ended = createSelectionEnd(() => closes++);
  // Opening the field reports a caret, before anything is selected: not an end.
  ended(0, 0);
  expect(closes).toBe(0);
  // A long press picks a word, and the handles widen it.
  ended(2, 6);
  ended(2, 9);
  expect(closes).toBe(0);
  // Copy ends the action mode in the platform's own code, which sets the selection to its
  // end (`TextView.onTextContextMenuItem`, `ID_COPY` → `stopTextActionMode`). That is the end.
  ended(9, 9);
  expect(closes).toBe(1);
  // A later caret report is nothing new: the body is already back.
  ended(9, 9);
  expect(closes).toBe(1);
});

test("each block takes the page's own leading and the page's own room above it", () => {
  const runs = toRuns(
    [
      { text: "标题", heading: 1, quote: false },
      { text: "正文", heading: 0, quote: false },
      { text: "小标题", heading: 2, quote: false },
      { text: "又问一句", heading: 2, quote: false },
      { text: "引用", heading: 0, quote: true },
    ],
    15,
    23,
  );
  // A heading is led by its own size, not the body's: h1 is 27 × 1.25, drawn at 16pt as the page
  // draws it (`OP_TITLE_STYLES` gives it the size; the leading stays the heading's own).
  expect(runs[0].size).toBe(16);
  expect(runs[0].line).toBe(33.75);
  // The first block of all has nothing above it.
  expect(runs[0].gap).toBe(0);
  // A block after a block takes the column's gap.
  expect(runs[1].line).toBe(23);
  expect(runs[1].gap).toBe(11.25);
  // A heading after a block takes its room above (h2: 20 × 1.6 = 32).
  expect(Math.round(runs[2].gap)).toBe(32);
  expect(runs[2].line).toBe(27);
  // A heading after a heading takes less (0.6 of its size).
  expect(Math.round(runs[3].gap)).toBe(12);
  // A block after a heading takes the column's gap, not the heading's room.
  expect(runs[4].gap).toBe(11.25);
  expect(runs[4].block.quote).toBe(true);
});

test("closing clears the selection off the gesture's dispatch, then puts the body back", async () => {
  const calls: string[] = [];
  const finish = createFinish(() => calls.push("clear"), () => calls.push("done"));
  finish();
  // Nothing on the turn the selection ended on: the platform's own copy code is still running
  // there, and taking the field away inside it left the page deaf to every touch afterwards.
  expect(calls).toEqual([]);
  // Twice is one close: the second would start a second state change on a gone field.
  finish();
  await new Promise((r) => setTimeout(r, 400));
  expect(calls).toEqual(["clear", "done"]);
});
