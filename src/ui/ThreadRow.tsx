import { Text, View } from "nsh";
import type { Post } from "../discuz/parse";
import { timeAgo } from "../discuz/timeAgo";
import { palette } from "./appearance";
import { displaySettings } from "./settings";
import { Avatar } from "./Avatar";
import { LineIcon } from "./lineIcons";
import { newRepliesSinceView } from "./history";

const AVATAR_BASE = 32;
const LIST_BASE = 12.5;
function avatarSide(): number {
  return Math.max(26, Math.min(40, Math.round((AVATAR_BASE * displaySettings().list) / LIST_BASE)));
}

function meta(p: Post, byDate: boolean): string {
  const when = byDate ? p.at : (p.lastReplyAt ?? p.at);
  return [p.author, when ? timeAgo(when) : undefined].filter(Boolean).join(" · ");
}

export function ThreadRow(props: {
  item: () => Post;
  selected: () => boolean;
  avatar: () => string | undefined;
  sortByDate?: () => boolean;
  favorite: () => boolean;
  viewed: () => boolean;
  onPress: () => void;
  /** A long press (to hide the thread from the list). */
  onLongPress?: () => void;
}) {
  // Read the row once: the getter is called a dozen times below (height, tint, title, counts),
  // and each call is a signal read on a row that scrolls.
  const p = props.item();
  return (
    <View
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 6,
        height: p.excerpt !== undefined ? undefined : 64,
        backgroundColor: props.selected() ? palette().selected : palette().surface,
        opacity: p.pinned ? 0.5 : (props.viewed() && !props.selected() ? 0.62 : 1),
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Avatar size={avatarSide()} radius={7} url={props.avatar()} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Text style={{ numberOfLines: 2, fontSize: displaySettings().list, color: p.color ?? (props.viewed() ? palette().muted : palette().text), fontWeight: props.viewed() ? 400 : 600, flexShrink: 1 }}>
            {props.favorite() ? <Text style={{ fontSize: 11, color: palette().muted }}>{"★ "}</Text> : null}
            {p.title}
          </Text>
          {p.agreed ? <LineIcon name="thumb" size={12} /> : null}
        </View>
        {}
        {p.excerpt !== undefined ? (
          p.excerpt ? <Text style={{ fontSize: 12, color: palette().muted }}>{p.excerpt}</Text> : null
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
            <Text style={{ fontSize: 11, color: palette().muted, flexShrink: 1, numberOfLines: 1 }}>
              {meta(p, props.sortByDate?.() ?? false)}
            </Text>
            {}
            {p.hasImages ? <LineIcon name="image" size={12} /> : null}
          </View>
        )}
      </View>
      {p.excerpt !== undefined ? (
        <View style={{ width: 0, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: palette().muted }}>{timeAgo((p.lastReplyAt ?? p.at) ?? "")}</Text>
        </View>
      ) : null}
      {(p.replies === undefined && p.views === undefined) ? null : (
        <View style={{ width: 52, alignItems: "flex-end", gap: 1 }}>
          {p.views !== undefined ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={{ fontSize: 11, color: palette().muted }}>{String(p.views)}</Text>
              <LineIcon name="eye" size={11} color={palette().muted} />
            </View>
          ) : null}
          {p.replies !== undefined ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={{ fontSize: 11, color: palette().muted }}>{String(p.replies)}</Text>
              <LineIcon name="bubble" size={11} color={palette().muted} />
            </View>
          ) : null}
          {p.replies !== undefined && newRepliesSinceView(p.id, p.replies) > 0 ? (
            <Text style={{ fontSize: 10, fontWeight: 600, color: palette().link }}>
              {`+${newRepliesSinceView(p.id, p.replies)}`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
