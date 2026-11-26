import { expect, open, test } from "nsh/test";

test("the body stays inside the card on a phone width", async () => {
  const app = await open("./replyCardHarness.tsx", { width: 390, height: 844 });
  await app.waitFor("label:body", { timeout: 3000 });
  const cell = app.layout("label:cell");
  const body = app.layout("label:body");
  console.log(`cell: ${cell ? `${cell.width} wide at ${cell.x}` : "null"}`);
  console.log(`body: ${body ? `${body.width} wide at ${body.x}, right edge ${body.x + body.width}` : "null"}`);
  expect(body).not.toBe(null);
  // 390 wide, 12 of padding each side: the card is 366. Its own 10 of padding, the face's 36 and
  // the gap's 8 leave the column 302, ending 10 before the card's right edge.
  expect(Math.abs(body!.width - (390 - 24 - 20 - 36 - 8)) < 0.5).toBe(true);
  // The paragraph itself, not just the column it sits in.
  const line = app.layout("text:全新安卓客户端DBer来袭 新瓶装旧酒，还是熟悉的配方，还是熟悉的味道。");
  console.log(`paragraph: ${line ? `${line.width} wide at ${line.x}, right edge ${line.x + line.width}` : "null"}`);
  expect(body!.x + body!.width).toBeLessThanOrEqual(390 - 12 - 10 + 0.5);
  // A quote is drawn a shade behind the reply around it, so the two part at a glance.
  const quote = app.spanStyle("text:现在用gkd");
  const reply = app.spanStyle("text:全新安卓客户端DBer来袭 新瓶装旧酒，还是熟悉的配方，还是熟悉的味道。");
  console.log(`quote color: ${quote.color}, reply color: ${reply.color}`);
  expect(quote.color.toLowerCase().startsWith("#6e5c46")).toBe(true);
  expect(quote.color === reply.color).toBe(false);
});
