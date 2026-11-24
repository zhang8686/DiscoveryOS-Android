import { HOST_BASE } from "./parse";
import { cookieHeader } from "./cookies";
import { USER_AGENT } from "./encoding";
import { fetchLogged } from "../net/traffic";
import { Gb18030 } from "../nativeStub";

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

/** Whether an attachment is a picture, from the forum's answer about it: `attachment.php` sends
 *  the file's own type, so an image type is a picture. The headers come from a HEAD, so saying
 *  "no" to a file of several megabytes costs a request, not the file. Anything else — a refused
 *  request, a page, no type — is not a picture. */
export async function attachmentIsPicture(url: string): Promise<boolean> {
  const cookie = cookieHeader();
  // The deadline ends the request itself (`abort`), not just the wait for it: a server that keeps
  // the connection open would otherwise hold it — and one of the download slots behind it — long
  // after this answer gave up, while every attachment of the page piled up another.
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const request = fetch(new URL(url, HOST_BASE).href, {
    method: "HEAD",
    headers: { "User-Agent": USER_AGENT, ...(cookie ? { Cookie: cookie } : {}) },
    ...(controller ? { signal: controller.signal } : {}),
  }).catch(() => null);
  let response: Response | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    response = await Promise.race([
      request,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller?.abort();
          resolve(null);
        }, 12_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    // The answer came first, or gave up: either way the timer has nothing left to do.
    if (timer !== undefined) clearTimeout(timer);
  }
  if (!response || !response.ok) return false;
  return /^image\//i.test(response.headers.get("content-type") ?? "");
}

/** A file the forum sends back: its bytes, the name its answer carries and its type. */
export interface FetchedAttachment {
  bytes: Uint8Array;
  /** The name the forum itself gives the file (`Content-Disposition`); `null` when it gives none. */
  name: string | null;
  /** The answer's `Content-Type` (`""` when it sends none). */
  type: string;
}

/** A header's text as the forum wrote it: GB18030 pages put Chinese names in headers as bytes,
 *  which arrive here as one character per byte, so they are read back as bytes first. */
function headerText(raw: string): string {
  if (!/[\x80-\xff]/.test(raw)) return raw;
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return Gb18030.decode(bytes);
    } catch {
      return raw;
    }
  }
}

const DISPOSITION_EXTENDED = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i;
const DISPOSITION_PLAIN = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i;

/**
 * The name a `Content-Disposition` header carries: `filename*=utf-8''%E4%B8%AD.zip` when the
 * forum sends one (its own encoding, percent-escaped), else the plain `filename`. `null` when the
 * header names nothing — a name taken from the address is then all there is.
 */
export function fileNameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const extended = DISPOSITION_EXTENDED.exec(header);
  if (extended) {
    const value = extended[2].trim().replace(/^"|"$/g, "");
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }
    const text = headerText(decoded).trim();
    if (text) return text;
  }
  const plain = DISPOSITION_PLAIN.exec(header);
  if (!plain) return null;
  const text = headerText((plain[1] ?? plain[2] ?? "").trim()).trim();
  return text.length > 0 ? text : null;
}

/** The extensions the common attachment types go by, for a file whose answer names none. */
const TYPE_EXT: Record<string, string> = {
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/x-rar-compressed": "rar",
  "application/vnd.rar": "rar",
  "application/x-7z-compressed": "7z",
  "application/pdf": "pdf",
  "application/vnd.android.package-archive": "apk",
  "application/epub+zip": "epub",
  "application/gzip": "gz",
  "application/x-tar": "tar",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/html": "html",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
};

/** The extension a `Content-Type` goes by (`""` for a type this does not know). */
export function extensionForType(type: string): string {
  const base = type.split(";")[0].trim().toLowerCase();
  return TYPE_EXT[base] ?? "";
}

/** Names that are a word for "download" rather than the file's own: Discuz's link text. */
const GENERIC_NAME = /^(?:下载|下载附件|附件|点击下载|attachment|download|file|getfile)$/i;

/** Whether a name is the forum's word for downloading, not a file name. */
export function isGenericFileName(name: string): boolean {
  const { stem } = splitFileName(safeFileName(name));
  return GENERIC_NAME.test(stem.trim());
}

function nameStamp(at: number): string {
  const d = new Date(at);
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

/**
 * The name a download is saved under. Discuz's download line reads 下载, so the link's text is no
 * file name — the answer carries the real one (`fileNameFromDisposition`) as `answered`. Failing
 * both, the type names the extension and the moment the stem, so what lands is never `下载` or a
 * name with the extension cut off.
 */
export function attachmentFileName(linkName: string, answered: string | null | undefined, type: string): string {
  for (const raw of [answered, linkName]) {
    if (!raw) continue;
    const safe = safeFileName(raw);
    const { stem, ext } = splitFileName(safe);
    if (ext.length > 1 && stem && !GENERIC_NAME.test(stem.trim())) return safe;
  }
  const ext = splitFileName(safeFileName(answered ?? linkName ?? "")).ext;
  const typed = ext.length > 1 ? ext : extensionForType(type);
  return `附件-${nameStamp(Date.now())}${typed ? (typed.startsWith(".") ? typed : `.${typed}`) : ""}`;
}

/**
 * The bytes of an attachment, with the forum's session cookies. A signed-out or refused
 * request comes back as the forum's HTML page, not the file, so an HTML answer is an error
 * unless the file itself is HTML.
 */
export async function fetchAttachment(url: string, name: string): Promise<Uint8Array> {
  return (await fetchAttachmentFile(url, name)).bytes;
}

/** An attachment's bytes as the answer sends them, with the name and type it reports. */
export async function fetchAttachmentFile(url: string, name: string): Promise<FetchedAttachment> {
  try {
    return await fetchAttachmentOnce(url, name);
  } catch (e) {
    if (e instanceof AttachmentError) throw e;
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    return await fetchAttachmentOnce(url, name);
  }
}

async function fetchAttachmentOnce(url: string, name: string): Promise<FetchedAttachment> {
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
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new AttachmentError("文件超过 8 MB（运行时一次最多写 8 MB）");
  return { bytes, name: fileNameFromDisposition(response.headers.get("content-disposition")), type };
}
