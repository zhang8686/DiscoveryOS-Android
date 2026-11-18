// Whether a text field has the keyboard focus. The reply box sets it on focus and clears it on
// blur; the app's root reads it to keep the content above the keyboard on a phone, where the
// window spans the screen and the IME height can come back as 0 while the keyboard is up.
import { signal } from "nsh";

export const textFieldFocused = signal(false);
