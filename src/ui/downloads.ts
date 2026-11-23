import { platform, Share } from "nsh";
import { exists, mkdir, writeFile } from "fs/promises";
import process from "process";
import { AttachmentError, attachmentFileName, fetchAttachmentFile, isGenericFileName, safeFileName, splitFileName } from "../discuz/attachments";
import { notify } from "./toast";

const TOAST = "download";
const inFlight = new Set<string>();

/** The phone's own Downloads folder, then the app's. Only the first is where the reader looks for
 *  a download; Android keeps an app out of it (scoped storage), so the second is the one that
 *  works there — and the system sheet is how a file in it reaches the phone's files. */
const PUBLIC_DOWNLOADS = "/storage/emulated/0/Download";
const DOWNLOAD_DIRS = platform.os === "android"
  ? [PUBLIC_DOWNLOADS, `${process.dataDir}/Downloads`]
  : [`${process.dataDir}/Downloads`];

/**
 * Writes `bytes` into the Downloads folder under the file's name, with a number added when
 * the name is taken (`a.md`, `a (2).md`). Resolves to the path written.
 */
export async function saveToDownloads(name: string, bytes: Uint8Array): Promise<string> {
  const safe = safeFileName(name);
  const { stem, ext } = splitFileName(safe);
  let refusal: unknown = new Error("no folder to save to");
  for (const dir of DOWNLOAD_DIRS) {
    try {
      await mkdir(dir, { recursive: true });
      let target = `${dir}/${safe}`;
      for (let n = 2; await exists(target); n++) target = `${dir}/${stem} (${n})${ext}`;
      await writeFile(target, bytes);
      return target;
    } catch (e) {
      refusal = e;
    }
  }
  throw refusal;
}

/** Whether a path is the phone's own Downloads folder, where the reader finds it themselves. */
export function isPublicDownload(path: string): boolean {
  return path.startsWith(`${PUBLIC_DOWNLOADS}/`);
}

/** What to call the file while it is on the wire, before the answer says its real name. */
function pendingName(name: string): string {
  return name && !isGenericFileName(name) ? name : "附件";
}

/**
 * Downloads the attachment at `url` into Downloads, and reports the outcome. The name comes from
 * the forum's answer (`Content-Disposition`), because Discuz's own link text is just 下载; where
 * only the app's folder could be written, the system sheet hands the file over from there —
 * 「保存到文件」 puts it in the phone's Downloads, or it goes straight to whoever it is sent to.
 */
export async function downloadAttachment(url: string, name: string): Promise<void> {
  if (inFlight.has(url)) return;
  inFlight.add(url);
  const label = pendingName(name);
  notify(TOAST, `正在下载${label === "附件" ? "附件" : ` ${label}`}…`);
  try {
    const file = await fetchAttachmentFile(url, name);
    const saved = await saveToDownloads(attachmentFileName(name, file.name, file.type), file.bytes);
    const shown = saved.split("/").pop() ?? label;
    if (isPublicDownload(saved)) {
      notify(TOAST, `已保存到下载目录：${shown}`);
      return;
    }
    // The app's own folder: the reader cannot browse it, so the file is handed over instead.
    notify(TOAST, `已下载 ${shown}，选「保存到文件」即可存到手机。`);
    try {
      const result = await Share.show({ files: [saved], title: shown });
      if (result.action === "dismissed") notify(TOAST, `${shown} 已下载，可在下次分享时找到。`);
    } catch {
      notify(TOAST, `${shown} 已下载到应用目录。`);
    }
  } catch (e) {
    const reason = e instanceof AttachmentError ? `：${e.message}` : "";
    notify(TOAST, `无法下载 ${label}${reason}。`);
  } finally {
    inFlight.delete(url);
  }
}
