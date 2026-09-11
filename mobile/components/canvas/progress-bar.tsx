/**
 * Progress and feedback readout for live marking.
 */
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";

import type { VerificationState } from "@/hooks/use-handwriting-recognition";

interface ProgressBarProps {
  state: VerificationState;
  topOffset: number;
}

export const ProgressBar = ({ state, topOffset }: ProgressBarProps) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(state.percentage / 100, { duration: 350 });
  }, [state.percentage, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const visible = state.isLoading || state.percentage > 0 || !!state.feedback;
  if (!visible) return null;

  return (
    <View style={[styles.wrapper, { top: topOffset }]} pointerEvents="none">
      <View style={styles.track}>
        <Animated.View
          style={[
            fillStyle,
            styles.fill,
            { backgroundColor: state.isCorrect ? "#22c55e" : "#ef4444" },
          ]}
        />
      </View>

      <View style={styles.row}>
        {state.isLoading && (
          <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
        )}
        <Text style={styles.feedback} numberOfLines={2}>
          {state.isLoading ? "Checking your working..." : state.feedback}
        </Text>
        {!state.isLoading && state.percentage > 0 && (
          <Text style={styles.percent}>{state.percentage}%</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: "rgba(18,18,31,0.94)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 10,
    gap: 8,
  },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  feedback: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12 },
  percent: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
