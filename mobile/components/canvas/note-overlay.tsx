/**
 * Text for sticky notes and text layers.
 *
 * This is a redesign, not a port. The web app used `<foreignObject>` to embed a
 * `react-contenteditable` div inside the SVG, which gave it HTML text editing that
 * panned and zoomed with the canvas for free. Skia has no equivalent escape hatch
 * and no text input, so glyphs live in an absolutely-positioned overlay sharing
 * the camera transform (see `useCamera().overlayStyle`).
 *
 * Display only, plus a `TextInput` for whichever layer is being edited. It
 * deliberately handles NO touches of its own: the canvas gestures own all
 * interaction and decide what is being edited. An earlier version had a
 * `Pressable` per note, which competed with the pan and tap gestures on the
 * parent and made selection unpredictable.
 *
 * Known consequence: note text always composites above the ink regardless of
 * layer order. The alternative is Skia's `Paragraph` API for display with a native
 * input only while editing, which preserves z-order at the cost of font
 * management via `useFonts`.
 */
import { memo, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

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
  onDoneEditing: () => void;
}

export const NoteOverlay = ({
  layerIds,
  layers,
  editingNoteId,
  onDoneEditing,
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
            onDoneEditing={onDoneEditing}
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
  onDoneEditing: () => void;
}

const NoteContent = memo(
  ({ id, layer, isEditing, onDoneEditing }: NoteContentProps) => {
    const { x, y, width, height, fill, value } = layer;
    const isNote = layer.type === LayerType.Note;

    // Local buffer so each keystroke is not a storage mutation. The web version
    // wrote through on every change, which is affordable at desktop typing rates
    // but wasteful over a mobile connection with autocorrect rewriting words.
    const [draft, setDraft] = useState(value ?? "");
    useEffect(() => {
      if (!isEditing) setDraft(value ?? "");
    }, [value, isEditing]);

    const updateValue = useMutation(({ storage }, newValue: string) => {
      storage.get("layers").get(id)?.set("value" as never, newValue as never);
    }, [id]);

    // Notes are a filled square, so the text has to contrast with the fill. Text
    // layers draw no background, so the fill IS the text colour.
    const color = isNote
      ? fill
        ? getContrastingTextColor(fill)
        : "#000000"
      : fill
        ? colorToCss(fill)
        : "#000000";

    const textStyle = {
      fontSize: calculateFontSize(width, height),
      color,
      // Loaded at runtime via expo-font; `next/font/google` has no RN equivalent.
      fontFamily: "Kalam_400Regular",
    };

    return (
      <View
        pointerEvents={isEditing ? "auto" : "none"}
        style={[styles.layer, { left: x, top: y, width, height }]}
      >
        {isEditing ? (
          <TextInput
            autoFocus
            multiline
            value={draft}
            onChangeText={setDraft}
            onBlur={() => {
              updateValue(draft);
              onDoneEditing();
            }}
            style={[styles.text, textStyle]}
            // Notes centre their text like a real sticky note; a text layer reads
            // as a caption and stays left-aligned.
            textAlign={isNote ? "center" : "left"}
          />
        ) : (
          <Text
            style={[
              styles.text,
              textStyle,
              { textAlign: isNote ? "center" : "left" },
            ]}
          >
            {draft || (isNote ? "" : "Text")}
          </Text>
        )}
      </View>
    );
  }
);

NoteContent.displayName = "NoteContent";

const styles = StyleSheet.create({
  layer: { position: "absolute", padding: 8 },
  text: {
    flex: 1,
    textAlignVertical: "center",
    padding: 0,
  },
});
