// One post in the forum's style: the avatar on the left, and beside it the meta line over
// the body. Threads and private-message conversations both show their posts this way.
import { colorScheme, Image, Text, View, type JSX } from "nsh";
import { palette } from "./appearance";
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
      {/* Two columns, as the Swift app: the avatar on the left, and beside it the meta line
          over the body, so the body starts under the name. */}
      <View
        onPress={props.onAvatarPress}
        accessibilityLabel={props.onAvatarPress ? `给 ${props.name} 发短消息` : undefined}
        style={{ width: 36, height: 36, borderRadius: 6, overflow: "hidden" }}
      >
        {props.avatar ? <Image src={props.avatar} placeholder={PLACEHOLDER_AVATAR} fadeDuration={160} style={{ width: 36, height: 36 }} /> : <Image src={PLACEHOLDER_AVATAR} style={{ width: 36, height: 36 }} />}
      </View>
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
