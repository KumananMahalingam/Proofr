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
