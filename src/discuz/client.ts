import { formEncodeGb, fetchGbRequest, htmlEntities, postFormGb, postGbNoRedirect } from "./encoding";
import { absorbSetCookie, clearCookies, cookieHeader } from "./cookies";
import { flushVault } from "./vault";
import { htmlDecode, parseLoginQuestions } from "./parse";
import { discuzPassword } from "./md5";
import type { ReplyNotice } from "./replyTo";

export const HOST = "https://www.4d4y.com/forum/";

/** Login gets its own deadlines. A slow config page must never masquerade as "登录失败". */
const LOGIN_TIMEOUT_MS = 20_000;
const LOGIN_VERIFY_MS = 15_000;
const CONFIG_TIMEOUT_MS = 8_000;

const LOGIN_REQUIRED = '<select name="loginfield" id="loginfield">';
const LOGOUT_LINK = /href="logging\.php\?action=logout&amp;formhash=([^"]+)"/;
const HIDDEN_FORMHASH = /<input[^>]*\bname="formhash"[^>]*\bvalue="([^"]+)"/;
const REPLY_OK = "非常感谢，您的回复已经发布，现在将转入主题页";
const POSTBOX = /<div class="postbox">([\s\S]*?)<\/div>/;
const AJAX_REFUSAL = /messagehandle_fastpost\('[^']*', '([^']*)'\)/;
const PAGE_SIZE = /name="pppnew" value="(\d+)" checked="checked"/;
const MEMBER_LINK = /<a href="space\.php\?uid=\d+"[^>]*>([^<]+)<\/a>/;

export type Session = { name: string; pass: string; questionId?: number; answer?: string };

let session: Session | null = null;
let signedInName: string | null = null;
let formHash: string | null = null;
export let pageSize = 50;

/** The form hash in a page, if it shows the logged-in header. */
export function parseFormHash(html: string): string | undefined {
  return LOGOUT_LINK.exec(html)?.[1];
}

/** The form hash in a page's hidden form input, if it has one. */
export function parseHiddenFormHash(html: string): string | undefined {
  return HIDDEN_FORMHASH.exec(html)?.[1];
}

/** The posts-per-page setting in the profile page, if present and positive. */
export function parsePageSize(html: string): number | undefined {
  const n = Number(PAGE_SIZE.exec(html)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function isLoginRequired(html: string): boolean {
  return html.includes(LOGIN_REQUIRED);
}

/** A GB18030 request. Re-logs in once if the page asks for it (`retry`). */
export async function request(
  method: "GET" | "POST",
  path: string,
  options: { query?: [string, string][]; form?: [string, string][]; retry?: boolean; cookie?: string; timeoutMs?: number } = {},
): Promise<string> {
  const { retry = true } = options;
  try {
    return await requestOnce(method, path, options);
  } catch (e) {
    if (method !== "GET" || !retry) throw e;
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    return await requestOnce(method, path, { ...options, retry: false });
  }
}

async function requestOnce(
  method: "GET" | "POST",
  path: string,
  options: { query?: [string, string][]; form?: [string, string][]; retry?: boolean; cookie?: string; timeoutMs?: number } = {},
): Promise<string> {
  const { query, form, retry = true, cookie, timeoutMs } = options;
  const qs = query?.map(([k, v]) => `${formEncodeGb(k)}=${formEncodeGb(v)}`).join("&");
  const url = HOST + path + (qs ? (path.includes("?") ? "&" : "?") + qs : "");
  const body = method === "POST" && form ? form.map(([k, v]) => `${formEncodeGb(k)}=${formEncodeGb(v)}`).join("&") : undefined;
  const headerCookie = [cookieHeader(), cookie].filter(Boolean).join("; ") || undefined;
  const { html, setCookies } = await fetchGbRequest(method, url, body, headerCookie, timeoutMs);
  absorbSetCookie(setCookies);
  // Every signed-in page carries a fresh form hash; keep the latest so writes don't use a stale one.
  if (formHash) {
    const fresh = parseHiddenFormHash(html) ?? parseFormHash(html);
    if (fresh) formHash = fresh;
  }
  if (retry && isLoginRequired(html) && session) {
    const relogged = await reLogin(session.name, session.pass, session.questionId, session.answer);
    if (relogged) return request(method, path, { query, form, retry: false, cookie, timeoutMs });
  }
  return html;
}

/**
 * The thread page holding post `pid`, found through Discuz's `findpost` redirect, which the
 * fetch follows: the page's HTML and its page number (1 when the address names none).
 */
export async function findFloor(tid: string, pid: string): Promise<{ html: string; page: number }> {
  const { html, setCookies, url } = await fetchGbRequest(
    "GET",
    `${HOST}redirect.php?goto=findpost&pid=${pid}&ptid=${tid}`,
    undefined,
    cookieHeader() || undefined,
  );
  absorbSetCookie(setCookies);
  return { html, page: Number(new URL(url).searchParams.get("page")) || 1 };
}

/** The hidden values the site's own login form posts alongside the credentials. */
type LoginMeta = { hash?: string; sid?: string };

// The dialog reads this page for its security questions, and the POST needs the
// same hash and sid. One short-lived copy serves both instead of fetching it twice.
let loginPage: { html: string; at: number } | null = null;

async function readLoginPage(): Promise<string> {
  if (loginPage && Date.now() - loginPage.at < 60_000) return loginPage.html;
  const html = await request("GET", "logging.php?action=login", { retry: false, timeoutMs: LOGIN_TIMEOUT_MS });
  loginPage = { html, at: Date.now() };
  return html;
}

/** Reads the login page so the POST carries a fresh form hash and sid, as a browser's does. */
async function loadLoginMeta(force = false): Promise<LoginMeta> {
  if (force) loginPage = null;
  try {
    const html = await readLoginPage();
    return {
      hash: parseHiddenFormHash(html),
      sid: /name="sid"\s+value="([^"]+)"/.exec(html)?.[1],
    };
  } catch {
    // Without the form page the POST still has a chance with the session's known hash.
    return {};
  }
}

/** Forgets the cached login form, e.g. before a retry after a timeout. */
function refreshLoginMeta(): Promise<LoginMeta> { return loadLoginMeta(true); }

/**
 * Builds the login form exactly as the forum's `loginform` does. Exported so a
 * test can check the fields without a live forum.
 */
export function loginFormFields(
  name: string,
  pass: string,
  meta: LoginMeta,
  questionId = 0,
  answer = "",
): [string, string][] {
  // `pwmd5()` in the page's inline script replaces the field with
  // `hex_md5(addslashes(password))`; Discuz checks md5(md5(password) . salt).
  const form: [string, string][] = [
    ["username", name],
    ["password", discuzPassword(pass)],
    ["loginfield", "username"],
    ["loginsubmit", "true"],
    // A persistent login (30 days, the web form's "记住登录" cookietime): without
    // it Discuz issues a session-only cookie, and a launch the next day asks again.
    ["cookietime", "2592000"],
    ["referer", ""],
  ];
  if (meta.hash) form.push(["formhash", meta.hash]);
  if (meta.sid) form.push(["sid", meta.sid]);
  // A member who set a security question must answer it; field 0 posts none.
  if (questionId > 0) {
    form.push(["questionid", String(questionId)]);
    form.push(["answer", answer]);
  }
  return form;
}

const isTimeout = (e: unknown): boolean => e instanceof Error && e.message.startsWith("请求超时");

/**
 * The member's own form hash, read from a page served after the auth cookie was
 * set. A GET is safe to repeat, so a slow member page gets one more chance here
 * instead of re-posting the credentials.
 */
async function verifyLogin(): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const page = await request("GET", "my.php", {
        query: [["item", "threads"]],
        retry: false,
        timeoutMs: LOGIN_VERIFY_MS,
      });
      return parseFormHash(page);
    } catch (e) {
      if (!isTimeout(e) || attempt === 1) throw e;
    }
  }
  return undefined;
}

async function dologin(name: string, pass: string, questionId = 0, answer = ""): Promise<string | undefined> {
  // A POST is never retried by `request`: doing it with a stale form hash only
  // wastes another attempt. A timeout is retried once with a freshly read form.
  let posted = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const meta = await loadLoginMeta();
    const form = loginFormFields(name, pass, meta, questionId, answer);
    try {
      await request("POST", "logging.php?action=login&loginsubmit=yes", {
        form,
        retry: false,
        timeoutMs: LOGIN_TIMEOUT_MS,
      });
      posted = true;
      break;
    } catch (e) {
      if (!isTimeout(e) || attempt === 1) throw e;
      // The first attempt may have reached the server just as the deadline passed:
      // a fresh form keeps the retry from using a stale hash/sid.
      await refreshLoginMeta();
    }
  }
  if (!posted) return undefined;
  // `requestOnce` has already absorbed the auth cookies from the reply here.
  // The forum's member page — not the login reply's guest hash — is the proof.
  return await verifyLogin();
}

// The login in progress, if any. Requests that find the login page while one runs
// share its answer, so a burst of loads logs in once rather than once each.
let loginInFlight: Promise<string | undefined> | null = null;

function reLogin(name: string, pass: string, questionId?: number, answer?: string): Promise<string | undefined> {
  // The new login's form hash replaces the old one: every write sends it, and the old one is refused.
  loginInFlight ??= dologin(name, pass, questionId, answer)
    .then((hash) => {
      if (hash) formHash = hash;
      return hash;
    })
    .finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

/** Reads the posts-per-page setting; a best-effort extra, never part of signing in. */
async function loadConfig(): Promise<void> {
  const html = await request("GET", "memcp.php?action=profile&typeid=5", {
    retry: false,
    timeoutMs: CONFIG_TIMEOUT_MS,
  });
  const n = parsePageSize(html);
  if (n) pageSize = n;
}

/**
 * Logs in; on success keeps the credentials for re-login and loads the config.
 * Only the member page confirming the session can fail the login: the config
 * page is deliberately best-effort, so its failure cannot be shown as
 * "登录失败：请求超时" when the account was accepted.
 */
export async function login(name: string, pass: string, questionId = 0, answer = ""): Promise<boolean> {
  const hash = await dologin(name, pass, questionId, answer);
  if (!hash) {
    session = null;
    formHash = null;
    return false;
  }
  session = { name, pass, questionId, answer };
  signedInName = name;
  formHash = hash;
  try {
    await loadConfig();
  } catch { /* keep the default page size; the account is already signed in */ }
  // The auth cookie must be durable before the app can be backgrounded.
  await flushVault();
  return true;
}

/** The security questions the login page offers, in its order; empty when the page has none. */
export async function loadLoginQuestions(): Promise<{ id: number; text: string }[]> {
  try {
    return parseLoginQuestions(await readLoginPage());
  } catch {
    return [];
  }
}

/** Logs out and forgets the session. (Cookies are the platform's; see the notes.) */
export async function logout(): Promise<void> {
  try {
    if (formHash) {
      await request("GET", `logging.php?action=logout&formhash=${formHash}`, { retry: false });
    }
  } finally {
    session = null;
    signedInName = null;
    formHash = null;
    clearCookies();
    await flushVault();
  }
}

/**
 * Resumes a saved session at launch. With saved cookies, the index page's
 * logout link says whether they still work; otherwise (or when they expired)
 * the saved password signs in again. A network failure keeps everything saved:
 * only a refused password clears it.
 */
export async function restoreSession(saved: { name: string; pass: string } | null): Promise<"signed-in" | "signed-out" | "offline"> {
  try {
    // `my.php` is served to guests and members alike (unlike `index.php`, which
    // Cloudflare challenges when no session cookie is present), and its header
    // carries both the member's name and a fresh form hash.
    const html = await request("GET", "my.php", { query: [["item", "threads"]], retry: false });
    const hash = parseFormHash(html);
    const member = MEMBER_LINK.exec(html)?.[1];
    if (hash) {
      formHash = hash;
      signedInName = member ? htmlDecode(member).trim() : (saved?.name ?? null);
      // No password is stored on Android, so `session` stays null: the request
      // layer must not try to re-login with a blank password.
      session = null;
      return "signed-in";
    }
    signedInName = null;
  } catch (e) {
    // A server refusal (`HTTP …`) is not a network failure: report it, so the
    // user sees why the login did not restore instead of a misleading "offline".
    if (e instanceof Error && e.message.startsWith("HTTP ")) throw e;
    return "offline";
  }
  if (!saved) return "signed-out";
  try {
    return (await login(saved.name, saved.pass)) ? "signed-in" : "signed-out";
  } catch {
    return "offline";
  }
}

/** The upload form and post time of a reply page (`post.php?action=reply`). */
export type ReplyBox = { uid: string; hash: string; posttime: string };

/** Reads the reply box's upload form and post time; `undefined` when the page has none. */
export function parseReplyBox(html: string): ReplyBox | undefined {
  const form = /<form name="imgattachform"[\s\S]*?<\/form>/.exec(html)?.[0];
  if (!form) return undefined;
  const uid = /name="uid" value="(\d+)"/.exec(form)?.[1];
  const hash = /name="hash" value="([0-9a-f]+)"/.exec(form)?.[1];
  const posttime = /name="posttime" id="posttime" value="(\d+)"/.exec(html)?.[1];
  return uid && hash && posttime ? { uid, hash, posttime } : undefined;
}

/** The image attachments the reply box lists as unused: `insertAttachimgTag('id')` in its list. */
export function parseAttachIds(html: string): string[] {
  return [...html.matchAll(/insertAttachimgTag\('(\d+)'\)/g)].map((m) => m[1]);
}

/** The attachment ids a reply's text inserts (`[attachimg]id[/attachimg]` for a picture, `[attach]id[/attach]` for a file), once each. */
export function attachedIds(content: string): string[] {
  return [...new Set([...content.matchAll(/\[attach(?:img)?\](\d+)\[\/attach(?:img)?\]/g)].map((m) => m[1]))];
}

// `STATUSMSG` of Discuz's `post.js`: the upload's failure codes, in English.
const UPLOAD_ERRORS: Record<string, string> = {
  "-1": "服务器错误",
  "1": "文件类型不允许",
  "2": "文件为空",
  "3": "文件过大",
  "4": "文件类型不允许",
  "5": "文件过大",
  "6": "附件总体积过大",
  "7": "不是有效的图片",
  "8": "文件无法保存",
  "9": "没有上传有效文件",
  "10": "不允许",
};

// The post time of the reply box an upload started on, per thread. The reply
// sends it with the attachments so Discuz links them to the post.
const postTimes = new Map<string, string>();

// The post time of a new thread's box, per channel; a thread not yet posted has no thread id.
const newThreadKey = (fid: string) => `new:${fid}`;

// The reply box of a thread, or the new-thread box of a channel when there is no thread yet.
async function replyBox(fid: string, tid?: string): Promise<ReplyBox> {
  const url = tid ? `post.php?action=reply&fid=${fid}&tid=${tid}` : `post.php?action=newthread&fid=${fid}`;
  const box = parseReplyBox(await request("GET", url));
  if (!box) throw new Error("回复框中没有图片上传入口");
  return box;
}

/** The unused image attachments of a post time, as the reply box lists them. */
async function unusedImages(posttime: string): Promise<string[]> {
  const html = await request("GET", "ajax.php?action=attachlist", {
    query: [["posttime", posttime], ["inajax", "1"], ["ajaxtarget", "attachlist"]],
  });
  return parseAttachIds(html);
}

/**
 * Uploads a picked image as the reply box's own upload does
 * (`misc.php?action=swfupload`), and resolves with its attachment id: the new
 * entry in the reply box's list. The reply then names it in `[attachimg]`.
 */
export async function uploadAttachment(fid: string, tid: string | undefined, file: File, kind: "image" | "file"): Promise<string> {
  if (!formHash) throw new Error("尚未登录");
  const box = await replyBox(fid, tid);
  postTimes.set(tid ?? newThreadKey(fid), box.posttime);
  return uploadToBox(box, file, kind);
}

/**
 * Uploads a picture while a post is being edited, through the edit form's own upload box. Its post
 * time is the edit form's, so the picture is linked to the post being edited (not to a new reply).
 */
export async function uploadEditAttachment(form: EditForm, file: File, kind: "image" | "file"): Promise<string> {
  if (!formHash) throw new Error("尚未登录");
  if (!form.upload) throw new Error("编辑表单中没有图片上传入口");
  return uploadToBox({ ...form.upload, posttime: form.posttime }, file, kind);
}

/** Sends a file through a box's upload form and resolves with its attachment id. */
async function uploadToBox(box: ReplyBox, file: File, kind: "image" | "file"): Promise<string> {
  const before = await unusedImages(box.posttime);
  const form = new FormData();
  form.append("uid", box.uid);
  form.append("hash", box.hash);
  form.append("Filedata", file, file.name);
  const { text, setCookies } = await postFormGb(
    HOST + `misc.php?action=swfupload&operation=upload&simple=1&type=${kind}`,
    form,
    cookieHeader(),
  );
  absorbSetCookie(setCookies);
  const [marker, code, aid] = text.split("|");
  if (marker !== "DISCUZUPLOAD" || code !== "0") {
    const reason = marker === "DISCUZUPLOAD" ? UPLOAD_ERRORS[code] ?? `code ${code}` : text.slice(0, 80);
    throw new Error(`Upload failed: ${reason}`);
  }
  // The upload's own reply names the attachment when it does; else the list shows it.
  if (aid && /^\d+$/.test(aid)) return aid;
  const after = await unusedImages(box.posttime);
  const added = after.filter((id) => !before.includes(id));
  if (added.length === 0) {
    throw new Error(`The uploaded image is not in the reply box (upload reply: ${text.slice(0, 60)}; list: ${after.length} ids)`);
  }
  // Ids grow with each upload, so the newest is the largest.
  return added.reduce((a, b) => (Number(b) > Number(a) ? b : a));
}

// The app signs what it publishes: a small-font link at the end of a new thread or a reply. It is
// sent as Discuz BBCode, not raw HTML — Discuz escapes raw tags in a post, which shows the markup
// as text instead of a link. It is added here, in the two publish calls, so it never enters the
// editor or a draft and is not sent when editing an existing post.
const TAIL_TID = "3476658";
const TAIL_MARK = `viewthread.php?tid=${TAIL_TID}`;
const TAIL_BBCODE = `　[size=1][url=${HOST}viewthread.php?tid=${TAIL_TID}]| DiscoveryOSX[/url][/size]`;

/** Appends the signature once, after any attachments, without touching the author's text. A body
 *  that already carries the link (quoted, or copied from an earlier post) is left as it is. */
export function withSignature(content: string): string {
  return content.includes(TAIL_MARK) ? content : `${content.trimEnd()}${TAIL_BBCODE}`;
}

/** A reply the forum refused; its message is the forum's own words, shown to the user. */
export class ReplyRefused extends Error {}

/** Posts a reply to a thread (`DiscuzAPI.postReply`). Resolves on success;
 * rejects with the page's own message when Discuz refuses it. The image
 * attachments the text inserts (`[attachimg]`) go with it. `notice` is the web
 * reply form's hidden fields for a targeted reply; without it the post goes
 * out exactly as before. */
export async function postReply(fid: string, tid: string, content: string, notice?: ReplyNotice): Promise<void> {
  if (!formHash) throw new Error("尚未登录");
  // The Swift app sends `\n` as CRLF and escapes characters outside the
  // CJK range as numeric references, then percent-encodes the GB18030 bytes.
  const message = htmlEntities(withSignature(content).replace(/\n/g, "\r\n"));
  const ids = attachedIds(content);
  const extra: [string, string][] = [];
  if (notice) {
    extra.push(["noticeauthor", notice.noticeauthor]);
    extra.push(["noticetrimstr", notice.noticetrimstr]);
    extra.push(["noticeauthormsg", notice.noticeauthormsg]);
  }
  if (ids.length > 0) {
    const posttime = postTimes.get(tid) ?? (await replyBox(fid, tid)).posttime;
    extra.push(["posttime", posttime]);
    for (const id of ids) extra.push([`attachnew[${id}][description]`, ""]);
  }
  const html = await request(
    "POST",
    `post.php?action=reply&fid=${fid}&tid=${tid}&extra=page%3D1&replysubmit=yes&infloat=yes&handlekey=fastpost&inajax=1`,
    {
      form: [["formhash", formHash], ["subject", ""], ["usesig", "0"], ["message", message], ...extra],
      cookie: "discuz_fastpostrefresh=0",
    },
  );
  const outcome = replyOutcome(html);
  if (outcome.posted === false) throw new ReplyRefused(outcome.reason);
}

/** A post's edit form (`post.php?action=edit`): its subject and text as the form holds them, and the form's post time. */
export type EditForm = { subject: string; message: string; posttime: string; upload?: { uid: string; hash: string } };

const EDIT_MESSAGE = /<textarea[^>]*name="message"[^>]*>([\s\S]*?)<\/textarea>/;
const EDIT_SUBJECT = /<input[^>]*name="subject"[^>]*value="([^"]*)"/;
const EDIT_POSTTIME = /name="posttime" id="posttime" value="(\d+)"/;
// Discuz's error box on a page it refused (e.g. an edit it does not allow).
const ALERT_ERROR = /<div class="alert_error">([\s\S]*?)<\/div>/;

/** Reads a post's edit form; `undefined` when the page has none. The text is decoded from the textarea's escaping. */
export function parseEditForm(html: string): EditForm | undefined {
  const raw = EDIT_MESSAGE.exec(html)?.[1];
  const posttime = EDIT_POSTTIME.exec(html)?.[1];
  if (raw === undefined || !posttime) return undefined;
  const subject = EDIT_SUBJECT.exec(html)?.[1] ?? "";
  // The edit page carries the reply box's upload form too, so pictures can be added while editing.
  const box = parseReplyBox(html);
  return {
    subject: htmlDecode(subject),
    message: htmlDecode(raw).replace(/\r\n?/g, "\n"),
    posttime,
    upload: box ? { uid: box.uid, hash: box.hash } : undefined,
  };
}

/** Opens a post's edit form (`post.php?action=edit`), as the site's own edit link does. */
export async function loadEditForm(fid: string, tid: string, pid: string, page = 1): Promise<EditForm> {
  const html = await request("GET", "post.php", {
    query: [
      ["action", "edit"],
      ["fid", fid],
      ["tid", tid],
      ["pid", pid],
      ["page", String(page)],
    ],
  });
  if (isLoginRequired(html)) throw new ReplyRefused("请重新登录后再编辑。");
  const form = parseEditForm(html);
  if (!form) throw new ReplyRefused(alertText(html) ?? "无法打开这条回复的编辑页面。");
  return form;
}

/** The text of the forum's error box on a page, if it shows one. */
function alertText(html: string): string | undefined {
  const text = ALERT_ERROR.exec(html)?.[1]?.replace(/<[^>]*>/g, "").trim();
  return text || undefined;
}

/** The first line of a text that is not blank: what the saved post must still start with. */
function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
}

/**
 * Saves an edit to a post (`post.php?action=edit&editsubmit=yes`), with the form the site sends
 * from a browser. `form` is the edit form as it was loaded (its subject and post time are sent back).
 * The forum's answer is not parsed for success: the edit form is read again, and the edit counts as
 * saved when it starts with the new text's first line. Rejects with `ReplyRefused` otherwise.
 */
export async function editPost(fid: string, tid: string, pid: string, page: number, form: EditForm, content: string): Promise<void> {
  if (!formHash) throw new Error("尚未登录");
  const message = htmlEntities(content.replace(/\n/g, "\r\n"));
  const fields: [string, string][] = [
    ["formhash", formHash],
    ["posttime", form.posttime],
    ["wysiwyg", "1"],
    ["fid", fid],
    ["tid", tid],
    ["pid", pid],
    ["page", String(page)],
    ["iconid", "0"],
    ["subject", htmlEntities(form.subject)],
    ["message", message],
    ["tags", ""],
    ["usesig", "1"],
    ["editsubmit", "true"],
  ];
  // The pictures the text inserts are linked to the post, as a reply's are.
  for (const id of attachedIds(content)) fields.push([`attachnew[${id}][description]`, ""]);
  const body = fields.map(([k, v]) => `${formEncodeGb(k)}=${formEncodeGb(v)}`).join("&");
  const answer = await postGbNoRedirect(`${HOST}post.php?action=edit&extra=&editsubmit=yes&mod=`, body, cookieHeader() || undefined);
  absorbSetCookie(answer.setCookies);
  // A saved edit answers with a redirect (302) to the thread: the forum's own word that it is saved.
  if (answer.status >= 300 && answer.status < 400 && answer.location && threadIdFromUrl(answer.location) === tid) return;
  // Otherwise (the redirect is hidden, or the forum answered with a page): read the edit form again.
  const saved = await loadEditForm(fid, tid, pid, page);
  const want = firstLine(content);
  if (!want || !saved.message.split("\n").some((line) => line.trim() === want)) {
    throw new ReplyRefused(alertText(answer.html) ?? "论坛未保存本次修改。");
  }
}

/**
 * Deletes reply `pid` the way the forum's edit box does: its edit form sent with `delete` set
 * (the box's Delete checkbox). The reply is gone when its edit form no longer opens; a forum
 * that still opens it refused the delete, and its own words are shown.
 */
export async function deletePost(fid: string, tid: string, pid: string, page: number, form: EditForm): Promise<void> {
  if (!formHash) throw new Error("尚未登录");
  const fields: [string, string][] = [
    ["formhash", formHash],
    ["posttime", form.posttime],
    ["wysiwyg", "1"],
    ["fid", fid],
    ["tid", tid],
    ["pid", pid],
    ["page", String(page)],
    ["subject", htmlEntities(form.subject)],
    ["message", htmlEntities(form.message.replace(/\n/g, "\r\n"))],
    ["delete", "1"],
    ["editsubmit", "true"],
  ];
  const body = fields.map(([k, v]) => `${formEncodeGb(k)}=${formEncodeGb(v)}`).join("&");
  const answer = await postGbNoRedirect(`${HOST}post.php?action=edit&extra=&editsubmit=yes&mod=`, body, cookieHeader() || undefined);
  absorbSetCookie(answer.setCookies);
  try {
    await loadEditForm(fid, tid, pid, page);
  } catch (e) {
    if (e instanceof ReplyRefused) return;
    throw e;
  }
  throw new ReplyRefused(alertText(answer.html) ?? "论坛未删除该回复。");
}

/**
 * Reads the answer to a reply POST. Discuz confirms a post with `REPLY_OK`. It refuses one
 * either with its `postbox` box (the full page) or with the AJAX call
 * `messagehandle_fastpost('<code>', '<message>')`, e.g. the 30-second flood limit. A response
 * with neither is not a refusal, so the post is treated as made and the thread is refreshed
 * to show what the server holds.
 */
export function replyOutcome(html: string): { posted: true | "unsure" } | { posted: false; reason: string } {
  if (html.includes(REPLY_OK)) return { posted: true };
  const ajax = AJAX_REFUSAL.exec(html)?.[1];
  if (ajax) return { posted: false, reason: ajax };
  const refusal = POSTBOX.exec(html)?.[1];
  if (refusal) return { posted: false, reason: refusal.replace(/<[^>]*>/g, "").trim() };
  return { posted: "unsure" };
}

/** A new thread whose answer does not show it was posted. It is not retried, since it may be there already. */
export class ThreadUnconfirmed extends Error {}

/** The post time of the new-thread form (`post.php?action=newthread`), if the page has one. */
export function parseNewThreadPostTime(html: string): string | undefined {
  return /name="posttime" id="posttime" value="(\d+)"/.exec(html)?.[1];
}

/** The thread a URL names (`viewthread.php?tid=N`): where the forum sends the user once a new thread is posted. */
export function threadIdFromUrl(url: string): string | undefined {
  return /viewthread\.php\?tid=(\d+)/.exec(url)?.[1];
}

/**
 * Posts a new thread in `fid` (`post.php?action=newthread`), with the same form the site sends
 * from a browser. Resolves with the new thread's id, or `undefined` when the forum confirmed the
 * post without showing the thread. Rejects with `ReplyRefused` when the forum refuses it, and
 * with `ThreadUnconfirmed` when the answer shows neither.
 */
export async function postThread(fid: string, subject: string, content: string): Promise<string | undefined> {
  if (!formHash) throw new Error("尚未登录");
  if (!subject.trim()) throw new ReplyRefused("请填写标题。");
  // The form's post time is read first, as the reply box's is; the site checks it with the post.
  const formPage = await request("GET", `post.php?action=newthread&fid=${fid}`);
  if (isLoginRequired(formPage)) throw new ReplyRefused("请重新登录后再发帖。");
  const posttime = parseNewThreadPostTime(formPage);
  if (!posttime) throw new ReplyRefused("无法读取这个版块的发帖表单。");
  const fields: [string, string][] = [
    ["formhash", formHash],
    ["posttime", posttime],
    ["wysiwyg", "1"],
    ["iconid", ""],
    ["subject", htmlEntities(subject.trim())],
    ["message", htmlEntities(withSignature(content).replace(/\n/g, "\r\n"))],
    ["tags", ""],
    ["usesig", "1"],
  ];
  // The pictures and files the text inserts go with the thread, linked by the post time their box
  // uploaded them under; the form's own post time is then that one.
  const ids = attachedIds(content);
  if (ids.length > 0) {
    const stamp = postTimes.get(newThreadKey(fid)) ?? posttime;
    fields.find(([k]) => k === "posttime")![1] = stamp;
    for (const id of ids) fields.push([`attachnew[${id}][description]`, ""]);
  }
  const body = fields.map(([k, v]) => `${formEncodeGb(k)}=${formEncodeGb(v)}`).join("&");
  const { html, setCookies, url } = await fetchGbRequest(
    "POST",
    `${HOST}post.php?action=newthread&fid=${fid}&extra=&topicsubmit=yes`,
    body,
    cookieHeader() || undefined,
  );
  absorbSetCookie(setCookies);
  // A successful post redirects to the new thread; the final URL (after the redirect) names it.
  const tid = threadIdFromUrl(url);
  if (tid) {
    postTimes.delete(newThreadKey(fid));
    return tid;
  }
  if (isLoginRequired(html)) throw new ReplyRefused("请重新登录后再发帖。");
  const outcome = replyOutcome(html);
  if (outcome.posted === false) throw new ReplyRefused(outcome.reason);
  if (outcome.posted === true) {
    postTimes.delete(newThreadKey(fid));
    return undefined;
  }
  throw new ThreadUnconfirmed("论坛未确认新主题。");
}

export function currentUser(): string | null {
  return signedInName ?? session?.name ?? null;
}

/** The form hash a POST needs (`DiscuzAPI.sharedFormHash`). */
export function currentFormHash(): string | null {
  return formHash;
}
