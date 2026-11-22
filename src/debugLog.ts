import { DebugLog } from "./nativeStub";

/** The log file, or `null` when debugging is off. */
export const debugLogPath: string | null = DebugLog.path();

export const debugEnabled: boolean = debugLogPath !== null;

/** Appends the arguments to the debug log, one line with a timestamp, when debugging is on. */
export function consoleDebug(...args: unknown[]): void {
  if (!debugEnabled) return;
  const text = args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ");
  DebugLog.write(`${new Date().toISOString()} ${text}`);
}
