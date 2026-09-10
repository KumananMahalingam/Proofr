/**
 * Sticky-note and text-layer content, rendered as native views.
 *
 * This is a redesign, not a port. The web app used `<foreignObject>` to drop a
 * `react-contenteditable` div inside the SVG, which gave it HTML text editing
 * that panned and zoomed with the canvas for free. Skia has neither an
 * equivalent escape hatch nor any text input, so note glyphs move out of the
 * drawing surface and into an absolutely-positioned overlay that shares the
 * camera transform (see `useCamera().overlayStyle`).
 *
 * Consequence to be aware of: note text now always composites above the ink,
 * regardless of layer order. If strict z-ordering matters, the alternative is
 * Skia's `Paragraph` API for display plus a native `TextInput` only while
 * editing — more code, and you take on font management via `useFonts`.
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

    // Local buffer so each keystroke doesn't become a storage mutation. The web
    // version wrote through on every `onChange`, which is affordable at desktop
    // typing rates but wasteful over a mobile connection with autocorrect
    // rewriting whole words.
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
      // Load Kalam through expo-font; `next/font/google` has no RN equivalent.
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
            // select-and-drag, which on web was a modifier-free distinction the
            // DOM handled via separate pointer targets.
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
