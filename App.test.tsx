// `nsh test` runs this in a headless runner: its network answers nothing, so a
// sign-in there must fail with a message rather than sign in.
// The tablet build is Chinese and does not force the sign-in sheet on launch:
// the account row in the sidebar opens it on demand.
import { expect, open, test } from "nsh/test";

test("the forum shows without signing in, with no Favorites", async () => {
  // A tablet window: the channel column is the full column, with its heading.
  const app = await open("./App.tsx", { width: 1200 });
  expect(app.texts()).toContain("版块");
  expect(app.texts()).toContain("帖子");
  expect(app.texts()).not.toContain("Favorites");
  // No modal on a tablet's first screen.
  expect(app.texts()).not.toContain("账户");
});

test("a narrow window folds the channel column into a rail, without its heading", async () => {
  // The default test viewport is a phone's: the channel column is the rail.
  const app = await open("./App.tsx");
  expect(app.texts()).not.toContain("版块");
  expect(app.texts()).toContain("帖子");
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
