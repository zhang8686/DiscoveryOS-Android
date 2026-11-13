// Desktop OTA removed on Android.
import { signal } from "nsh";
import type { Manifest } from "./updateManifest";
export const UPDATE_MANIFEST_URL = "";
export const availableUpdate = signal<Manifest | null>(null);
export async function checkForUpdate(): Promise<Manifest | null> { return null; }
export async function installUpdate(_m: Manifest): Promise<string> { return "err"; }
export function startUpdateCheck(): void {}
