
import { consoleDebug, debugEnabled } from "../debugLog";

const BODY_LOG_LIMIT = 20_000;
const SECRET_NAME = /pass|cookie|authorization|token|secret/i;

const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** `a=1&password=x` with the secret values replaced. */
function redactForm(text: string): string {
  return text
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      return SECRET_NAME.test(key) ? `${key}=***` : pair;
    })
    .join("&");
}

/** `name=value; other=value` with each value replaced. */
function redactCookieHeader(value: string): string {
  return value
    .split(";")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq < 0 ? pair.trim() : `${pair.slice(0, eq).trim()}=***`;
    })
    .join("; ");
}

/** A `Set-Cookie` line with its value replaced; its attributes (path, expires...) are kept. */
function redactSetCookie(line: string): string {
  const [pair, ...attributes] = line.split(";");
  const eq = pair.indexOf("=");
  const shown = eq < 0 ? pair.trim() : `${pair.slice(0, eq).trim()}=***`;
  return [shown, ...attributes.map((a) => a.trim())].join("; ");
}

function describeBody(body: BodyInit | null | undefined): string {
  if (body === undefined || body === null) return "(none)";
  if (typeof body === "string") return redactForm(body);
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const parts: string[] = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") parts.push(`${key}=${SECRET_NAME.test(key) ? "***" : value}`);
      else parts.push(`${key}=<file ${value.name} ${value.size} bytes>`);
    }
    return `multipart: ${parts.join(" & ")}`;
  }
  return "(binary body)";
}

function printText(text: string): void {
  if (text.length <= BODY_LOG_LIMIT) {
    consoleDebug(text);
    return;
  }
  consoleDebug(`${text.slice(0, BODY_LOG_LIMIT)}\nHTTP   … ${text.length - BODY_LOG_LIMIT} more characters not shown`);
}

/**
 * `fetch`, with the request and the response logged. Reads the whole body and returns it
 * with the response, so the caller uses `bytes` rather than reading the response again.
 * `decode` turns a text body into a string for the log (the forum's pages are GB18030).
 */
/** How long one request may take before it is given up on. A server that accepts the connection
 *  and never answers used to leave the screen waiting forever — no answer, no error, nothing to
 *  retry. Uploads pass a longer deadline; the default fits a page or a picture. */
export const REQUEST_TIMEOUT_MS = 30_000;

export async function fetchLogged(
  url: string,
  init: RequestInit = {},
  decode: (bytes: Uint8Array) => string = utf8,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const method = (init.method ?? "GET").toUpperCase();
  const started = Date.now();
  consoleDebug(`HTTP > ${method} ${url}`);
  new Headers(init.headers).forEach((value, name) => {
    consoleDebug(`HTTP   ${name}: ${SECRET_NAME.test(name) ? redactCookieHeader(value) : value}`);
  });
  consoleDebug(`HTTP   body: ${describeBody(init.body)}`);

  let response: Response;
  let bytes: Uint8Array;
  // A caller's own signal wins. Otherwise the request gets a deadline, so a connection that is
  // never answered ends in an error the screens already know how to report and retry.
  const controller = !init.signal && timeoutMs > 0 && typeof AbortController !== "undefined"
    ? new AbortController()
    : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    response = await fetch(url, controller ? { ...init, signal: controller.signal } : init);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    const aborted = controller !== null && controller.signal.aborted;
    consoleDebug(`HTTP ! ${method} ${url} failed after ${Date.now() - started} ms${aborted ? ` (timed out after ${timeoutMs} ms)` : ""}: ${String(e)}`);
    throw aborted ? new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒没有响应）`) : e;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  consoleDebug(`HTTP < ${response.status} ${response.statusText} ${method} ${url} (${Date.now() - started} ms)`);
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") consoleDebug(`HTTP   ${name}: ${value}`);
  });
  for (const line of response.headers.getSetCookie()) consoleDebug(`HTTP   set-cookie: ${redactSetCookie(line)}`);
  // Logging off is the normal case. Decoding a GB18030 page is pure-TS table
  // work, and doing it a second time just to build a line nobody prints made
  // every forum request noticeably slower on a phone.
  if (debugEnabled) {
    const type = response.headers.get("content-type") ?? "";
    if (/text|json|xml|javascript/i.test(type)) {
      consoleDebug(`HTTP   body (${bytes.length} bytes):`);
      printText(decode(bytes));
    } else {
      consoleDebug(`HTTP   body (${bytes.length} bytes, ${type || "no content type"}, not shown)`);
    }
  }
  return { response, bytes };
}
