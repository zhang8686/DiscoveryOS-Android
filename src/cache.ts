import { readdir, rmdir, stat, unlink } from "fs/promises";
import { platform } from "nsh";
import process from "process";

/** The package id from nsh.json: Android's private directories are named after it. */
const PACKAGE = "com.Android.DiscoveryOSX";

/** How many entries are touched at once. Each one is a call into the platform, so a directory of
 *  thousands is walked in parallel without flooding the bridge or the disk. */
const BATCH = 8;

/**
 * The directories the runtime keeps downloaded images in.
 *
 * `NshCacheOptions.DEFAULT` puts the image cache in the app's cache directory (`nsh` in it), which
 * is where it has been since v1.2.0, so the phone's own "clear cache" clears it too. The path is
 * derived from `dataDir` (`<app>/files`) rather than written out as `/data/user/0/…` alone: a work
 * profile or a second user is `/data/user/10/…`, where the literal would silently clear nothing.
 * The two literals stay as fallbacks. A directory that is not there costs one failed `readdir`.
 *
 * Nothing in these directories is state: cookies and the sign-in live in `Storage` (the app's data
 * directory), which clearing a cache never touches.
 */
function cacheRoots(): string[] {
  const roots: string[] = [];
  const dataDir = process.dataDir;
  if (dataDir) {
    const appDir = dataDir.replace(/\/files\/?$/, "");
    roots.push(`${appDir}/cache/nsh`, `${dataDir}/nsh-cache`, `${dataDir}/cache/nsh`);
  }
  if (platform.os === "android") {
    // `/data/user/0/…` is the real path on Android 4.2 and later, `/data/data/…` the alias every
    // version keeps; with scoped storage the first is what a file check sees.
    roots.push(`/data/user/0/${PACKAGE}/cache/nsh`, `/data/data/${PACKAGE}/cache/nsh`);
  }
  return [...new Set(roots)];
}

type Entry = { name: string; isDirectory(): boolean };

/** `items` mapped through `run`, `BATCH` at a time, in order. */
async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += BATCH) {
    out.push(...(await Promise.all(items.slice(at, at + BATCH).map(run))));
  }
  return out;
}

/** What the files under `path` take, in bytes; 0 when it cannot be listed. */
async function usage(path: string): Promise<number> {
  let entries: Entry[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await inBatches(entries, async (entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return await usage(child);
    try {
      return (await stat(child)).size;
    } catch {
      // Removed while we counted: nothing it adds.
      return 0;
    }
  });
  return sizes.reduce((sum, n) => sum + n, 0);
}

/**
 * Empties `path` of files and of the directories under it, keeping `path` itself, and reports what
 * it freed. `reached` false means the directory could not be listed at all — missing (nothing
 * cached there) or not ours to read.
 *
 * The runtime's image cache is a flat directory of one file per URL, with no index to update
 * (`nsh_core::image::DiskCache`): a file that is gone is a miss, and its next write rescans the
 * directory. So deleting these files behind its back is safe, and the walk counts while it
 * deletes instead of reading the sizes twice.
 */
async function empty(path: string): Promise<{ bytes: number; reached: boolean }> {
  let entries: Entry[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return { bytes: 0, reached: false };
  }
  let bytes = 0;
  const directories: string[] = [];
  await inBatches(entries, async (entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      directories.push(child);
      return;
    }
    try {
      const size = (await stat(child)).size;
      await unlink(child);
      bytes += size;
    } catch {
      // Gone already, or kept by the platform: nothing of ours to count.
    }
  });
  for (const child of directories) {
    bytes += (await empty(child)).bytes;
    try {
      await rmdir(child);
    } catch {
      // Not empty (something wrote while we cleared) or not ours: leaving it is harmless.
    }
  }
  return { bytes, reached: true };
}

/** How much the image cache takes now, in bytes. */
export async function cacheBytes(roots: string[] = cacheRoots()): Promise<number> {
  let total = 0;
  for (const root of roots) total += await usage(root);
  return total;
}

/** `n` as the settings panel prints it: "0 B", "820 KB", "34.6 MB". */
export function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Empties every cache directory, and reports what it freed and whether a directory could be
 * emptied at all. `cleared` false means the platform did not let us reach the cache (the phone's
 * own "clear cache" still can), so the caller can send the reader there instead of claiming a
 * cleanup that did not happen.
 */
export async function clearCaches(roots: string[] = cacheRoots()): Promise<{ bytes: number; cleared: boolean }> {
  let bytes = 0;
  let cleared = false;
  for (const root of roots) {
    const result = await empty(root);
    bytes += result.bytes;
    cleared = cleared || result.reached;
  }
  return { bytes, cleared };
}
