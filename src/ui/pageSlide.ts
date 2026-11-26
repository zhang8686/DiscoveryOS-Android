import { reduceMotion, type AnimatedValue, type Easing, type Motion } from "nsh";

const bez = (x1: number, y1: number, x2: number, y2: number): Easing => [x1, y1, x2, y2];

/** M3 easing + duration tokens, the single source of truth for page transitions. */
export const M3 = {
  easing: {
    standard: bez(0.2, 0, 0, 1),
    standardDecelerate: bez(0, 0, 0, 1),      
    standardAccelerate: bez(0.3, 0, 1, 1),    
    emphasizedDecelerate: bez(0.05, 0.7, 0.1, 1),
    emphasizedAccelerate: bez(0.3, 0, 0.8, 0.15),
  },
  duration: {
    enter: 250,   
    exit: 200,    
    onScreen: 300, 
  },
} as const;

/** The short travel of a forward/backward or lateral slide (M3 keeps it well below a screen). */
const DISTANCE = 64;

/**
 * M3 forward navigation: a freshly mounted page fades in while sliding in from the trailing
 * edge (translateX: +D -> 0). Standard decelerate, so it starts fast and settles gently.
 */
export async function slideIn(motion: Motion): Promise<void> {
  if (reduceMotion()) {
    await motion.play({ keyframes: { opacity: [0, 1] }, duration: M3.duration.exit });
    return;
  }
  await motion.play({
    keyframes: { translateX: [DISTANCE, 0], opacity: [0, 1] },
    duration: M3.duration.enter, easing: M3.easing.standardDecelerate,
  });
}

/**
 * M3 backward navigation driven by a drag. `pan` is the live drag value bound to the view's
 * `pan` prop, so it already holds however far the finger moved; `opacity` is the motion's fade
 * channel. `direction` is +1 for a rightward exit, -1 for a leftward one — the page keeps
 * travelling the way the finger was going, off the edge of a screen `screenWidth` wide, and
 * fades as it goes (Android's forward/backward: a fade so screens need not cross the full width).
 *
 * After the animation the values are put back at rest (pan 0, opacity 1). A page that will be
 * unmounted does not care, but a page that STAYS MOUNTED and is merely covered/uncovered by the
 * portrait pane (the thread body, in particular) must not be left at opacity 0 / off-screen —
 * otherwise uncovering it shows a blank screen. Resetting here is what keeps a reused page
 * visible the next time it is revealed.
 */
export async function settleExit(
  pan: AnimatedValue,
  opacity: AnimatedValue,
  screenWidth: number,
  direction: number,
): Promise<void> {
  if (reduceMotion()) { pan.set(0); opacity.set(1); return; }
  const target = direction >= 0 ? screenWidth : -screenWidth;
  try {
    await Promise.all([
      pan.timing(target, { duration: M3.duration.exit, easing: M3.easing.standardAccelerate }),
      opacity.timing(0, { duration: M3.duration.exit, easing: M3.easing.standardAccelerate }),
    ]);
  } finally {
    pan.set(0);
    opacity.set(1);
  }
}

/** A cancelled or below-threshold swipe springs back to rest — M3's predictive-back behaviour. */
export function settleBack(pan: AnimatedValue): Promise<{ finished: boolean }> {
  return pan.spring(0);
}

/**
 * M3 lateral transition: peer destinations in the same set (the list column switching boards)
 * slide in together on one axis WITHOUT a fade or parallax. Standard easing, begin and end on
 * screen. This replaces the former one-off fade+slide used for the board list.
 */
export async function lateralSlide(motion: Motion): Promise<void> {
  if (reduceMotion()) { motion.reset(); return; }
  await motion.play({
    keyframes: { translateX: [DISTANCE, 0] },
    duration: M3.duration.onScreen, easing: M3.easing.standard,
  });
}
