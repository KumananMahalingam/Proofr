"use node";

/**
 * Replaces `app/api/extract-math/route.ts` and `app/api/analyse-problem/route.ts`.
 *
 * Expo has no server, so these move into Convex actions. API keys stay on the
 * Convex deployment and never reach the device — the same reason the web version
 * kept them in route handlers rather than the browser.
 *
 * One deliberate improvement over the web version: `extractMath` takes a Convex
 * storage id and reads the image server-side. The web route accepted a base64
 * data URL in the request body, which meant the whole image travelled browser ->
 * server on every call. Since mobile already uploads to Convex storage, the bytes
 * are on the backend before analysis starts.
 *
 * The per-task model split is carried over from the web app, because each step
 * has genuinely different requirements:
 *   extractMath     -> Gemini 3.8 Flash        (vision OCR of printed math)
 *   analyseProblem  -> gpt-oss-120b on Groq    (text reasoning, no vision needed)
 *
 * Required Convex environment variables:
 *   npx convex env set GEMINI_API_KEY <key>
 *   npx convex env set GROQ_API_KEY   <key>
 */
import { v } from "convex/values";

import { action } from "./_generated/server";

/**
 * Model IDs, kept together so they are easy to review and bump.
 *
 * `GEMINI_VISION_MODEL` is upgraded from the web app's `gemini-2.5-flash`.
 *
 * `GROQ_TEXT_MODEL` replaces `llama-3.3-70b-versatile`, which Groq deprecated in
 * June 2026 and shut down for free and developer tiers in August 2026 — so the
 * ported route would have been calling a dead model.
 *
 * Important for the marking pipeline that is still to be ported: `gpt-oss-120b`
 * is TEXT ONLY. It cannot replace Llama 4 Scout in `recognize-math` or
 * `mark-working`, both of which send canvas screenshots. Those need a vision
 * model — see the note at the bottom of this file.
 */
const GEMINI_VISION_MODEL = "gemini-3.8-flash";

/**
 * Used only when the primary model returns a retryable error.
 *
 * `gemini-3.8-flash` is the newest Flash model and returns 503 UNAVAILABLE
 * ("experiencing high demand") under load. A slightly older GA model is usually
 * available when the newest one is saturated, and for OCR of printed math the
 * accuracy difference is small — far smaller than the difference between a result
 * and an error.
 */
const GEMINI_FALLBACK_MODEL = "gemini-3.6-flash";

const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";

/** Upstream statuses worth retrying: rate limits and transient server errors. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

type UpstreamError = Error & { status?: number; retryable?: boolean };

/**
 * POST with exponential backoff on retryable statuses.
 *
 * Kept deliberately small — Convex actions have a wall-clock budget, and the user
 * is staring at a spinner, so this is a few hundred milliseconds of patience
 * rather than a serious retry policy.
 */
async function postWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;

    lastStatus = response.status;
    lastBody = await response.text();

    if (!RETRYABLE_STATUS.has(response.status)) break;

    if (attempt < attempts - 1) {
      const backoff = 400 * 2 ** attempt + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  const error: UpstreamError = new Error(
    describeUpstreamFailure(lastStatus, lastBody)
  );
  error.status = lastStatus;
  error.retryable = RETRYABLE_STATUS.has(lastStatus);
  throw error;
}

/**
 * Turns a provider error body into something worth showing a student.
 *
 * The raw body is a wall of JSON; the panel renders `error.message` directly, so
 * dumping it there is useless to the person holding the phone.
 */
function describeUpstreamFailure(status: number, body: string): string {
  if (status === 429) {
    return "Rate limited by the AI provider. Wait a few seconds and try again.";
  }
  if (status === 503 || status === 502 || status === 504) {
    return "The AI model is busy right now. Try again in a few seconds.";
  }
  if (status === 401 || status === 403) {
    return "AI provider rejected the API key. Check the Convex environment variables.";
  }

  // Surface the provider message when there is one, but keep it short.
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Body was not JSON; fall through.
  }

  return `AI request failed (${status}).`;
}

/** Models sometimes wrap JSON in a markdown fence despite instructions not to. */
function parseJsonLoose<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(cleaned) as T;
}

/**
 * Strips LaTeX that renders badly as plain text. Carried over verbatim from the
 * web route — the extracted string is displayed in a monospace block, not
 * typeset, so table rules and environments are noise.
 */
function cleanLatex(latex: string): string {
  return latex
    .replace(/\\rule\{[^}]*\}\{[^}]*\}/g, "")
    .replace(/\\hline/g, "")
    .replace(/\\\\/g, "")
    .replace(/\\begin\{[^}]*\}/g, "")
    .replace(/\\end\{[^}]*\}/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\$/g, "")
    .trim();
}

export const extractMath = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<{ text: string; latex: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("Image not found in storage");

    const mimeType = blob.type || "image/jpeg";
    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            {
              text:
                "Extract the math problem from this image exactly as written. " +
                "Return only the math problem as plain text and in LaTeX format. " +
                "Format your response as JSON with this structure: " +
                "{ text: string, latex: string }. " +
                "Return only valid JSON, no markdown, no preamble.",
            },
          ],
        },
      ],
    });

    const callGemini = (model: string) =>
      postWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        }
      );

    let response: Response;
    try {
      response = await callGemini(GEMINI_VISION_MODEL);
    } catch (error) {
      // Only fall back for transient failures. A bad key or malformed request
      // will fail identically on the secondary model, so retrying there just
      // doubles the latency before showing the same error.
      const upstream = error as UpstreamError;
      if (!upstream.retryable) throw error;

      console.warn(
        `[extractMath] ${GEMINI_VISION_MODEL} unavailable (${upstream.status}); falling back to ${GEMINI_FALLBACK_MODEL}`
      );
      response = await callGemini(GEMINI_FALLBACK_MODEL);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("Gemini returned no extractable content");

    const parsed = parseJsonLoose<{ text?: string; latex?: string }>(raw);

    return {
      latex: cleanLatex(parsed.latex ?? ""),
      text: parsed.text ?? "",
    };
  },
});

export type ProblemAnalysis = {
  topic: string;
  concepts: string[];
  hints: [string, string, string];
  solution: {
    steps: Array<{ step: number; explanation: string; working: string }>;
    finalAnswer: string;
  };
};

const ANALYSE_SYSTEM_PROMPT = `You are an expert math tutor. You will be given a math problem. Your job is to:
1. Identify the topic and concepts involved
2. Provide 3 progressive hints that guide the student without giving away the answer. Each hint should be more specific than the last.
3. Provide a full worked solution with each step clearly explained.

Format your response as JSON with this exact structure:
{
  topic: string,
  concepts: string[],
  hints: [string, string, string],
  solution: {
    steps: [{ step: number, explanation: string, working: string }],
    finalAnswer: string
  }
}
Return only valid JSON, no markdown, no preamble.`;

export const analyseProblem = action({
  args: {
    latex: v.optional(v.string()),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { latex = "", text = "" }): Promise<ProblemAnalysis> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    if (!latex && !text) throw new Error("Missing latex/text payload");

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

    const response = await postWithRetry(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_TEXT_MODEL,
          messages: [
            { role: "system", content: ANALYSE_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify({ latex, text }) },
          ],
        }),
      }
    );

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned no analysis content");

    return parseJsonLoose<ProblemAnalysis>(content);
  },
});

/*
 * ---------------------------------------------------------------------------
 * TODO (marking pipeline): recognizeMath + markWorking
 * ---------------------------------------------------------------------------
 * These two are not ported yet, and the model choice is now an open decision
 * rather than a straight copy.
 *
 * The web app used Llama 4 Scout on Groq for both, deliberately: `recognize-math`
 * fires after every stroke, so Groq's latency mattered more than peak accuracy.
 * That reasoning does not survive the model landscape changing:
 *
 *   - `openai/gpt-oss-120b` cannot be used here. It is text only, and both of
 *     these routes send a PNG of the canvas.
 *   - Groq's vision options have thinned considerably.
 *
 * Realistic options, in rough order of preference:
 *
 *   1. Gemini Flash-Lite for `recognize-math` and Gemini 3.8 Flash for
 *      `mark-working`. Keeps the fast/deliberate split that made the web
 *      pipeline work, at the cost of moving off Groq and losing some latency.
 *   2. Gemini 3.8 Flash for both. Simplest, but the per-stroke path becomes
 *      slower and more expensive; the existing 2s debounce, 5s minimum interval
 *      and single-in-flight guard become load-bearing rather than protective.
 *   3. Whatever vision model Groq currently offers, if latency turns out to
 *      dominate accuracy in practice on phone-sized finger handwriting.
 *
 * Worth deciding only after measuring how legible fingertip handwriting actually
 * is through `lib/capture-canvas.ts` — if accuracy is the binding constraint,
 * option 1 or 2 wins regardless of latency.
 */
