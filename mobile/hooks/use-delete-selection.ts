/**
 * Delete the currently selected layers.
 *
 * Port of `hooks/use-delete-layers.ts`. On the web this was reachable via the
 * Backspace key; there is no keyboard here, so it is wired to the trash button in
 * the toolbar's colour row instead.
 */
import { useMutation, useSelf } from "@/liveblocks.config";

export function useDeleteSelection() {
  const selection = useSelf((me) => me.presence.selection);

  return useMutation(
    ({ storage, setMyPresence }) => {
      if (!selection || selection.length === 0) return;

      const liveLayers = storage.get("layers");
      const liveLayerIds = storage.get("layerIds");

      for (const id of selection) {
        liveLayers.delete(id);

        const index = liveLayerIds.indexOf(id);
        if (index !== -1) liveLayerIds.delete(index);
      }

      setMyPresence({ selection: [] }, { addToHistory: true });
    },
    [selection]
  );
}
