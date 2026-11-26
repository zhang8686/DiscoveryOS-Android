import { appInfo, openUrl, signal, Storage } from "nsh";
import { checkForUpdate as askUpdater } from "nsh/updater";
import process from "process";

/**
 * A newer build the reader may want.
 *
 * Android installs nothing by itself (`canInstall` is false there) and the runtime exposes no way
 * to hand a downloaded APK to the installer, so "yes" opens the release page and the reader taps
 * Download there. Everything else — the offer, the skip, the once-a-week rhythm — is the app's.
 */
export type AvailableUpdate = {
  version: string;
  notes: string | null;
  /** The release page: the manifest's asset URL is the APK itself, which a browser downloads. */
  url: string;
};

const REPOSITORY = "zhang8686/DiscoveryOS-Android";
const LAST_CHECK = "update:lastCheck";
const SKIPPED = "update:skipped";
/** How often a quiet check runs. A cold start is cheap, but the answer changes at most weekly. */
const EVERY = 7 * 24 * 60 * 60 * 1000;

/** The update found and not yet answered, for the badge's dot and the download button. */
export const availableUpdate = signal<AvailableUpdate | null>(null);

/** The version this build carries, as the settings badge shows it. */
export function runningVersion(): string {
  try {
    return appInfo().version ?? "";
  } catch {
    return "";
  }
}

function releasePage(version: string): string {
  return version
    ? `https://github.com/${REPOSITORY}/releases/tag/v${version}`
    : `https://github.com/${REPOSITORY}/releases/latest`;
}

/** The dialog's heading: the version, then what the release says. */
export function updateLabel(update: AvailableUpdate): string {
  const head = `新版本 V${update.version}`;
  return update.notes ? `${head}\n${update.notes}` : head;
}

/**
 * Asks the release feed for a newer version.
 *
 * `nsh.json`'s `"updater": { "github": … }` is what the runtime reads: it fetches
 * `releases/latest/download/latest.json`, a plain file on the release, so there is no API call and
 * no rate limit. The manifest must list an `android` asset — the runtime treats a manifest without
 * one as "no update" — so every release carries `latest.json` beside its APK.
 *
 * Quiet by default: a check the reader did not ask for runs once a week, leaves no trace when it
 * fails or finds nothing, and never blocks a start. `force` is the badge's own press.
 */
export async function checkForUpdate(force = false): Promise<AvailableUpdate | null> {
  const now = Date.now();
  if (!force) {
    const last = Number((await Storage.getItem(LAST_CHECK).catch(() => null)) ?? 0);
    if (Number.isFinite(last) && now - last < EVERY) return availableUpdate();
  }
  let found: { version: string; notes?: string | null } | null = null;
  try {
    found = await askUpdater({ locale: "zh" });
  } catch {
    // Offline, a release without `latest.json`, a manifest the runtime refuses: all the same here.
    void Storage.setItem(LAST_CHECK, String(now)).catch(() => undefined);
    return null;
  }
  void Storage.setItem(LAST_CHECK, String(now)).catch(() => undefined);
  if (!found) {
    availableUpdate.set(null);
    return null;
  }
  const skipped = (await Storage.getItem(SKIPPED).catch(() => null)) ?? "";
  if (found.version && found.version === skipped) {
    availableUpdate.set(null);
    return null;
  }
  const update: AvailableUpdate = {
    version: found.version,
    notes: found.notes ?? null,
    url: releasePage(found.version),
  };
  availableUpdate.set(update);
  return update;
}

/** Opens the release page, where the reader downloads and installs the new build. */
export async function installUpdate(update: AvailableUpdate): Promise<string> {
  try {
    const result: unknown = await openUrl(update.url);
    const opened = typeof result === "object" && result !== null
      ? (result as { opened?: boolean }).opened !== false
      : result !== false;
    return opened ? "opened" : "err";
  } catch {
    return "err";
  }
}

/** 「忽略」: this version is not offered again; the next one is. */
export async function skipUpdate(): Promise<void> {
  const update = availableUpdate();
  availableUpdate.set(null);
  if (!update) return;
  await Storage.setItem(SKIPPED, update.version).catch(() => undefined);
  await Storage.setItem(LAST_CHECK, String(Date.now())).catch(() => undefined);
}

/**
 * The start-up check: ten seconds after the window is up, so nothing competes with the first page,
 * and only where there is an app to update (the test host has no data directory, and a browser has
 * no updater).
 */
export function startUpdateCheck(): void {
  if (!process.dataDir) return;
  setTimeout(() => {
    void checkForUpdate().catch(() => undefined);
  }, 10_000);
}
