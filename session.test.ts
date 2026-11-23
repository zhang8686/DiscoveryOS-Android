import { expect, test, open } from "nsh/test";

const VAULT = JSON.stringify({
  creds: null,
  cookies: { cdb_auth: "stub-auth-value", cdb_saltkey: "stub-salt", cdb_sid: "stub-sid" },
});

const SIGNED_IN_PAGE = `<html><body>
<a href="space.php?uid=498635" class="noborder">tablet-tester</a>
<a href="logging.php?action=logout&amp;formhash=a1b2c3d4">logout</a>
</body></html>`;

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

  await app.waitFor("text:tablet-tester", { timeout: 8000 });
  expect(app.shows("text:tablet-tester")).toBe(true);
  expect(app.shows("text:登录")).toBe(false);

  const vault = JSON.parse(app.storage()["discoveryos/vault"] ?? "{}") as {
    cookies?: Record<string, string>;
  };
  expect(vault.cookies?.["cdb_auth"]).toBe("stub-auth-value");
});
