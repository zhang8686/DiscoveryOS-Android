// One thread in a channel's list. A `List` recycles its rows for other threads as the user
// scrolls, so a row reads its thread through `item()` rather than holding it, and keeps no
// state of its own beyond its hover animation, which a hover-out always settles.
import { Image, Text, View } from "nsh";
import type { Post } from "../discuz/parse";
import { timeAgo } from "../discuz/timeAgo";
import { palette } from "./appearance";
import { PLACEHOLDER_AVATAR } from "../discuz/avatarUrl";

function meta(p: Post): string {
  return [p.author, (p.lastReplyAt ?? p.at) ? timeAgo(p.lastReplyAt ?? p.at!) : undefined].filter(Boolean).join(" · ");
}

export function ThreadRow(props: {
  item: () => Post;
  selected: () => boolean;
  avatar: () => string | undefined;
  // Whether the thread is a favorite: a solid star before its title.
  favorite: () => boolean;
  // Already read: its title goes muted and the row dims a little, so unread
  // threads stand out in the list.
  viewed: () => boolean;
  onPress: () => void;
}) {
  return (
    <View
      onPress={props.onPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: props.selected() ? palette().selected : palette().surface,
        // A pinned thread sits at the top whatever its reply time, so it is greyed to read as pinned.
        opacity: props.item().pinned ? 0.5 : (props.viewed() && !props.selected() ? 0.62 : 1),
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {props.avatar() ? (
        <Image src={props.avatar()!} placeholder={PLACEHOLDER_AVATAR} fadeDuration={0} style={{ width: 24, height: 24, borderRadius: 5 }} />
      ) : (
        <View style={{ width: 24, height: 24, borderRadius: 5, backgroundColor: palette().border }} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        {/* A favorite's star is a span of the title's own text, so it sits on the first line and wraps with it. */}
        <Text style={{ fontSize: 12.5, color: props.viewed() ? palette().muted : palette().text, fontWeight: props.viewed() ? 400 : 600 }}>
          {props.favorite() ? <Text style={{ fontSize: 11, color: palette().muted }}>{"★ "}</Text> : null}
          {props.item().title}
        </Text>
        {/* My Replies rows: the reply's text takes the second line, and the time moves to the right. */}
        {props.item().excerpt !== undefined ? (
          props.item().excerpt ? <Text style={{ fontSize: 12, color: palette().muted }}>{props.item().excerpt}</Text> : null
        ) : (
          <Text style={{ fontSize: 11, color: palette().muted }}>{meta(props.item())}</Text>
        )}
      </View>
      {props.item().excerpt !== undefined ? (
        <View style={{ width: 0, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: palette().muted }}>{timeAgo((props.item().lastReplyAt ?? props.item().at) ?? "")}</Text>
        </View>
      ) : null}
      {/* Replies in a fixed right-hand column, so the counts line up down the list. Lists
          that carry no count (the user's own threads) leave the column out. */}
      {props.item().replies === undefined ? null : (
        <View style={{ width: 46, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: palette().muted }}>{String(props.item().replies)} 回复</Text>
        </View>
      )}
    </View>
  );
}
