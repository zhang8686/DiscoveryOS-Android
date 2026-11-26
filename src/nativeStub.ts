export { Gb18030 } from "./discuz/gb18030";

export const Files = {
  path: (_uri: string): string | null => null,
  read: (_path: string): Uint8Array | null => null,
};

export const DebugLog = {
  path: (): string | null => null,
  write: (_s: string): void => {},
};

export const Updater = { aboutInfo: (): string => "{}" };
