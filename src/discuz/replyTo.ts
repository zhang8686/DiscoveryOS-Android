/**
 * A floor the reader is replying to, the web forum's `reppost` (as opposed to `repquote`). The
 * forum's own reply page fills the editor with one bold line linking back to that floor and sends
 * three hidden fields so its author is notified. Both are made here from the floor the reader
 * pressed, so no extra page request is needed.
 */
export type ReplyTarget = {
  pid: string;
  ptid: string;
  seq: number;
  uid: string;
  name: string;
  /** The target floor as plain text, passed to the forum's notification about the reply. */
  message: string;
};

export type ReplyNotice = { noticeauthor: string; noticetrimstr: string; noticeauthormsg: string };

/** Brackets in a member's name would end the tags we wrap it in. */
function bbName(name: string): string {
  return name.replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
}

/** The line at the top of the editor and, once posted, at the top of the reply. */
export function replyToHeader(t: ReplyTarget, host: string): string {
  return `[b]回复 [url=${host}redirect.php?goto=findpost&pid=${t.pid}&ptid=${t.ptid}]${t.seq}#[/url] [i]${bbName(t.name)}[/i] [/b]\n\n`;
}

/** The chip above the input: the same words the header shows, nothing of the target's body. */
export function replyToChip(t: ReplyTarget): string {
  return `回复 ${t.seq}# ${t.name}`;
}

/** The hidden fields the web reply form sends with `reppost` to notify the target's author. */
export function replyToNotice(t: ReplyTarget, host: string): ReplyNotice {
  return {
    noticeauthor: `r|${t.uid}|[i]${bbName(t.name)}[/i]`,
    noticetrimstr: replyToHeader(t, host),
    noticeauthormsg: t.message,
  };
}
