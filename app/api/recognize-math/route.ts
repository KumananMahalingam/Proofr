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

The image shows the math problem (printed) and the student's handwritten ink strokes (their working out, written top to bottom).

Your job: identify each distinct STEP the student has written (each separate line of working / each equation) and evaluate it.

Respond ONLY with a JSON object in this exact shape (no markdown fences, no preamble, no commentary):
{
  "latex": "the student's most recent step as LaTeX (best guess)",
  "isCorrect": true or false,
  "percentage": integer 0-100 reflecting overall progress,
  "feedback": "one short, encouraging sentence of overall feedback",
  "steps": [
    {
      "label": "concise text of this step (e.g. '3x + 5 = 14')",
      "isCorrect": true or false,
      "issue": "if incorrect: one short sentence explaining the error. If correct: empty string."
    }
  ]
}

Rules for the "steps" array:
- One entry per distinct line of HANDWRITTEN working. Do NOT include the printed problem itself as a step.
- Order entries strictly top-to-bottom, matching the visual order of the handwritten lines. This ordering is critical — the marks are placed on each line by position in this array.
- "isCorrect" reflects whether this specific step is mathematically valid given the previous steps.
- If the student has written nothing handwritten, return an empty steps array.

Reading the handwriting carefully:
- Handwritten math is messy. Read each line charitably and in the context of the problem and the previous lines.
- Watch for easily-confused characters: 7 vs 1, t vs +, x vs ×, 5 vs S, 0 vs O, 2 vs z. Use the surrounding equation to disambiguate.
- If a line is a valid algebraic consequence of the line above it (or of the original problem), it is CORRECT, even if the student skipped intermediate steps or started partway through.

When to mark a step INCORRECT (be conservative — only flag genuine mistakes):
- Mark incorrect ONLY when there is a clear, unambiguous mathematical error (e.g. wrong arithmetic, invalid algebra, sign error).
- Do NOT mark incorrect for: skipped steps, starting midway, unconventional but valid rearrangements, or messy-but-plausible handwriting.
- If you are unsure whether a line is wrong or just hard to read, give the student the benefit of the doubt and mark it CORRECT.

Detecting the final answer:
- A line that isolates the unknown (e.g. "t = 1", "x = 3") is the final answer.
- If that value is correct for the problem, the working is complete: set the top-level "isCorrect" to true and "percentage" to 100, and mark that final-answer step isCorrect = true.

Guidance for percentage:
- 0  = nothing meaningful written yet
- 25 = first useful step is on the page
- 50 = halfway through the working
- 75 = nearly at the answer
- 100 = a correct final answer (e.g. "x = ...") is written

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
