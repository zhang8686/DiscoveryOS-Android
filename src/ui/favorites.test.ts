import { expect, test } from "nsh/test";
import { reconcile, type Favorite } from "./favorites";
import type { Post } from "../discuz/parse";

const post = (id: string, lastReplyAt: string): Post => ({ id, title: id, fid: "2", lastReplyAt });

test("a saved favorite later than the page's oldest day and not on it is dropped", () => {
  const saved: Favorite[] = [
    { id: "1", day: "2026-11-05" },
    { id: "2", day: "2026-10-20" },
    { id: "3", day: "2026-10-01" },
  ];
  const page = [post("1", "2026-11-06"), post("9", "2026-10-10")];
  expect(reconcile(saved, page, false).map((f) => f.id).sort()).toEqual(["1", "3", "9"]);
});

test("a saved favorite on or before the page's oldest day is kept", () => {
  const saved: Favorite[] = [{ id: "3", day: "2026-10-10" }];
  expect(reconcile(saved, [post("9", "2026-10-10")], false).map((f) => f.id).sort()).toEqual(["3", "9"]);
});

test("a complete list drops every saved favorite it does not show", () => {
  const saved: Favorite[] = [{ id: "3", day: "2026-01-01" }];
  expect(reconcile(saved, [post("9", "2026-11-06")], true).map((f) => f.id)).toEqual(["9"]);
});

test("a saved favorite with no known day is kept", () => {
  const saved: Favorite[] = [{ id: "3", day: null }];
  expect(reconcile(saved, [post("9", "2026-11-06")], false).map((f) => f.id).sort()).toEqual(["3", "9"]);
});
