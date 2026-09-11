/**
 * Live step marking: capture the canvas after each stroke, mark it, place ticks.
 *
 * Port of the web `HandwritingOverlay` scheduling logic. All four guards are
 * carried over, because without them every finished stroke fires a request and
 * you are instantly rate-limited:
 *
 *   - 2s debounce, so a burst of strokes (one character is often several) becomes
 *     a single request
 *   - 5s minimum interval between successful calls
 *   - one request in flight at a time; concurrent captures are dropped, not queued
 *   - server-driven backoff honouring `retryAfterSeconds`
 *
 * What changed for mobile: capture is a Skia offscreen render rather than an SVG
 * clone rasterised through a 2D canvas, and it runs after interactions so the
 * encode does not hitch the frame the user is drawing on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { InteractionManager } from "react-native";
import { useAction } from "convex/react";
import type { SkImage } from "@shopify/react-native-skia";

import { api } from "@/convex/_generated/api";
import { captureLayers } from "@/lib/capture-canvas";
import { boundsOf, getPathLineAnchors } from "@/lib/skia-draw";
import type { LayerLookup } from "@/lib/canvas-utils";

const DEBOUNCE_MS = 2000;
const MIN_INTERVAL_MS = 5000;
const CAPTURE_PADDING = 60;

export interface StepMarker {
  id: string;
  x: number;
  y: number;
  isCorrect: boolean;
  label: string;
  issue: string;
}

export interface VerificationState {
  isLoading: boolean;
  isCorrect: boolean;
  percentage: number;
  feedback: string;
}

const INITIAL_STATE: VerificationState = {
  isLoading: false,
  isCorrect: true,
  percentage: 0,
  feedback: "",
};

interface Options {
  /** Increments once per committed stroke. Drives the whole pipeline. */
  strokeTick: number;
  layerIds: readonly string[];
  layers: LayerLookup;
  images: ReadonlyMap<string, SkImage>;
  /** Extracted problem text, used as context for the model. */
  problemText?: string;
}

export function useHandwritingRecognition({
  strokeTick,
  layerIds,
  layers,
  images,
  problemText,
}: Options) {
  const recognizeMath = useAction(api.ai.recognizeMath);

  const [state, setState] = useState<VerificationState>(INITIAL_STATE);
  const [markers, setMarkers] = useState<StepMarker[]>([]);

  // Refs so the scheduling effect depends only on `strokeTick` — panning or
  // re-rendering must not retrigger recognition, but when it does fire it needs
  // the latest layers.
  const latest = useRef({ layerIds, layers, images, problemText });
  useEffect(() => {
    latest.current = { layerIds, layers, images, problemText };
  }, [layerIds, layers, images, problemText]);

  const inFlight = useRef(false);
  const nextAllowedAt = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Tracks unmount only — deliberately NOT "a newer stroke arrived".
   *
   * The first version keyed the scheduling effect on `strokeTick` and set a
   * `cancelled` flag in its cleanup, which meant every new stroke discarded the
   * result of the request already in flight. While the student was actively
   * writing, every response was thrown away and only the one after they stopped
   * was ever applied — so the progress bar sat at 0% and then jumped straight to
   * 100% at the end instead of climbing as the work developed.
   *
   * A late result is still useful: it describes strictly less ink than is on the
   * canvas now, and the next run will supersede it.
   */
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    []
  );

  /** Wipes marks whose positions no longer match the ink (e.g. after erasing). */
  const clearMarks = useCallback(() => {
    setMarkers([]);
    setState((prev) => ({ ...prev, percentage: 0, feedback: "" }));
  }, []);

  // Held in a ref so the scheduler survives across stroke ticks. Reassigned each
  // render so it always closes over the current `recognizeMath`.
  const runRef = useRef<() => Promise<void>>(async () => {});

  runRef.current = async () => {
    {
      if (!mounted.current || inFlight.current) return;

      const wait = Math.max(0, nextAllowedAt.current - Date.now());
      if (wait > 0) {
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        pendingTimer.current = setTimeout(
          () => void runRef.current(),
          wait
        );
        return;
      }

      const { layerIds: ids, layers: map, images: imgs, problemText: problem } =
        latest.current;

      const bounds = boundsOf(ids, map);
      if (!bounds) return;

      // Snapshot anchors at capture time. More strokes may land while the
      // request is in flight, and markers must line up with what the model saw.
      const anchors = getPathLineAnchors(ids, map);

      // Encoding a PNG is synchronous and would hitch the frame if it landed
      // mid-gesture.
      const capture = await new Promise<ReturnType<typeof captureLayers>>(
        (resolve) => {
          InteractionManager.runAfterInteractions(() => {
            resolve(
              captureLayers({
                bounds,
                layerIds: ids,
                layers: map,
                images: imgs,
                padding: CAPTURE_PADDING,
              })
            );
          });
        }
      );

      if (!mounted.current || !capture) return;

      inFlight.current = true;
      nextAllowedAt.current = Date.now() + MIN_INTERVAL_MS;
      setState((prev) => ({ ...prev, isLoading: true }));

      try {
        const result = await recognizeMath({
          imageBase64: capture.base64,
          problem: problem,
        });

        if (!mounted.current) return;

        if (result.rateLimited) {
          const retry = result.retryAfterSeconds ?? 30;
          nextAllowedAt.current = Date.now() + retry * 1000;
          setState((prev) => ({
            ...prev,
            isLoading: false,
            feedback: `Rate limited — retrying in ${retry}s.`,
          }));

          if (pendingTimer.current) clearTimeout(pendingTimer.current);
          pendingTimer.current = setTimeout(
            () => void runRef.current(),
            retry * 1000
          );
          return;
        }

        // Map ordered verdicts onto real line anchors by index. Falls back to the
        // model's normalised coordinates only when there is no matching ink.
        const next: StepMarker[] = result.steps.map((step, index) => {
          const anchor = anchors[index];
          return {
            id: `step-${index}`,
            x: anchor
              ? anchor.rightX
              : capture.bounds.x + step.x * capture.bounds.width,
            y: anchor
              ? anchor.y
              : capture.bounds.y + step.y * capture.bounds.height,
            isCorrect: step.isCorrect,
            label: step.label,
            issue: step.issue,
          };
        });

        setMarkers(next);
        setState({
          isLoading: false,
          isCorrect: result.isCorrect,
          percentage: result.percentage,
          feedback:
            result.feedback ||
            (result.isCorrect
              ? "Looking good — keep going."
              : "Something looks off — keep trying."),
        });
      } catch (error) {
        console.error("[recognition] failed", error);
        if (mounted.current) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            feedback: "Could not analyse handwriting. Try again.",
          }));
        }
      } finally {
        inFlight.current = false;
      }
    }
  };

  // A new stroke only ever restarts the debounce. It never invalidates a request
  // already in flight — see the note on `mounted` above.
  useEffect(() => {
    if (strokeTick <= 0) return;

    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(
      () => void runRef.current(),
      DEBOUNCE_MS
    );
  }, [strokeTick]);

  return { state, markers, clearMarks };
}
