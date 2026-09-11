/**
 * Camera (pan + zoom) held entirely in Reanimated shared values.
 */
import { Gesture } from "react-native-gesture-handler";
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";

import { MAX_ZOOM, MIN_ZOOM, type Camera, type Point } from "@/types/canvas";
import { clampWorklet } from "@/lib/canvas-utils";

export type CameraController = ReturnType<typeof useCamera>;

export function useCamera() {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const zoom = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startZoom = useSharedValue(1);

  const transform = useDerivedValue(() => [
    { translateX: x.value },
    { translateY: y.value },
    { scale: zoom.value },
  ]);

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: zoom.value },
    ],
  }));

  const pinch = Gesture.Pinch()
    .onStart(() => {
      "worklet";
      startX.value = x.value;
      startY.value = y.value;
      startZoom.value = zoom.value;
    })
    .onUpdate((e) => {
      "worklet";
      const next = clampWorklet(startZoom.value * e.scale, MIN_ZOOM, MAX_ZOOM);
      const ratio = next / startZoom.value;
      zoom.value = next;
      x.value = e.focalX - (e.focalX - startX.value) * ratio;
      y.value = e.focalY - (e.focalY - startY.value) * ratio;
    });

  const pan = Gesture.Pan()
    // Two fingers pans; one finger belongs to whichever tool is active.
    .minPointers(2)
    .averageTouches(true)
    .onStart(() => {
      "worklet";
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      "worklet";
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    });

  const toCanvas = (sx: number, sy: number): Point => {
    "worklet";
    const z = zoom.value || 1;
    return { x: (sx - x.value) / z, y: (sy - y.value) / z };
  };

  const snapshot = (): Camera => ({
    x: x.value,
    y: y.value,
    zoom: zoom.value,
  });


  const zoomBy = (factor: number, screenX: number, screenY: number) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.value * factor));
    const ratio = next / zoom.value;
    zoom.value = next;
    x.value = screenX - (screenX - x.value) * ratio;
    y.value = screenY - (screenY - y.value) * ratio;
  };

  const reset = () => {
    x.value = 0;
    y.value = 0;
    zoom.value = 1;
  };

  const fitTo = (
    bounds: { x: number; y: number; width: number; height: number },
    viewport: { width: number; height: number },
    padding = 48
  ) => {
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const scale = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        Math.min(
          (viewport.width - padding * 2) / bounds.width,
          (viewport.height - padding * 2) / bounds.height
        )
      )
    );

    zoom.value = scale;
    x.value = viewport.width / 2 - (bounds.x + bounds.width / 2) * scale;
    y.value = viewport.height / 2 - (bounds.y + bounds.height / 2) * scale;
  };

  return {
    x,
    y,
    zoom,
    transform,
    overlayStyle,
    pinch,
    pan,
    toCanvas,
    snapshot,
    zoomBy,
    reset,
    fitTo,
  };
}
