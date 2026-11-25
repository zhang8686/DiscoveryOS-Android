import { computed, Text, View } from "nsh";
import type { Post } from "../discuz/parse";
import { timeAgo } from "../discuz/timeAgo";
import { palette } from "./appearance";
import { displaySettings } from "./settings";
import { Avatar } from "./Avatar";
import { LineIcon } from "./lineIcons";
import { newRepliesSinceView } from "./history";

const AVATAR_BASE = 32;
const LIST_BASE = 12.5;
function avatarSide(fontSize: number): number {
  return Math.max(26, Math.min(40, Math.round((AVATAR_BASE * fontSize) / LIST_BASE)));
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
  // Gathered once per row update, because a row is a dozen separate bindings — height, tint,
  // title, counts, two times — and each of them is its own tracked expression. Read separately
  // they would fetch the post a dozen times, build the palette nine times and parse the same
  // timestamp twice on every update; through a `computed` the work is done once and every
  // binding reads the result.
  const row = computed(() => {
    const p = props.item();
    const colors = palette();
    const font = displaySettings().list;
    const when = timeAgo((p.lastReplyAt ?? p.at) ?? "");
    return {
      p,
      colors,
      font,
      side: avatarSide(font),
      selected: props.selected(),
      viewed: props.viewed(),
      favorite: props.favorite(),
      sortByDate: props.sortByDate?.() ?? false,
      meta: meta(p, props.sortByDate?.() ?? false),
      when,
      fresh: p.replies === undefined ? 0 : newRepliesSinceView(p.id, p.replies),
    };
  });
  return (
    <View
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 6,
        height: row().p.excerpt !== undefined ? undefined : 64,
        backgroundColor: row().selected ? row().colors.selected : row().colors.surface,
        opacity: row().p.pinned ? 0.5 : (row().viewed && !row().selected ? 0.62 : 1),
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Avatar size={row().side} radius={7} url={props.avatar()} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Text style={{ numberOfLines: 2, fontSize: row().font, color: row().p.color ?? (row().viewed ? row().colors.muted : row().colors.text), fontWeight: row().viewed ? 400 : 600, flexShrink: 1 }}>
            {row().favorite ? <Text style={{ fontSize: 11, color: row().colors.muted }}>{"★ "}</Text> : null}
            {row().p.title}
          </Text>
          {row().p.agreed ? <LineIcon name="thumb" size={12} /> : null}
        </View>
        {}
        {row().p.excerpt !== undefined ? (
          row().p.excerpt ? <Text style={{ fontSize: 12, color: row().colors.muted }}>{row().p.excerpt}</Text> : null
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
            <Text style={{ fontSize: 11, color: row().colors.muted, flexShrink: 1, numberOfLines: 1 }}>
              {row().meta}
            </Text>
            {}
            {row().p.hasImages ? <LineIcon name="image" size={12} /> : null}
          </View>
        )}
      </View>
      {row().p.excerpt !== undefined ? (
        <View style={{ width: 0, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: row().colors.muted }}>{row().when}</Text>
        </View>
      ) : null}
      {(row().p.replies === undefined && row().p.views === undefined) ? null : (
        <View style={{ width: 52, alignItems: "flex-end", gap: 1 }}>
          {row().p.views !== undefined ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={{ fontSize: 11, color: row().colors.muted }}>{String(row().p.views)}</Text>
              <LineIcon name="eye" size={11} color={row().colors.muted} />
            </View>
          ) : null}
          {row().p.replies !== undefined ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={{ fontSize: 11, color: row().colors.muted }}>{String(row().p.replies)}</Text>
              <LineIcon name="bubble" size={11} color={row().colors.muted} />
            </View>
          ) : null}
          {row().fresh > 0 ? (
            <Text style={{ fontSize: 10, fontWeight: 600, color: row().colors.link }}>
              {`+${row().fresh}`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
