/**
 * The forum loads `forumdata/cache/md5.js` and hashes the password in the
 * browser before posting it: `pwmd5()` sets the field to
 * `hex_md5(addslashes(password))`. Discuz! 7.2 then checks
 * `md5(md5(password) . salt)` on the server, so a plain-text password can
 * never match. This is the same hash as that page's `hex_md5`: the low byte
 * of each UTF-16 code unit (the `md5.js` build uses `chrsz = 8`), which is
 * the password's bytes for the usual ASCII passwords.
 */

const HEX = "0123456789abcdef";

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function add(a: number, b: number): number {
  const lo = (a & 0xffff) + (b & 0xffff);
  const hi = (a >>> 16) + (b >>> 16) + (lo >>> 16);
  return ((hi << 16) | (lo & 0xffff)) >>> 0;
}

function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return add(b, rotl(add(add(a, (b & c) | (~b & d)), add(x, t)), s));
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return add(b, rotl(add(add(a, (b & d) | (c & ~d)), add(x, t)), s));
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return add(b, rotl(add(add(a, b ^ c ^ d), add(x, t)), s));
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return add(b, rotl(add(add(a, c ^ (b | ~d)), add(x, t)), s));
}

function words(text: string): number[] {
  const w: number[] = [];
  for (let i = 0; i < text.length; i++) w[i >> 2] = (w[i >> 2] ?? 0) | ((text.charCodeAt(i) & 0xff) << ((i % 4) * 8));
  return w;
}

/** `hex_md5(text)` of the forum's md5.js, as a 32-character lowercase string. */
export function hexMd5(text: string): string {
  const x = words(text);
  const len = text.length * 8;
  x[len >> 5] = (x[len >> 5] ?? 0) | (0x80 << (len % 32));
  x[(((len + 64) >>> 9) << 4) + 14] = len;

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < x.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[i] ?? 0, 7, -680876936);
    d = ff(d, a, b, c, x[i + 1] ?? 0, 12, -389564586);
    c = ff(c, d, a, b, x[i + 2] ?? 0, 17, 606105819);
    b = ff(b, c, d, a, x[i + 3] ?? 0, 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4] ?? 0, 7, -176418897);
    d = ff(d, a, b, c, x[i + 5] ?? 0, 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6] ?? 0, 17, -1473231341);
    b = ff(b, c, d, a, x[i + 7] ?? 0, 22, -45705983);
    a = ff(a, b, c, d, x[i + 8] ?? 0, 7, 1770035416);
    d = ff(d, a, b, c, x[i + 9] ?? 0, 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10] ?? 0, 17, -42063);
    b = ff(b, c, d, a, x[i + 11] ?? 0, 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12] ?? 0, 7, 1804603682);
    d = ff(d, a, b, c, x[i + 13] ?? 0, 12, -40341101);
    c = ff(c, d, a, b, x[i + 14] ?? 0, 17, -1502002290);
    b = ff(b, c, d, a, x[i + 15] ?? 0, 22, 1236535329);

    a = gg(a, b, c, d, x[i + 1] ?? 0, 5, -165796510);
    d = gg(d, a, b, c, x[i + 6] ?? 0, 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11] ?? 0, 14, 643717713);
    b = gg(b, c, d, a, x[i] ?? 0, 20, -373897302);
    a = gg(a, b, c, d, x[i + 5] ?? 0, 5, -701558691);
    d = gg(d, a, b, c, x[i + 10] ?? 0, 9, 38016083);
    c = gg(c, d, a, b, x[i + 15] ?? 0, 14, -660478335);
    b = gg(b, c, d, a, x[i + 4] ?? 0, 20, -405537848);
    a = gg(a, b, c, d, x[i + 9] ?? 0, 5, 568446438);
    d = gg(d, a, b, c, x[i + 14] ?? 0, 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3] ?? 0, 14, -187363961);
    b = gg(b, c, d, a, x[i + 8] ?? 0, 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13] ?? 0, 5, -1444681467);
    d = gg(d, a, b, c, x[i + 2] ?? 0, 9, -51403784);
    c = gg(c, d, a, b, x[i + 7] ?? 0, 14, 1735328473);
    b = gg(b, c, d, a, x[i + 12] ?? 0, 20, -1926607734);

    a = hh(a, b, c, d, x[i + 5] ?? 0, 4, -378558);
    d = hh(d, a, b, c, x[i + 8] ?? 0, 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11] ?? 0, 16, 1839030562);
    b = hh(b, c, d, a, x[i + 14] ?? 0, 23, -35309556);
    a = hh(a, b, c, d, x[i + 1] ?? 0, 4, -1530992060);
    d = hh(d, a, b, c, x[i + 4] ?? 0, 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7] ?? 0, 16, -155497632);
    b = hh(b, c, d, a, x[i + 10] ?? 0, 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13] ?? 0, 4, 681279174);
    d = hh(d, a, b, c, x[i] ?? 0, 11, -358537222);
    c = hh(c, d, a, b, x[i + 3] ?? 0, 16, -722521979);
    b = hh(b, c, d, a, x[i + 6] ?? 0, 23, 76029189);
    a = hh(a, b, c, d, x[i + 9] ?? 0, 4, -640364487);
    d = hh(d, a, b, c, x[i + 12] ?? 0, 11, -421815835);
    c = hh(c, d, a, b, x[i + 15] ?? 0, 16, 530742520);
    b = hh(b, c, d, a, x[i + 2] ?? 0, 23, -995338651);

    a = ii(a, b, c, d, x[i] ?? 0, 6, -198630844);
    d = ii(d, a, b, c, x[i + 7] ?? 0, 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14] ?? 0, 15, -1416354905);
    b = ii(b, c, d, a, x[i + 5] ?? 0, 21, -57434055);
    a = ii(a, b, c, d, x[i + 12] ?? 0, 6, 1700485571);
    d = ii(d, a, b, c, x[i + 3] ?? 0, 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10] ?? 0, 15, -1051523);
    b = ii(b, c, d, a, x[i + 1] ?? 0, 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8] ?? 0, 6, 1873313359);
    d = ii(d, a, b, c, x[i + 15] ?? 0, 10, -30611744);
    c = ii(c, d, a, b, x[i + 6] ?? 0, 15, -1560198380);
    b = ii(b, c, d, a, x[i + 13] ?? 0, 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4] ?? 0, 6, -145523070);
    d = ii(d, a, b, c, x[i + 11] ?? 0, 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2] ?? 0, 15, 718787259);
    b = ii(b, c, d, a, x[i + 9] ?? 0, 21, -343485551);

    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  let out = "";
  for (const word of [a, b, c, d]) {
    for (let i = 0; i < 4; i++) {
      const byte = (word >>> (i * 8)) & 0xff;
      out += HEX.charAt((byte >>> 4) & 0x0f) + HEX.charAt(byte & 0x0f);
    }
  }
  return out;
}

/** Discuz's `addslashes()` in the login page's JavaScript. */
function addslashes(text: string): string {
  return text.replace(/[\\'"]/g, (ch) => `\\${ch}`).replace(/\0/g, "\\0");
}

/** The value the forum's `pwmd5()` puts in the `password` field. */
export function discuzPassword(password: string): string {
  return hexMd5(addslashes(password));
}
