"use node";

import { v } from "convex/values";

import { action } from "./_generated/server";

const GEMINI_VISION_MODEL = "gemini-3.8-flash";
const GEMINI_FALLBACK_MODEL = "gemini-3.6-flash";
const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";
const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";
const GROQ_VISION_FALLBACK_MODEL = "qwen/qwen3.6-27b";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

type UpstreamError = Error & { status?: number; retryable?: boolean };

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

/** Tolerates raw JSON, fenced JSON, or JSON embedded in prose. */
function parseJsonFromText(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    return JSON.parse(cleaned);
  }
}

/**
 * Strips LaTeX that renders badly as plain text.
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
  handler: async (
    ctx,
    { storageId }
  ): Promise<{ text: string; latex: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    // Read the image server-side. 
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


export type StepResult = {
  label: string;
  /** Normalised fallback coords. */
  x: number;
  y: number;
  isCorrect: boolean;
  issue: string;
};

export type RecognizeResult = {
  latex: string;
  isCorrect: boolean;
  percentage: number;
  feedback: string;
  steps: StepResult[];
  rateLimited?: boolean;
  retryAfterSeconds?: number;
};


const RECOGNIZE_FALLBACK: RecognizeResult = {
  latex: "",
  isCorrect: true,
  percentage: 0,
  feedback: "",
  steps: [],
};


function normaliseSteps(raw: unknown): StepResult[] {
  if (!Array.isArray(raw)) return [];

  const result: StepResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const step = item as Record<string, unknown>;

    const x = Number(step.x);
    const y = Number(step.y);

    result.push({
      label: typeof step.label === "string" ? step.label : "",
      x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.95,
      y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : 0,
      isCorrect: typeof step.isCorrect === "boolean" ? step.isCorrect : true,
      issue: typeof step.issue === "string" ? step.issue : "",
    });
  }
  return result;
}


const RECOGNIZE_SYSTEM_PROMPT = `You are a patient, encouraging math teacher reviewing a student's handwritten working on a digital whiteboard.

The image shows the math problem and the student's handwritten ink strokes (their working out, written top to bottom). The problem may be printed text or may itself be handwritten.

Your job: identify each distinct STEP the student has written (each separate line of working) and evaluate the work as a coherent whole.

Respond ONLY with a JSON object in this exact shape (no markdown fences, no preamble, no commentary):
{
  "latex": "the student's most recent step as LaTeX (best guess)",
  "isCorrect": true or false,
  "percentage": integer 0-100 reflecting overall progress,
  "feedback": "one short, encouraging sentence of overall feedback",
  "steps": [
    {
      "label": "concise text of this step (e.g. 'When n=1' or '3x + 5 = 14')",
      "isCorrect": true or false,
      "issue": "if incorrect: one short sentence explaining the error. If correct: empty string."
    }
  ]
}

Rules for the "steps" array:
- One entry per distinct line of HANDWRITTEN working. Do NOT include the printed problem itself as a step.
- Order entries strictly top-to-bottom, matching the visual order of the handwritten lines. This ordering is critical \u2014 the marks are placed on each line by position in this array.
- If the student has written nothing handwritten, return an empty steps array.

READ THE WHOLE PAGE FIRST, THEN EVALUATE:
- Before judging any line, read every line top-to-bottom and work out what kind of solution this is and where the student is heading. Common types: solving an equation, an algebraic derivation, or a PROOF (induction, contradiction, direct proof, etc.).
- Evaluate each line IN THE CONTEXT of the lines around it and the overall strategy. A line is correct if it is a sensible part of a valid overall argument, even if it is not a self-contained equation.
- Do not demand that the student start from the beginning or include every intermediate step.

PROOFS (very important \u2014 do not treat proof lines as standalone equations):
- Recognise proof scaffolding and narrative lines and treat them as CORRECT as long as they are reasonable. Examples: "When n=1", "Base case:", "Assume true for n=k", "Inductive hypothesis", "\u2234 true for n=1", "Therefore...", "Let ...", "Suppose ...". These are structure, not equations \u2014 never mark them incorrect for "not being an equation".
- For INDUCTION specifically: the student typically (1) checks a base case, (2) assumes the statement for n=k (inductive hypothesis), (3) proves it for n=k+1. Judge each piece by whether it is a valid part of that structure.
- A correct base-case check (e.g. for "2^n > n": "when n=1, 2^1 = 2 and 2 > 1, so true for n=1") is CORRECT. Mark it correct.
- Only mark a proof line incorrect if it states something mathematically false (e.g. a wrong base-case computation, an invalid algebraic step, or an inductive step that doesn't follow).

Reading the handwriting carefully:
- Handwritten math is messy. Read each line charitably and in the context of the problem and the surrounding lines.
- Watch for easily-confused characters: 7 vs 1, t vs +, x vs \u00d7, 5 vs S, 0 vs O, 2 vs z, n vs h. Use the surrounding context to disambiguate.

When to mark a step INCORRECT (be conservative \u2014 only flag genuine mistakes):
- Mark incorrect ONLY when there is a clear, unambiguous mathematical error (wrong arithmetic, invalid algebra, sign error, a claim that is false, or a step that does not follow).
- BEFORE flagging arithmetic, recompute it yourself from the problem and the preceding line. Only mark the line incorrect if your own recomputation disagrees with what is written. Do not flag a line merely because it skips the intermediate working.
- Rearranging an equation is valid and extremely common: terms moved across the equals sign change sign, and like terms are then combined. For example, from "16 - 2t = 5t + 9" the line "16 - 9 = 5t + 2t" is CORRECT, and so is the resulting "7 = 7t". Verify such a rearrangement by substituting back, not by expecting a particular order of operations.
- Do NOT mark incorrect for: scaffolding/prose lines, skipped steps, starting midway, unconventional but valid approaches, or messy-but-plausible handwriting.
- If you are unsure whether a line is wrong or just hard to read, give the student the benefit of the doubt and mark it CORRECT.
- Never refuse to evaluate later lines because an earlier line looked odd \u2014 assess every line on its own merits within the overall argument.

Completion:
- For equation solving: a correct line that isolates the unknown (e.g. "x = 3") is the final answer.
- For a proof: completion is reaching a valid conclusion (e.g. finishing the inductive step and concluding the statement holds for all n).
- When the work is complete and correct, set the top-level "isCorrect" to true, set "percentage" to 100, and mark that concluding step isCorrect = true.

Guidance for percentage (applies to both solving and proofs):
- 0   = nothing meaningful written yet
- 25  = a correct start is on the page (e.g. base case checked, or first useful step)
- 50  = solidly underway (e.g. inductive hypothesis stated, or halfway through the working)
- 75  = nearly there (e.g. most of the inductive step done, or close to the answer)
- 100 = a complete, correct solution / proof

Even if the handwriting is messy or partial, ALWAYS produce your best guess. Never refuse.`;

export const recognizeMath = action({
  args: {
    imageBase64: v.string(),
    problem: v.optional(v.string()),
  },
  handler: async (ctx, { imageBase64, problem }): Promise<RecognizeResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return RECOGNIZE_FALLBACK;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.warn("[recognizeMath] GROQ_API_KEY is not configured");
      return RECOGNIZE_FALLBACK;
    }

    const buildBody = (model: string) =>
      JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${RECOGNIZE_SYSTEM_PROMPT}\n\nProblem context: ${
                  problem || "(unknown \u2014 infer from the image)"
                }`,
              },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${imageBase64}` },
              },
            ],
          },
        ],
      });

    const call = (model: string) =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: buildBody(model),
      });

    try {
      let response = await call(GROQ_VISION_MODEL);

      // One retry on a different model rather than a backoff loop: this runs
      // per stroke, so a slow retry is worse than a missing mark.
      if (!response.ok && RETRYABLE_STATUS.has(response.status)) {
        console.warn(
          `[recognizeMath] ${GROQ_VISION_MODEL} returned ${response.status}; trying ${GROQ_VISION_FALLBACK_MODEL}`
        );
        response = await call(GROQ_VISION_FALLBACK_MODEL);
      }

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[recognizeMath] groq ${response.status}: ${text.slice(0, 400)}`
        );

        if (RETRYABLE_STATUS.has(response.status)) {
          const headerRetry = response.headers.get("retry-after");
          const bodyMatch = text.match(/try again in ([\d.]+)s/i);
          const retryAfterSeconds = headerRetry
            ? Math.max(1, Math.ceil(Number(headerRetry)))
            : bodyMatch
              ? Math.max(1, Math.ceil(parseFloat(bodyMatch[1])))
              : 30;
          return {
            ...RECOGNIZE_FALLBACK,
            rateLimited: true,
            retryAfterSeconds,
          };
        }

        return RECOGNIZE_FALLBACK;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const text = data.choices?.[0]?.message?.content;
      if (!text) return RECOGNIZE_FALLBACK;

      const parsed = parseJsonFromText(text) as Record<string, unknown>;
      const percentage = Number(parsed.percentage);

      return {
        latex: typeof parsed.latex === "string" ? parsed.latex : "",
        isCorrect:
          typeof parsed.isCorrect === "boolean" ? parsed.isCorrect : true,
        percentage: Number.isFinite(percentage)
          ? Math.max(0, Math.min(100, percentage))
          : 0,
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
        steps: normaliseSteps(parsed.steps),
      };
    } catch (error) {
      console.error("[recognizeMath] unhandled", error);
      return RECOGNIZE_FALLBACK;
    }
  },
});