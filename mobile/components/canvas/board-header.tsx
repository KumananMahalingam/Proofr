/**
 * Top bar: back, board title, participants, undo/redo — plus a floating zoom pill.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "convex/react";
import {
  useAnimatedReaction,
  type SharedValue,
} from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import { useWindowDimensions } from "react-native";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCanRedo, useCanUndo, useHistory, useOthers } from "@/liveblocks.config";
import type { CameraController } from "@/hooks/use-camera";

interface BoardHeaderProps {
  boardId: string;
  camera: CameraController;
  onOpenPanel: () => void;
}

export const BoardHeader = ({
  boardId,
  camera,
  onOpenPanel,
}: BoardHeaderProps) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const board = useQuery(api.board.get, { id: boardId as Id<"boards"> });
  const others = useOthers();
  const history = useHistory();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  return (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconButton}>
          <MaterialCommunityIcons name="chevron-left" size={24} color="#fff" />
        </Pressable>

        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {board?.title ?? "Board"}
          </Text>
          {others.length > 0 && (
            <Text style={styles.subtitle}>
              {others.length} other{others.length === 1 ? "" : "s"} here
            </Text>
          )}
        </View>

        <Pressable
          onPress={() => history.undo()}
          disabled={!canUndo}
          style={[styles.iconButton, !canUndo && styles.disabled]}
        >
          <MaterialCommunityIcons name="undo-variant" size={22} color="#fff" />
        </Pressable>
        <Pressable
          onPress={() => history.redo()}
          disabled={!canRedo}
          style={[styles.iconButton, !canRedo && styles.disabled]}
        >
          <MaterialCommunityIcons name="redo-variant" size={22} color="#fff" />
        </Pressable>

        <Pressable onPress={onOpenPanel} style={styles.analyseButton}>
          <MaterialCommunityIcons
            name="auto-fix"
            size={20}
            color="#ffffff"
          />
        </Pressable>
      </View>

      <ZoomPill
        zoom={camera.zoom}
        zoomBy={camera.zoomBy}
        reset={camera.reset}
        topOffset={insets.top + 64}
      />
    </>
  );
};


const ZoomPill = ({
  zoom,
  zoomBy,
  reset,
  topOffset,
}: {
  zoom: SharedValue<number>;
  zoomBy: (factor: number, screenX: number, screenY: number) => void;
  reset: () => void;
  topOffset: number;
}) => {
  const { width, height } = useWindowDimensions();
  const [percent, setPercent] = useState(100);

  useAnimatedReaction(
    () => Math.round(zoom.value * 100),
    (next, previous) => {
      if (next !== previous) runOnJS(setPercent)(next);
    }
  );

  const centreX = width / 2;
  const centreY = height / 2;

  return (
    <View style={[styles.zoomPill, { top: topOffset }]}>
      <Pressable
        onPress={() => zoomBy(1 / 1.25, centreX, centreY)}
        style={styles.zoomButton}
      >
        <MaterialCommunityIcons name="minus" size={18} color="#fff" />
      </Pressable>

      <Pressable onPress={reset} style={styles.zoomLabelButton}>
        <Text style={styles.zoomLabel}>{percent}%</Text>
      </Pressable>

      <Pressable
        onPress={() => zoomBy(1.25, centreX, centreY)}
        style={styles.zoomButton}
      >
        <MaterialCommunityIcons name="plus" size={18} color="#fff" />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingBottom: 10,
    backgroundColor: "rgba(15,15,26,0.92)",
  },
  titleBlock: { flex: 1, paddingHorizontal: 4 },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  subtitle: { color: "rgba(255,255,255,0.45)", fontSize: 11 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.35 },
  analyseButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3b82f6",
    marginLeft: 2,
  },
  zoomPill: {
    position: "absolute",
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 2,
  },
  zoomButton: {
    width: 32,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomLabelButton: { paddingHorizontal: 4 },
  zoomLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 42,
    textAlign: "center",
  },
});
