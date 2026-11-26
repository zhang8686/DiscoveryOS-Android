import { expect, test } from "nsh/test";
import { formatBytes } from "./cache";

test("formatBytes prints a size the settings row can show", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1024)).toBe("1 KB");
  expect(formatBytes(1024 * 1024 * 3.5)).toBe("3.5 MB");
});
