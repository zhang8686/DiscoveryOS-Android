import { expect, test } from "nsh/test";
import { clearWarmedAvatars, clearWarmedImages, setImageLoader, warmAvatars, warmAvatarsPending, warmImages, warmPending, warmedCount } from "./imageWarm";

/** A loader that records what it was asked for and answers on the next tick. */
function recorder() {
  const seen: string[] = [];
  setImageLoader((url) => {
    seen.push(url);
    return new Promise<void>((resolve) => setTimeout(resolve, 1));
  });
  return seen;
}

test("a warm-up asks for each address once, however often it is queued", async () => {
  clearWarmedImages();
  const seen = recorder();
  warmImages(["a.jpg", "b.jpg", "c.jpg"], 8);
  warmImages(["a.jpg", "b.jpg"], 8);
  await waitIdle();
  expect(seen).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  expect(warmedCount()).toBe(3);
});

test("a warm-up takes only the first `limit` addresses, in reading order", async () => {
  clearWarmedImages();
  const seen = recorder();
  warmImages(["1.jpg", "2.jpg", "3.jpg", "4.jpg"], 2);
  await waitIdle();
  expect(seen).toEqual(["1.jpg", "2.jpg"]);
  // The ones past the limit stay unknown, so a later page may warm them.
  warmImages(["3.jpg"], 1);
  await waitIdle();
  expect(seen).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
});

test("only three warm-ups run at once, leaving the pool a thread for what is on screen", async () => {
  clearWarmedImages();
  let running = 0;
  let peak = 0;
  setImageLoader((url) => {
    void url;
    running++;
    peak = Math.max(peak, running);
    return new Promise<void>((resolve) => setTimeout(() => { running--; resolve(); }, 5));
  });
  warmImages(["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg", "7.jpg", "8.jpg", "9.jpg"], 9);
  await waitIdle();
  expect(peak).toBe(3);
  expect(warmedCount()).toBe(9);
  setImageLoader(null);
});

test("blank addresses are skipped and a failed picture does not stop the queue", async () => {
  clearWarmedImages();
  const seen: string[] = [];
  setImageLoader((url) => {
    seen.push(url);
    return url === "bad.jpg" ? Promise.reject(new Error("no")) : Promise.resolve();
  });
  warmImages(["", "bad.jpg", "good.jpg"], 8);
  await waitIdle();
  expect(seen).toEqual(["bad.jpg", "good.jpg"]);
  expect(warmPending()).toBe(0);
  setImageLoader(null);
});

/** Lets the loader promises and the queues settle. */
async function waitIdle(): Promise<void> {
  for (let i = 0; i < 50 && (warmPending() > 0 || warmAvatarsPending() > 0); i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

test("faces are warmed once each, alongside a page's pictures", async () => {
  clearWarmedImages();
  clearWarmedAvatars();
  const seen = recorder();
  warmImages(["post-1.jpg"], 8);
  warmAvatars(["face-a.jpg", "face-b.jpg", "face-a.jpg"]);
  await waitIdle();
  expect(seen.sort()).toEqual(["face-a.jpg", "face-b.jpg", "post-1.jpg"]);
  expect(warmAvatarsPending()).toBe(0);
});

test("a thread's own warm-up does not drop the faces a list asked for", async () => {
  clearWarmedImages();
  clearWarmedAvatars();
  const seen = recorder();
  warmAvatars(["face-a.jpg"]);
  await waitIdle();
  // Entering a thread clears the pictures' queue, not the faces' answers.
  clearWarmedImages();
  warmAvatars(["face-a.jpg"]);
  await waitIdle();
  expect(seen).toEqual(["face-a.jpg"]);
  // A sign-out drops them, so the next member's list asks again.
  clearWarmedAvatars();
  warmAvatars(["face-a.jpg"]);
  await waitIdle();
  expect(seen).toEqual(["face-a.jpg", "face-a.jpg"]);
});
