import { keyboardFrame, platform, signal, windowSize } from "nsh";

export const textFieldFocused = signal(false);

let phoneDecision: boolean | null = null;

/** True on a phone. Tablets (any orientation) keep their own keyboard handling. */
export function isPhoneDevice(): boolean {
  if (phoneDecision !== null) return phoneDecision;
  const w = windowSize().width;
  const h = windowSize().height;
  phoneDecision = platform.idiom === "phone" && Math.min(w, h) < 600;
  return phoneDecision;
}

let baseWindowHeight = 0;
let baseWindowWidth = 0;
let imeSeen = false;

/** Tablet path: the state machine used and verified on the pad, in portrait and landscape. */
function tabletState(): { inset: number; open: boolean } {
  const w = windowSize().width;
  const h = windowSize().height;
  if (w !== baseWindowWidth) {
    baseWindowWidth = w;
    baseWindowHeight = h;
    imeSeen = false;
  } else if (h > baseWindowHeight) {
    baseWindowHeight = h;
  }
  const shrink = baseWindowHeight - h;
  if (shrink > 120) {
    imeSeen = true;
    return { inset: 0, open: true };
  }
  const ime = keyboardFrame().height;
  if (ime > 80) {
    imeSeen = true;
    return { inset: ime, open: true };
  }
  if (imeSeen) return { inset: 0, open: false };
  if (textFieldFocused() && shrink > 0) return { inset: Math.min(shrink, 360), open: true };
  return { inset: 0, open: false };
}

let phoneImeSeen = false;

/** Phone path: the DiscoveryOS-mobile state machine, verbatim in its decisions. The
 *  manifest gives this build the system's automatic adjustment (adjustResize), so the
 *  system itself moves the focused reply box above the IME and moves it back down when
 *  the IME hides. The app never guesses a keyboard height: on Android 10 full-screen
 *  windows the IME's show/hide is not reported to the app at all, so a guessed lift
 *  leaves a gap above the keyboard and leaves the box floating after it is dismissed. */
function phoneState(): { inset: number; open: boolean } {
  const w = windowSize().width;
  const h = windowSize().height;
  if (w !== baseWindowWidth) {
    baseWindowWidth = w;
    baseWindowHeight = h;
    phoneImeSeen = false;
  } else if (h > baseWindowHeight) {
    baseWindowHeight = h;
  }
  const shrink = baseWindowHeight - h;
  if (shrink > 120) {
    phoneImeSeen = true;
    return { inset: 0, open: true };
  }
  const ime = keyboardFrame().height;
  if (ime > 80) {
    phoneImeSeen = true;
    return { inset: ime, open: true };
  }
  if (phoneImeSeen) return { inset: 0, open: false };
  if (textFieldFocused() && shrink > 0) return { inset: Math.min(shrink, 360), open: true };
  return { inset: 0, open: false };
}

/** The inset the app must add, and whether the keyboard is actually up. */
function state(): { inset: number; open: boolean } {
  return isPhoneDevice() ? phoneState() : tabletState();
}

/** Extra bottom padding for the app's root, when the window did not resize itself. */
export function keyboardInset(): number {
  return state().inset;
}

/** True while a keyboard is up, even when its reported height is 0. */
export function keyboardIsOpen(): boolean {
  return state().open;
}
