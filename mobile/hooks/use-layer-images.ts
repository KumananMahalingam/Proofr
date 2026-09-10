/**
 * Decodes image layers into SkImages.
 *
 * `useImage()` from react-native-skia can't be called in a loop, and image
 * layers are dynamic, so decoding is done manually into a Map keyed by layer
 * id. `drawLayers` and the capture pipeline both read from that Map.
 *
 * Accepts either a `data:` URL (what the web app stores today) or a remote /
 * local file URI (what you'll want to move to — see the notes on Liveblocks
 * storage limits).
 */
import { useEffect, useRef, useState } from "react";
import { Skia, type SkImage } from "@shopify/react-native-skia";

import { LayerType } from "@/types/canvas";
import { getLayer, type LayerLookup } from "@/lib/canvas-utils";

async function decode(src: string): Promise<SkImage | null> {
  try {
    if (src.startsWith("data:")) {
      const base64 = src.slice(src.indexOf(",") + 1);
      const data = Skia.Data.fromBase64(base64);
      return Skia.Image.MakeImageFromEncoded(data);
    }
    const data = await Skia.Data.fromURI(src);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch (error) {
    console.warn("[useLayerImages] decode failed", error);
    return null;
  }
}

export function useLayerImages(
  layerIds: readonly string[],
  layers: LayerLookup
): ReadonlyMap<string, SkImage> {
  const [images, setImages] = useState<ReadonlyMap<string, SkImage>>(new Map());

  // Tracks which src we've already decoded per layer, so re-renders don't
  // re-decode and a changed src does.
  const decodedSrcRef = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const pending: Array<[string, string]> = [];

      for (const id of layerIds) {
        const layer = getLayer(layers, id);
        if (!layer || layer.type !== LayerType.Image) continue;
        if (decodedSrcRef.current.get(id) === layer.src) continue;
        pending.push([id, layer.src]);
      }

      if (pending.length === 0) return;

      const decoded = await Promise.all(
        pending.map(async ([id, src]) => [id, src, await decode(src)] as const)
      );
      if (cancelled) return;

      setImages((prev) => {
        const next = new Map(prev);
        for (const [id, src, image] of decoded) {
          if (!image) continue;
          next.set(id, image);
          decodedSrcRef.current.set(id, src);
        }
        return next;
      });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [layerIds, layers]);

  return images;
}
