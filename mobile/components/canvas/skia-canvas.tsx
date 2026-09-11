/**
 * Skia + Liveblocks collaborative canvas.
 *
 * Port of `app/board/[boardId]/_components/canvas.tsx`. All of the Liveblocks
 * storage logic is carried over unchanged — `insertLayer`, `insertPath`,
 * `eraseAtPoint`, `translateSelectedLayers` are the same mutations against the
 * same `LiveMap` / `LiveList`, so a mobile client and a web client can share a
 * room with no schema translation.
 *
 * What changed, and why:
 *
 *  1. Rendering. One `<Picture>` holding every committed layer, instead of one
 *     React element per layer. The web app leaned on the DOM for hit testing
 *     and camera transforms; Skia has no scene graph, so keeping thousands of
 *     React nodes buys nothing and costs reconciliation time. Committed layers
 *     rebuild once per storage change, not once per frame.
 *
 *  2. The live stroke. Points accumulate in a shared value and the preview path
 *     is derived on the UI thread, so ink appears under the finger without a
 *     round trip to JS. Only the finished stroke crosses back to JS, exactly
 *     once, to be committed to storage.
 *
 *  3. Presence broadcast is throttled explicitly. On web, `continueDrawing`
 *     called `setMyPresence` on every pointermove and the browser coalesced it.
 *     Here it's a deliberate ~20Hz so a 120Hz Apple Pencil doesn't saturate the
 *     socket.
 *
 * Not yet ported (deliberately, see the plan): resize handles, marquee
 * selection, and step/marking overlays. Those belong in the native overlay
 * layer alongside note text.
 */
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Canvas,
  Circle,
  Group,
  PaintStyle,
  Path,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  createPicture,
  useCanvasRef,
  type SkPath,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
// Reanimated 4 moved every worklet-threading helper into `react-native-worklets`
// and dropped them from its own entry point, so `runOnJS` is not importable from
// "react-native-reanimated" any more. `scheduleOnRN` is the current name —
// `runOnJS` still exists but is deprecated, and it has a different shape:
// `runOnJS(fn)(args)` vs. `scheduleOnRN(fn, args)`.
import { scheduleOnRN } from "react-native-worklets";
import { LiveObject } from "@liveblocks/client";
import { nanoid } from "nanoid/non-secure";

import {
  useHistory,
  useMutation,
  useOthersMapped,
  useSelf,
  useStorage,
  useUpdateMyPresence,
} from "@/liveblocks.config";
import {
  CanvasMode,
  LayerType,
  type CanvasState,
  type Color,
  type Point,
  type StrokePoint,
} from "@/types/canvas";
import {
  colorToCss,
  connectionIdToColor,
  hitTestLayers,
  penPointsToPathLayer,
} from "@/lib/canvas-utils";
import {
  PREVIEW_STROKE_WIDTH,
  buildPreviewPath,
  drawLayers,
} from "@/lib/skia-draw";
import type { CameraController } from "@/hooks/use-camera";
import { useLayerImages } from "@/hooks/use-layer-images";
import { GridBackground } from "./grid-background";
import { NoteOverlay } from "./note-overlay";

const MAX_LAYERS = 10_000;
const ERASER_RADIUS = 14;

/** ~20Hz. Enough for smooth remote ink, low enough to not flood the socket. */
const PRESENCE_INTERVAL_MS = 50;

interface SkiaCanvasProps {
  boardId: string;
  canvasState: CanvasState;
  setCanvasState: (state: CanvasState) => void;
  lastUsedColor: Color;
  /**
   * Owned by the board screen so the header's zoom controls can drive it. The
   * canvas does not create its own camera.
   */
  camera: CameraController;
  /** Bumped when a stroke is committed, to drive the recognition pipeline. */
  onStrokeEnd?: () => void;
  /** Called when erasing invalidates existing marks. */
  onMarksInvalidated?: () => void;
}

export const SkiaCanvas = ({
  canvasState,
  setCanvasState,
  lastUsedColor,
  camera,
  onStrokeEnd,
  onMarksInvalidated,
}: SkiaCanvasProps) => {
  const canvasRef = useCanvasRef();

  // Destructured up front, and it must stay that way.
  //
  // Reanimated serialises everything a worklet closes over. `useCamera()`
  // returns an object that also holds GestureType instances (pinch/pan), and
  // those cannot be copied to the UI thread. Writing `camera.toCanvas(...)`
  // inside a gesture callback captures the whole `camera` object and fails at
  // runtime with:
  //
  //   [Worklets] Cannot copy value of type `PinchGesture`
  //
  // Referencing the extracted `toCanvas` instead captures only that function,
  // which closes over shared values and serialises fine.
  const {
    transform: cameraTransform,
    overlayStyle: cameraOverlayStyle,
    pinch: cameraPinch,
    pan: cameraPan,
    toCanvas,
  } = camera;
  const history = useHistory();
  const updateMyPresence = useUpdateMyPresence();

  const layerIds = useStorage((root) => root.layerIds);
  const layers = useStorage((root) => root.layers);
  const selection = useSelf((me) => me.presence.selection);

  const images = useLayerImages(layerIds ?? [], layers);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // --- live stroke (UI thread) -------------------------------------------

  const draftPoints = useSharedValue<StrokePoint[]>([]);
  const draftPath = useDerivedValue(() => buildPreviewPath(draftPoints.value));
  const draftColor = useMemo(() => colorToCss(lastUsedColor), [lastUsedColor]);

  /**
   * Throttle timestamp for presence broadcasts.
   *
   * A shared value, not a ref, and deliberately so. The gesture worklet closes
   * over `broadcastDraft`, and Reanimated serialises that closure — a ref caught
   * in it triggers "[Worklets] Tried to modify key `current` of an object which
   * has been already passed to a worklet" the moment JS mutates it. Keeping the
   * throttle on the UI thread also avoids scheduling JS work just to discard it.
   */
  const lastPresenceAt = useSharedValue(0);

  const broadcastDraft = useCallback(
    (points: StrokePoint[]) => {
      updateMyPresence({ pencilDraft: points, penColor: lastUsedColor });
    },
    [lastUsedColor, updateMyPresence]
  );

  // --- storage mutations (unchanged from the web app) ---------------------

  const insertPath = useMutation(
    ({ storage, setMyPresence }, points: StrokePoint[]) => {
      const liveLayers = storage.get("layers");

      if (points.length < 2 || liveLayers.size >= MAX_LAYERS) {
        setMyPresence({ pencilDraft: null });
        return;
      }

      const id = nanoid();
      liveLayers.set(
        id,
        new LiveObject(penPointsToPathLayer(points, lastUsedColor))
      );
      storage.get("layerIds").push(id);
      setMyPresence({ pencilDraft: null });
    },
    [lastUsedColor]
  );

  const insertLayer = useMutation(
    (
      { storage, setMyPresence },
      layerType:
        | LayerType.Ellipse
        | LayerType.Rectangle
        | LayerType.Text
        | LayerType.Note,
      position: Point
    ) => {
      const liveLayers = storage.get("layers");
      if (liveLayers.size >= MAX_LAYERS) return;

      const layerId = nanoid();
      liveLayers.set(
        layerId,
        new LiveObject({
          type: layerType,
          x: position.x,
          y: position.y,
          height: 100,
          width: 100,
          fill: lastUsedColor,
        })
      );
      storage.get("layerIds").push(layerId);

      setMyPresence({ selection: [layerId] }, { addToHistory: true });
      setCanvasState({ mode: CanvasMode.None });
    },
    [lastUsedColor, setCanvasState]
  );

  const eraseAtPoint = useMutation(({ storage, self, setMyPresence }, point: Point) => {
    const liveLayers = storage.get("layers");
    const liveLayerIds = storage.get("layerIds");
    const idsToDelete: string[] = [];

    for (let i = 0; i < liveLayerIds.length; i++) {
      const id = liveLayerIds.get(i);
      if (!id) continue;
      const layer = liveLayers.get(id);
      // Paths only: the problem image must survive the eraser.
      if (!layer || layer.get("type") !== LayerType.Path) continue;

      const x = layer.get("x");
      const y = layer.get("y");
      const w = layer.get("width");
      const h = layer.get("height");
      if ([x, y, w, h].some((v) => typeof v !== "number")) continue;

      if (
        point.x + ERASER_RADIUS > x &&
        point.x - ERASER_RADIUS < x + w &&
        point.y + ERASER_RADIUS > y &&
        point.y - ERASER_RADIUS < y + h
      ) {
        idsToDelete.push(id);
      }
    }

    if (idsToDelete.length === 0) return false;

    for (const id of idsToDelete) {
      const index = liveLayerIds.indexOf(id);
      if (index !== -1) liveLayerIds.delete(index);
      liveLayers.delete(id);
    }

    const current = self.presence.selection;
    if (current.some((id) => idsToDelete.includes(id))) {
      setMyPresence({
        selection: current.filter((id) => !idsToDelete.includes(id)),
      });
    }

    return true;
  }, []);

  const translateSelection = useMutation(
    ({ storage, self }, offset: Point) => {
      const liveLayers = storage.get("layers");
      for (const id of self.presence.selection) {
        const layer = liveLayers.get(id);
        if (!layer) continue;
        layer.update({
          x: layer.get("x") + offset.x,
          y: layer.get("y") + offset.y,
        });
      }
    },
    []
  );

  const selectLayer = useMutation(
    ({ setMyPresence }, layerId: string | null) => {
      setMyPresence(
        { selection: layerId ? [layerId] : [] },
        { addToHistory: true }
      );
    },
    []
  );

  // --- JS-thread gesture callbacks ---------------------------------------

  const onDrawStart = useCallback(() => {
    history.pause();
  }, [history]);

  const onDrawEnd = useCallback(
    (points: StrokePoint[]) => {
      history.resume();
      if (points.length < 2) {
        updateMyPresence({ pencilDraft: null });
        return;
      }
      insertPath(points);
      onStrokeEnd?.();
    },
    [history, insertPath, onStrokeEnd, updateMyPresence]
  );

  const onErase = useCallback(
    (point: Point) => {
      if (eraseAtPoint(point)) onMarksInvalidated?.();
    },
    [eraseAtPoint, onMarksInvalidated]
  );

  const onTap = useCallback(
    (point: Point) => {
      if (canvasState.mode === CanvasMode.Inserting) {
        insertLayer(canvasState.layerType, point);
        return;
      }

      const hit = hitTestLayers(layerIds ?? [], layers, point);
      selectLayer(hit);
      setEditingNoteId(null);

      if (hit) {
        setCanvasState({ mode: CanvasMode.Translating, current: point });
      }
    },
    [canvasState, insertLayer, layerIds, layers, selectLayer]
  );

  const onTranslate = useCallback(
    (offset: Point) => translateSelection(offset),
    [translateSelection]
  );

  // --- gestures -----------------------------------------------------------

  const eraserCursor = useSharedValue<Point | null>(null);
  const lastTranslate = useSharedValue<Point>({ x: 0, y: 0 });

  const toolPan = Gesture.Pan()
    // One finger only. Two fingers is always pan/zoom, which is what makes the
    // "draw vs. navigate" distinction unambiguous on a touchscreen — the web
    // app had to disambiguate this by hand with capture-phase pointer listeners.
    .maxPointers(1)
    .minDistance(0)
    .onStart((e) => {
      "worklet";
      const point = toCanvas(e.x, e.y);

      if (canvasState.mode === CanvasMode.Pencil) {
        draftPoints.value = [[point.x, point.y]];
        scheduleOnRN(onDrawStart);
        return;
      }

      if (canvasState.mode === CanvasMode.Eraser) {
        eraserCursor.value = point;
        scheduleOnRN(onErase, point);
        return;
      }

      lastTranslate.value = point;
    })
    .onUpdate((e) => {
      "worklet";
      const point = toCanvas(e.x, e.y);

      if (canvasState.mode === CanvasMode.Pencil) {
        draftPoints.value = [...draftPoints.value, [point.x, point.y]];

        // ~20Hz. Enough for smooth remote ink without saturating the socket.
        const now = Date.now();
        if (now - lastPresenceAt.value >= PRESENCE_INTERVAL_MS) {
          lastPresenceAt.value = now;
          scheduleOnRN(broadcastDraft, draftPoints.value);
        }
        return;
      }

      if (canvasState.mode === CanvasMode.Eraser) {
        eraserCursor.value = point;
        scheduleOnRN(onErase, point);
        return;
      }

      if (canvasState.mode === CanvasMode.Translating) {
        const offset = {
          x: point.x - lastTranslate.value.x,
          y: point.y - lastTranslate.value.y,
        };
        lastTranslate.value = point;
        scheduleOnRN(onTranslate, offset);
      }
    })
    .onEnd(() => {
      "worklet";
      if (canvasState.mode === CanvasMode.Pencil) {
        const points = draftPoints.value;
        draftPoints.value = [];
        scheduleOnRN(onDrawEnd, points);
      }
      eraserCursor.value = null;
    });

  const tap = Gesture.Tap().onEnd((e, success) => {
    "worklet";
    if (!success) return;
    if (
      canvasState.mode === CanvasMode.Pencil ||
      canvasState.mode === CanvasMode.Eraser
    ) {
      return;
    }
    scheduleOnRN(onTap, toCanvas(e.x, e.y));
  });

  // Pinch runs alongside the tool gesture so a two-finger zoom can interrupt a
  // one-finger drag without the tool gesture having to know about it.
  const gesture = Gesture.Simultaneous(
    Gesture.Race(tap, toolPan),
    Gesture.Simultaneous(cameraPinch, cameraPan)
  );

  // --- rendering ----------------------------------------------------------

  const selections = useOthersMapped((other) => other.presence.selection);
  const selectionColors = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [connectionId, ids] of selections) {
      for (const id of ids) {
        result[id] = connectionIdToColor(connectionId);
      }
    }
    return result;
  }, [selections]);

  const committedPicture = useMemo(
    () =>
      createPicture((canvas) => {
        drawLayers(canvas, layerIds ?? [], layers, {
          images,
          selectionColors,
        });
      }),
    [layerIds, layers, images, selectionColors]
  );

  const draftPaint = useMemo(() => {
    const paint = Skia.Paint();
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(PREVIEW_STROKE_WIDTH);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(draftColor));
    return paint;
  }, [draftColor]);

  const eraserRing = useDerivedValue(() => eraserCursor.value);
  const eraserCx = useDerivedValue(() => eraserRing.value?.x ?? -9999);
  const eraserCy = useDerivedValue(() => eraserRing.value?.y ?? -9999);

  /**
   * Other users' in-progress strokes, from presence.
   *
   * This has to be read here, in the component that *renders* `<Canvas>`, not in
   * a child inside it. react-native-skia draws its subtree with its own React
   * reconciler, so React context does not cross the `<Canvas>` boundary — any
   * Liveblocks hook called inside it fails with "RoomProvider is missing from
   * the React tree". Geometry is therefore built out here and handed in as plain
   * data.
   */
  const othersDrafts = useOthersMapped((other) => ({
    pencilDraft: other.presence.pencilDraft,
    penColor: other.presence.penColor,
  }));

  const otherDraftPaths = useMemo(() => {
    const result: Array<{ key: number; path: SkPath; color: string }> = [];

    for (const [connectionId, other] of othersDrafts) {
      const draft = other.pencilDraft;
      if (!draft || draft.length < 2) continue;

      const path = Skia.Path.Make();
      path.moveTo(draft[0][0], draft[0][1]);
      for (let i = 1; i < draft.length; i++) {
        const [cx, cy] = draft[i - 1];
        const [nx, ny] = draft[i];
        path.quadTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
      }

      result.push({
        key: connectionId,
        path,
        color: other.penColor ? colorToCss(other.penColor) : "#000000",
      });
    }

    return result;
  }, [othersDrafts]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.root}>
        <Canvas ref={canvasRef} style={styles.canvas}>
          <Group transform={cameraTransform}>
            <GridBackground
              cameraX={camera.x}
              cameraY={camera.y}
              zoom={camera.zoom}
            />
            <Picture picture={committedPicture} />
            <Path path={draftPath} paint={draftPaint} />
            {otherDraftPaths.map((draft) => (
              <Path
                key={draft.key}
                path={draft.path}
                style="stroke"
                strokeWidth={PREVIEW_STROKE_WIDTH}
                strokeCap="round"
                strokeJoin="round"
                color={draft.color}
              />
            ))}
            {canvasState.mode === CanvasMode.Eraser && (
              <Circle
                cx={eraserCx}
                cy={eraserCy}
                r={ERASER_RADIUS}
                color="rgba(120,120,120,0.35)"
              />
            )}
          </Group>
        </Canvas>

        {/*
          Native overlay, camera-transformed on the UI thread. Anything that
          needs real text, text input, or touch targets lives here rather than
          in Skia. This is the direct replacement for the web app's
          `<foreignObject>` usage.
        */}
        <Animated.View
          pointerEvents="box-none"
          style={[styles.overlay, cameraOverlayStyle]}
        >
          <NoteOverlay
            layerIds={layerIds ?? []}
            layers={layers}
            editingNoteId={editingNoteId}
            onRequestEdit={setEditingNoteId}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  canvas: { flex: 1 },
  overlay: {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    // Required so the scale in `overlayStyle` matches Skia's, which scales
    // about the canvas origin rather than the view centre.
    transformOrigin: "top left",
  },
});
