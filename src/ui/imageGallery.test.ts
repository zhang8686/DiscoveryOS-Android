import { expect, test } from "nsh/test";
import { imageIdentity, postImages } from "./imageViewer";

const HOST = "https://www.4d4y.com/forum/";

test("one picture has one identity, however many addresses it wears", () => {
  // The attachment name, with or without the query's other parameters.
  expect(imageIdentity("https://h/attachment.php?aid=MTIzfDk5")).toBe(
    imageIdentity("https://h/forum.php?mod=attachment&aid=MTIzfDk5&nothumb=yes"),
  );
  // The drawn copy and the original of the same file.
  expect(imageIdentity("https://h/data/attachment/forum/202401/01/abc_thumb.jpg")).toBe(
    imageIdentity("https://h/data/attachment/forum/202401/01/abc.jpg"),
  );
  // A cache-busting query, and the size suffix some templates add.
  expect(imageIdentity("https://h/a/abc.jpg?t=1700000000")).toBe(imageIdentity("https://h/a/abc.jpg"));
  expect(imageIdentity("https://h/a/abc-300x200.jpg")).toBe(imageIdentity("https://h/a/abc.jpg"));
  // Different pictures stay different.
  expect(imageIdentity("https://h/a/abc.jpg") === imageIdentity("https://h/a/def.jpg")).toBe(false);
  // An address that names nothing still answers something, and never collides with a file.
  expect(imageIdentity("https://h/a/abc.jpg") === imageIdentity("")).toBe(false);
});

test("a picture written twice is one page to step onto", () => {
  const body = [
    `<a href="${HOST}attachment.php?aid=MTIz"><img src="${HOST}data/attachment/forum/abc_thumb.jpg" width="600"></a>`,
    `<img src="${HOST}data/attachment/forum/abc.jpg">`,
    `<img src="${HOST}data/attachment/forum/def.jpg">`,
  ].join("\n");
  const items = postImages(body);
  expect(items.length).toBe(2);
  // The entry kept is the one that names the original for Save, not the drawn copy alone.
  expect(items[0].url).toBe(`${HOST}attachment.php?aid=MTIz`);
  expect(items[0].display).toBe(`${HOST}data/attachment/forum/abc_thumb.jpg`);
  expect(items[1].url).toBe(`${HOST}data/attachment/forum/def.jpg`);
});

test("the same file under two direct addresses is still one picture", () => {
  const body = [
    `<img src="${HOST}data/attachment/forum/abc.jpg">`,
    `<img src="${HOST}data/attachment/forum/abc-300x200.jpg">`,
  ].join("");
  expect(postImages(body).length).toBe(1);
});

test("the drawn copy alone may be met first and the original folded into it", () => {
  const body = [
    `<img src="${HOST}data/attachment/forum/abc.jpg">`,
    `<a href="${HOST}attachment.php?aid=MTIz"><img src="${HOST}data/attachment/forum/abc_thumb.jpg"></a>`,
  ].join("");
  const items = postImages(body);
  expect(items.length).toBe(1);
  expect(items[0].url).toBe(`${HOST}attachment.php?aid=MTIz`);
});

test("smilies are not pictures to step through", () => {
  const body = `<img src="${HOST}images/smilies/default/smile.gif"><img src="${HOST}data/attachment/forum/abc.jpg">`;
  const items = postImages(body);
  expect(items.length).toBe(1);
  expect(items[0].url).toBe(`${HOST}data/attachment/forum/abc.jpg`);
});
