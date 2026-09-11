/**
 * Board screen: header, canvas, toolbar.
 *
 * Layout differs from the web deliberately. The web app had a left tool rail, a
 * floating selection popover, a top-left info block, a bottom-right zoom cluster
 * and a 380px right-hand problem panel. None of that fits a ~390pt screen, so:
 *
 *   - tools moved to a bottom bar, within thumb reach
 *   - colours appear above it only when relevant
 *   - info/participants/undo/redo consolidated into a top bar
 *   - zoom became a compact pill
 *
 * The camera is owned here rather than inside the canvas, so the header's zoom
 * controls and the canvas share one source of truth.
 *
 * Still to come: the problem-analysis panel as a bottom sheet. It depends on the
 * four AI routes being migrated to Convex actions, so it lands with that work
 * rather than as dead UI now.
 */
import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Room } from "@/providers/board-providers";
import { SkiaCanvas } from "@/components/canvas/skia-canvas";
import { BoardHeader } from "@/components/canvas/board-header";
import { BoardToolbar } from "@/components/canvas/board-toolbar";
import { useCamera } from "@/hooks/use-camera";
import { useInsertImage } from "@/hooks/use-insert-image";
import { useDeleteSelection } from "@/hooks/use-delete-selection";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProblemPanel } from "@/components/canvas/problem-panel";
import { ProgressBar } from "@/components/canvas/progress-bar";
import type { VerificationState } from "@/hooks/use-handwriting-recognition";
import { useSelf, useStorage } from "@/liveblocks.config";
import { getLayer } from "@/lib/canvas-utils";
import {
  CanvasMode,
  LayerType,
  type CanvasState,
  type Color,
} from "@/types/canvas";

export default function BoardScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>();

  if (!boardId) return null;

  return (
    <Room roomId={boardId}>
      <BoardCanvas boardId={boardId} />
    </Room>
  );
}

const BoardCanvas = ({ boardId }: { boardId: string }) => {
  const camera = useCamera();
  const insets = useSafeAreaInsets();

  const [canvasState, setCanvasState] = useState<CanvasState>({
    mode: CanvasMode.Pencil,
  });
  const [lastUsedColor, setLastUsedColor] = useState<Color>({
    r: 0,
    g: 0,
    b: 0,
  });

  const selection = useSelf((me) => me.presence.selection);
  const hasSelection = (selection?.length ?? 0) > 0;

  const [panelOpen, setPanelOpen] = useState(false);

  // Extracted problem text, lifted here so it can be fed to the marking model as
  // context. The panel produces it; the canvas consumes it.
  const [problemText, setProblemText] = useState<string | undefined>();
  const [verification, setVerification] = useState<VerificationState>({
    isLoading: false,
    isCorrect: true,
    percentage: 0,
    feedback: "",
  });

  // Storage id of the selected image layer — the mobile equivalent of the web
  // `activeProblemSrc`. Drives which problem the analysis panel operates on.
  const layers = useStorage((root) => root.layers);
  const activeStorageId = (() => {
    for (const id of selection ?? []) {
      const layer = getLayer(layers, id);
      if (layer?.type === LayerType.Image) return layer.storageId;
    }
    return null;
  })();

  const deleteSelection = useDeleteSelection();
  const insertImage = useInsertImage(camera.snapshot, setCanvasState);

  // Camera first: on a phone the problem is usually on paper in front of you,
  // which is the flow the web app's drag-and-drop could not serve at all.
  const onAddImage = useCallback(() => {
    Alert.alert("Add problem", undefined, [
      { text: "Take photo", onPress: () => void insertImage("camera") },
      { text: "Choose from library", onPress: () => void insertImage("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [insertImage]);

  return (
    <View style={styles.root}>
      <SkiaCanvas
        boardId={boardId}
        canvasState={canvasState}
        setCanvasState={setCanvasState}
        lastUsedColor={lastUsedColor}
        camera={camera}
        problemText={problemText}
        onVerificationChange={setVerification}
      />

      <BoardHeader
        boardId={boardId}
        camera={camera}
        onOpenPanel={() => setPanelOpen(true)}
      />

      <BoardToolbar
        canvasState={canvasState}
        setCanvasState={setCanvasState}
        lastUsedColor={lastUsedColor}
        setLastUsedColor={setLastUsedColor}
        onAddImage={onAddImage}
        hasSelection={hasSelection}
        onDeleteSelection={deleteSelection}
      />

      <ProgressBar state={verification} topOffset={insets.top + 108} />

      <ProblemPanel
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        activeStorageId={activeStorageId}
        onProblemExtracted={setProblemText}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
});
