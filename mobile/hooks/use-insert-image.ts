/**
 * Problem-image insertion: pick or shoot -> upload to Convex -> insert layer.
 *
 * Two changes from the web `addProblemImage` / `createImageLayerAtPoint`:
 *
 *  1. No drag-and-drop and no `FileReader`. `expo-image-picker` covers both the
 *     library and the camera, which is the flow that actually matters on a phone
 *     where the problem is on paper in front of you.
 *
 *  2. Sizing is viewport-relative, not a fixed 400 units. With resize handles
 *     cut from the first pass, an image is stuck at whatever width it's inserted
 *     at — and a hardcoded 400 is wider than most phone screens, so every
 *     problem image would land unusably large with no way to shrink it.
 */
import { useCallback } from "react";
import { useWindowDimensions } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useConvex, useMutation as useConvexMutation } from "convex/react";
import { LiveObject } from "@liveblocks/client";
import { nanoid } from "nanoid/non-secure";

import { api } from "@/convex/_generated/api";
import { useMutation } from "@/liveblocks.config";
import { CanvasMode, LayerType, type Camera } from "@/types/canvas";

/** Fraction of the viewport width a freshly inserted problem image occupies. */
const IMAGE_VIEWPORT_FRACTION = 0.8;

export function useInsertImage(
  camera: () => Camera,
  setCanvasState: (state: { mode: CanvasMode.None }) => void
) {
  const { width: viewportWidth, height: viewportHeight } =
    useWindowDimensions();
  const convex = useConvex();
  const generateUploadUrl = useConvexMutation(api.images.generateUploadUrl);

  const insertImageLayer = useMutation(
    (
      { storage, setMyPresence },
      layer: {
        x: number;
        y: number;
        width: number;
        height: number;
        storageId: string;
        src: string;
      }
    ) => {
      const layerId = nanoid();
      storage.get("layers").set(
        layerId,
        new LiveObject({ type: LayerType.Image as const, ...layer })
      );
      storage.get("layerIds").push(layerId);
      setMyPresence({ selection: [layerId] }, { addToHistory: true });
    },
    []
  );

  return useCallback(
    async (source: "camera" | "library") => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) return;

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      // Upload straight to Convex storage.
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        body: await (await fetch(asset.uri)).blob(),
      });

      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as { storageId: string };

      // Resolve the shared URL before inserting. `asset.uri` is a local
      // `file://` path that only exists on this device, so storing it would
      // render the image for the person who added it and nobody else in the
      // room. Convex storage URLs are stable, so resolving once here is safe.
      const src = await convex.query(api.images.getUrl, {
        storageId: storageId as never,
      });
      if (!src) throw new Error("Could not resolve uploaded image URL");

      // `expo-image-picker` already reports intrinsic dimensions, so unlike the
      // web `loadImageSize` there's no decode round trip needed just to get the
      // aspect ratio.
      const aspect =
        asset.width && asset.height ? asset.height / asset.width : 1;

      const cam = camera();
      const width = (viewportWidth * IMAGE_VIEWPORT_FRACTION) / cam.zoom;
      const height = width * aspect;

      // Canvas-space point under the centre of the viewport, accounting for
      // both pan and zoom — same maths as the web version.
      const x = (viewportWidth / 2 - cam.x) / cam.zoom - width / 2;
      const y = (viewportHeight / 2 - cam.y) / cam.zoom - height / 2;

      insertImageLayer({ x, y, width, height, storageId, src });

      setCanvasState({ mode: CanvasMode.None });
    },
    [
      camera,
      convex,
      generateUploadUrl,
      insertImageLayer,
      setCanvasState,
      viewportHeight,
      viewportWidth,
    ]
  );
}
