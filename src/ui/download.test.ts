import { expect, open, test } from "nsh/test";

const FILE = "https://www.4d4y.com/forum/attachment.php?aid=9";

test("a download line asks the forum whether it is a picture, and takes the name it answers", async () => {
  const app = await open("./downloadHarness.tsx", {
    network: {
      "HEAD https://www.4d4y.com/forum/attachment.php?aid=9": {
        status: 200,
        headers: { "content-type": "application/zip" },
      },
      "GET https://www.4d4y.com/forum/attachment.php?aid=9": {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="newton.zip"',
        },
        body: "PK\u0003\u0004",
      },
    },
  });
  await app.press("label:下载");
  await app.waitFor("text:file:newton.zip:4", { timeout: 10000 });
  // A zip is no picture: the press downloads it instead of handing it to the picture viewer.
  expect(app.texts()).not.toContain("picture");
  expect(app.requests().map((r) => r.method)).toEqual(["HEAD", "GET"]);
  expect(app.requests()[1].url).toBe(FILE);
});
