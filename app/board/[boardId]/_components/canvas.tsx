"use client";

import { nanoid } from "nanoid";
import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { LiveObject } from "@liveblocks/client";

import { 
  useHistory, 
  useCanUndo, 
  useCanRedo,
  useMutation,
  useStorage,
  useOthersMapped,
  useSelf,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";
import { 
  colorToCss,
  connectionIdToColor, 
  findIntersectingLayersWithRectangle, 
  penPointsToPathLayer, 
  pointerEventToCanvasPoint, 
  resizeBounds,
} from "@/lib/utils";
import { 
  Camera, 
  CanvasMode, 
  CanvasState, 
  Color,
  Layer,
  LayerType,
  MAX_ZOOM,
  MIN_ZOOM,
  Point,
  Side,
  XYWH,
} from "@/types/canvas";
import { useDisableScrollBounce } from "@/hooks/use-disable-scroll-bounce";
import { useDeleteLayers } from "@/hooks/use-delete-layers";
import { captureWorkingArea } from "@/lib/capture-canvas";

import { Info } from "./info";
import { Path } from "./path";
import { Toolbar } from "./toolbar";
import { LayerPreview } from "./layer-preview";
import { SelectionBox } from "./selection-box";
import { SelectionTools } from "./selection-tools";
import { CursorsPresence } from "./cursors-presence";
import { ProblemPanel, type ProblemAnalysis } from "./problem-panel";
import {
  HandwritingOverlay,
  type CanvasStepMarker,
} from "./handwriting-overlay";
import { StepMarkers } from "./step-markers";
import { MarkingOverlay, type MarkedLine } from "@/app/board/[boardId]/_components/marking-overlay";
import { ZoomControls } from "./zoom-controls";

// High enough to be effectively unlimited for handwriting — each pen stroke
// becomes a Path layer, and a single line of math working can easily contain
// 20+ strokes, so the old cap of 100 was being hit during normal use.
const MAX_LAYERS = 10000;
const DEFAULT_IMAGE_WIDTH = 400;
const LINE_GROUP_Y_THRESHOLD = 50;
const LINE_RIGHT_EDGE_OFFSET = 20;

interface CanvasProps {
  boardId: string;
};

type StrokeLineAnchor = {
  y: number;
  rightX: number;
};

export type { StrokeLineAnchor };

// Radius (in canvas units) of the object-eraser hit region. Any pen stroke
// whose bounding box comes within this distance of the cursor is removed.
const ERASER_RADIUS = 14;

export const Canvas = ({
  boardId,
}: CanvasProps) => {
  const layerIds = useStorage((root) => root.layerIds);

  const pencilDraft = useSelf((me) => me.presence.pencilDraft);
  const selection = useSelf((me) => me.presence.selection);
  const [canvasState, setCanvasState] = useState<CanvasState>({
    mode: CanvasMode.None,
  });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  // Tracks active touches/pointers for two-finger pinch gestures.
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map()
  );
  const pinchStartRef = useRef<{
    distance: number;
    midpoint: { x: number; y: number };
    cameraStart: Camera;
  } | null>(null);
  const isPinchingRef = useRef(false);
  const updateMyPresence = useUpdateMyPresence();
  const [lastUsedColor, setLastUsedColor] = useState<Color>({
    r: 0,
    g: 0,
    b: 0,
  });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [strokeEndTick, setStrokeEndTick] = useState(0);
  const [verification, setVerification] = useState({
    isLoading: false,
    isCorrect: true,
    percentage: 0,
    feedback: "Start writing with the pen tool to verify steps in real time.",
  });
  const [stepMarkers, setStepMarkers] = useState<CanvasStepMarker[]>([]);

  // Canvas-space position of the eraser cursor, used to render a hollow ring
  // showing the eraser's reach while the Eraser tool is active.
  const [eraserCursor, setEraserCursor] = useState<Point | null>(null);

  // --- Submit Working state ---------------------------------------------
  // markingResults: per-line marks returned by the vision model.
  // workingBounds: the canvas-space rect that was captured (with padding),
  //   used to position the tick/cross icons against the same frame the
  //   model saw.
  // isMarking: true while a marking request is in flight.
  const [markingResults, setMarkingResults] = useState<MarkedLine[]>([]);
  const [workingBounds, setWorkingBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [isMarking, setIsMarking] = useState(false);

  const onProgressChange = useCallback((state: {
      isLoading: boolean;
      isCorrect: boolean;
      percentage: number;
      feedback: string;
  }) => {
      setVerification(state);
  }, []);

  const onStepsChange = useCallback((steps: CanvasStepMarker[]) => {
      setStepMarkers(steps);
  }, []);

  // Wipe any existing marks (live step markers + submit-working results).
  // Used when the geometry changes underneath them (e.g. erasing) so stale
  // ticks/crosses don't linger at positions that no longer match the work.
  const clearStaleMarks = useCallback(() => {
      setStepMarkers([]);
      setMarkingResults([]);
      setWorkingBounds(null);
  }, []);

 

  useDisableScrollBounce();
  const history = useHistory();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  // Compute the union bounding box of every drawn layer. Used by the
  // HandwritingOverlay to capture the *entire* working — not just whatever's
  // in the viewport — so the verifier sees all of the student's process.
  const computeLayerBounds = useMutation(({ storage }) => {
    const liveLayers = storage.get("layers");
    const liveLayerIds = storage.get("layerIds");

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < liveLayerIds.length; i++) {
      const id = liveLayerIds.get(i);
      if (!id) continue;
      const layer = liveLayers.get(id);
      if (!layer) continue;
      const x = layer.get("x");
      const y = layer.get("y");
      const w = layer.get("width");
      const h = layer.get("height");
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof w !== "number" ||
        typeof h !== "number"
      ) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }

    if (!Number.isFinite(minX)) return null;

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, []);

  // Bounding box of just the pen-stroke (Path) layers. Used by the Submit
  // Working flow so the captured image only encloses the student's working,
  // not the printed problem image or any other layers.
  const getPathLayerBounds = useMutation(({ storage }) => {
    const liveLayers = storage.get("layers");
    const liveLayerIds = storage.get("layerIds");

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < liveLayerIds.length; i++) {
      const id = liveLayerIds.get(i);
      if (!id) continue;
      const layer = liveLayers.get(id);
      if (!layer) continue;
      if (layer.get("type") !== LayerType.Path) continue;

      const x = layer.get("x");
      const y = layer.get("y");
      const w = layer.get("width");
      const h = layer.get("height");
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof w !== "number" ||
        typeof h !== "number"
      ) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }

    if (!Number.isFinite(minX)) return null;

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, []);

  // Groups stroke layers into approximate handwritten lines by Y proximity.
  // Each resulting anchor uses:
  // - average stroke midpoint Y in the group (vertical marker position)
  // - max stroke right edge X + small offset (horizontal marker position)
  const getPathLineAnchors = useMutation(({ storage }) => {
    const liveLayers = storage.get("layers");
    const liveLayerIds = storage.get("layerIds");

    const strokes: Array<{ midY: number; rightX: number }> = [];

    for (let i = 0; i < liveLayerIds.length; i++) {
      const id = liveLayerIds.get(i);
      if (!id) continue;
      const layer = liveLayers.get(id);
      if (!layer) continue;
      if (layer.get("type") !== LayerType.Path) continue;

      const x = layer.get("x");
      const y = layer.get("y");
      const w = layer.get("width");
      const h = layer.get("height");
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof w !== "number" ||
        typeof h !== "number"
      ) {
        continue;
      }

      strokes.push({
        midY: y + h / 2,
        rightX: x + w,
      });
    }

    if (strokes.length === 0) return [] as StrokeLineAnchor[];

    strokes.sort((a, b) => a.midY - b.midY);

    type Group = {
      sumMidY: number;
      count: number;
      maxRightX: number;
    };

    const groups: Group[] = [];

    for (const stroke of strokes) {
      let selected: Group | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const group of groups) {
        const groupMidY = group.sumMidY / group.count;
        const distance = Math.abs(stroke.midY - groupMidY);
        if (distance <= LINE_GROUP_Y_THRESHOLD && distance < bestDistance) {
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
        rightX: group.maxRightX + LINE_RIGHT_EDGE_OFFSET,
      }))
      .sort((a, b) => a.y - b.y);
  }, []);

  const insertLayer = useMutation((
    { storage, setMyPresence },
    layerType: LayerType.Ellipse | LayerType.Rectangle | LayerType.Text | LayerType.Note,
    position: Point,
  ) => {
    const liveLayers = storage.get("layers");
    if (liveLayers.size >= MAX_LAYERS) {
      return;
    }

    const liveLayerIds = storage.get("layerIds");
    const layerId = nanoid();
    const layer = new LiveObject({
      type: layerType,
      x: position.x,
      y: position.y,
      height: 100,
      width: 100,
      fill: lastUsedColor,
    });

    liveLayerIds.push(layerId);
    liveLayers.set(layerId, layer);

    setMyPresence({ selection: [layerId] }, { addToHistory: true });
    setCanvasState({ mode: CanvasMode.None });
  }, [lastUsedColor]);

  const insertImageLayer = useMutation((
    { storage, setMyPresence },
    position: Point,
    src: string,
    width: number,
    height: number,
  ) => {
    const liveLayers = storage.get("layers");
    if (liveLayers.size >= MAX_LAYERS) {
      return;
    }

    const liveLayerIds = storage.get("layerIds");
    const layerId = nanoid();
    const layer = new LiveObject({
      type: LayerType.Image as const,
      x: position.x,
      y: position.y,
      width,
      height,
      src,
    });

    liveLayerIds.push(layerId);
    liveLayers.set(layerId, layer);

    setMyPresence({ selection: [layerId] }, { addToHistory: true });
    setCanvasState({ mode: CanvasMode.None });
  }, []);

  const loadImageSize = useCallback((src: string) => {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.width, height: image.height });
      image.onerror = () => reject(new Error("Failed to load image"));
      image.src = src;
    });
  }, []);

  const createImageLayerAtPoint = useCallback(async (src: string, point: Point) => {
    const size = await loadImageSize(src);
    if (!size.width || !size.height) {
      return;
    }
    const height = (DEFAULT_IMAGE_WIDTH / size.width) * size.height;

    insertImageLayer(point, src, DEFAULT_IMAGE_WIDTH, height);
  }, [insertImageLayer, loadImageSize]);

  const uploadImageFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload-image", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Image upload failed");
    }

    const data = await response.json() as { src: string };
    return data.src;
  }, []);

  const addProblemImage = useCallback(async (file: File) => {
    try {
      const src = await uploadImageFile(file);
      const size = await loadImageSize(src);
      if (!size.width || !size.height) {
        return;
      }

      const height = (DEFAULT_IMAGE_WIDTH / size.width) * size.height;
      // Drop the image at the canvas-space point under the centre of the
      // viewport, accounting for both pan AND zoom.
      const center = {
        x: (viewport.width / 2 - camera.x) / camera.zoom - DEFAULT_IMAGE_WIDTH / 2,
        y: (viewport.height / 2 - camera.y) / camera.zoom - height / 2,
      };

      insertImageLayer(center, src, DEFAULT_IMAGE_WIDTH, height);
    } catch {
      // Ignore failed image uploads for now.
    }
  }, [camera.x, camera.y, camera.zoom, insertImageLayer, loadImageSize, uploadImageFile, viewport.height, viewport.width]);

  const translateSelectedLayers = useMutation((
    { storage, self },
    point: Point,
  ) => {
    if (canvasState.mode !== CanvasMode.Translating) {
      return;
    }

    const offset = {
      x: point.x - canvasState.current.x,
      y: point.y - canvasState.current.y,
    };

    const liveLayers = storage.get("layers");

    for (const id of self.presence.selection) {
      const layer = liveLayers.get(id);

      if (layer) {
        layer.update({
          x: layer.get("x") + offset.x,
          y: layer.get("y") + offset.y,
        });
      }
    }

    setCanvasState({ mode: CanvasMode.Translating, current: point });
  }, 
  [
    canvasState,
  ]);

  const unselectLayers = useMutation((
    { self, setMyPresence }
  ) => {
    if (self.presence.selection.length > 0) {
      setMyPresence({ selection: [] }, { addToHistory: true });
    }
  }, []);

  const updateSelectionNet = useMutation((
    { storage, setMyPresence },
    current: Point,
    origin: Point,
  ) => {
    const liveLayers = storage.get("layers");
    setCanvasState({
      mode: CanvasMode.SelectionNet,
      origin,
      current,
    });
    
    const ids = findIntersectingLayersWithRectangle(
      layerIds,
      liveLayers as unknown as ReadonlyMap<string, Layer>,
      origin,
      current,
    );

    setMyPresence({ selection: ids });
  }, [layerIds]);

  const startMultiSelection = useCallback((
    current: Point,
    origin: Point,
  ) => {
    if (
      Math.abs(current.x - origin.x) + Math.abs(current.y - origin.y) > 5
    ) {
      setCanvasState({
        mode: CanvasMode.SelectionNet,
        origin,
        current,
      });
    }
  }, []);

  const continueDrawing = useMutation((
    { self, setMyPresence },
    point: Point,
    e: React.PointerEvent,
  ) => {
    const { pencilDraft } = self.presence;

    if (
      canvasState.mode !== CanvasMode.Pencil ||
      e.buttons !== 1 ||
      pencilDraft == null
    ) {
      return;
    }

    setMyPresence({
      cursor: point,
      pencilDraft:
        pencilDraft.length === 1 &&
        pencilDraft[0][0] === point.x &&
        pencilDraft[0][1] === point.y
          ? pencilDraft
          : [...pencilDraft, [point.x, point.y, e.pressure]],
    });
  }, [canvasState.mode]);

  const insertPath = useMutation((
    { storage, self, setMyPresence }
  ) => {
    const liveLayers = storage.get("layers");
    const { pencilDraft } = self.presence;

    if (
      pencilDraft == null ||
      pencilDraft.length < 2 ||
      liveLayers.size >= MAX_LAYERS
    ) {
      setMyPresence({ pencilDraft: null });
      return;
    }

    const id = nanoid();
    liveLayers.set(
      id,
      new LiveObject(penPointsToPathLayer(
        pencilDraft,
        lastUsedColor,
      )),
    );

    const liveLayerIds = storage.get("layerIds");
    liveLayerIds.push(id);

    setMyPresence({ pencilDraft: null });
    setCanvasState({ mode: CanvasMode.Pencil });
  }, [lastUsedColor]);

  const startDrawing = useMutation((
    { setMyPresence },
    point: Point,
    pressure: number,
  ) => {
    setMyPresence({
      pencilDraft: [[point.x, point.y, pressure]],
      penColor: lastUsedColor,
    })
  }, [lastUsedColor]);

  // Object-eraser: deletes any pen stroke (Path layer) whose bounding box is
  // within ERASER_RADIUS of the cursor. Deliberately skips non-Path layers so
  // the printed problem image, notes, etc. can't be wiped out by accident.
  // Returns true when at least one stroke was removed.
  const eraseAtPoint = useMutation((
    { storage, self, setMyPresence },
    point: Point,
  ) => {
    const liveLayers = storage.get("layers");
    const liveLayerIds = storage.get("layerIds");

    const idsToDelete: string[] = [];

    for (let i = 0; i < liveLayerIds.length; i++) {
      const id = liveLayerIds.get(i);
      if (!id) continue;
      const layer = liveLayers.get(id);
      if (!layer) continue;
      if (layer.get("type") !== LayerType.Path) continue;

      const x = layer.get("x");
      const y = layer.get("y");
      const w = layer.get("width");
      const h = layer.get("height");
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof w !== "number" ||
        typeof h !== "number"
      ) {
        continue;
      }

      // Treat the cursor as a circle of ERASER_RADIUS and test it against the
      // stroke's bounding box (inflated by the radius).
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
      if (index !== -1) {
        liveLayerIds.delete(index);
      }
      liveLayers.delete(id);
    }

    // Drop any erased strokes from the current selection.
    const selection = self.presence.selection;
    if (selection.some((id) => idsToDelete.includes(id))) {
      setMyPresence({
        selection: selection.filter((id) => !idsToDelete.includes(id)),
      });
    }

    return true;
  }, []);

  const resizeSelectedLayer = useMutation((
    { storage, self },
    point: Point,
  ) => {
    if (canvasState.mode !== CanvasMode.Resizing) {
      return;
    }

    const bounds = resizeBounds(
      canvasState.initialBounds,
      canvasState.corner,
      point,
    );

    const liveLayers = storage.get("layers");
    const layer = liveLayers.get(self.presence.selection[0]);

    if (layer) {
      layer.update(bounds);
    };
  }, [canvasState]);

  const onResizeHandlePointerDown = useCallback((
    corner: Side,
    initialBounds: XYWH,
  ) => {
    history.pause();
    setCanvasState({
      mode: CanvasMode.Resizing,
      initialBounds,
      corner,
    });
  }, [history]);

  // --- Zoom helpers ------------------------------------------------------
  // Zoom anchored at a screen point: the canvas point under (sx, sy) stays
  // visually under (sx, sy) after the zoom level changes.
  const zoomCameraAt = useCallback((nextZoom: number, sx: number, sy: number) => {
    setCamera((prev) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      const ratio = clamped / prev.zoom;
      return {
        zoom: clamped,
        x: sx - (sx - prev.x) * ratio,
        y: sy - (sy - prev.y) * ratio,
      };
    });
  }, []);

  const zoomBy = useCallback((factor: number, sx?: number, sy?: number) => {
    const cx = sx ?? window.innerWidth / 2;
    const cy = sy ?? window.innerHeight / 2;
    setCamera((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * factor));
      const ratio = next / prev.zoom;
      return {
        zoom: next,
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
      };
    });
  }, []);

  const zoomIn = useCallback(() => zoomBy(1.2), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);
  const resetZoom = useCallback(() => {
    setCamera({ x: 0, y: 0, zoom: 1 });
  }, []);

  // Native wheel listener so we can preventDefault on ctrl/⌘+wheel pinch
  // zoom (React's synthetic wheel is passive and can't preventDefault).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Trackpad pinch sends small deltaY values with ctrlKey=true.
        // Convert that to a smooth multiplicative factor.
        const factor = Math.exp(-e.deltaY * 0.01);
        setCamera((prev) => {
          const next = Math.max(
            MIN_ZOOM,
            Math.min(MAX_ZOOM, prev.zoom * factor)
          );
          const ratio = next / prev.zoom;
          return {
            zoom: next,
            x: e.clientX - (e.clientX - prev.x) * ratio,
            y: e.clientY - (e.clientY - prev.y) * ratio,
          };
        });
      } else {
        setCamera((prev) => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    svg.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onNativeWheel);
  }, []);

  // Two-finger pinch zoom on touchscreens. Native capture-phase listeners
  // so we can intercept gestures even when an inner layer would otherwise
  // call stopPropagation on its synthetic events.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onPointerDownNative = (e: PointerEvent) => {
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });

      if (activePointersRef.current.size === 2) {
        const pts = Array.from(activePointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinchStartRef.current = {
          distance: Math.hypot(dx, dy),
          midpoint: {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
          },
          cameraStart: { ...cameraRef.current },
        };
        isPinchingRef.current = true;
        // Drop any in-progress pencil stroke so a giant connecting line
        // doesn't appear when the pinch ends.
        updateMyPresence({ pencilDraft: null });
        e.stopPropagation();
        e.preventDefault();
      }
    };

    const onPointerMoveNative = (e: PointerEvent) => {
      if (!activePointersRef.current.has(e.pointerId)) return;
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });

      if (
        activePointersRef.current.size >= 2 &&
        pinchStartRef.current &&
        isPinchingRef.current
      ) {
        e.stopPropagation();
        e.preventDefault();
        const pts = Array.from(activePointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const newDist = Math.hypot(dx, dy);
        if (newDist === 0) return;

        const start = pinchStartRef.current;
        const factor = newDist / start.distance;
        const newZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, start.cameraStart.zoom * factor)
        );
        const ratio = newZoom / start.cameraStart.zoom;
        setCamera({
          zoom: newZoom,
          x: start.midpoint.x - (start.midpoint.x - start.cameraStart.x) * ratio,
          y: start.midpoint.y - (start.midpoint.y - start.cameraStart.y) * ratio,
        });
      }
    };

    const onPointerUpNative = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        pinchStartRef.current = null;
      }
      if (activePointersRef.current.size === 0) {
        isPinchingRef.current = false;
      }
    };

    svg.addEventListener("pointerdown", onPointerDownNative, { capture: true });
    svg.addEventListener("pointermove", onPointerMoveNative, { capture: true });
    svg.addEventListener("pointerup", onPointerUpNative, { capture: true });
    svg.addEventListener("pointercancel", onPointerUpNative, { capture: true });

    return () => {
      svg.removeEventListener("pointerdown", onPointerDownNative, true);
      svg.removeEventListener("pointermove", onPointerMoveNative, true);
      svg.removeEventListener("pointerup", onPointerUpNative, true);
      svg.removeEventListener("pointercancel", onPointerUpNative, true);
    };
  }, [updateMyPresence]);

  const onPointerMove = useMutation((
    { setMyPresence }, 
    e: React.PointerEvent
  ) => {
    if (isPinchingRef.current) return;
    e.preventDefault();

    const current = pointerEventToCanvasPoint(e, camera);

    if (canvasState.mode === CanvasMode.Pressing) {
      startMultiSelection(current, canvasState.origin);
    } else if (canvasState.mode === CanvasMode.SelectionNet) {
      updateSelectionNet(current, canvasState.origin);
    } else if (canvasState.mode === CanvasMode.Translating) {
      translateSelectedLayers(current);
    } else if (canvasState.mode === CanvasMode.Resizing) {
      resizeSelectedLayer(current);
    } else if (canvasState.mode === CanvasMode.Pencil) {
      continueDrawing(current, e);
    } else if (canvasState.mode === CanvasMode.Eraser) {
      setEraserCursor(current);
      if (e.buttons === 1) {
        if (eraseAtPoint(current)) {
          clearStaleMarks();
        }
      }
    }

    setMyPresence({ cursor: current });
  }, 
  [
    continueDrawing,
    camera,
    canvasState,
    resizeSelectedLayer,
    translateSelectedLayers,
    startMultiSelection,
    updateSelectionNet,
    eraseAtPoint,
    clearStaleMarks,
  ]);

  const onPointerLeave = useMutation(({ setMyPresence }) => {
    setMyPresence({ cursor: null });
    setEraserCursor(null);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();

    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read dropped image"));
        reader.readAsDataURL(file);
      });

      const point = {
        x: (Math.round(e.clientX) - camera.x) / camera.zoom,
        y: (Math.round(e.clientY) - camera.y) / camera.zoom,
      };
      await createImageLayerAtPoint(src, point);
    } catch {
      // Ignore invalid dropped files.
    }
  }, [camera.x, camera.y, camera.zoom, createImageLayerAtPoint]);

  const onPointerDown = useCallback((
    e: React.PointerEvent,
  ) => {
    if (isPinchingRef.current) return;
    const point = pointerEventToCanvasPoint(e, camera);

    if (canvasState.mode === CanvasMode.Inserting) {
      return;
    }

    if (canvasState.mode === CanvasMode.Pencil) {
      startDrawing(point, e.pressure);
      return;
    }

    if (canvasState.mode === CanvasMode.Eraser) {
      history.pause();
      setEraserCursor(point);
      if (eraseAtPoint(point)) {
        clearStaleMarks();
      }
      return;
    }

    setCanvasState({ origin: point, mode: CanvasMode.Pressing });
  }, [camera, canvasState.mode, setCanvasState, startDrawing, history, eraseAtPoint, clearStaleMarks]);

  const onPointerUp = useMutation((
    {},
    e
  ) => {
    const point = pointerEventToCanvasPoint(e, camera);

    if (
      canvasState.mode === CanvasMode.None ||
      canvasState.mode === CanvasMode.Pressing
    ) {
      unselectLayers();
      setCanvasState({
        mode: CanvasMode.None,
      });
    } else if (canvasState.mode === CanvasMode.Pencil) {
      insertPath();
      setStrokeEndTick((t) => {
          console.log("Stroke ended, tick:", t + 1);
          return t + 1;
      });
    } else if (canvasState.mode === CanvasMode.Inserting) {
      insertLayer(canvasState.layerType, point);
    } else if (canvasState.mode === CanvasMode.Eraser) {
      // Strokes were removed; re-run recognition so the remaining work gets
      // re-marked with fresh, correctly-positioned ticks/crosses.
      setStrokeEndTick((t) => t + 1);
    } else {
      setCanvasState({
        mode: CanvasMode.None,
      });
    }

    history.resume();
  }, 
  [
    setCanvasState,
    camera,
    canvasState,
    history,
    insertLayer,
    unselectLayers,
    insertPath
  ]);

const handlePointerUp = useCallback((e: React.PointerEvent) => {
      if (canvasState.mode === CanvasMode.Pencil) {
          setStrokeEndTick((t) => t + 1);
      }
      onPointerUp(e);
  }, [canvasState.mode, onPointerUp]);

  const selections = useOthersMapped((other) => other.presence.selection);

  const onLayerPointerDown = useMutation((
    { self, setMyPresence },
    e: React.PointerEvent,
    layerId: string,
  ) => {
    if (
      canvasState.mode === CanvasMode.Pencil ||
      canvasState.mode === CanvasMode.Inserting
    ) {
      return;
    }

    history.pause();
    e.stopPropagation();

    const point = pointerEventToCanvasPoint(e, camera);

    if (!self.presence.selection.includes(layerId)) {
      setMyPresence({ selection: [layerId] }, { addToHistory: true });
    }
    setCanvasState({ mode: CanvasMode.Translating, current: point });
  }, 
  [
    setCanvasState,
    camera,
    history,
    canvasState.mode,
  ]);

  const layerIdsToColorSelection = useMemo(() => {
    const layerIdsToColorSelection: Record<string, string> = {};

    for (const user of selections) {
      const [connectionId, selection] = user;

      for (const layerId of selection) {
        layerIdsToColorSelection[layerId] = connectionIdToColor(connectionId)
      }
    }

    return layerIdsToColorSelection;
  }, [selections]);

  const activeProblemSrc = useStorage((root) => {
    for (const layerId of selection) {
      const layer = root.layers[layerId];
      if (layer?.type === LayerType.Image) {
        return layer.src;
      }
    }
    return null;
  });

  // Clear step markers AND submit-working marks when the active problem
  // changes so stale results don't linger across problem switches.
  useEffect(() => {
    setStepMarkers([]);
    setMarkingResults([]);
    setWorkingBounds(null);
  }, [activeProblemSrc]);

  // Submit the student's handwritten working to the marker API. Captures
  // just the path-layer region (so the printed problem image isn't sent),
  // then overlays per-line ticks/crosses on the canvas using the bounds we
  // captured against.
  const submitWorking = useCallback(
    async (analysis: ProblemAnalysis, problemText: string) => {
      if (!svgRef.current) return;
      const bounds = getPathLayerBounds();
      if (!bounds) {
        console.warn("[submit-working] no path layers to mark");
        return;
      }
      const lineAnchors = getPathLineAnchors();

      setIsMarking(true);
      setMarkingResults([]);

      try {
        const capture = await captureWorkingArea(
          svgRef.current,
          bounds,
          camera
        );
        if (!capture) {
          console.warn("[submit-working] capture failed");
          return;
        }

        setWorkingBounds(capture.bounds);

        const response = await fetch("/api/mark-working", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workingImageSrc: capture.dataUrl,
            solutionSteps: analysis.solution.steps,
            finalAnswer: analysis.solution.finalAnswer,
            problemText,
          }),
        });

        if (!response.ok) {
          console.error(
            "[submit-working] mark-working API failed",
            response.status
          );
          return;
        }

        const results = (await response.json()) as MarkedLine[] | { error?: string };
        if (Array.isArray(results)) {
          // Remap model results onto geometry-derived line anchors so marker
          // placement follows the actual handwriting lines:
          // - group strokes by Y proximity
          // - use group average midpoint Y
          // - use group max right X (+offset)
          const overlayBounds = capture.bounds;
          const orderedResults = [...results].sort(
            (a, b) => a.yPositionPercent - b.yPositionPercent
          );

          const remapped = orderedResults.map((result, idx) => {
            const anchor = lineAnchors[idx];
            if (!anchor || overlayBounds.width <= 0 || overlayBounds.height <= 0) {
              return result;
            }

            const yPositionPercent = Math.max(
              0,
              Math.min(100, ((anchor.y - overlayBounds.y) / overlayBounds.height) * 100)
            );
            const xPositionPercent = Math.max(
              0,
              Math.min(
                100,
                ((anchor.rightX - overlayBounds.x) / overlayBounds.width) * 100
              )
            );

            return {
              ...result,
              yPositionPercent,
              xPositionPercent,
            } as MarkedLine;
          });

          setMarkingResults(remapped);
        } else {
          console.error("[submit-working] unexpected response", results);
        }
      } catch (err) {
        console.error("[submit-working] failed", err);
      } finally {
        setIsMarking(false);
      }
    },
    [camera, getPathLayerBounds, getPathLineAnchors]
  );

  const deleteLayers = useDeleteLayers();

  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    onResize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        // case "Backspace":
        //   deleteLayers();
        //   break;
        case "z": {
          if (e.ctrlKey || e.metaKey) {
            if (e.shiftKey) {
              history.redo();
            } else {
              history.undo();
            }
            break;
          }
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [deleteLayers, history]);

  return (
    <main
      className="h-full w-full relative bg-white touch-none"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
      linear-gradient(to right, oklch(0.75 0 0 / 0.2) 1px, transparent 1px),
      linear-gradient(to bottom, oklch(0.75 0 0 / 0.2) 1px, transparent 1px)
    `,
          backgroundSize: "24px 24px",
        }}
      />
      <Info boardId={boardId} />
      <Toolbar
        canvasState={canvasState}
        setCanvasState={setCanvasState}
        canRedo={canRedo}
        canUndo={canUndo}
        undo={history.undo}
        redo={history.redo}
        onAddProblem={addProblemImage}
      />
      <SelectionTools
        camera={camera}
        setLastUsedColor={setLastUsedColor}
      />
      <ProblemPanel
        activeProblemSrc={activeProblemSrc}
        verificationPercentage={verification.percentage}
        verificationIsCorrect={verification.isCorrect}
        verificationFeedback={verification.feedback}
        verificationIsLoading={verification.isLoading}
      />
      <ZoomControls
        zoom={camera.zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
      />
      <svg
        ref={svgRef}
        className="h-[100vh] w-[100vw]"
        style={{
          cursor: canvasState.mode === CanvasMode.Eraser ? "none" : undefined,
        }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={handlePointerUp}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <g
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {layerIds.map((layerId) => (
            <LayerPreview
              key={layerId}
              id={layerId}
              onLayerPointerDown={onLayerPointerDown}
              selectionColor={layerIdsToColorSelection[layerId]}
            />
          ))}
          {layerIds.length === 0 && viewport.width > 0 && viewport.height > 0 && (() => {
            // Centre the hint on the viewport in canvas coords, accounting
            // for both pan and zoom.
            const cx = (viewport.width / 2 - camera.x) / camera.zoom;
            const cy = (viewport.height / 2 - camera.y) / camera.zoom;
            return (
              <g>
                <rect
                  x={cx - 250}
                  y={cy - 90}
                  width={500}
                  height={180}
                  rx={16}
                  className="fill-white/5 stroke-slate-400 stroke-1"
                  strokeDasharray="10 8"
                />
                <text
                  x={cx}
                  y={cy + 6}
                  textAnchor="middle"
                  className="fill-slate-400 text-xl font-medium"
                >
                  Drop your problem here or click Add Problem
                </text>
              </g>
            );
          })()}
          <SelectionBox
            onResizeHandlePointerDown={onResizeHandlePointerDown}
          />
          {canvasState.mode === CanvasMode.SelectionNet && canvasState.current != null && (
            <rect
              className="fill-blue-500/5 stroke-blue-500 stroke-1"
              x={Math.min(canvasState.origin.x, canvasState.current.x)}
              y={Math.min(canvasState.origin.y, canvasState.current.y)}
              width={Math.abs(canvasState.origin.x - canvasState.current.x)}
              height={Math.abs(canvasState.origin.y - canvasState.current.y)}
            />
          )}
          <CursorsPresence />
          {pencilDraft != null && pencilDraft.length > 0 && (
            <Path
              points={pencilDraft}
              fill={colorToCss(lastUsedColor)}
              x={0}
              y={0}
            />
          )}
          <StepMarkers steps={stepMarkers} />
          <MarkingOverlay
            bounds={workingBounds}
            results={markingResults}
          />
          {canvasState.mode === CanvasMode.Eraser && eraserCursor && (
            <circle
              cx={eraserCursor.x}
              cy={eraserCursor.y}
              r={ERASER_RADIUS}
              className="fill-white/40 stroke-neutral-500"
              strokeWidth={1.5 / camera.zoom}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      <HandwritingOverlay
        activeProblemSrc={activeProblemSrc}
        canvasState={canvasState}
        onProgressChange={onProgressChange}
        onStepsChange={onStepsChange}
        onStrokeEnd={strokeEndTick}
        camera={camera}
        computeLayerBounds={computeLayerBounds}
        getPathLineAnchors={getPathLineAnchors}
      />
    </main>
  );
};
