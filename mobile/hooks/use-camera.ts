/**
 * Camera (pan + zoom) held entirely in Reanimated shared values.
 *
 * This is the single most important structural difference from the web app.
 * There, camera lived in React state and pan/zoom re-rendered the whole layer
 * tree on every frame — survivable because the browser only had to recompute
 * one CSS transform on a `<g>`. In RN that pattern would cross the JS bridge
 * 60+ times a second while your finger is down.
 *
 * Keeping the camera in shared values and feeding it to a Skia `<Group
 * transform>` means panning and zooming never touch the JS thread and never
 * re-render a single layer.
 *
 * `overlayStyle` exposes the same transform as a Reanimated view style so the
 * native overlay (note text, tooltips, cursor labels) tracks the canvas on the
 * UI thread too. That preserves the property the web app got from putting
 * overlays inside the transformed `<g>`: everything stays glued to content
 * under pan and zoom, for free.
 */
import { Gesture } from "react-native-gesture-handler";
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";

import { MAX_ZOOM, MIN_ZOOM, type Camera, type Point } from "@/types/canvas";
import { clampWorklet } from "@/lib/canvas-utils";

/**
 * Inferred rather than hand-declared. Reanimated 4 renamed several of the
 * relevant return types (`DerivedValue`, the animated-style types), and pinning
 * them by name here would just be a second thing to keep in sync.
 *
 * Members:
 *   x / y / zoom  - raw shared values
 *   transform     - feed into a Skia `<Group transform={...}>`
 *   overlayStyle  - feed into an `<Animated.View style={...}>` for overlays
 *   pinch / pan   - two-finger gestures; one finger is reserved for tools
 *   toCanvas      - worklet-safe screen -> canvas conversion
 *   snapshot      - JS-thread read, for low-frequency work like "insert at centre"
 */
export type CameraController = ReturnType<typeof useCamera>;

export function useCamera() {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const zoom = useSharedValue(1);

  // Gesture-start baseline. Deriving from a baseline rather than accumulating
  // deltas avoids drift over long gestures.
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
      // Identical anchoring maths to the web app's `zoomCameraAt`: the canvas
      // point under the focal point stays under the focal point.
      const next = clampWorklet(startZoom.value * e.scale, MIN_ZOOM, MAX_ZOOM);
      const ratio = next / startZoom.value;
      zoom.value = next;
      x.value = e.focalX - (e.focalX - startX.value) * ratio;
      y.value = e.focalY - (e.focalY - startY.value) * ratio;
    });

  const pan = Gesture.Pan()
    // Two fingers pans; one finger belongs to whichever tool is active. This
    // replaces ~120 lines of manual `activePointersRef` / `pinchStartRef`
    // bookkeeping and capture-phase native listeners in the web canvas.
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
  };
}
