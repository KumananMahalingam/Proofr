"use client";

import { ChangeEvent, useRef } from "react";
import { 
  Circle, 
  Eraser,
  ImagePlus,
  MousePointer2, 
  Pencil, 
  Redo2, 
  Square, 
  StickyNote, 
  Type,
  Undo2
} from "lucide-react";

import { CanvasMode, CanvasState, LayerType } from "@/types/canvas";

import { ToolButton } from "./tool-button";

interface ToolbarProps {
  canvasState: CanvasState;
  setCanvasState: (newState: CanvasState) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onAddProblem: (file: File) => Promise<void>;
};

export const Toolbar = ({
  canvasState,
  setCanvasState,
  undo,
  redo,
  canUndo,
  canRedo,
  onAddProblem,
}: ToolbarProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onImageSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    await onAddProblem(file);
    e.target.value = "";
  };

  return (
    <div className="absolute top-[50%] -translate-y-[50%] left-2 flex flex-col gap-y-4">
      <div className="bg-neutral-900 border border-white/10 rounded-md p-1.5 flex gap-y-1 flex-col items-center shadow-xl text-white/70">
        <ToolButton
          label="Select"
          icon={MousePointer2}
          onClick={() => setCanvasState({ 
            mode: CanvasMode.None
          })}
          isActive={
            canvasState.mode === CanvasMode.None ||
            canvasState.mode === CanvasMode.Translating ||
            canvasState.mode === CanvasMode.SelectionNet ||
            canvasState.mode === CanvasMode.Pressing ||
            canvasState.mode === CanvasMode.Resizing
          }
        />
        <ToolButton
          label="Text"
          icon={Type}
          onClick={() => setCanvasState({
            mode: CanvasMode.Inserting,
            layerType: LayerType.Text,
          })}
          isActive={
            canvasState.mode === CanvasMode.Inserting &&
            canvasState.layerType === LayerType.Text
          }
        />
        <ToolButton
          label="Sticky note"
          icon={StickyNote}
          onClick={() => setCanvasState({
            mode: CanvasMode.Inserting,
            layerType: LayerType.Note,
          })}
          isActive={
            canvasState.mode === CanvasMode.Inserting &&
            canvasState.layerType === LayerType.Note
          }
        />
        <ToolButton
          label="Rectangle"
          icon={Square}
          onClick={() => setCanvasState({
            mode: CanvasMode.Inserting,
            layerType: LayerType.Rectangle,
          })}
          isActive={
            canvasState.mode === CanvasMode.Inserting &&
            canvasState.layerType === LayerType.Rectangle
          }
        />
        <ToolButton
          label="Ellipse"
          icon={Circle}
          onClick={() => setCanvasState({
            mode: CanvasMode.Inserting,
            layerType: LayerType.Ellipse,
          })}
          isActive={
            canvasState.mode === CanvasMode.Inserting &&
            canvasState.layerType === LayerType.Ellipse
          }
        />
        <ToolButton
          label="Add Problem"
          icon={ImagePlus}
          onClick={() => fileInputRef.current?.click()}
        />
        <ToolButton
          label="Pen"
          icon={Pencil}
          onClick={() => setCanvasState({
            mode: CanvasMode.Pencil,
          })}
          isActive={
            canvasState.mode === CanvasMode.Pencil
          }
        />
        <ToolButton
          label="Eraser"
          icon={Eraser}
          onClick={() => setCanvasState({
            mode: CanvasMode.Eraser,
          })}
          isActive={
            canvasState.mode === CanvasMode.Eraser
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onImageSelected}
        />
      </div>
      <div className="bg-neutral-900 border border-white/10 rounded-md p-1.5 flex flex-col items-center shadow-xl text-white/70">
        <ToolButton
          label="Undo"
          icon={Undo2}
          onClick={undo}
          isDisabled={!canUndo}
        />
        <ToolButton
          label="Redo"
          icon={Redo2}
          onClick={redo}
          isDisabled={!canRedo}
        />
      </div>
    </div>
  );
};

export const ToolbarSkeleton = () => {
  return (
    <div className="absolute top-[50%] -translate-y-[50%] left-2 flex flex-col gap-y-4 bg-neutral-900 border border-white/10 h-[360px] w-[52px] shadow-xl rounded-md" />
  );
};
