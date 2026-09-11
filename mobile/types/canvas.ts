/**
 * Mobile layer model.
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
  storageId: string;
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
