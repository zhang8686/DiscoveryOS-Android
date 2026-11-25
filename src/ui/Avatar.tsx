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
  // The address that failed, not a plain boolean: a row recycled onto another member asks for a
  // different face, and that one must be tried (a boolean would keep the dinosaur for good).
  const failedFor = signal<string | undefined>(undefined);
  const showsPicture = () => !!props.url && props.url.length > 0 && failedFor() !== props.url;
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
      {/* The dinosaur is the placeholder, not a layer: once the face is there it is neither drawn
          behind it nor faded away, which is one less canvas repaint per row while a list scrolls. */}
      {showsPicture() ? (
        <Image
          src={props.url!}
          fadeDuration={0}
          onError={() => failedFor.set(props.url)}
          style={{ position: "absolute", left: 0, top: 0, width: props.size, height: props.size, objectFit: "cover" }}
        />
      ) : (
        <PixelDino size={Math.round(props.size * 0.9)} />
      )}
    </View>
  );
}
