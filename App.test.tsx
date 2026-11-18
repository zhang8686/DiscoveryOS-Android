// `nsh test` runs this in a headless runner: its network answers nothing, so a
// sign-in there must fail with a message rather than sign in.
// The tablet build is Chinese and does not force the sign-in sheet on launch:
// the account row in the sidebar opens it on demand.
import { expect, open, test } from "nsh/test";

test("the forum shows without signing in, with no Favorites", async () => {
  // A tablet window: the channel column is the full column, with its heading.
  const app = await open("./App.tsx", { width: 1200 });
  expect(app.texts()).toContain("版块");
  // A first run opens the first board, so the list column names it rather than the generic "帖子".
  expect(app.texts()).toContain("按回帖时间");
  expect(app.texts()).not.toContain("Favorites");
  // No modal on a tablet's first screen.
  expect(app.texts()).not.toContain("账户");
});

test("a narrow window opens on the boards pane, over a full-width body", async () => {
  // The default test viewport is a phone's portrait: the first screen is the board column as a
  // pane; the thread list is not in the layout until a board is picked.
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("版块");
  expect(app.texts()).toContain("我的主题");
  expect(app.texts()).not.toContain("按回帖时间");
});

test("portrait steps from the boards pane to a list pane", async () => {
  const app = await open("./App.tsx");
  // The boards pane has the "版块" heading; picking a board replaces it with the list pane,
  // which carries that board's own order control instead.
  expect(app.texts()).toContain("版块");
  await app.press("text:Buy & Sell 交易服务区");
  expect(app.texts()).not.toContain("版块");
  expect(app.texts()).toContain("按回帖时间");
});

test("each board keeps its own order", async () => {
  const app = await open("./App.tsx");
  await app.press("text:Buy & Sell 交易服务区");
  await app.press("label:展开筛选");
  await app.press("label:按发帖时间排序");
  await app.press("label:收起筛选");
  expect(app.texts()).toContain("按发帖时间");
  // Another board still opens on the default, last-reply order.
  await app.drag("text:Buy & Sell 交易服务区", { x: 120, y: 0 });
  await app.press("text:Geek Talks · 奇客怪谈");
  expect(app.texts()).toContain("按回帖时间");
  // The first board kept the order it was given.
  await app.drag("text:Geek Talks · 奇客怪谈", { x: 120, y: 0 });
  await app.press("text:Buy & Sell 交易服务区");
  expect(app.texts()).toContain("按发帖时间");
});

test("portrait's panes step back with a right swipe", async () => {
  const app = await open("./App.tsx");
  // The list pane swipes back to the boards...
  await app.press("text:Buy & Sell 交易服务区");
  expect(app.texts()).not.toContain("版块");
  await app.drag("text:Buy & Sell 交易服务区", { x: 120, y: 0 });
  expect(app.texts()).toContain("版块");
  // With no thread open the board column stays: the bare placeholder is never shown full screen,
  // so swiping the boards away brings them straight back.
  await app.drag("text:版块", { x: 120, y: 0 });
  expect(app.texts()).toContain("版块");
});

test("signed out with nothing saved, no channel error is shown", async () => {
  const app = await open("./App.tsx", { width: 1200 });
  expect(app.texts()).toContain("登录");
  expect(app.texts()).not.toContain("Couldn't load channels. Tap to retry.");
});

test("the blank avatar opens the sign-in dialog, and Cancel closes it", async () => {
  const app = await open("./App.tsx", { width: 1200 });
  await app.press("label:登录 >> nth=0");
  expect(app.texts()).toContain("账户");
  await app.press("text:取消");
  expect(app.texts()).not.toContain("账户");
});

test("a failed sign-in shows a Chinese error", async () => {
  const app = await open("./App.tsx", { width: 1200 });
  await app.press("label:登录 >> nth=0");
  await app.type("用户名", "someone");
  await app.type("密码", "secret");
  await app.press("text:登录 >> nth=1");
  expect(app.texts().some((t) => t.startsWith("登录失败"))).toBe(true);
});
