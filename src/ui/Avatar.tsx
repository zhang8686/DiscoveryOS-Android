import { Image, signal, View } from "nsh";
import { palette } from "./appearance";
import { PixelDino } from "./PixelArt";

export function Avatar(props: {
  size: number;
  /** The picture's address; empty or missing draws the dinosaur. */
  url?: string;
  /** Corner rounding: square (0) for a plain face, 6–8 for the app's cards. */
  radius?: number;
  /** Opens something when pressed (a card, a message sheet). */
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const failed = signal(false);
  const showsPicture = () => !!props.url && props.url.length > 0 && !failed();
  return (
    <View
      onPress={props.onPress}
      accessibilityLabel={props.accessibilityLabel}
      style={{
        width: props.size,
        height: props.size,
        borderRadius: props.radius ?? 6,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette().border,
      }}
    >
      {
}
      <PixelDino size={Math.round(props.size * 0.9)} />
      {showsPicture() ? (
        <Image
          src={props.url!}
          fadeDuration={120}
          onError={() => failed.set(true)}
          style={{ position: "absolute", left: 0, top: 0, width: props.size, height: props.size }}
        />
      ) : null}
    </View>
  );
}
