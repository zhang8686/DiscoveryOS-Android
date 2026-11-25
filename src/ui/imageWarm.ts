import { Image, pixelRatio, windowSize } from "nsh";

/** How wide a post's picture is drawn, in device pixels: the reading column at this screen's
 *  density, clamped so a tablet does not ask for a needlessly large copy. One source for the
 *  viewer, the thread's transform and the warm-up, so a picture warmed is the picture drawn. */
export function bodyPicturePx(): number {
  return Math.min(1440, Math.max(720, Math.round(windowSize().width * pixelRatio())));
}

/**
 * Loads pictures ahead of showing them.
 *
 * A post's pictures are drawn by the text view, which asks for each one only as it lays the body
 * out — so on a slow link the words appear first and the pictures fill in one round trip at a
 * time, which is what reading a picture-heavy thread felt like. `Image.prefetch` puts the bytes in
 * the same in-memory cache the views read (`Image` keeps encoded bytes and decoded images by URL),
 * so warming the pictures of a page the moment it arrives overlaps their download with the layout
 * that follows, and the next pictures of the page are already there when the reader scrolls.
 *
 * Requests stay few and ordered: one queue, a couple in flight, and every address asked for once.
 */

/** Loads one picture; swapped in tests so the queue can be checked without a network. */
type Loader = (url: string) => Promise<unknown>;

const defaultLoader: Loader = (url) => Image.prefetch(url);
let loader: Loader = defaultLoader;

/** Addresses already asked for (loaded or in flight): a warm-up never repeats one. */
const asked = new Set<string>();
const queue: string[] = [];
/** How many warm-ups run at once: enough that a page of pictures arrives together, few enough
 *  that the pictures already on screen are not starved of the connection. The runtime's own
 *  download pool is the ceiling (`Images.POOL`), so this never asks for more than it can run. */
const CONCURRENCY = 6;
let active = 0;

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const url = queue.shift();
    if (!url) break;
    active++;
    loader(url)
      // A picture that cannot load is the text view's problem to report, not the warm-up's.
      .catch(() => undefined)
      .finally(() => {
        active--;
        pump();
      });
  }
}

/** Warms `urls`, in order, at most `limit` of them (the ones a reader reaches first).
 *  Blank and already-asked addresses are skipped; the call never throws. */
export function warmImages(urls: string[], limit = 8): void {
  let n = 0;
  for (const url of urls) {
    if (n >= limit) break;
    if (!url || asked.has(url)) continue;
    asked.add(url);
    queue.push(url);
    n++;
  }
  if (queue.length > 0) pump();
}

/**
 * Warms `urls` ahead of whatever is queued: the pictures the reader is about to step to (the
 * viewer's neighbours), which would otherwise wait behind a page's worth of body pictures that
 * were asked for first. Order within `urls` is kept; already-asked addresses are skipped.
 */
export function warmImagesFirst(urls: string[], limit = 3): void {
  const fresh: string[] = [];
  for (const url of urls) {
    if (fresh.length >= limit) break;
    if (!url || asked.has(url)) continue;
    asked.add(url);
    fresh.push(url);
  }
  if (fresh.length === 0) return;
  queue.unshift(...fresh);
  pump();
}

/** Forgets what was warmed (a sign-out drops the session the pictures were fetched with). */
export function clearWarmedImages(): void {
  asked.clear();
  queue.length = 0;
}

/** How many pictures are queued or loading, for tests and diagnostics. */
export function warmPending(): number {
  return queue.length + active;
}

/** How many addresses have been asked for since the last clear, for tests. */
export function warmedCount(): number {
  return asked.size;
}

/**
 * Faces, warmed apart from the body's pictures.
 *
 * An avatar is drawn the moment its row comes into view: without bytes already in the cache the
 * row shows the grey square, then the face fades in a round trip later — the "avatars appear one by
 * one" a long list was known for. The address of a row's face is known before it is drawn (a uid
 * builds it, a name resolves to it), so it can be fetched ahead of the row.
 *
 * A queue of its own, so a page of faces never sits behind a page of post pictures and a body's
 * warm-up (which clears its own queue on entry) does not drop them. Faces are small and few:
 * a couple in flight is enough, and the runtime's own `Image` cache answers a row that asks again.
 */
const faceAsked = new Set<string>();
const faceQueue: string[] = [];
let faceActive = 0;
/** Four at once: the runtime downloads on four threads (`Images.POOL`), and a face is a few
 *  kilobytes — matching that count drains a screenful of faces before the body's pictures,
 *  which are the ones that actually wait on bandwidth. */
const FACE_CONCURRENCY = 4;

function pumpFaces(): void {
  while (faceActive < FACE_CONCURRENCY && faceQueue.length > 0) {
    const url = faceQueue.shift();
    if (!url) break;
    faceActive++;
    loader(url)
      .catch(() => undefined)
      .finally(() => {
        faceActive--;
        pumpFaces();
      });
  }
}

/** Warms the faces `urls` (in row order), at most `limit` of them. Never throws. */
export function warmAvatars(urls: (string | undefined)[], limit = 12): void {
  let n = 0;
  for (const url of urls) {
    if (n >= limit) break;
    if (!url || faceAsked.has(url)) continue;
    faceAsked.add(url);
    faceQueue.push(url);
    n++;
  }
  if (faceQueue.length > 0) pumpFaces();
}

/** How many faces are queued or loading (tests, and the sign-out reset below). */
export function warmAvatarsPending(): number {
  return faceQueue.length + faceActive;
}

/** Drops the warmed faces (a sign-out, when another member's list follows). */
export function clearWarmedAvatars(): void {
  faceAsked.clear();
  faceQueue.length = 0;
}

/** Runs the queue through `fn` instead of loading pictures (`null` puts `Image.prefetch` back). */
export function setImageLoader(fn: Loader | null): void {
  loader = fn ?? defaultLoader;
}
