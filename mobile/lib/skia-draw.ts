/**
 * The single source of truth for "what a board looks like".
 *
 * This one function is used for BOTH on-screen rendering (wrapped in
 * `createPicture`) and for the offscreen PNG capture that feeds the vision
 * model. That's deliberate: in the web app, `captureCanvas` cloned the live
 * SVG, so what the model saw was guaranteed to match what the student saw. If
 * mobile had a declarative render path and a separate imperative capture path,
 * the two would drift and marker placement would land on the wrong lines.
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

/**
 * Web `<Path>` options, plus `simulatePressure`.
 *
 * That addition matters: `thinning: 0.5` varies stroke width by pressure, and
 * finger input reports none. Without simulation every stroke renders at a flat
 * mid-width and the ink looks lifeless compared to the desktop app.
 * `simulatePressure` derives width from velocity instead, which is why dropping
 * the pressure component from stored points costs nothing visually.
 */
export const STROKE_OPTIONS = {
  size: 16,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
} as const;

/**
 * Converts a `perfect-freehand` outline into an SkPath.
 *
 * This is the mobile counterpart of `getSvgPathFromStroke`. Rather than build
 * an SVG `d` string and hand it to `Skia.Path.MakeFromSVGString`, we emit the
 * same quadratic segments straight into an SkPath — identical geometry, no
 * string parse, and no dependence on Skia's SVG path grammar.
 */
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

/**
 * Cache of committed stroke geometry, keyed on the `points` array identity.
 *
 * Liveblocks hands out a frozen snapshot, so a layer's `points` array keeps a
 * stable reference until that layer actually changes. A WeakMap therefore gives
 * us free invalidation with no eviction policy to tune.
 */
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

/**
 * Preview path for the stroke currently under the user's finger.
 *
 * A worklet, so it runs on the UI thread and the live ink never waits on the
 * JS thread. Note this is a *stroked polyline*, not a perfect-freehand outline:
 * regenerating the outline every frame is wasted work when the committed layer
 * will be rebuilt properly on release anyway. The tradeoff is a small visual
 * pop at commit time — tune `PREVIEW_STROKE_WIDTH` against `STROKE_OPTIONS.size`
 * until it's not noticeable.
 */
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
  /** Decoded images, keyed by layer id. See `useLayerImages`. */
  images?: ReadonlyMap<string, SkImage>;
  /** layerId -> outline colour, from other users' selections. */
  selectionColors?: Record<string, string>;
  /**
   * Restrict drawing to these layer types. The capture pipeline uses
   * `[LayerType.Path]` to send the model *only* the student's ink — something
   * the web SVG-clone capture couldn't actually guarantee, since any layer
   * overlapping the viewBox got rasterised along with it.
   */
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

      case LayerType.Note:
      case LayerType.Text: {
        // Background only. The glyphs are rendered by the native overlay
        // (see `note-overlay.tsx`) because Skia has no text input and RN's
        // text engine handles wrapping and font fallback far better.
        if (layer.type === LayerType.Note) {
          const rect = Skia.XYWHRect(
            layer.x,
            layer.y,
            layer.width,
            layer.height
          );
          fill.setColor(
            Skia.Color(layer.fill ? colorToCss(layer.fill) : "#000000")
          );
          canvas.drawRRect(Skia.RRectXY(rect, 2, 2), fill);
        }
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

/** Union bounding box, for centring / capture. Mirrors `computeLayerBounds`. */
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

/**
 * Vertical centre and right edge of each handwritten line, derived from stroke
 * geometry. Direct port of `getPathLineAnchors` from the web `canvas.tsx`.
 *
 * This is the fix the web app's README describes as the hardest problem in the
 * project, and it ports across untouched because it never depended on the
 * renderer — only on bounding boxes already in storage.
 *
 * The split of responsibility is the whole point:
 *   - the MODEL decides judgement and order (which lines exist, top to bottom,
 *     and whether each is right)
 *   - the CLIENT decides position, by clustering strokes into lines
 *
 * Vision models read content well and estimate coordinates badly, so trusting
 * their (x, y) made marks drift between lines. Model verdicts are mapped onto
 * these anchors by index instead.
 */
export type StrokeLineAnchor = { y: number; rightX: number };

/**
 * Horizontal gap between a line's rightmost ink and its mark, as a fraction of
 * the detected line height. The web app used a flat 20 canvas units, which is
 * invisible next to letters several hundred units tall.
 */
const LINE_RIGHT_EDGE_RATIO = 0.35;

/**
 * How far apart two strokes' vertical centres can be and still count as the same
 * line, as a fraction of the detected line height.
 */
const LINE_GROUP_RATIO = 0.7;

/** Floor for tiny drawings, so the threshold never collapses to nothing. */
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

  /**
   * Derive the clustering threshold from the ink itself rather than hardcoding it.
   *
   * This is the fix for marks landing mid-line on mobile. The web app's flat
   * 50-unit threshold assumed desktop-sized handwriting; a finger on a zoomed-out
   * phone canvas produces letters many times larger, so strokes on the same line
   * differ in vertical centre by far more than 50 units. Every stroke then became
   * its own "line", and the model's ordered verdicts mapped onto individual
   * strokes instead of lines.
   *
   * The 75th percentile of stroke heights approximates the height of a tall
   * letter, which is a good proxy for line height — the median would be dragged
   * down by dots, minus signs, and equals bars.
   */
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
