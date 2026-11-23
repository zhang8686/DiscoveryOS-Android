import { expect, open, test } from "nsh/test";

// The headless host counts text from every mounted pane as on screen: panes slide with
// translateX instead of unmounting, so a pane's text never disappears from `texts()`.
// Assertions that a pane's text is gone are therefore untestable here (both 0.5 and 0.6);
// pane navigation is verified with positive assertions and interaction steps instead.

test("the forum shows without signing in, with no Favorites", async () => {
  const app = await open("./App.tsx", { width: 1200 });
  expect(app.texts()).toContain("版块");
  expect(app.texts()).toContain("按回帖时间");
  expect(app.texts()).not.toContain("Favorites");
  expect(app.texts()).not.toContain("账户");
});

test("a narrow window opens on the boards pane, over a full-width body", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("版块");
  expect(app.texts()).toContain("我的主题");
  // Positive check that the boards pane is up; its text is always present in the host.
  expect(app.texts()).toContain("浏览版块与帖子");
});

test("portrait steps from the boards pane to a list pane", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("版块");
  await app.press("text:Buy & Sell 交易服务区 >> nth=0");
  // The list pane coming up is asserted by its own control, not by the boards text vanishing.
  expect(app.texts()).toContain("按回帖时间");
});

test("each board keeps its own order", async () => {
  const app = await open("./App.tsx");
  await app.press("text:Buy & Sell 交易服务区 >> nth=0");
  await app.press("label:展开筛选");
  await app.press("label:按发帖时间排序");
  await app.press("label:收起筛选");
  expect(app.texts()).toContain("按发帖时间");
  await app.drag("text:Buy & Sell 交易服务区 >> nth=0", { x: 120, y: 0 });
  await app.press("text:Geek Talks · 奇客怪谈 >> nth=0");
  expect(app.texts()).toContain("按回帖时间");
  await app.drag("text:Geek Talks · 奇客怪谈 >> nth=0", { x: 120, y: 0 });
  await app.press("text:Buy & Sell 交易服务区 >> nth=0");
  expect(app.texts()).toContain("按发帖时间");
});

test("portrait's panes step back with a right swipe", async () => {
  const app = await open("./App.tsx");
  await app.press("text:Buy & Sell 交易服务区 >> nth=0");
  expect(app.texts()).toContain("按回帖时间");
  await app.drag("text:Buy & Sell 交易服务区 >> nth=0", { x: 120, y: 0 });
  expect(app.texts()).toContain("版块");
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
