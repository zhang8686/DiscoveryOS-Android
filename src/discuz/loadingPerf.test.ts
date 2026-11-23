import { expect, open, test } from "nsh/test";

// A forumdisplay page with one thread row; enough for parsePosts to return a list.
const forumHtml = `<html><body><table><tr><td class="author">
<a href="space.php?uid=123">作者</a>
</td><td><span><a href="viewthread.php?tid=999">一条测试帖子</a></span></td>
<td class="nums"><strong>3</strong>/<em>100</em></td></tr></table></body></html>`;

// A profile page carrying an avatar image for the name the harness looks up.
const profileHtml = `<html><body><img src="uc_server/data/avatar/000/00/00/01_avatar_small.jpg"></body></html>`;

test("concurrent loads of one page and one avatar share a single request each", async () => {
  const app = await open("./loadingHarness.tsx", {
    network: {
      "GET https://www.4d4y.com/forum/forumdisplay.php*": { body: forumHtml },
      "GET https://www.4d4y.com/forum/space.php*": { body: profileHtml },
    },
  });

  // The harness prints its results; wait until both promises have settled.
  await app.waitUntil(() => app.texts().some((t) => t.includes("avatar:")));

  const forumCalls = app.requests().filter((r) => r.url.includes("forumdisplay.php"));
  const profileCalls = app.requests().filter((r) => r.url.includes("space.php"));
  expect(forumCalls.length).toBe(1);
  expect(profileCalls.length).toBe(1);
});
