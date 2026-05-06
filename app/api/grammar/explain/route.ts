import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { textStreamToResponseWithFallback } from "@/lib/ai/stream";
import { getItemWithAnswer } from "@/lib/grammar/persistence";
import { GRAMMAR_EXPLAIN_PROMPT } from "@/lib/prompts";

export const maxDuration = 30;

const BodySchema = z.object({
  itemId: z.string().uuid(),
  studentAnswer: z.string().min(0),
  correct: z.boolean(),
});

/**
 * POST /api/grammar/explain
 *
 * Streams a Socratic explanation for a single grammar item using GPT-4o.
 * Called after the auto-grader has already responded via
 * /api/grammar/answer, so the UI can show an instant right/wrong banner
 * and progressively fill in the "why".
 *
 * Returns a plain text stream (not the AI SDK's message envelope) so the
 * client can consume it with a simple ReadableStream reader.
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

  const item = await getItemWithAnswer(parsed.data.itemId);
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const payload = item.payload;
  const correctDisplay =
    payload.type === "lexical_mc"
      ? `${String.fromCharCode(65 + payload.answer)} — ${payload.options[payload.answer]}`
      : payload.answer;

  const hint =
    payload.type === "transform"
      ? payload.hint
      : payload.type === "word_formation"
        ? payload.pos
        : null;

  const context = [
    `Task type: ${payload.type}.`,
    `Prompt: ${item.stimulusText}`,
    payload.type === "lexical_mc"
      ? `Options (A/B/C/D): ${payload.options.join(" / ")}.`
      : `Base: ${payload.base}.`,
    hint ? `Hint: ${hint}.` : null,
    `Student answered: "${parsed.data.studentAnswer}".`,
    `Correct answer: "${correctDisplay}".`,
    `Auto-grader result: ${parsed.data.correct ? "CORRECT" : "INCORRECT"}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL ?? "gpt-4o"),
    system: GRAMMAR_EXPLAIN_PROMPT,
    prompt: context,
    temperature: 0.3,
  });

  return textStreamToResponseWithFallback(result);
}
