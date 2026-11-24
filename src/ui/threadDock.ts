import { Storage } from "nsh";

const KEY = "visual:thread-dock-y";

/** The cluster's default bottom plus the space it must leave at either end of the window. */
const DEFAULT_BOTTOM = 104;
const GROUP_AND_BOX = 160 + 56;

/** Where the cluster may rest, in pixels lifted from its default bottom. The same limits are
 * used while dragging and when reading a saved spot back, so a position saved on a taller
 * window never lands off screen on a shorter one. */
export function clampDockY(y: number, windowHeight: number): number {
  const top = Math.max(0, windowHeight - DEFAULT_BOTTOM - GROUP_AND_BOX);
  return Math.min(top, Math.max(-32, y));
}

/** The saved resting position, or null when there is none or it is not a usable number. */
export function loadDockY(): Promise<number | null> {
  return Storage.getItem(KEY)
    .then((text) => {
      if (!text) return null;
      const y = Number(text);
      return Number.isFinite(y) ? y : null;
    })
    .catch(() => null);
}

/** Remembers where the cluster rests. A failed write costs only the remembered spot. */
export function saveDockY(y: number): void {
  Storage.setItem(KEY, String(y)).catch(() => undefined);
}
