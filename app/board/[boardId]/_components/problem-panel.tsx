"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lightbulb,
  Lock,
  Loader2,
  Sparkles,
  Variable,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "./progress-bar";

export type ProblemAnalysis = {
  topic: string;
  concepts: string[];
  hints: [string, string, string];
  solution: {
    steps: Array<{
      step: number;
      explanation: string;
      working: string;
    }>;
    finalAnswer: string;
  };
};

interface ProblemPanelProps {
  activeProblemSrc: string | null;
  verificationPercentage: number;
  verificationIsCorrect: boolean;
  verificationFeedback: string;
  verificationIsLoading: boolean;
}

export const ProblemPanel = ({
  activeProblemSrc,
  verificationPercentage,
  verificationIsCorrect,
  verificationFeedback,
  verificationIsLoading,
}: ProblemPanelProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [hintsExpanded, setHintsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latex, setLatex] = useState("");
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState<ProblemAnalysis | null>(null);
  const [revealedHints, setRevealedHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  useEffect(() => {
    setError(null);
    setIsLoading(false);
    setLatex("");
    setText("");
    setAnalysis(null);
    setRevealedHints(0);
    setShowSolution(false);
  }, [activeProblemSrc]);

  const canAnalyse = Boolean(activeProblemSrc) && !isLoading;
  const hintsLocked = !analysis;
  const solutionLocked = !analysis;

  const conceptList = useMemo(() => analysis?.concepts ?? [], [analysis]);

  const runAnalysis = async () => {
    if (!activeProblemSrc) {
      setError("Select a problem image layer first.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const extractResponse = await fetch("/api/extract-math", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: activeProblemSrc }),
      });

      const extractData = (await extractResponse.json()) as {
        latex?: string;
        text?: string;
        error?: string;
      };

      if (!extractResponse.ok) {
        throw new Error(extractData.error ?? "Failed to extract problem");
      }

      const extractedLatex = extractData.latex ?? "";
      const extractedText = extractData.text ?? "";
      setLatex(extractedLatex);
      setText(extractedText);

      const analyseResponse = await fetch("/api/analyse-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latex: extractedLatex,
          text: extractedText,
        }),
      });

      const analyseData = (await analyseResponse.json()) as ProblemAnalysis & { error?: string };
      if (!analyseResponse.ok) {
        throw new Error(analyseData.error ?? "Failed to analyse problem");
      }

      setAnalysis(analyseData);
      setRevealedHints(0);
      setShowSolution(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      setError(message);
      setAnalysis(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside
      className={`fixed top-0 right-0 h-screen z-50 transition-all duration-200 ${
        collapsed ? "w-10" : "w-[380px]"
      }`}
    >
      <div className={`relative h-full ${collapsed ? "pointer-events-none" : ""}`}>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="pointer-events-auto absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 h-12 w-10 rounded-l-lg border border-r-0 border-white/10 bg-neutral-800 text-white/60 shadow-sm flex items-center justify-center hover:text-white"
          aria-label={collapsed ? "Expand panel" : "Collapse panel"}
        >
          {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {collapsed ? (
          <div className="pointer-events-auto h-full w-10 bg-neutral-900 border-l border-white/10 shadow-xl flex items-center justify-center">
            <span className="text-xs font-medium text-white/50 [writing-mode:vertical-rl] rotate-180 tracking-wide">
              Problem Analysis
            </span>
          </div>
        ) : (
          <div className="h-full bg-neutral-900 border-l border-white/10 shadow-xl overflow-y-auto">
            <div className="p-5 border-b border-white/10">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-blue-500/20 border border-blue-500/30 p-2">
                  <Calculator className="h-4 w-4 text-blue-400" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-white">Problem Analysis</h2>
                  <p className="text-sm text-white/50 mt-1">
                    Select an image layer, then run extraction and analysis.
                  </p>
                </div>
              </div>
            </div>

            <section className="p-5 border-b border-white/10">
                <ProgressBar
                    percentage={verificationPercentage}
                    isCorrect={verificationIsCorrect}
                    feedback={verificationFeedback}
                    isLoading={verificationIsLoading}
                />
            </section>


            <section className="p-5 border-b border-white/10">
              <div className="flex items-center gap-2 mb-3">
                <Variable className="h-4 w-4 text-white/40" />
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider">Problem</h3>
              </div>

              {latex ? (
                <pre className="bg-white/5 border border-white/10 rounded-xl p-4 text-white font-mono text-sm whitespace-pre-wrap break-words">
                  {latex}
                </pre>
              ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-white/30 font-mono text-sm whitespace-pre-wrap break-words">
                  {activeProblemSrc
                    ? "No extracted problem yet."
                    : "Select an image layer to analyse."}
                </div>
              )}

              {error && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 space-y-2">
                  <p>{error}</p>
                  <Button
                    size="sm"
                    className="rounded"
                    onClick={runAnalysis}
                    disabled={!canAnalyse}
                  >
                    Retry
                  </Button>
                </div>
              )}

              <Button
                onClick={runAnalysis}
                disabled={!canAnalyse}
                className="w-full mt-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl h-11"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isLoading ? "Analyzing..." : "Analyse Problem"}
              </Button>
            </section>

            <section className={`p-5 border-b border-white/10 ${hintsLocked ? "opacity-40 pointer-events-none" : ""}`}>
              <button
                type="button"
                onClick={() => setHintsExpanded((prev) => !prev)}
                className="flex items-center justify-between w-full mb-4 text-white hover:bg-white/5 rounded-lg px-1 py-1"
              >
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-400" />
                  <h3 className="text-sm font-medium text-white">Hints</h3>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-white/40 transition-transform duration-200 ${hintsExpanded ? "rotate-180" : ""}`}
                />
              </button>

              {hintsExpanded && (
                <>
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <BookOpen className="h-3.5 w-3.5 text-white/40" />
                      <p className="text-xs uppercase tracking-wider text-white/40">Topic</p>
                    </div>
                    <p className="text-sm font-semibold text-white mb-2">{analysis?.topic || "-"}</p>
                    <div className="flex flex-wrap gap-2">
                      {conceptList.length > 0 ? conceptList.map((concept) => (
                        <Badge
                          key={concept}
                          variant="secondary"
                          className="bg-white/10 text-white/70 border-0 rounded-full px-3 py-1 text-xs"
                        >
                          {concept}
                        </Badge>
                      )) : (
                        <span className="text-xs text-muted-foreground">No concepts yet</span>
                      )}
                    </div>
                  </div>
                </>
              )}

              {hintsExpanded && (
                <div className="space-y-2 mt-4">
                  {[0, 1, 2].map((index) => {
                const hintNumber = index + 1;
                const canReveal = revealedHints === index;
                const visible = revealedHints > index;

                return (
                  <div
                    key={hintNumber}
                    className={`rounded-lg border transition-all duration-200 ${
                      visible
                        ? "bg-yellow-500/10 border-yellow-500/20 rounded-xl"
                        : "bg-white/5 border border-white/10 rounded-xl"
                    } ${
                      !visible && !canReveal ? "opacity-40 pointer-events-none" : ""
                    }`}
                  >
                    {visible ? (
                      <div className="flex items-start gap-3 p-4">
                        <span className="p-1.5 rounded-md bg-yellow-500/20">
                          <Check className="h-3 w-3 text-yellow-400" />
                        </span>
                        <div>
                          <p className="text-xs font-medium text-yellow-400 mb-1">Hint {hintNumber}</p>
                          <p className="text-sm text-white/90 leading-relaxed">{analysis?.hints[index]}</p>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!canReveal}
                        onClick={() => setRevealedHints((prev) => prev + 1)}
                        className="w-full p-4 flex items-center justify-between group text-white/60 hover:text-white text-sm"
                      >
                        <span className="text-sm font-medium">
                          Reveal Hint {hintNumber}
                        </span>
                        {canReveal ? (
                          <Eye className="h-3.5 w-3.5 text-white/40" />
                        ) : (
                          <Lock className="h-3.5 w-3.5 text-white/40" />
                        )}
                      </button>
                    )}
                  </div>
                );
                  })}
                </div>
              )}
            </section>

            <section className={`p-5 ${solutionLocked ? "opacity-40 pointer-events-none" : ""}`}>
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-white/40" />
                <h3 className="text-xs uppercase tracking-wider text-white/40">Solution</h3>
              </div>

              {!showSolution ? (
                <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-4 mt-3">
                  <div className="flex items-start gap-3">
                    <span className="p-1.5 rounded-md bg-yellow-500/20">
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                    </span>
                    <div className="flex-1">
                      <p className="text-yellow-200/80 text-sm leading-relaxed mb-3">
                        Showing the solution will reduce your learning. Are you sure?
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border border-white/20 text-white/70 hover:bg-white/10 rounded-lg"
                        onClick={() => setShowSolution(true)}
                      >
                        <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                        Show Solution Anyway
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-4 mt-3">
                  <div className="flex items-start gap-3 mb-3">
                    <span className="p-1.5 rounded-md bg-green-500/20">
                      <Check className="h-3.5 w-3.5 text-green-400" />
                    </span>
                    <div>
                      <p className="text-green-400 text-xs font-medium">Answer</p>
                      <p className="text-green-300 text-lg font-mono font-semibold">
                        {analysis?.solution.finalAnswer}
                      </p>
                    </div>
                  </div>

                  {analysis?.solution.steps.map((step) => (
                    <div key={step.step} className="rounded-lg border border-white/10 p-3 mt-2 space-y-1 bg-white/5">
                      <span className="inline-flex bg-white/10 text-white/80 text-xs rounded-md px-2 py-0.5 font-medium">
                        Step {step.step}
                      </span>
                      <p className="text-sm text-white/90">{step.explanation}</p>
                      <pre className="bg-white/5 border border-white/10 rounded p-2 text-xs font-mono text-white/90 whitespace-pre-wrap break-words">
                        {step.working}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
};
