/**
 * Problem analysis: extract the problem, then reveal hints and solution.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAction } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProblemAnalysis } from "@/convex/ai";

interface ProblemPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Storage id of the selected image layer, or null if none is selected. */
  activeStorageId: string | null;
  /**
   * Reports the extracted problem so the marking pipeline can use it as context.
   */
  onProblemExtracted?: (text: string) => void;
}

export const ProblemPanel = ({
  visible,
  onClose,
  activeStorageId,
  onProblemExtracted,
}: ProblemPanelProps) => {
  const insets = useSafeAreaInsets();

  const extractMath = useAction(api.ai.extractMath);
  const analyseProblem = useAction(api.ai.analyseProblem);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latex, setLatex] = useState("");
  const [analysis, setAnalysis] = useState<ProblemAnalysis | null>(null);
  const [revealedHints, setRevealedHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  // Reset everything when the selected problem changes.
  useEffect(() => {
    setError(null);
    setLoading(false);
    setLatex("");
    setAnalysis(null);
    setRevealedHints(0);
    setShowSolution(false);
  }, [activeStorageId]);

  const run = async () => {
    if (!activeStorageId || loading) return;

    setLoading(true);
    setError(null);

    try {
      const extracted = await extractMath({
        storageId: activeStorageId as Id<"_storage">,
      });
      const problemText = extracted.text || extracted.latex;
      setLatex(extracted.latex || extracted.text);
      if (problemText) onProblemExtracted?.(problemText);

      const result = await analyseProblem({
        latex: extracted.latex,
        text: extracted.text,
      });

      setAnalysis(result);
      setRevealedHints(0);
      setShowSolution(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            <MaterialCommunityIcons
              name="calculator-variant-outline"
              size={18}
              color="#60a5fa"
            />
            <Text style={styles.headerTitle}>Problem Analysis</Text>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={20} color="#fff" />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            <Section label="Problem">
              <View style={styles.codeBlock}>
                <Text style={latex ? styles.code : styles.codeMuted}>
                  {latex ||
                    (activeStorageId
                      ? "Not extracted yet."
                      : "Select a problem image on the canvas first.")}
                </Text>
              </View>

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                onPress={run}
                disabled={!activeStorageId || loading}
                style={[
                  styles.primaryButton,
                  (!activeStorageId || loading) && styles.disabled,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Analyse problem</Text>
                )}
              </Pressable>
            </Section>

            {analysis && (
              <>
                <Section label="Topic">
                  <Text style={styles.topic}>{analysis.topic}</Text>
                  <View style={styles.badgeRow}>
                    {analysis.concepts.map((concept) => (
                      <View key={concept} style={styles.badge}>
                        <Text style={styles.badgeText}>{concept}</Text>
                      </View>
                    ))}
                  </View>
                </Section>

                <Section label="Hints">
                  {[0, 1, 2].map((index) => {
                    const visibleHint = revealedHints > index;
                    const canReveal = revealedHints === index;

                    if (visibleHint) {
                      return (
                        <View key={index} style={styles.hintRevealed}>
                          <Text style={styles.hintLabel}>Hint {index + 1}</Text>
                          <Text style={styles.hintText}>
                            {analysis.hints[index]}
                          </Text>
                        </View>
                      );
                    }

                    return (
                      <Pressable
                        key={index}
                        disabled={!canReveal}
                        onPress={() => setRevealedHints((n) => n + 1)}
                        style={[
                          styles.hintLocked,
                          !canReveal && styles.disabled,
                        ]}
                      >
                        <Text style={styles.hintLockedText}>
                          Reveal hint {index + 1}
                        </Text>
                        <MaterialCommunityIcons
                          name={canReveal ? "eye-outline" : "lock-outline"}
                          size={16}
                          color="rgba(255,255,255,0.4)"
                        />
                      </Pressable>
                    );
                  })}
                </Section>

                <Section label="Solution">
                  {!showSolution ? (
                    <View style={styles.warningBox}>
                      <Text style={styles.warningText}>
                        Showing the solution will reduce your learning. Are you
                        sure?
                      </Text>
                      <Pressable
                        onPress={() => setShowSolution(true)}
                        style={styles.outlineButton}
                      >
                        <Text style={styles.outlineButtonText}>
                          Show solution anyway
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.solutionBox}>
                      <Text style={styles.answerLabel}>Answer</Text>
                      <Text style={styles.answerValue}>
                        {analysis.solution.finalAnswer}
                      </Text>

                      {analysis.solution.steps.map((step) => (
                        <View key={step.step} style={styles.stepBox}>
                          <Text style={styles.stepBadge}>Step {step.step}</Text>
                          <Text style={styles.stepText}>
                            {step.explanation}
                          </Text>
                          <View style={styles.codeBlock}>
                            <Text style={styles.code}>{step.working}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </Section>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const Section = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  backdropFill: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    maxHeight: "82%",
    backgroundColor: "#12121f",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 18,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginTop: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
  },
  headerTitle: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "700" },
  closeButton: { padding: 4 },
  scroll: { paddingBottom: 20, gap: 20 },
  section: { gap: 8 },
  sectionLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  codeBlock: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: 12,
  },
  code: { color: "#fff", fontFamily: "monospace", fontSize: 13 },
  codeMuted: {
    color: "rgba(255,255,255,0.3)",
    fontFamily: "monospace",
    fontSize: 13,
  },
  error: { color: "#f87171", fontSize: 12 },
  primaryButton: {
    backgroundColor: "#3b82f6",
    borderRadius: 11,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.45 },
  topic: { color: "#fff", fontSize: 15, fontWeight: "700" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: "rgba(255,255,255,0.75)", fontSize: 11 },
  hintRevealed: {
    backgroundColor: "rgba(250,204,21,0.1)",
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.25)",
    borderRadius: 11,
    padding: 12,
    gap: 4,
  },
  hintLabel: { color: "#facc15", fontSize: 11, fontWeight: "700" },
  hintText: { color: "rgba(255,255,255,0.9)", fontSize: 13, lineHeight: 19 },
  hintLocked: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 11,
    padding: 14,
  },
  hintLockedText: { color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  warningBox: {
    backgroundColor: "rgba(250,204,21,0.1)",
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.25)",
    borderRadius: 11,
    padding: 14,
    gap: 10,
  },
  warningText: { color: "rgba(254,240,138,0.9)", fontSize: 13, lineHeight: 19 },
  outlineButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: "center",
  },
  outlineButtonText: { color: "rgba(255,255,255,0.75)", fontWeight: "600" },
  solutionBox: {
    backgroundColor: "rgba(34,197,94,0.08)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.22)",
    borderRadius: 11,
    padding: 14,
    gap: 10,
  },
  answerLabel: { color: "#4ade80", fontSize: 11, fontWeight: "700" },
  answerValue: {
    color: "#86efac",
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  stepBox: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 9,
    padding: 10,
    gap: 6,
  },
  stepBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "600",
    overflow: "hidden",
  },
  stepText: { color: "rgba(255,255,255,0.9)", fontSize: 13, lineHeight: 19 },
});
