import { colorScheme, signal, Text, View, type JSX } from "nsh";
import { palette } from "./appearance";
import { Avatar } from "./Avatar";

/** The card's own measure: its padding, the face's size, and the gap after the face. */
const PADDING = 10;
const FACE = 36;
const GAP = 8;

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
  /** A press on the card, outside whatever its body handles itself (e.g. to close the body's
   *  character-precise selection). The innermost view that hears presses takes one, then the
   *  card does. */
  onPress?: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}) {
  const cardWidth = signal(0);
  // The card carries no padding of its own: a padded box hands its children the padding-box
  // width, and text measured against it wraps 2 × the padding too wide, then draws past the
  // card's right edge. The inset is a margin on the row inside instead, which the layout does
  // subtract, and the row states its width so nothing is left to the distribution.
  const rowWidth = () => {
    const width = cardWidth() - PADDING * 2;
    return width > 0 ? width : undefined;
  };
  const columnWidth = () => {
    const width = cardWidth() - PADDING * 2 - FACE - GAP;
    return width > 0 ? width : undefined;
  };
  return (
    <View
      onPress={props.onPress}
      onMouseEnter={props.onHoverIn}
      onMouseLeave={props.onHoverOut}
      onLayout={(e) => {
        const width = e.bounds.size.width;
        if (Math.abs(width - cardWidth()) > 0.5) cardWidth.set(width);
      }}
      style={{
        borderRadius: 8,
        backgroundColor: props.highlighted?.() ? palette().replyHighlight : palette().surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: GAP,
          margin: PADDING,
          width: rowWidth(),
        }}
      >
        <Avatar
          size={FACE}
          url={props.avatar}
          onPress={props.onAvatarPress}
          accessibilityLabel={props.onAvatarPress ? `查看 ${props.name} 的资料` : undefined}
        />
        {/* Until the card has been measured the column keeps `flex: 1`; once it has, its width is
            the row's width less the face and the gap, so the text wraps inside the card. */}
        <View
          style={{
            width: columnWidth(),
            flexGrow: columnWidth() === undefined ? 1 : 0,
            flexShrink: 1,
            minWidth: 0,
            gap: 6,
          }}
        >
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
    </View>
  );
}
