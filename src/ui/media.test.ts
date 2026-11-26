import { expect, test } from "nsh/test";
import { mediaKind, mediaNote, onForum } from "./media";

test("a video file or a page that plays one is a video", () => {
  expect(mediaKind("https://www.4d4y.com/forum/attachment.php?aid=1&n=clip.mp4")).toBe("video");
  expect(mediaKind("https://cdn.example.com/a/b.webm?x=1")).toBe("video");
  expect(mediaKind("https://www.bilibili.com/video/BV1xx411c7mD")).toBe("video");
  expect(mediaKind("https://b23.tv/abc")).toBe("video");
  expect(mediaKind("https://v.douyin.com/iRx/")).toBe("video");
});

test("an audio file is audio", () => {
  expect(mediaKind("https://www.4d4y.com/forum/attachment.php?aid=2&n=song.mp3")).toBe("audio");
  expect(mediaKind("https://cdn.example.com/a.m4a")).toBe("audio");
  expect(mediaKind("https://cdn.example.com/a.ogg")).toBe("audio");
});

test("a post, a picture or a plain page is not media", () => {
  expect(mediaKind("https://www.4d4y.com/forum/viewthread.php?tid=123")).toBe(null);
  expect(mediaKind("https://www.4d4y.com/forum/attachment.php?aid=3")).toBe(null);
  expect(mediaKind("https://cdn.example.com/a.jpg")).toBe(null);
  expect(mediaKind("")).toBe(null);
});

test("the forum's own hosts count, a look-alike does not", () => {
  expect(onForum("https://www.4d4y.com/forum/attachment.php?aid=1")).toBe(true);
  expect(onForum("https://4d4y.com/forum/attachment.php?aid=1")).toBe(true);
  expect(onForum("https://img02.4d4y.com/a.jpg")).toBe(true);
  expect(onForum("https://evil4d4y.com/a.mp4")).toBe(false);
  expect(onForum("https://b23.tv/abc")).toBe(false);
});

test("only a video says anything before the browser opens", () => {
  expect(mediaNote("video")).toContain("登录");
  expect(mediaNote("audio")).toBe(null);
});
