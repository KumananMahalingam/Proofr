/**
 * The single source of truth for "what a board looks like".
 */
import getStroke from "perfect-freehand";
import {
  PaintStyle,
  Skia,
  type SkCanvas,
  type SkImage,
  type SkPath,
} from "@shopify/react-native-skia";

import {
  LayerType,
  type PathLayer,
  type StrokePoint,
} from "@/types/canvas";
import { colorToCss, getLayer, type LayerLookup } from "./canvas-utils";

export const STROKE_OPTIONS = {
  size: 16,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
} as const;

export function outlineToSkPath(outline: number[][]): SkPath {
  const path = Skia.Path.Make();
  if (outline.length === 0) return path;

  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < outline.length; i++) {
    const [cx, cy] = outline[i];
    const [nx, ny] = outline[(i + 1) % outline.length];
    path.quadTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  path.close();
  return path;
}

const pathCache = new WeakMap<StrokePoint[], SkPath>();

export function pathLayerToSkPath(layer: PathLayer): SkPath {
  const cached = pathCache.get(layer.points);
  if (cached) return cached;

  const built = outlineToSkPath(
    getStroke(layer.points as number[][], STROKE_OPTIONS)
  );
  pathCache.set(layer.points, built);
  return built;
}

export const PREVIEW_STROKE_WIDTH = 9;

export function buildPreviewPath(points: StrokePoint[]): SkPath {
  "worklet";
  const path = Skia.Path.Make();
  if (points.length === 0) return path;

  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const [cx, cy] = points[i - 1];
    const [nx, ny] = points[i];
    path.quadTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  return path;
}

export type DrawLayersOptions = {
  images?: ReadonlyMap<string, SkImage>;
  selectionColors?: Record<string, string>;
  onlyTypes?: readonly LayerType[];
};

export function drawLayers(
  canvas: SkCanvas,
  layerIds: readonly string[],
  layers: LayerLookup,
  options: DrawLayersOptions = {}
) {
  const { images, selectionColors, onlyTypes } = options;

  const fill = Skia.Paint();
  fill.setStyle(PaintStyle.Fill);
  fill.setAntiAlias(true);

  const outline = Skia.Paint();
  outline.setStyle(PaintStyle.Stroke);
  outline.setAntiAlias(true);

  for (const id of layerIds) {
    const layer = getLayer(layers, id);
    if (!layer) continue;
    if (onlyTypes && !onlyTypes.includes(layer.type)) continue;

    const selectionColor = selectionColors?.[id];

    switch (layer.type) {
      case LayerType.Path: {
        fill.setColor(
          Skia.Color(layer.fill ? colorToCss(layer.fill) : "#000000")
        );
        canvas.save();
        canvas.translate(layer.x, layer.y);
        canvas.drawPath(pathLayerToSkPath(layer), fill);
        canvas.restore();
        break;
      }

      case LayerType.Rectangle: {
        const rect = Skia.XYWHRect(
          layer.x,
          layer.y,
          layer.width,
          layer.height
        );
        fill.setColor(
          Skia.Color(layer.fill ? colorToCss(layer.fill) : "#000000")
        );
        canvas.drawRect(rect, fill);
        break;
      }

      case LayerType.Ellipse: {
        const rect = Skia.XYWHRect(
          layer.x,
          layer.y,
          layer.width,
          layer.height
        );
        fill.setColor(
          Skia.Color(layer.fill ? colorToCss(layer.fill) : "#000000")
        );
        canvas.drawOval(rect, fill);
        break;
      }

      case LayerType.Note: {
        // Background only. Glyphs come from the native overlay
        // (`note-overlay.tsx`), since Skia has no text input and RN's text engine
        // handles wrapping and font fallback far better.
        const rect = Skia.XYWHRect(layer.x, layer.y, layer.width, layer.height);

        // Offset drop shadow, so a note reads as a physical object sitting on the
        // page rather than a flat rectangle. The web app got this from a Tailwind
        // `shadow-md` on the foreignObject.
        const shadow = Skia.Paint();
        shadow.setStyle(PaintStyle.Fill);
        shadow.setAntiAlias(true);
        shadow.setColor(Skia.Color("rgba(0,0,0,0.18)"));
        canvas.drawRRect(
          Skia.RRectXY(
            Skia.XYWHRect(
              layer.x + 3,
              layer.y + 4,
              layer.width,
              layer.height
            ),
            3,
            3
          ),
          shadow
        );

        // Default to sticky-note yellow rather than black when no fill is set.
        fill.setColor(
          Skia.Color(layer.fill ? colorToCss(layer.fill) : "#facc15")
        );
        canvas.drawRRect(Skia.RRectXY(rect, 3, 3), fill);
        break;
      }

      case LayerType.Text: {
        // Glyphs only — nothing for Skia to draw.
        break;
      }

      case LayerType.Image: {
        const image = images?.get(id);
        if (!image) break;
        canvas.drawImageRect(
          image,
          Skia.XYWHRect(0, 0, image.width(), image.height()),
          Skia.XYWHRect(layer.x, layer.y, layer.width, layer.height),
          fill
        );
        break;
      }
    }

    if (selectionColor) {
      outline.setColor(Skia.Color(selectionColor));
      outline.setStrokeWidth(1);
      canvas.drawRect(
        Skia.XYWHRect(layer.x, layer.y, layer.width, layer.height),
        outline
      );
    }
  }
}

export function boundsOf(
  layerIds: readonly string[],
  layers: LayerLookup,
  onlyTypes?: readonly LayerType[]
) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const id of layerIds) {
    const layer = getLayer(layers, id);
    if (!layer) continue;
    if (onlyTypes && !onlyTypes.includes(layer.type)) continue;

    if (layer.x < minX) minX = layer.x;
    if (layer.y < minY) minY = layer.y;
    if (layer.x + layer.width > maxX) maxX = layer.x + layer.width;
    if (layer.y + layer.height > maxY) maxY = layer.y + layer.height;
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type StrokeLineAnchor = { y: number; rightX: number };

const LINE_RIGHT_EDGE_RATIO = 0.35;
const LINE_GROUP_RATIO = 0.7;
const MIN_LINE_THRESHOLD = 16;

export function getPathLineAnchors(
  layerIds: readonly string[],
  layers: LayerLookup
): StrokeLineAnchor[] {
  const strokes: Array<{ midY: number; rightX: number; height: number }> = [];

  for (const id of layerIds) {
    const layer = getLayer(layers, id);
    if (!layer || layer.type !== LayerType.Path) continue;

    strokes.push({
      midY: layer.y + layer.height / 2,
      rightX: layer.x + layer.width,
      height: layer.height,
    });
  }

  if (strokes.length === 0) return [];

  const sortedHeights = strokes.map((s) => s.height).sort((a, b) => a - b);
  const p75 =
    sortedHeights[Math.min(sortedHeights.length - 1, Math.floor(sortedHeights.length * 0.75))] ?? 0;

  const lineHeight = Math.max(MIN_LINE_THRESHOLD, p75);
  const threshold = Math.max(MIN_LINE_THRESHOLD, lineHeight * LINE_GROUP_RATIO);
  const rightOffset = lineHeight * LINE_RIGHT_EDGE_RATIO;

  strokes.sort((a, b) => a.midY - b.midY);

  type Group = { sumMidY: number; count: number; maxRightX: number };
  const groups: Group[] = [];

  for (const stroke of strokes) {
    let selected: Group | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const group of groups) {
      const groupMidY = group.sumMidY / group.count;
      const distance = Math.abs(stroke.midY - groupMidY);
      if (distance <= threshold && distance < bestDistance) {
        selected = group;
        bestDistance = distance;
      }
    }

    if (!selected) {
      groups.push({
        sumMidY: stroke.midY,
        count: 1,
        maxRightX: stroke.rightX,
      });
    } else {
      selected.sumMidY += stroke.midY;
      selected.count += 1;
      if (stroke.rightX > selected.maxRightX) {
        selected.maxRightX = stroke.rightX;
      }
    }
  }

  return groups
    .map((group) => ({
      y: group.sumMidY / group.count,
      rightX: group.maxRightX + rightOffset,
    }))
    .sort((a, b) => a.y - b.y);
}
