import { expect, test } from "nsh/test";
import { imageExtension, pictureFileName } from "./imageViewer";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);
const page = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45]);

const AT = new Date(2026, 10, 23, 10, 5, 9).getTime();

test("the bytes name the format, whatever the name says", () => {
  expect(imageExtension(jpeg)).toBe(".jpg");
  expect(imageExtension(png)).toBe(".png");
  expect(imageExtension(gif)).toBe(".gif");
  expect(imageExtension(webp)).toBe(".webp");
  expect(imageExtension(page)).toBe(null);
  expect(imageExtension(new Uint8Array(0))).toBe(null);
});

test("a forum script name becomes a picture's own name, never a .txt", () => {
  expect(pictureFileName("attachment.php", jpeg, AT)).toBe("图片-20261123-100509.jpg");
  expect(pictureFileName("forum.php", png, AT)).toBe("图片-20261123-100509.png");
  expect(pictureFileName("图片.jpg", gif, AT)).toBe("图片-20261123-100509.gif");
});

test("a name that says something is kept, and takes the format of its bytes", () => {
  expect(pictureFileName("IMG_0001.jpeg", png, AT)).toBe("IMG_0001.png");
  expect(pictureFileName("截图 2026-11-23.png", jpeg, AT)).toBe("截图 2026-11-23.jpg");
  expect(pictureFileName("newton.md", webp, AT)).toBe("newton.webp");
});

test("an extension the bytes do not prove still follows the name when they show no format", () => {
  expect(pictureFileName("photo.jpeg", page, AT)).toBe("photo.jpeg");
  expect(pictureFileName("no-extension", new Uint8Array(0), AT)).toBe("no-extension.jpg");
});
