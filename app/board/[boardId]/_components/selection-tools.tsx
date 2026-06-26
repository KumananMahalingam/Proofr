"use client";

import { memo } from "react";
import { BringToFront, SendToBack, Trash2 } from "lucide-react";

import { LiveObject } from "@liveblocks/client";

import { Hint } from "@/components/hint";
import {
  Camera,
  Color,
  Layer,
  LayerType,
  ImageLayer,
} from "@/types/canvas";
import { Button } from "@/components/ui/button";
import { useMutation, useSelf } from "@/liveblocks.config";
import { useDeleteLayers } from "@/hooks/use-delete-layers";
import { useSelectionBounds } from "@/hooks/use-selection-bounds";

import { ColorPicker } from "./color-picker";

interface SelectionToolsProps {
  camera: Camera;
  setLastUsedColor: (color: Color) => void;
};

export const SelectionTools = memo(({
  camera,
  setLastUsedColor,
}: SelectionToolsProps) => {
  const selection = useSelf((me) => me.presence.selection);

  const moveToFront = useMutation((
    { storage }
  ) => {
    const liveLayerIds = storage.get("layerIds");
    const indices: number[] = [];

    const arr = liveLayerIds.map((id) => id);

    for (let i = 0; i < arr.length; i++) {
      if (selection.includes(arr[i])) {
        indices.push(i);
      }
    }

    for (let i = indices.length - 1; i >= 0; i--) {
      liveLayerIds.move(
        indices[i],
        arr.length - 1 - (indices.length - 1 - i)
      );
    }
  }, [selection]);

  const moveToBack = useMutation((
    { storage }
  ) => {
    const liveLayerIds = storage.get("layerIds");
    const indices: number[] = [];

    const arr = liveLayerIds.map((id) => id);

    for (let i = 0; i < arr.length; i++) {
      if (selection.includes(arr[i])) {
        indices.push(i);
      }
    }

    for (let i = 0; i < indices.length; i++) {
      liveLayerIds.move(indices[i], i);
    }
  }, [selection]);

  const setFill = useMutation((
    { storage },
    fill: Color,
  ) => {
    const liveLayers = storage.get("layers");
    setLastUsedColor(fill);

    selection.forEach((id) => {
      const layer = liveLayers.get(id);

      // Image layers have no fill, so skip them.
      if (!layer || layer.get("type") === LayerType.Image) {
        return;
      }

      (layer as LiveObject<Exclude<Layer, ImageLayer>>).set("fill", fill);
    })
  }, [selection, setLastUsedColor]);

  const deleteLayers = useDeleteLayers();

  const selectionBounds = useSelectionBounds();

  if (!selectionBounds) {
    return null;
  }

  const zoom = camera.zoom || 1;
  const x = (selectionBounds.x + selectionBounds.width / 2) * zoom + camera.x;
  const y = selectionBounds.y * zoom + camera.y;

  return (
    <div
      className="absolute p-3 rounded-xl bg-neutral-900 border border-white/10 shadow-xl flex select-none"
      style={{
        transform: `translate(
          calc(${x}px - 50%),
          calc(${y - 16}px - 100%)
        )`
      }}
    >
      <ColorPicker
        onChange={setFill}
      />
      <div className="flex flex-col gap-y-0.5">
        <Hint label="Bring to front">
          <Button
            onClick={moveToFront}
            variant="board"
            size="icon"
            className="text-white/60 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <BringToFront />
          </Button>
        </Hint>
        <Hint label="Send to back" side="bottom">
          <Button
            onClick={moveToBack}
            variant="board"
            size="icon"
            className="text-white/60 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <SendToBack />
          </Button>
        </Hint>
      </div>
      <div className="flex items-center pl-2 ml-2 border-l border-white/10">
        <Hint label="Delete">
          <Button
            variant="board"
            size="icon"
            onClick={deleteLayers}
            className="text-white/60 hover:text-red-400 hover:bg-red-500/20 rounded-lg"
          >
            <Trash2 />
          </Button>
        </Hint>
      </div>
    </div>
  );
});

SelectionTools.displayName = "SelectionTools";
