/**
 * Replacement for `lib/capture-canvas.ts`.
 *
 * The web version cloned the live `<svg>`, rewrote its `viewBox`, neutralised
 * the camera transform, serialised it to a blob, loaded that into an `Image`,
 * and rasterised it through a 2D canvas — five failure points, plus a
 * `SecurityError` risk from tainted cross-origin images.
 *
 * Skia collapses all of that into: make an offscreen surface, apply the same
 * viewBox maths as a plain canvas transform, replay `drawLayers`, snapshot.
 * No DOM, no CORS, and no possibility of the capture disagreeing with what's
 * on screen, because it calls the exact same draw function.
 */
import { ImageFormat, Skia, type SkImage } from "@shopify/react-native-skia";

import { LayerType } from "@/types/canvas";
import type { LayerLookup } from "./canvas-utils";
import { drawLayers } from "./skia-draw";

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureOptions {
  bounds: CanvasBounds;
  layerIds: readonly string[];
  layers: LayerLookup;
  images?: ReadonlyMap<string, SkImage>;
  /** Canvas units of whitespace around `bounds`. Web default was 60. */
  padding?: number;
  /** Cap on the longest output side, to keep the upload bounded. */
  maxDim?: number;
  /** Pass `[LayerType.Path]` to send the model only the student's ink. */
  onlyTypes?: readonly LayerType[];
}

export interface CaptureResult {
  /** Bare base64 (no data-URL prefix), matching `captureCanvas`'s return. */
  base64: string;
  /**
   * The region actually rendered, in canvas coordinates and with padding
   * already applied. Marker placement must be interpreted against this exact
   * rect — same contract as the web `captureWorkingArea`.
   */
  bounds: CanvasBounds;
}

export function captureLayers({
  bounds,
  layerIds,
  layers,
  images,
  padding = 60,
  maxDim = 1600,
  onlyTypes,
}: CaptureOptions): CaptureResult | null {
  const viewBox: CanvasBounds = {
    x: Math.floor(bounds.x - padding),
    y: Math.floor(bounds.y - padding),
    width: Math.max(1, Math.ceil(bounds.width + padding * 2)),
    height: Math.max(1, Math.ceil(bounds.height + padding * 2)),
  };

  const scale = Math.min(1, maxDim / Math.max(viewBox.width, viewBox.height));
  const outW = Math.max(1, Math.round(viewBox.width * scale));
  const outH = Math.max(1, Math.round(viewBox.height * scale));

  const surface = Skia.Surface.MakeOffscreen(outW, outH);
  if (!surface) {
    console.warn("[capture] MakeOffscreen returned null");
    return null;
  }

  try {
    const canvas = surface.getCanvas();

    // The model reads dark ink; give it an opaque white page rather than the
    // transparent black an unfilled surface would encode to.
    canvas.clear(Skia.Color("#ffffff"));

    canvas.save();
    canvas.scale(scale, scale);
    canvas.translate(-viewBox.x, -viewBox.y);
    drawLayers(canvas, layerIds, layers, { images, onlyTypes });
    canvas.restore();

    surface.flush();

    const snapshot = surface.makeImageSnapshot();
    const base64 = snapshot.encodeToBase64(ImageFormat.PNG, 100);
    if (!base64) return null;

    return { base64, bounds: viewBox };
  } catch (error) {
    console.error("[capture] failed", error);
    return null;
  } finally {
    // Offscreen surfaces hold GPU memory and the recognition pipeline fires on
    // every stroke, so leaking one per capture will end badly.
    surface.dispose?.();
  }
}
