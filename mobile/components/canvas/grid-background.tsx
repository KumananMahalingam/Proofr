import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { Path, Skia } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

const GRID_SIZE = 24;
const GRID_COLOR = "rgba(120,120,130,0.20)";

interface GridBackgroundProps {
  cameraX: SharedValue<number>;
  cameraY: SharedValue<number>;
  zoom: SharedValue<number>;
}

export const GridBackground = ({
  cameraX,
  cameraY,
  zoom,
}: GridBackgroundProps) => {
  const { width, height } = useWindowDimensions();

  const path = useDerivedValue(() => {
    const z = zoom.value || 1;

    // Visible region in canvas coordinates.
    const left = -cameraX.value / z;
    const top = -cameraY.value / z;
    const right = left + width / z;
    const bottom = top + height / z;

    const p = Skia.Path.Make();

    const firstX = Math.floor(left / GRID_SIZE) * GRID_SIZE;
    for (let gx = firstX; gx <= right; gx += GRID_SIZE) {
      p.moveTo(gx, top);
      p.lineTo(gx, bottom);
    }

    const firstY = Math.floor(top / GRID_SIZE) * GRID_SIZE;
    for (let gy = firstY; gy <= bottom; gy += GRID_SIZE) {
      p.moveTo(left, gy);
      p.lineTo(right, gy);
    }

    return p;
  });

  // Divide by zoom so grid lines stay hairline-thin on screen at any scale,
  // rather than thickening as you zoom in.
  const strokeWidth = useDerivedValue(() => 1 / (zoom.value || 1));

  const color = useMemo(() => GRID_COLOR, []);

  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={strokeWidth}
      color={color}
    />
  );
};
