// A tiny test-only app that drives the real login flow against the host's stubbed
// network. Not part of the shipped app.
import { mount, signal, Text, View } from "nsh";
import { login } from "./client";

const result = signal("running");

export default function LoginHarness() {
  void login("tester", "secret")
    .then((ok) => result.set(ok ? "signed-in" : "refused"))
    .catch((e) => result.set(`error:${e instanceof Error ? e.message : String(e)}`));
  return <View><Text>{result()}</Text></View>;
}

mount(LoginHarness);
