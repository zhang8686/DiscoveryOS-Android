import { expect, test } from "nsh/test";
import { attachmentLinks, fixImages, isAttachmentUrl } from "./parse";
import { attachmentFileName, extensionForType, fileNameFromDisposition, safeFileName, splitFileName } from "./attachments";
import { Gb18030 } from "../nativeStub";

test("finds a post's file links by their text, and not a picture's link", () => {
  const html =
    '<div class="postmessage">这是一个文件<br>' +
    '<dl class="t_attachlist"><dt><img src="images/attachicons/zip.gif" alt="" />' +
    '<a href="attachment.php?aid=MTIz&amp;k=1" target="_blank">newton.md</a> (16.06 KB)</dt></dl>' +
    '<a href="attachment.php?aid=MTI0"><img src="attachments/d/a.jpg.thumb.jpg"></a></div>';
  expect(attachmentLinks(html)).toEqual([{ url: "attachment.php?aid=MTIz&k=1", name: "newton.md" }]);
});

test("reads Discuz X's attachment links too", () => {
  expect(attachmentLinks('<a href="forum.php?mod=attachment&amp;aid=9">report.pdf</a>')).toEqual([
    { url: "forum.php?mod=attachment&aid=9", name: "report.pdf" },
  ]);
});

test("accepts only the forum's own attachment downloads", () => {
  expect(isAttachmentUrl("https://www.4d4y.com/forum/attachment.php?aid=1")).toBe(true);
  expect(isAttachmentUrl("https://img02.4d4y.com/forum/forum.php?mod=attachment&aid=1")).toBe(true);
  expect(isAttachmentUrl("https://www.4d4y.com/forum/attachment.php?aid=1")).toBe(true);
  expect(isAttachmentUrl("attachment.php?aid=1")).toBe(true);
  expect(isAttachmentUrl("https://evil.example/attachment.php?aid=1")).toBe(false);
  expect(isAttachmentUrl("https://4d4y.com.evil.example/attachment.php?aid=1")).toBe(false);
  expect(isAttachmentUrl("javascript:attachment.php")).toBe(false);
  expect(isAttachmentUrl("https://www.4d4y.com/forum/viewthread.php?tid=1")).toBe(false);
});

test("keeps a hidden attachment menu out of the text, but a block with a file link", () => {
  const menu = '<div class="t_attach" style="display: none">\n<a href="x">下载</a>\n</div>\n</div>';
  expect(fixImages(`a${menu}b`)).toBe("ab");
  const visible = '<div class="t_attach"><a href="attachment.php?aid=1">newton.md</a></div></div>';
  expect(fixImages(`a${visible}`)).toBe(`a${visible}`);
});

test("names a saved file safely", () => {
  expect(safeFileName("newton.md")).toBe("newton.md");
  expect(safeFileName("../../.bashrc")).toBe("bashrc");
  expect(safeFileName("a/b\\c.zip")).toBe("c.zip");
  expect(safeFileName("bad:name?.txt")).toBe("badname.txt");
  expect(safeFileName("   ")).toBe("download");
  expect(safeFileName("x".repeat(300) + ".md").length).toBeLessThanOrEqual(180);
});

test("splits a name at its last dot", () => {
  expect(splitFileName("a.tar.gz")).toEqual({ stem: "a.tar", ext: ".gz" });
  expect(splitFileName("README")).toEqual({ stem: "README", ext: "" });
  expect(splitFileName(".gitignore")).toEqual({ stem: ".gitignore", ext: "" });
});

test("takes a file's real name from the forum's answer", () => {
  expect(fileNameFromDisposition('attachment; filename="newton.md"')).toBe("newton.md");
  expect(fileNameFromDisposition("attachment; filename*=UTF-8''%E8%AF%B4%E6%98%8E%E4%B9%A6.pdf")).toBe("说明书.pdf");
  // Discuz writes Chinese names in GB18030: the bytes arrive as one character per byte.
  const gbk = Array.from(Gb18030.encode("说明书.zip")).map((b) => String.fromCharCode(b)).join("");
  expect(fileNameFromDisposition(`attachment; filename="${gbk}"`)).toBe("说明书.zip");
  expect(fileNameFromDisposition("inline")).toBe(null);
  expect(fileNameFromDisposition(null)).toBe(null);
});

test("names a download that the link calls 下载", () => {
  // The link text is the forum's word for it; the answer names the file.
  expect(attachmentFileName("下载", "newton.md", "text/plain")).toBe("newton.md");
  // Nothing names it but the type: the stem carries the moment, the extension the type.
  expect(attachmentFileName("下载", null, "application/zip")).toMatch(/^附件-\d{8}-\d{4}\.zip$/);
  expect(attachmentFileName("下载", null, "application/octet-stream")).toMatch(/^附件-\d{8}-\d{4}$/);
  // A name without an extension keeps the one the type gives it.
  expect(attachmentFileName("下载", "download", "application/pdf")).toMatch(/^附件-\d{8}-\d{4}\.pdf$/);
  expect(extensionForType("text/plain; charset=utf-8")).toBe("txt");
  expect(extensionForType("application/whatever")).toBe("");
});
