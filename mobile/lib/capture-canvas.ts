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
  /** Target for the longest output side. Bounds the upload. */
  maxDim?: number;
  /** Ceiling on upscaling of small drawings. */
  maxUpscale?: number;
  onlyTypes?: readonly LayerType[];
}

export interface CaptureResult {
  base64: string;
  bounds: CanvasBounds;
}

export function captureLayers({
  bounds,
  layerIds,
  layers,
  images,
  padding = 60,
  maxDim = 2000,
  maxUpscale = 3,
  onlyTypes,
}: CaptureOptions): CaptureResult | null {
  const viewBox: CanvasBounds = {
    x: Math.floor(bounds.x - padding),
    y: Math.floor(bounds.y - padding),
    width: Math.max(1, Math.ceil(bounds.width + padding * 2)),
    height: Math.max(1, Math.ceil(bounds.height + padding * 2)),
  };

  const longest = Math.max(viewBox.width, viewBox.height);
  const scale = Math.min(maxUpscale, maxDim / longest);

  const outW = Math.max(1, Math.round(viewBox.width * scale));
  const outH = Math.max(1, Math.round(viewBox.height * scale));

  const surface = Skia.Surface.MakeOffscreen(outW, outH);
  if (!surface) {
    console.warn("[capture] MakeOffscreen returned null");
    return null;
  }

  try {
    const canvas = surface.getCanvas();

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
    surface.dispose?.();
  }
}
