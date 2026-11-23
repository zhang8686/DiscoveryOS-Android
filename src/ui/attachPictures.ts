import { Image, signal } from "nsh";
import { attachmentIsPicture } from "../discuz/attachments";

/**
 * Which of a post's attachments are pictures, asked of the forum once each and remembered for the
 * app's life. A picture the author attached but did not put in the text arrives as a download
 * line; `showAttachedPictures` draws the picture there instead, once this says it is one.
 *
 * Two answers make a picture: the forum's type for the address (`attachmentIsPicture`, headers
 * only), then a real load (`Image.getSize`) — the same loader the view will use, so a picture the
 * loader cannot get (a board that wants a session it does not send) is not promised. Its bytes
 * stay loaded for the view that draws it next.
 */
const decided = new Map<string, boolean>();
const asking = new Set<string>();
const revision = signal(0);

/** Bumped when an answer about an attachment arrives, so the floors redraw. */
export function attachedPictureRevision(): number {
  return revision();
}

/**
 * Whether the attachment at `url` shows as a picture in the post: `false` until the answer is in
 * (the floor draws as it did, then redraws with the picture). Asking starts on the first call.
 */
export function attachedPicture(url: string): boolean {
  const known = decided.get(url);
  if (known !== undefined) return known;
  if (!asking.has(url)) {
    asking.add(url);
    void (async () => {
      let picture = false;
      try {
        picture = (await attachmentIsPicture(url)) && (await loads(url));
      } catch {
        picture = false;
      }
      decided.set(url, picture);
      revision.set(revision() + 1);
    })();
  }
  return false;
}

/** Whether the app's picture loader can load it at all. */
async function loads(url: string): Promise<boolean> {
  try {
    await Image.getSize(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * What is known about `url`: `true` or `false` once the answer is in, `undefined` while it is on
 * the way (asking starts here, as it does in `attachedPicture`). A press on the download line uses
 * it to tell a picture — which opens the viewer — from a file, which is downloaded.
 */
export function attachedPictureKnown(url: string): boolean | undefined {
  const known = decided.get(url);
  if (known === undefined) void attachedPicture(url);
  return known;
}

/** Forgets what was asked (tests, and a sign-out that drops the session the answers came with). */
export function clearAttachedPictures(): void {
  decided.clear();
  asking.clear();
  revision.set(revision() + 1);
}
