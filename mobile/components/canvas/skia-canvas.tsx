/**
 * Skia + Liveblocks collaborative canvas.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  getLayer,
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
import {
  useHandwritingRecognition,
  type VerificationState,
} from "@/hooks/use-handwriting-recognition";
import { GridBackground } from "./grid-background";
import { NoteOverlay } from "./note-overlay";
import { StepMarkers } from "./step-markers";

const MAX_LAYERS = 10_000;
const ERASER_RADIUS = 14;

/**
 * On-screen size for freshly inserted layers, in points. Converted to canvas
 * units at insert time using the current zoom.
 */
const INSERT_SIZE_ON_SCREEN: Record<
  | LayerType.Rectangle
  | LayerType.Ellipse
  | LayerType.Text
  | LayerType.Note,
  { width: number; height: number }
> = {
  [LayerType.Rectangle]: { width: 160, height: 120 },
  [LayerType.Ellipse]: { width: 150, height: 150 },
  [LayerType.Note]: { width: 170, height: 170 },
  [LayerType.Text]: { width: 220, height: 70 },
};

/** ~20Hz. Enough for smooth remote ink, low enough to not flood the socket. */
const PRESENCE_INTERVAL_MS = 50;

interface SkiaCanvasProps {
  boardId: string;
  canvasState: CanvasState;
  setCanvasState: (state: CanvasState) => void;
  lastUsedColor: Color;
  camera: CameraController;
  /** Extracted problem text, passed to the model as context for marking. */
  problemText?: string;
  /** Reports marking progress up so the board screen can render the bar. */
  onVerificationChange?: (state: VerificationState) => void;
}

export const SkiaCanvas = ({
  canvasState,
  setCanvasState,
  lastUsedColor,
  camera,
  problemText,
  onVerificationChange,
}: SkiaCanvasProps) => {
  const canvasRef = useCanvasRef();

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

  const [strokeTick, setStrokeTick] = useState(0);

  const { state: verification, markers, clearMarks } =
    useHandwritingRecognition({
      strokeTick,
      layerIds: layerIds ?? [],
      layers,
      images,
      problemText,
    });

  useEffect(() => {
    onVerificationChange?.(verification);
  }, [verification, onVerificationChange]);

 
  const draftPoints = useSharedValue<StrokePoint[]>([]);
  const draftPath = useDerivedValue(() => buildPreviewPath(draftPoints.value));
  const draftColor = useMemo(() => colorToCss(lastUsedColor), [lastUsedColor]);

  const lastPresenceAt = useSharedValue(0);

  const broadcastDraft = useCallback(
    (points: StrokePoint[]) => {
      updateMyPresence({ pencilDraft: points, penColor: lastUsedColor });
    },
    [lastUsedColor, updateMyPresence]
  );

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

      /**
       * Size new layers in SCREEN terms, then convert to canvas units.
       *
       * The web app inserted everything at a fixed 100x100 canvas units, which
       * was fine at 100% zoom on a desktop. On a phone you are often at 40% zoom,
       * where 100 units is a 40pt square — too small to read or grab. Dividing by
       * the current zoom means a new note or shape always arrives at a usable
       * on-screen size regardless of how far you are zoomed out.
       */
      const zoom = camera.zoom.value || 1;
      const screenSize = INSERT_SIZE_ON_SCREEN[layerType];
      const width = screenSize.width / zoom;
      const height = screenSize.height / zoom;

      const layerId = nanoid();
      liveLayers.set(
        layerId,
        new LiveObject({
          type: layerType,
          // Centre the new layer on the tap rather than hanging it off the
          // bottom-right, which is what a top-left anchor feels like on touch.
          x: position.x - width / 2,
          y: position.y - height / 2,
          width,
          height,
          fill: lastUsedColor,
        })
      );
      storage.get("layerIds").push(layerId);

      setMyPresence({ selection: [layerId] }, { addToHistory: true });

      // Drop straight back to Select so the thing you just made can be moved or
      // typed into, instead of the next tap making another one.
      setCanvasState({ mode: CanvasMode.None });

      // Text and notes exist to be written in, so open the editor immediately.
      if (layerType === LayerType.Text || layerType === LayerType.Note) {
        setEditingNoteId(layerId);
      }
    },
    [camera.zoom, lastUsedColor, setCanvasState]
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

  const translateLayer = useMutation(
    ({ storage }, layerId: string, offset: Point) => {
      const layer = storage.get("layers").get(layerId);
      if (!layer) return;

      layer.update({
        x: layer.get("x") + offset.x,
        y: layer.get("y") + offset.y,
      });
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
      setStrokeTick((tick) => tick + 1);
    },
    [history, insertPath, updateMyPresence]
  );

  const onErase = useCallback(
    (point: Point) => {
      if (!eraseAtPoint(point)) return;

      // Erasing moves the geometry the marks were placed against, so existing
      // ticks are gone immediately.
      clearMarks();
      setStrokeTick((tick) => tick + 1);
    },
    [clearMarks, eraseAtPoint]
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
    },
    [canvasState, insertLayer, layerIds, layers, selectLayer]
  );

  /**
   * Layer currently being dragged, if any.
   *
   * Direct manipulation: pressing a layer and moving picks it up straight away,
   * rather than requiring select-then-drag as two separate gestures. Hit testing
   * needs the JS thread, so the gesture worklet hands the start point over and
   * this ref carries the answer through the rest of the drag.
   */
  const draggingId = useRef<string | null>(null);

  const onDragStart = useCallback(
    (point: Point) => {
      const hit = hitTestLayers(layerIds ?? [], layers, point);
      draggingId.current = hit;

      if (hit) {
        history.pause();
        selectLayer(hit);
      }
    },
    [history, layerIds, layers, selectLayer]
  );

  const onDragMove = useCallback(
    (offset: Point) => {
      if (!draggingId.current) return;
      translateLayer(draggingId.current, offset);
    },
    [translateLayer]
  );

  const onDragEnd = useCallback(() => {
    if (draggingId.current) history.resume();
    draggingId.current = null;
  }, [history]);

  /** Long press or double tap on a text/note layer opens its editor. */
  const onEditRequest = useCallback(
    (point: Point) => {
      const hit = hitTestLayers(layerIds ?? [], layers, point);
      if (!hit) return;

      const layer = getLayer(layers, hit);
      if (layer?.type !== LayerType.Text && layer?.type !== LayerType.Note) {
        return;
      }

      selectLayer(hit);
      setEditingNoteId(hit);
    },
    [layerIds, layers, selectLayer]
  );


  const eraserCursor = useSharedValue<Point | null>(null);
  const lastTranslate = useSharedValue<Point>({ x: 0, y: 0 });
  
  const drawingMode =
    canvasState.mode === CanvasMode.Pencil ||
    canvasState.mode === CanvasMode.Eraser;

  const toolPan = Gesture.Pan()
    // One finger only. Two fingers is always pan/zoom, which is what makes the
    // "draw vs. navigate" distinction 
    .maxPointers(1)
    .minDistance(drawingMode ? 0 : 8)
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

      // Select mode: work out on the JS thread whether a layer is under the
      // finger, so a drag can move it directly.
      lastTranslate.value = point;
      scheduleOnRN(onDragStart, point);
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

      // Deltas rather than absolute positions, so the layer tracks the finger
      // even though the hit test resolved a frame or two late.
      const offset = {
        x: point.x - lastTranslate.value.x,
        y: point.y - lastTranslate.value.y,
      };
      lastTranslate.value = point;
      scheduleOnRN(onDragMove, offset);
    })
    .onEnd(() => {
      "worklet";
      if (canvasState.mode === CanvasMode.Pencil) {
        const points = draftPoints.value;
        draftPoints.value = [];
        scheduleOnRN(onDrawEnd, points);
      }
      eraserCursor.value = null;
      scheduleOnRN(onDragEnd);
    });

  // A firm press on a text or sticky note opens its editor.
  const longPress = Gesture.LongPress()
    .minDuration(400)
    .onStart((e) => {
      "worklet";
      if (drawingMode) return;
      scheduleOnRN(onEditRequest, toCanvas(e.x, e.y));
    });

  // Double tap does the same, since that is the other convention people reach for.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e, success) => {
      "worklet";
      if (!success || drawingMode) return;
      scheduleOnRN(onEditRequest, toCanvas(e.x, e.y));
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

  /**
   * Gesture priority, outermost first.
   *
   * Two-finger pan/zoom always runs alongside everything else. Within the
   * one-finger tools, the order inside `Race` matters: the double tap and long
   * press must be offered the chance to win before the single tap and the pan,
   * or a double tap would register as two selects and a long press as a select.
   */
  const gesture = Gesture.Simultaneous(
    Gesture.Race(doubleTap, longPress, tap, toolPan),
    Gesture.Simultaneous(cameraPinch, cameraPan)
  );

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
            <StepMarkers markers={markers} />
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

        <Animated.View
          pointerEvents="box-none"
          style={[styles.overlay, cameraOverlayStyle]}
        >
          <NoteOverlay
            layerIds={layerIds ?? []}
            layers={layers}
            editingNoteId={editingNoteId}
            onDoneEditing={() => setEditingNoteId(null)}
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
    transformOrigin: "top left",
  },
});
