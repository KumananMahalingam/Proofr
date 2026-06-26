import { NextResponse } from "next/server";

interface StepResult {
  label: string;
  x: number;
  y: number;
  isCorrect: boolean;
  issue: string;
}

interface RecognizeResult {
  latex: string;
  isCorrect: boolean;
  percentage: number;
  feedback: string;
  steps: StepResult[];
}

const FALLBACK: RecognizeResult = {
  latex: "",
  isCorrect: true,
  percentage: 0,
  feedback: "",
  steps: [],
};

const parseJson = (raw: string): unknown => {
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
};

const normaliseSteps = (raw: unknown): StepResult[] => {
  if (!Array.isArray(raw)) return [];
  const result: StepResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const yNum = Number(s.y);
    const xNum = Number(s.x);
    // Keep every step, even if the model omits coordinates: the client now
    // positions markers geometrically from the actual strokes, using these
    // coords only as a fallback. Default x to the right edge (0.95) and y to
    // the top (0) when missing.
    result.push({
      label: typeof s.label === "string" ? s.label : "",
      x: Number.isFinite(xNum) ? Math.max(0, Math.min(1, xNum)) : 0.95,
      y: Number.isFinite(yNum) ? Math.max(0, Math.min(1, yNum)) : 0,
      isCorrect: typeof s.isCorrect === "boolean" ? s.isCorrect : true,
      issue: typeof s.issue === "string" ? s.issue : "",
    });
  }
  return result;
};

const SYSTEM_PROMPT = `You are a patient, encouraging math teacher reviewing a student's handwritten working on a digital whiteboard.

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
- Order entries strictly top-to-bottom, matching the visual order of the handwritten lines. This ordering is critical — the marks are placed on each line by position in this array.
- If the student has written nothing handwritten, return an empty steps array.

READ THE WHOLE PAGE FIRST, THEN EVALUATE:
- Before judging any line, read every line top-to-bottom and work out what kind of solution this is and where the student is heading. Common types: solving an equation, an algebraic derivation, or a PROOF (induction, contradiction, direct proof, etc.).
- Evaluate each line IN THE CONTEXT of the lines around it and the overall strategy. A line is correct if it is a sensible part of a valid overall argument, even if it is not a self-contained equation.
- Do not demand that the student start from the beginning or include every intermediate step.

PROOFS (very important — do not treat proof lines as standalone equations):
- Recognise proof scaffolding and narrative lines and treat them as CORRECT as long as they are reasonable. Examples: "When n=1", "Base case:", "Assume true for n=k", "Inductive hypothesis", "∴ true for n=1", "Therefore...", "Let ...", "Suppose ...". These are structure, not equations — never mark them incorrect for "not being an equation".
- For INDUCTION specifically: the student typically (1) checks a base case, (2) assumes the statement for n=k (inductive hypothesis), (3) proves it for n=k+1. Judge each piece by whether it is a valid part of that structure.
- A correct base-case check (e.g. for "2^n > n": "when n=1, 2^1 = 2 and 2 > 1, so true for n=1") is CORRECT. Mark it correct.
- Only mark a proof line incorrect if it states something mathematically false (e.g. a wrong base-case computation, an invalid algebraic step, or an inductive step that doesn't follow).

Reading the handwriting carefully:
- Handwritten math is messy. Read each line charitably and in the context of the problem and the surrounding lines.
- Watch for easily-confused characters: 7 vs 1, t vs +, x vs ×, 5 vs S, 0 vs O, 2 vs z, n vs h. Use the surrounding context to disambiguate.

When to mark a step INCORRECT (be conservative — only flag genuine mistakes):
- Mark incorrect ONLY when there is a clear, unambiguous mathematical error (wrong arithmetic, invalid algebra, sign error, a claim that is false, or a step that does not follow).
- Do NOT mark incorrect for: scaffolding/prose lines, skipped steps, starting midway, unconventional but valid approaches, or messy-but-plausible handwriting.
- If you are unsure whether a line is wrong or just hard to read, give the student the benefit of the doubt and mark it CORRECT.
- Never refuse to evaluate later lines because an earlier line looked odd — assess every line on its own merits within the overall argument.

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

export async function POST(request: Request) {
  try {
    const { imageBase64, problem } = (await request.json()) as {
      imageBase64?: string;
      problem?: string;
    };

    if (!imageBase64) {
      console.warn("[recognize-math] missing imageBase64");
      return NextResponse.json(FALLBACK);
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.warn("[recognize-math] missing GROQ_API_KEY");
      return NextResponse.json(FALLBACK);
    }

    console.log(
      `[recognize-math] calling groq llama-4-scout, image bytes=${imageBase64.length}, problem="${problem?.slice(0, 80) ?? ""}"`
    );

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          temperature: 0.2,
          max_tokens: 1024,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `${SYSTEM_PROMPT}\n\nProblem context: ${
                    problem || "(unknown — infer from the image)"
                  }`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      console.error(
        `[recognize-math] groq ${response.status}: ${body.slice(0, 500)}`
      );

      if (response.status === 429) {
        const headerRetry = response.headers.get("retry-after");
        const bodyMatch = body.match(/try again in ([\d.]+)s/i);
        const retryAfterSeconds = headerRetry
          ? Math.ceil(Number(headerRetry))
          : bodyMatch
            ? Math.ceil(parseFloat(bodyMatch[1]))
            : 30;
        return NextResponse.json(
          { ...FALLBACK, rateLimited: true, retryAfterSeconds },
          { status: 429 }
        );
      }

      return NextResponse.json(FALLBACK);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    console.log("[recognize-math] groq raw text:", text);

    if (!text) {
      return NextResponse.json(FALLBACK);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseJson(text) as Record<string, unknown>;
    } catch (e) {
      console.error("[recognize-math] could not parse groq response", e);
      return NextResponse.json(FALLBACK);
    }

    const result: RecognizeResult = {
      latex: typeof parsed.latex === "string" ? parsed.latex : "",
      isCorrect:
        typeof parsed.isCorrect === "boolean" ? parsed.isCorrect : true,
      percentage: Number.isFinite(Number(parsed.percentage))
        ? Math.max(0, Math.min(100, Number(parsed.percentage)))
        : 0,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      steps: normaliseSteps(parsed.steps),
    };
    console.log(
      `[recognize-math] returning percentage=${result.percentage}, steps=${result.steps.length}`
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error("[recognize-math] unhandled error", e);
    return NextResponse.json(FALLBACK);
  }
}
