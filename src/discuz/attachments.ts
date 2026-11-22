import { HOST_BASE } from "./parse";
import { cookieHeader } from "./cookies";
import { USER_AGENT } from "./encoding";
import { fetchLogged } from "../net/traffic";

/** Largest file the app saves: the platform's write limit. */
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

/** A download the app could not finish; the message is for the user. */
export class AttachmentError extends Error {}

/** A file name a download can be saved under: no folders, control characters or leading dots, short. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, "").replace(/^[.\s]+/, "").trim();
  if (!cleaned) return "download";
  const { stem, ext } = splitFileName(cleaned);
  const MAX = 180;
  const shortExt = ext.slice(0, MAX - 1);
  return stem.slice(0, Math.max(1, MAX - shortExt.length)) + shortExt;
}

/** Splits a file name into its stem and extension (`a.tar.gz` -> `a.tar`, `.gz`); no dot, no extension. */
export function splitFileName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}

/**
 * The bytes of an attachment, with the forum's session cookies. A signed-out or refused
 * request comes back as the forum's HTML page, not the file, so an HTML answer is an error
 * unless the file itself is HTML.
 */
export async function fetchAttachment(url: string, name: string): Promise<Uint8Array> {
  try {
    return await fetchAttachmentOnce(url, name);
  } catch (e) {
    if (e instanceof AttachmentError) throw e;
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    return await fetchAttachmentOnce(url, name);
  }
}

async function fetchAttachmentOnce(url: string, name: string): Promise<Uint8Array> {
  const cookie = cookieHeader();
  const { response, bytes } = await fetchLogged(
    new URL(url, HOST_BASE).href,
    { headers: { "User-Agent": USER_AGENT, ...(cookie ? { Cookie: cookie } : {}) } },
    undefined,
    90_000,
  );
  if (!response.ok) throw new AttachmentError(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  const isPage = /text\/html/i.test(type) && !/\.html?$/i.test(name);
  if (isPage) throw new AttachmentError("论坛返回的是页面，不是文件");
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new AttachmentError("文件超过 8 MB");
  return bytes;
}
