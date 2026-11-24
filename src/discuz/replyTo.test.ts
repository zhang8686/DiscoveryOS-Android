import { expect, test } from "nsh/test";
import { replyToChip, replyToHeader, replyToNotice, type ReplyTarget } from "./replyTo";

const HOST = "https://www.4d4y.com/forum/";

const target: ReplyTarget = {
  pid: "74945503",
  ptid: "3476658",
  seq: 22,
  uid: "498635",
  name: "mrky",
  message: "我在Android10没有这个问题，估计适配不了更高的的版本吧",
};

test("a targeted reply opens with the forum's own bold line back to the floor", () => {
  expect(replyToHeader(target, HOST)).toBe(
    "[b]回复 [url=https://www.4d4y.com/forum/redirect.php?goto=findpost&pid=74945503&ptid=3476658]22#[/url] [i]mrky[/i] [/b]\n\n",
  );
});

test("the chip above the field shows the floor and author, not the target's words", () => {
  expect(replyToChip(target)).toBe("回复 22# mrky");
});

test("the hidden notice fields match the reply page's, so the author is notified", () => {
  expect(replyToNotice(target, HOST)).toEqual({
    noticeauthor: "r|498635|[i]mrky[/i]",
    noticetrimstr: replyToHeader(target, HOST),
    noticeauthormsg: target.message,
  });
});

test("brackets in a member's name cannot close the forum's BBCode tags", () => {
  const odd = { ...target, name: "[admin]" };
  expect(replyToChip(odd)).toBe("回复 22# [admin]");
  expect(replyToHeader(odd, HOST)).toContain("[i]&#91;admin&#93;[/i]");
  expect(replyToNotice(odd, HOST).noticeauthor).toBe("r|498635|[i]&#91;admin&#93;[/i]");
});
