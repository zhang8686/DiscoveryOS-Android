// No Escape key on Android: the system back key is handled by NSH.
export function onEscape(_handler: () => boolean): () => void { return () => {}; }
