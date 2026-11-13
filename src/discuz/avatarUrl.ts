// Uploaded avatars live at a path derived from the numeric uid on the image
// host. A static .jpg URL is loaded directly by <Image>: no JS request, no
// runtime base64, no per-author profile lookup. Members without a picture get
// a 404 and the embedded placeholder stays visible.
const AVATAR_BASE = "https://img02.4d4y.com/forum/uc_server/data/avatar/";

/** `undefined` when the row has no usable numeric uid. */
export function avatarUrlForUid(uid?: string): string | undefined {
  if (!uid || !/^\d+$/.test(uid)) return undefined;
  const n = uid.padStart(9, "0").slice(-9);
  return `${AVATAR_BASE}${n.slice(0, 3)}/${n.slice(3, 5)}/${n.slice(5, 7)}/${n.slice(7, 9)}_avatar_small.jpg`;
}

/** A local picture shown until the avatar loads, and left in place on 404. */
export const PLACEHOLDER_AVATAR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAtklEQVR4nNXZMXbCMBAA0dGcxBWF7n+WFKm4CWlCHgTbUGp+62ZWsqodnPj6vt5YwLxs4+jbWDn8k0GsxB+1WYk/arQUv9dqLf7u3vzyBmpG8fQf5W9A4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iTOsyXy6uZlG/0b4M0qf1Xzt/nvBkpDzIfWp1+oMMT81/jyBlYeYu60ncauskM+O9QfE+UwzixGofoAAAAASUVORK5CYII=";
