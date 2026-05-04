import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { textStreamToResponseWithFallback } from "@/lib/ai/stream";
import { getListeningItemWithAnswer } from "@/lib/listening/persistence";
import { LISTENING_EXPLAIN_PROMPT } from "@/lib/prompts";

export const maxDuration = 30;

const BodySchema = z.object({
  itemId: z.string().uuid(),
  /** 0-based option index the student picked. */
  choice: z.number().int().min(0),
  correct: z.boolean(),
});

/**
 * POST /api/listening/explain
 *
 * Streams a Socratic discussion of a listening MC answer using GPT-4o.
 * Called after /api/listening/answer has already scored and persisted, so
 * the UI can show an instant verdict and progressively fill in the "why".
 *
 * On error, the stream body ends with a Markdown `⚠` line describing the
 * underlying failure (see `lib/ai/stream.ts`) — the UI never sees a
 * silent 200-with-empty-body response.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Set it in .env.local (see .env.example).",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const item = await getListeningItemWithAnswer(parsed.data.itemId);
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const payload = item.payload;
  const letter = (idx: number) => String.fromCharCode(65 + idx);
  const studentChoiceInRange =
    parsed.data.choice >= 0 && parsed.data.choice < payload.options.length;
  const studentDisplay = studentChoiceInRange
    ? `${letter(parsed.data.choice)} — ${payload.options[parsed.data.choice]}`
    : "(не выбрано)";
  const correctDisplay = `${letter(payload.answer)} — ${payload.options[payload.answer]}`;

  const context = [
    "Task type: listening_mc.",
    `Audio transcript (the student heard this, not read it):\n${item.transcript}`,
    `Question: ${item.question}`,
    `Options: ${payload.options
      .map((opt, idx) => `${letter(idx)}) ${opt}`)
      .join(" | ")}`,
    payload.evidence ? `Evidence hint: ${payload.evidence}` : null,
    `Student chose: ${studentDisplay}`,
    `Correct answer: ${correctDisplay}`,
    `Auto-grader result: ${parsed.data.correct ? "CORRECT" : "INCORRECT"}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL ?? "gpt-4o"),
    system: LISTENING_EXPLAIN_PROMPT,
    prompt: context,
    temperature: 0.3,
  });

  return textStreamToResponseWithFallback(result);
}
