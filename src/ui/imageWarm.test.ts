import { expect, test } from "nsh/test";
import { clearWarmedImages, setImageLoader, warmImages, warmPending, warmedCount } from "./imageWarm";

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

/** Lets the loader promises and the queue settle. */
async function waitIdle(): Promise<void> {
  for (let i = 0; i < 50 && warmPending() > 0; i++) await new Promise<void>((resolve) => setTimeout(resolve, 5));
}
