// Regression test: after a background kill, the saved cookies restore the login.
// Everything is stubbed in memory: no real account, no disk write, no network.
import { expect, test, open } from "nsh/test";

const VAULT = JSON.stringify({
  creds: null,
  cookies: { cdb_auth: "stub-auth-value", cdb_saltkey: "stub-salt", cdb_sid: "stub-sid" },
});

// A signed-in `my.php` page: the member's own uid link and a logout link with
// a form hash. Both are what `restoreSession` looks for.
const SIGNED_IN_PAGE = `<html><body>
<a href="space.php?uid=498635" class="noborder">tablet-tester</a>
<a href="logging.php?action=logout&amp;formhash=a1b2c3d4">logout</a>
</body></html>`;

// Any other page (channel list, thread list, profile) is a harmless stub so the
// first render never reaches the network.
const EMPTY_PAGE = "<html><body></body></html>";

test("saved cookies restore the signed-in user on a fresh launch", async () => {
  const app = await open("App.tsx", {
    storage: { "discoveryos/vault": VAULT },
    network: {
      "*": (request: { url: string }) => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: request.url.includes("my.php") ? SIGNED_IN_PAGE : EMPTY_PAGE,
      }),
    },
    width: 1280,
    height: 800,
    platform: "android",
  });

  // The account footer shows the member name instead of the "登录" prompt.
  await app.waitFor("text:tablet-tester", { timeout: 8000 });
  expect(app.shows("text:tablet-tester")).toBe(true);
  expect(app.shows("text:登录")).toBe(false);

  // The session cookie survives the launch: a guest response must not have
  // overwritten the vault with an empty jar.
  const vault = JSON.parse(app.storage()["discoveryos/vault"] ?? "{}") as {
    cookies?: Record<string, string>;
  };
  expect(vault.cookies?.["cdb_auth"]).toBe("stub-auth-value");
});
