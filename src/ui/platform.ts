// Android has no desktop title bar / menu bar. Keep the module surface of nsh/desktop.
export const isAvailable = false;
// Callable + readable: the desktop sources use both `titleBar()` and its fields.
// On Android the title bar is always absent, so both report zero.
export const titleBar: any = Object.assign(
  () => ({ height: 0, left: 0, right: 0 }),
  { height: 0, left: 0, right: 0 },
);
export const Window = { get: (_id: string): any => null };
export class Menu {
  static popup(_items: unknown[]): Promise<void> { return Promise.resolve(); }
  constructor(..._args: unknown[]) {}
  add(..._args: unknown[]): void {}
  set(..._args: unknown[]): void {}
}
export type MenuItem = Record<string, unknown>;
export type MenuRole = string;
