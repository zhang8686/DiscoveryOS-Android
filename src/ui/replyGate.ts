export const MIN_REPLY_CHARS = 5;

export function canSendReply(text: string): boolean {
  return [...text.trim()].length > MIN_REPLY_CHARS;
}
