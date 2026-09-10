/**
 * Board screen — the Phase 0 spike target.
 *
 * Deliberately minimal: enough toolbar to exercise every code path in
 * `SkiaCanvas` (draw, erase, insert, select) and nothing else. The real toolbar,
 * problem panel, and marking overlay come in later phases.
 *
 * To run the spike you need a real board `_id` from your Convex `boards` table,
 * because the Liveblocks auth action resolves the room id against it and checks
 * org membership. Navigate to /board/<that id>.
 */
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Room } from "@/providers/board-providers";
import { SkiaCanvas } from "@/components/canvas/skia-canvas";
import {
  CanvasMode,
  LayerType,
  type CanvasState,
  type Color,
} from "@/types/canvas";

const BLACK: Color = { r: 0, g: 0, b: 0 };

export default function BoardScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>();

  if (!boardId) return null;

  return (
    <Room roomId={boardId}>
      <BoardCanvas boardId={boardId} />
    </Room>
  );
}

const TOOLS = [
  { label: "Pen", state: { mode: CanvasMode.Pencil } as CanvasState },
  { label: "Erase", state: { mode: CanvasMode.Eraser } as CanvasState },
  { label: "Select", state: { mode: CanvasMode.None } as CanvasState },
  {
    label: "Note",
    state: {
      mode: CanvasMode.Inserting,
      layerType: LayerType.Note,
    } as CanvasState,
  },
  {
    label: "Rect",
    state: {
      mode: CanvasMode.Inserting,
      layerType: LayerType.Rectangle,
    } as CanvasState,
  },
];

const BoardCanvas = ({ boardId }: { boardId: string }) => {
  const [canvasState, setCanvasState] = useState<CanvasState>({
    mode: CanvasMode.Pencil,
  });
  const [strokeCount, setStrokeCount] = useState(0);

  // Stands in for the recognition pipeline. In Phase 4 this becomes the
  // debounced capture + `recognize-math` call; for the spike it just proves the
  // UI-thread gesture is handing committed strokes back to JS.
  const onStrokeEnd = useCallback(() => setStrokeCount((n) => n + 1), []);

  return (
    <View style={styles.root}>
      <SkiaCanvas
        boardId={boardId}
        canvasState={canvasState}
        setCanvasState={setCanvasState}
        lastUsedColor={BLACK}
        onStrokeEnd={onStrokeEnd}
      />

      <View style={styles.toolbar}>
        {TOOLS.map((tool) => {
          const active = canvasState.mode === tool.state.mode;
          return (
            <Pressable
              key={tool.label}
              onPress={() => setCanvasState(tool.state)}
              style={[styles.tool, active && styles.toolActive]}
            >
              <Text style={[styles.toolText, active && styles.toolTextActive]}>
                {tool.label}
              </Text>
            </Pressable>
          );
        })}
        <Text style={styles.counter}>{strokeCount}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 6,
    borderRadius: 14,
    backgroundColor: "#1a1a2e",
  },
  tool: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  toolActive: { backgroundColor: "#3b82f6" },
  toolText: { color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  toolTextActive: { color: "#ffffff" },
  counter: {
    color: "rgba(255,255,255,0.35)",
    paddingHorizontal: 8,
    fontVariant: ["tabular-nums"],
  },
});
