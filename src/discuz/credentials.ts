import type { Credentials } from "./vault";
export type { Credentials };
export function loadCredentials(): Credentials | null { return null; }
export function saveCredentials(_creds: Credentials): void {}
export function clearCredentials(): void {}
