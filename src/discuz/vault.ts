// Session persistence on Android: NSH Storage (app-private), cookies only.
// No plaintext password is kept (the desktop Keychain module was removed).
import { Storage } from "nsh";

const KEY = "discoveryos/vault";
export type Credentials = { name: string; pass: string };
export type Vault = { creds: Credentials | null; cookies: Record<string, string> };

let cache: Vault | null = null;
let started = false;

export function parseVault(raw: string | null): Vault {
  if (!raw) return { creds: null, cookies: {} };
  try {
    const v = JSON.parse(raw) as Partial<Vault> | null;
    const cookies: Record<string, string> = {};
    if (v?.cookies && typeof v.cookies === "object") {
      for (const [k, val] of Object.entries(v.cookies)) if (typeof val === "string") cookies[k] = val;
    }
    return { creds: null, cookies };
  } catch { return { creds: null, cookies: {} }; }
}

/** Awaits the persisted cookies once; call before restoring the session. */
export async function initVault(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const raw = await Storage.getItem(KEY);
    cache = parseVault(raw ?? null);
  } catch { cache = { creds: null, cookies: {} }; }
}

export function loadVault(): Vault {
  if (!cache) cache = { creds: null, cookies: {} };
  return cache;
}

export function saveVault(next: Vault): void {
  cache = { creds: null, cookies: next.cookies };
  Storage.setItem(KEY, JSON.stringify(cache)).catch(() => undefined);
}
