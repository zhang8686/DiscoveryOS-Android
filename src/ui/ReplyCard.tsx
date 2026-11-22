import { colorScheme, Image, Text, View, type JSX } from "nsh";
import { palette } from "./appearance";
import { Avatar } from "./Avatar";
import { PLACEHOLDER_AVATAR } from "../discuz/avatarUrl";

export function ReplyCard(props: {
  avatar?: string;
  name: string;
  /** Whether the post is by the thread's author (楼主), shown as a tag beside the name. */
  isOp?: boolean;
  /** Opens the private-message sheet for this floor's author. */
  onAvatarPress?: () => void;
  meta: string;
  /** Controls at the end of the meta line, such as Quote. */
  trailing?: JSX.Element | null;
  body: JSX.Element;
  /** Whether the post is highlighted (the pointer is over it, so `q` quotes it). */
  highlighted?: () => boolean;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}) {
  return (
    <View
      onMouseEnter={props.onHoverIn}
      onMouseLeave={props.onHoverOut}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        borderRadius: 8,
        backgroundColor: props.highlighted?.() ? palette().replyHighlight : palette().surface,
      }}
    >
      {
}
      <Avatar
        size={36}
        url={props.avatar}
        onPress={props.onAvatarPress}
        accessibilityLabel={props.onAvatarPress ? `查看 ${props.name} 的资料` : undefined}
      />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 13, color: palette().text }}>{props.name}</Text>
          {props.isOp ? (
            // Dark orange on the dark surface, dark blue on the light one.
            <View style={{ paddingHorizontal: 2, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: 600, color: colorScheme() === "dark" ? "#d9822b" : "#2f5f9e" }}>楼主</Text>
            </View>
          ) : null}
          <Text style={{ fontSize: 12, color: palette().muted }}>{props.meta}</Text>
          {props.trailing}
        </View>
        {props.body}
      </View>
    </View>
  );
}
