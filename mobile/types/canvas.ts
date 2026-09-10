/**
 * Mobile layer model.
 *
 * Trimmed from the web `types/canvas.ts`. Because the web app is being retired,
 * this is free to diverge — two deliberate changes:
 *
 *  1. Stroke points are `[x, y]`, not `[x, y, pressure]`. Finger input reports
 *     no pressure, so the third component was a constant 0.5 stored on every
 *     point of every stroke and broadcast on every presence update. Taper is
 *     restored via perfect-freehand's `simulatePressure`, which derives width
 *     from velocity instead. Add the component back when stylus support lands.
 *
 *  2. Image layers hold a Convex storage reference rather than a base64 data
 *     URL. Camera photos are megabytes; base64 in a CRDT is not viable.
 *
 * Removed entirely: `Side`, `XYWH`, and the `Resizing` / `SelectionNet` /
 * `Pressing` canvas modes, since resize handles and marquee selection are cut
 * from the first pass.
 */

export type Color = {
  r: number;
  g: number;
  b: number;
};

export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

export enum LayerType {
  Rectangle,
  Ellipse,
  Path,
  Text,
  Note,
  Image,
}

/** `[x, y]` in canvas units, relative to the layer's own origin. */
export type StrokePoint = [x: number, y: number];

export type RectangleLayer = {
  type: LayerType.Rectangle;
  x: number;
  y: number;
  height: number;
  width: number;
  fill: Color;
  value?: string;
};

export type EllipseLayer = {
  type: LayerType.Ellipse;
  x: number;
  y: number;
  height: number;
  width: number;
  fill: Color;
  value?: string;
};

export type PathLayer = {
  type: LayerType.Path;
  x: number;
  y: number;
  height: number;
  width: number;
  fill: Color;
  points: StrokePoint[];
  value?: string;
};

export type TextLayer = {
  type: LayerType.Text;
  x: number;
  y: number;
  height: number;
  width: number;
  fill: Color;
  value?: string;
};

export type NoteLayer = {
  type: LayerType.Note;
  x: number;
  y: number;
  height: number;
  width: number;
  fill: Color;
  value?: string;
};

export type ImageLayer = {
  type: LayerType.Image;
  x: number;
  y: number;
  height: number;
  width: number;
  /**
   * Convex `_storage` id. Kept alongside `src` so the file can be deleted when
   * the layer is, which base64 storage made impossible.
   */
  storageId: string;
  /** Resolved Convex storage URL, used for rendering. */
  src: string;
};

export type Point = {
  x: number;
  y: number;
};

export enum CanvasMode {
  None,
  Inserting,
  Translating,
  Pencil,
  Eraser,
}

export type CanvasState =
  | { mode: CanvasMode.None }
  | {
      mode: CanvasMode.Inserting;
      layerType:
        | LayerType.Ellipse
        | LayerType.Rectangle
        | LayerType.Text
        | LayerType.Note;
    }
  | { mode: CanvasMode.Translating; current: Point }
  | { mode: CanvasMode.Pencil }
  | { mode: CanvasMode.Eraser };

export type Layer =
  | RectangleLayer
  | EllipseLayer
  | PathLayer
  | TextLayer
  | NoteLayer
  | ImageLayer;
