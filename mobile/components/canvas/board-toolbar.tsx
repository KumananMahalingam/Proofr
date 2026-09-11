/**
 * Bottom tool bar and colour row.
 *
 * The web app had a vertical rail pinned to the left edge plus a floating
 * selection-tools popover. Neither survives a 390pt-wide screen, so tools move to
 * a horizontal bar along the bottom — within thumb reach — and the colour swatches
 * appear above it only when they are relevant (pen active, or a layer selected).
 *
 * Same tool set as the web `Toolbar` plus `SelectionTools`, minus the two features
 * cut from the first pass (resize handles and marquee selection).
 */
import { ScrollView, StyleSheet, Pressable, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { CanvasMode, LayerType, type CanvasState, type Color } from "@/types/canvas";
import { colorToCss } from "@/lib/canvas-utils";

/** Matches the web colour picker palette. */
export const PALETTE: Color[] = [
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { r: 220, g: 38, b: 38 },
  { r: 249, g: 115, b: 22 },
  { r: 250, g: 204, b: 21 },
  { r: 34, g: 197, b: 94 },
  { r: 59, g: 130, b: 246 },
  { r: 124, g: 58, b: 237 },
];

type ToolId =
  | "select"
  | "pen"
  | "eraser"
  | "note"
  | "text"
  | "rectangle"
  | "ellipse"
  | "image";

const TOOLS: Array<{
  id: ToolId;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  state?: CanvasState;
}> = [
  { id: "select", icon: "cursor-default-outline", state: { mode: CanvasMode.None } },
  { id: "pen", icon: "draw", state: { mode: CanvasMode.Pencil } },
  { id: "eraser", icon: "eraser", state: { mode: CanvasMode.Eraser } },
  {
    id: "note",
    icon: "note-outline",
    state: { mode: CanvasMode.Inserting, layerType: LayerType.Note },
  },
  {
    id: "text",
    icon: "format-text",
    state: { mode: CanvasMode.Inserting, layerType: LayerType.Text },
  },
  {
    id: "rectangle",
    icon: "square-outline",
    state: { mode: CanvasMode.Inserting, layerType: LayerType.Rectangle },
  },
  {
    id: "ellipse",
    icon: "circle-outline",
    state: { mode: CanvasMode.Inserting, layerType: LayerType.Ellipse },
  },
  // No CanvasState: opens the picker instead of arming an insert mode.
  { id: "image", icon: "image-plus" },
];

interface BoardToolbarProps {
  canvasState: CanvasState;
  setCanvasState: (state: CanvasState) => void;
  lastUsedColor: Color;
  setLastUsedColor: (color: Color) => void;
  onAddImage: () => void;
  /** Shown when a layer is selected, mirroring the web SelectionTools popover. */
  hasSelection: boolean;
  onDeleteSelection: () => void;
}

const isActive = (state: CanvasState, tool: CanvasState | undefined) => {
  if (!tool) return false;
  if (state.mode !== tool.mode) return false;
  if (
    state.mode === CanvasMode.Inserting &&
    tool.mode === CanvasMode.Inserting
  ) {
    return state.layerType === tool.layerType;
  }
  return true;
};

export const BoardToolbar = ({
  canvasState,
  setCanvasState,
  lastUsedColor,
  setLastUsedColor,
  onAddImage,
  hasSelection,
  onDeleteSelection,
}: BoardToolbarProps) => {
  const showColors =
    canvasState.mode === CanvasMode.Pencil ||
    canvasState.mode === CanvasMode.Inserting ||
    hasSelection;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {showColors && (
        <View style={styles.colorRow}>
          {PALETTE.map((color) => {
            const css = colorToCss(color);
            const selected = colorToCss(lastUsedColor) === css;
            return (
              <Pressable
                key={css}
                onPress={() => setLastUsedColor(color)}
                style={[
                  styles.swatch,
                  { backgroundColor: css },
                  selected && styles.swatchSelected,
                ]}
              />
            );
          })}
          {hasSelection && (
            <Pressable onPress={onDeleteSelection} style={styles.deleteButton}>
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={18}
                color="#f87171"
              />
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.bar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.barContent}
        >
          {TOOLS.map((tool) => {
            const active = isActive(canvasState, tool.state);
            return (
              <Pressable
                key={tool.id}
                onPress={() => {
                  if (tool.state) setCanvasState(tool.state);
                  else onAddImage();
                }}
                style={[styles.tool, active && styles.toolActive]}
              >
                <MaterialCommunityIcons
                  name={tool.icon}
                  size={22}
                  color={active ? "#ffffff" : "rgba(255,255,255,0.6)"}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: "center",
    gap: 8,
  },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  swatchSelected: { borderWidth: 3, borderColor: "#3b82f6" },
  deleteButton: {
    marginLeft: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  bar: {
    maxWidth: "94%",
    borderRadius: 16,
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  barContent: { padding: 6, gap: 4, alignItems: "center" },
  tool: {
    width: 42,
    height: 42,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  toolActive: { backgroundColor: "#3b82f6" },
});
