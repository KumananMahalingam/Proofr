import { NextResponse } from "next/server";

interface SolutionStep {
  step: number;
  explanation: string;
  working: string;
}

interface MarkRequestBody {
  workingImageSrc?: string;
  solutionSteps?: SolutionStep[];
  finalAnswer?: string;
  problemText?: string;
}

interface MarkedLine {
  lineNumber: number;
  content: string;
  yPositionPercent: number;
  correct: boolean;
  explanation: string | null;
}

const SYSTEM_PROMPT = `You are an expert math examiner marking a student's handwritten working. The student may begin their working from any step — they are not required to start from the beginning of the solution. They may also skip steps they consider obvious. Do not penalise missing steps.

Your job is to:
1. Read each line of the student's handwritten working from top to bottom
2. Check each line purely for mathematical correctness
3. A line is CORRECT if it is a valid mathematical statement that is consistent with the problem and moves toward the correct answer
4. A line is INCORRECT only if it contains a genuine mathematical error such as wrong arithmetic, invalid algebra, or an incorrect statement
5. Do not mark a line as incorrect just because it skips steps or starts partway through the solution

For each line you can read, estimate its vertical position as a percentage from the top of the image (0 = top, 100 = bottom).

Return ONLY a JSON array with this exact structure, no markdown, no preamble:
[
  {
    "lineNumber": number,
    "content": string,
    "yPositionPercent": number,
    "correct": boolean,
    "explanation": string | null
  }
]

Where:
- content is what you read on that line
- yPositionPercent is your estimate of vertical position (0-100)
- correct is true if the line is mathematically valid
- explanation is null if correct, or a brief explanation of the specific mathematical error if incorrect`;

const buildUserText = (
  problemText: string,
  solutionSteps: SolutionStep[],
  finalAnswer: string
) => {
  const stepsBlock = solutionSteps
    .map((s) => `Step ${s.step}: ${s.working}`)
    .join("\n");

  return `Here is the student's handwritten working. Mark only what is written — do not penalise skipped or missing steps.

Problem: ${problemText}

Correct solution for reference (student may start from any point in this):
${stepsBlock}

Final answer: ${finalAnswer}

Please mark each line of the student's working for mathematical correctness only.`;
};

const stripFences = (raw: string) =>
  raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

// The model is told to return a JSON array, but we accept either a bare
// array or an object that wraps an array under common keys, since vision
// models occasionally do that.
const parseMarkedLines = (raw: string): MarkedLine[] => {
  const cleaned = stripFences(raw);

  const tryParse = (input: string): unknown => {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  };

  let parsed: unknown = tryParse(cleaned);

  if (parsed == null) {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) parsed = tryParse(arrayMatch[0]);
  }

  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["lines", "results", "data", "marks"]) {
      if (Array.isArray(obj[key])) {
        parsed = obj[key];
        break;
      }
    }
  }

  if (!Array.isArray(parsed)) return [];

  const out: MarkedLine[] = [];
  parsed.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const m = item as Record<string, unknown>;

    const lineNumber = Number(m.lineNumber);
    const yRaw = Number(m.yPositionPercent);
    const content = typeof m.content === "string" ? m.content : "";
    const correct = m.correct === true;
    const explanation =
      typeof m.explanation === "string" && m.explanation.trim().length > 0
        ? m.explanation
        : null;

    if (!Number.isFinite(yRaw)) return;

    out.push({
      lineNumber: Number.isFinite(lineNumber) ? lineNumber : idx + 1,
      content,
      yPositionPercent: Math.max(0, Math.min(100, yRaw)),
      correct,
      explanation: correct ? null : explanation,
    });
  });

  return out;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MarkRequestBody;

    const workingImageSrc = body.workingImageSrc ?? "";
    const solutionSteps = Array.isArray(body.solutionSteps)
      ? body.solutionSteps
      : [];
    const finalAnswer = body.finalAnswer ?? "";
    const problemText = body.problemText ?? "";

    if (!workingImageSrc.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "workingImageSrc must be a base64 data URL" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const userText = `${SYSTEM_PROMPT}\n\n${buildUserText(
      problemText,
      solutionSteps,
      finalAnswer
    )}`;

    console.log(
      `[mark-working] calling groq llama-4-scout, image bytes=${workingImageSrc.length}, steps=${solutionSteps.length}`
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
          temperature: 0.1,
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: workingImageSrc },
                },
                {
                  type: "text",
                  text: userText,
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error(
        `[mark-working] groq ${response.status}: ${errBody.slice(0, 500)}`
      );
      return NextResponse.json(
        { error: `Groq request failed (${response.status})` },
        { status: 500 }
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    console.log("[mark-working] groq raw text:", text);

    if (!text) {
      return NextResponse.json([]);
    }

    const marked = parseMarkedLines(text);
    console.log(`[mark-working] parsed ${marked.length} marked lines`);
    return NextResponse.json(marked);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to mark working";
    console.error("[mark-working] unhandled error", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
