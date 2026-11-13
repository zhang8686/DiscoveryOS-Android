// Menu bar and keyboard shortcuts are desktop-only. Android uses visible buttons.
export type CommandId = string;
export interface Behavior { enabled?: () => boolean; run: () => void; [key: string]: unknown }
export function useCommand(_id: CommandId, _behavior: Behavior): void {}
export function shortcutRows(): { key: string; action: string }[] { return []; }
export function menuBar(): unknown[] { return []; }
export function installMenu(): void {}
