import { HOST } from "../discuz/client";

/** What kind of playable a link is, if it is one. */
export type MediaKind = "video" | "audio";

/** A file a post links to, by the name it is shown under (Discuz prints the filename itself). */
const VIDEO_FILE = /\.(?:mp4|m4v|webm|mov|3gp|mkv|avi|flv|f4v)(?:[?#]|$)/i;
const AUDIO_FILE = /\.(?:mp3|m4a|m4v|aac|ogg|oga|flac|wav|opus|amr)(?:[?#]|$)/i;

/** Pages that play video in a page of their own: the release the forum embeds with `[media]`. */
const VIDEO_SITE = /^https?:\/\/(?:[\w-]+\.)*(?:bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|kuaishou\.com|ixigua\.com|youtube\.com|youtu\.be|vimeo\.com|qq\.com\/x\/cover)\//i;

/** The kind of playable `url` is, or `null` for everything else (a post, a picture, a file). */
export function mediaKind(url: string): MediaKind | null {
  if (!url) return null;
  if (VIDEO_FILE.test(url) || VIDEO_SITE.test(url)) return "video";
  if (AUDIO_FILE.test(url)) return "audio";
  return null;
}

/** Whether `url` lives on the forum itself: those need the session's cookies, which only the app
 *  has — a browser answers with the sign-in page until the reader signs in there too. */
export function onForum(url: string): boolean {
  try {
    const host = new URL(url, HOST).host.toLowerCase();
    const base = new URL(HOST).host.toLowerCase().replace(/^www\./, "");
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}

/**
 * Where a media link goes.
 *
 * Nothing plays inside the app: the runtime's players take a URL and send no cookies, so a forum
 * attachment (which needs the session) would come back as the sign-in page, and its 8 MB write
 * limit rules out keeping the file instead. Both ends are the reader's own: a video opens in the
 * browser — where a signed-in forum plays and downloads it — and an audio attachment, small enough
 * to keep, is downloaded and handed to the share sheet, which passes it to a player.
 */
export function mediaNote(kind: MediaKind): string | null {
  if (kind !== "video") return null;
  return "浏览器首次需登录论坛一次，之后可直接播放或下载";
}
