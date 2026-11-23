// A tiny test-only app: exercises the load paths whose dedup/caching we changed and prints
// the outcomes as text the host can read. Not part of the shipped app.
import { mount, signal, Text, View } from "nsh";
import { loadPosts } from "./forum";
import { userAvatar } from "./avatarCache";

const result = signal("");

export default function LoadingHarness() {
  // Fire two concurrent requests for the same page. With in-flight sharing they collapse
  // into one network GET; the host counts the requests directly.
  void Promise.all([
    loadPosts("2", 1, "lastpost"),
    loadPosts("2", 1, "lastpost"),
  ]).then(([a, b]) => result.set(`posts:${a.length}/${b.length}`));

  // Two concurrent avatar lookups for one name share a single profile request, and the
  // in-memory resolved map makes a later lookup free.
  void Promise.all([userAvatar("tester"), userAvatar("tester")]).then(() => {
    void userAvatar("tester").then((u) => result.set(`${result()} avatar:${u ?? "none"}`));
  });

  return (
    <View><Text>{result() || "running"}</Text></View>
  );
}

mount(LoadingHarness);
