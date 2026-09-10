/**
 * DOM-free port of `lib/utils.ts`.
 *
 * Everything here is either copied verbatim from the web app or is a worklet
 * variant of a web helper. Notably absent:
 *   - `cn()` / tailwind-merge  -> styling is handled by NativeWind or StyleSheet
 *   - `pointerEventToCanvasPoint` -> replaced by `screenToCanvas` (a worklet,
 *     because touch coordinates now arrive on the UI thread)
 */
import type {
  Camera,
  Color,
  Layer,
  Point,
  StrokePoint,
} from "@/types/canvas";
import { LayerType } from "@/types/canvas";

const COLORS = ["#DC2626", "#D97706", "#059669", "#7C3AED", "#DB2777"];

export function connectionIdToColor(connectionId: number): string {
  return COLORS[connectionId % COLORS.length];
}

export function colorToCss(color: Color) {
  return `#${color.r.toString(16).padStart(2, "0")}${color.g
    .toString(16)
    .padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`;
}

export function getContrastingTextColor(color: Color) {
  const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  return luminance > 182 ? "black" : "white";
}

/**
 * Screen -> canvas coordinate conversion.
 *
 * Marked `worklet` so it can be called directly inside gesture handlers on the
 * UI thread. This is the RN equivalent of `pointerEventToCanvasPoint`, with the
 * identical formula: (screen - pan) / zoom.
 */
export function screenToCanvas(
  sx: number,
  sy: number,
  camera: Camera
): Point {
  "worklet";
  const zoom = camera.zoom || 1;
  return { x: (sx - camera.x) / zoom, y: (sy - camera.y) / zoom };
}

export function clampWorklet(value: number, min: number, max: number) {
  "worklet";
  return Math.max(min, Math.min(max, value));
}

/**
 * Liveblocks' immutable storage snapshot exposes a `LiveMap` differently
 * across versions (`ReadonlyMap` vs. a plain record). The web app indexes it
 * with `root.layers[id]`; this helper accepts either shape so the mobile code
 * doesn't silently render nothing if that ever changes under you.
 */
export type LayerLookup =
  | ReadonlyMap<string, Layer>
  | Readonly<Record<string, Layer>>;

export function getLayer(
  layers: LayerLookup,
  id: string
): Layer | undefined {
  if (typeof (layers as ReadonlyMap<string, Layer>).get === "function") {
    return (layers as ReadonlyMap<string, Layer>).get(id);
  }
  return (layers as Record<string, Layer>)[id];
}

/**
 * Port of `penPointsToPathLayer`. Same bounding-box-then-rebase logic; the only
 * change is that points are `[x, y]` pairs now that pressure is gone.
 *
 * `resizeBounds` and `findIntersectingLayersWithRectangle` are intentionally
 * absent — resize handles and marquee selection are cut from the first pass.
 * Both port cleanly from `lib/utils.ts` when you're ready for them.
 */
export function penPointsToPathLayer(points: StrokePoint[], color: Color) {
  if (points.length < 2) {
    throw new Error("Cannot transform points with less than 2 points");
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    if (left > x) left = x;
    if (top > y) top = y;
    if (right < x) right = x;
    if (bottom < y) bottom = y;
  }

  return {
    type: LayerType.Path as const,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    fill: color,
    points: points.map(
      ([x, y]) => [x - left, y - top] as StrokePoint
    ),
  };
}

/**
 * Reverse-order hit test for "what did the user tap on".
 *
 * The web app got this free from the DOM (`onPointerDown` on each `<path>`).
 * With Skia there is no scene graph to hit against, so picking is explicit:
 * walk layers front-to-back and take the first bounding-box hit.
 */
export function hitTestLayers(
  layerIds: readonly string[],
  layers: LayerLookup,
  point: Point,
  slop = 0
): string | null {
  for (let i = layerIds.length - 1; i >= 0; i--) {
    const id = layerIds[i];
    const layer = getLayer(layers, id);
    if (!layer) continue;

    if (
      point.x >= layer.x - slop &&
      point.x <= layer.x + layer.width + slop &&
      point.y >= layer.y - slop &&
      point.y <= layer.y + layer.height + slop
    ) {
      return id;
    }
  }
  return null;
}
