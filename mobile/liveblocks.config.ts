/**
 * Liveblocks presence + storage types.
 *
 * Near-verbatim from the web `liveblocks.config.ts` — the package is the same
 * (`@liveblocks/react`), the hooks are the same, and `LiveMap` / `LiveList` /
 * `LiveObject` behave identically under React Native. There is no separate
 * React Native package to install.
 *
 * The one change: `pencilDraft` is `StrokePoint[]` (`[x, y]`) rather than
 * `[x, y, pressure][]`. Pressure was a constant for finger input, and this is
 * the highest-frequency message the app sends — it goes out roughly 20x/second
 * for every actively drawing user in the room, so a third fewer numbers per
 * point is worth having.
 */
import { LiveList, LiveMap, LiveObject } from "@liveblocks/client";

import type { Color, Layer, StrokePoint } from "@/types/canvas";

export {
  RoomProvider,
  useMutation,
  useSelf,
  useStorage,
  useHistory,
  useCanUndo,
  useCanRedo,
  useOthers,
  useOther,
  useOthersMapped,
  useOthersConnectionIds,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";

declare global {
  interface Liveblocks {
    Presence: {
      cursor: { x: number; y: number } | null;
      selection: string[];
      pencilDraft: StrokePoint[] | null;
      penColor: Color | null;
    };

    Storage: {
      layers: LiveMap<string, LiveObject<Layer>>;
      layerIds: LiveList<string>;
    };

    UserMeta: {
      id: string;
      info: {
        name: string;
        picture: string;
      };
    };

    RoomEvent: {};
    ThreadMetadata: {};
    RoomInfo: {};
  }
}

export {};
