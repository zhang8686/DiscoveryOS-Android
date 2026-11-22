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
  return (
    <View
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 6,
        height: props.item().excerpt !== undefined ? undefined : 64,
        backgroundColor: props.selected() ? palette().selected : palette().surface,
        opacity: props.item().pinned ? 0.5 : (props.viewed() && !props.selected() ? 0.62 : 1),
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {
}
      <Avatar size={avatarSide()} radius={7} url={props.avatar()} />
      <View style={{ flex: 1, gap: 2 }}>
        {}
        <Text style={{ numberOfLines: 2, fontSize: displaySettings().list, color: props.item().color ?? (props.viewed() ? palette().muted : palette().text), fontWeight: props.viewed() ? 400 : 600 }}>
          {props.favorite() ? <Text style={{ fontSize: 11, color: palette().muted }}>{"★ "}</Text> : null}
          {props.item().title}
        </Text>
        {}
        {props.item().excerpt !== undefined ? (
          props.item().excerpt ? <Text style={{ fontSize: 12, color: palette().muted }}>{props.item().excerpt}</Text> : null
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
            <Text style={{ fontSize: 11, color: palette().muted, flexShrink: 1, numberOfLines: 1 }}>
              {meta(props.item(), props.sortByDate?.() ?? false)}
            </Text>
            {}
            {props.item().hasImages ? <LineIcon name="image" size={12} /> : null}
          </View>
        )}
      </View>
      {props.item().excerpt !== undefined ? (
        <View style={{ width: 0, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: palette().muted }}>{timeAgo((props.item().lastReplyAt ?? props.item().at) ?? "")}</Text>
        </View>
      ) : null}
      {
}
      {props.item().replies === undefined ? null : (
        <View style={{ width: 46, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: palette().muted }}>{String(props.item().replies)} 回复</Text>
          {}
          {newRepliesSinceView(props.item().id, props.item().replies) > 0 ? (
            <Text style={{ fontSize: 10, fontWeight: 600, color: palette().link }}>
              {`+${newRepliesSinceView(props.item().id, props.item().replies)}`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
