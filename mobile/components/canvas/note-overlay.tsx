/**
 * Sticky-note and text-layer content, rendered as native views.
 */
import React, { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { LayerType, type NoteLayer, type TextLayer } from "@/types/canvas";
import { useMutation } from "@/liveblocks.config";
import {
  colorToCss,
  getContrastingTextColor,
  getLayer,
  type LayerLookup,
} from "@/lib/canvas-utils";

/** Verbatim from the web `note.tsx`. */
const calculateFontSize = (width: number, height: number) => {
  const maxFontSize = 96;
  const scaleFactor = 0.15;
  return Math.min(height * scaleFactor, width * scaleFactor, maxFontSize);
};

interface NoteOverlayProps {
  layerIds: readonly string[];
  layers: LayerLookup;
  editingNoteId: string | null;
  onRequestEdit: (id: string | null) => void;
}

export const NoteOverlay = ({
  layerIds,
  layers,
  editingNoteId,
  onRequestEdit,
}: NoteOverlayProps) => {
  return (
    <>
      {layerIds.map((id) => {
        const layer = getLayer(layers, id);
        if (
          !layer ||
          (layer.type !== LayerType.Note && layer.type !== LayerType.Text)
        ) {
          return null;
        }

        return (
          <NoteContent
            key={id}
            id={id}
            layer={layer}
            isEditing={editingNoteId === id}
            onRequestEdit={onRequestEdit}
          />
        );
      })}
    </>
  );
};

interface NoteContentProps {
  id: string;
  layer: NoteLayer | TextLayer;
  isEditing: boolean;
  onRequestEdit: (id: string | null) => void;
}

const NoteContent = memo(
  ({ id, layer, isEditing, onRequestEdit }: NoteContentProps) => {
    const { x, y, width, height, fill, value } = layer;

    const [draft, setDraft] = useState(value ?? "");
    useEffect(() => {
      if (!isEditing) setDraft(value ?? "");
    }, [value, isEditing]);

    const updateValue = useMutation(({ storage }, newValue: string) => {
      storage.get("layers").get(id)?.set("value" as never, newValue as never);
    }, [id]);

    const color =
      layer.type === LayerType.Note && fill
        ? getContrastingTextColor(fill)
        : fill
          ? colorToCss(fill)
          : "#000000";

    const textStyle = {
      fontSize: calculateFontSize(width, height),
      color,
      fontFamily: "Kalam_400Regular",
      textAlign: "center" as const,
    };

    return (
      <View style={[styles.layer, { left: x, top: y, width, height }]}>
        {isEditing ? (
          <TextInput
            autoFocus
            multiline
            value={draft}
            onChangeText={setDraft}
            onBlur={() => {
              updateValue(draft);
              onRequestEdit(null);
            }}
            style={[styles.text, textStyle]}
          />
        ) : (
          <Pressable
            style={styles.fill}
            // Double-tap to edit: a single tap has to stay available for
            // select-and-drag
            onLongPress={() => onRequestEdit(id)}
          >
            <Text style={[styles.text, textStyle]}>{draft || "Text"}</Text>
          </Pressable>
        )}
      </View>
    );
  }
);

NoteContent.displayName = "NoteContent";

const styles = StyleSheet.create({
  layer: { position: "absolute" },
  fill: { flex: 1, justifyContent: "center" },
  text: {
    flex: 1,
    textAlignVertical: "center",
    padding: 0,
  },
});
