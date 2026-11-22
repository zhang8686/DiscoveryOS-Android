import { cleanup, createMotion, Image, View } from "nsh";
import refreshSvg from "./refresh.svg";

const SIZE = 16;

export function LoadingBar() {
  const motion = createMotion();
  void motion.play("spin", { duration: 900, iterations: "infinite", easing: "linear" });
  cleanup(() => motion.stop());
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 16 }}>
      <View accessibilityLabel="加载中" style={{ width: SIZE, height: SIZE, ...motion.style }}>
        <Image src={refreshSvg} style={{ width: SIZE, height: SIZE }} />
      </View>
    </View>
  );
}
