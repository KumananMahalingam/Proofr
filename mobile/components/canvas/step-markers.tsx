/**
 * Tick / cross badges next to each marked line.
 *
 * Renders inside the camera group, so marks stay glued to the handwriting under
 * pan and zoom — the same property the web app got from putting them inside the
 * transformed `<g>`.
 *
 * Everything is drawn as geometry rather than glyphs. The web version used an SVG
 * `<text>` node for the "!" on incorrect steps, which would need Skia font
 * loading here; a drawn cross avoids that entirely and reads just as clearly at
 * badge size. The tick path is carried over from the web `MarkingOverlay`
 * unchanged.
 *
 * Pure props only — no hooks. Liveblocks context does not cross the Skia
 * `<Canvas>` boundary, so state is read by the parent and passed in.
 */
import { Circle, Group, Path, Skia } from "@shopify/react-native-skia";

import type { StepMarker } from "@/hooks/use-handwriting-recognition";

const RADIUS = 11;

const CORRECT_FILL = "#22c55e";
const INCORRECT_FILL = "#ef4444";

/** Same tick geometry as the web SVG marker. */
const TICK = Skia.Path.MakeFromSVGString("M -4 0 L -1 3 L 4.5 -3")!;

/** Cross, replacing the web version's text glyph. */
const CROSS = Skia.Path.MakeFromSVGString(
  "M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"
)!;

interface StepMarkersProps {
  markers: StepMarker[];
}

export const StepMarkers = ({ markers }: StepMarkersProps) => {
  return (
    <>
      {markers.map((marker) => (
        <Group
          key={marker.id}
          transform={[{ translateX: marker.x }, { translateY: marker.y }]}
        >
          <Circle
            cx={0}
            cy={0}
            r={RADIUS}
            color={marker.isCorrect ? CORRECT_FILL : INCORRECT_FILL}
          />
          <Circle
            cx={0}
            cy={0}
            r={RADIUS}
            color="#ffffff"
            style="stroke"
            strokeWidth={1.5}
          />
          <Path
            path={marker.isCorrect ? TICK : CROSS}
            color="#ffffff"
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
          />
        </Group>
      ))}
    </>
  );
};
