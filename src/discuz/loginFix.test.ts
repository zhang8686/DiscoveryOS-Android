import { expect, test } from "nsh/test";
import { discuzPassword, hexMd5 } from "./md5";
import { loginFormFields } from "./client";

test("hexMd5 matches the standard MD5 test vectors", () => {
  expect(hexMd5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  expect(hexMd5("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
  expect(hexMd5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  expect(hexMd5("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
  expect(hexMd5("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
  expect(hexMd5("12345678901234567890123456789012345678901234567890123456789012345678901234567890"))
    .toBe("57edf4a22be3c955ac49da2e2107b67a");
});

test("the login password is the forum's pwmd5 value, not plain text", () => {
  // The forum hashes with hex_md5(addslashes(password)) before posting.
  expect(discuzPassword("secret")).toBe(hexMd5("secret"));
  expect(discuzPassword("secret")).not.toBe("secret");
  // Discuz's addslashes escapes quotes and backslashes before hashing.
  expect(discuzPassword("a'b")).toBe(hexMd5("a\\'b"));
  expect(discuzPassword('a"b\\c')).toBe(hexMd5('a\\"b\\\\c'));
});

test("the login form carries the browser's hidden fields and a hashed password", () => {
  const form = loginFormFields("tester", "secret", { hash: "abc123", sid: "xyz" }, 2, "mother");
  const fields = Object.fromEntries(form);
  expect(fields["username"]).toBe("tester");
  expect(fields["password"]).toBe(discuzPassword("secret"));
  expect(fields["loginfield"]).toBe("username");
  expect(fields["formhash"]).toBe("abc123");
  expect(fields["sid"]).toBe("xyz");
  expect(fields["questionid"]).toBe("2");
  expect(fields["answer"]).toBe("mother");
  expect(fields["cookietime"]).toBe("2592000");
  expect(fields["loginsubmit"]).toBe("true");
});

test("no security question means no question fields in the login form", () => {
  const fields = Object.fromEntries(loginFormFields("tester", "secret", {}));
  expect(fields["questionid"]).toBeUndefined();
  expect(fields["answer"]).toBeUndefined();
  expect(fields["formhash"]).toBeUndefined();
  expect(fields["sid"]).toBeUndefined();
});

const LOGIN_PAGE = `<html><body><form>
<input type="hidden" name="sid" value="stub-sid">
<input type="hidden" name="formhash" value="stub-hash">
<input type="text" name="username"><input type="password" name="password">
</form><select name="loginfield" id="loginfield"><option>username</option></select></body></html>`;
const MEMBER_PAGE = '<html><body><a href="logging.php?action=logout&amp;formhash=member-hash">logout</a></body></html>';

test("a slow config page does not turn a successful login into a failure", async () => {
  const { open } = await import("nsh/test");
  const seen: { url: string; method: string; body?: string | null }[] = [];
  const app = await open("./loginHarness.tsx", {
    network: {
      "GET https://www.4d4y.com/forum/logging.php*": (request) => {
        seen.push({ url: request.url, method: request.method, body: request.body });
        return { status: 200, body: LOGIN_PAGE };
      },
      "POST https://www.4d4y.com/forum/logging.php*": (request) => {
        seen.push({ url: request.url, method: request.method, body: request.body });
        return { status: 200, body: MEMBER_PAGE };
      },
      "GET https://www.4d4y.com/forum/my.php*": (request) => {
        seen.push({ url: request.url, method: request.method, body: request.body });
        return { status: 200, body: MEMBER_PAGE };
      },
      // The config page stalls past its 8 s deadline; signing in must still succeed.
      "GET https://www.4d4y.com/forum/memcp.php*": { status: 200, delay: 9_000, body: "" },
    },
  });
  await app.waitFor("text:signed-in", { timeout: 15_000 });
  expect(app.shows("text:signed-in")).toBe(true);
  const post = seen.find((r) => r.method === "POST");
  expect(post?.body ?? "").toContain("password=5ebe2294ecd0e0f08eab7690d2a6ee69");
  expect(post?.body ?? "").toContain("formhash=stub-hash");
}, 20000);
