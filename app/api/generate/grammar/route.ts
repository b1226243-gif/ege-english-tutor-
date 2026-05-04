import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { persistGeneratedItems } from "@/lib/generators/persist";
import {
  GeneratedLexicalMcItemSchema,
  GeneratedTransformItemSchema,
  GeneratedWordFormationItemSchema,
  MAX_BATCH,
  MIN_BATCH,
} from "@/lib/generators/types";
import { taskTemplateCode } from "@/lib/grammar/descriptors";
import { isSupportedExamCode } from "@/lib/exams";
import { GRAMMAR_GENERATE_PROMPT } from "@/lib/prompts";

export const maxDuration = 60;

const RequestSchema = z.object({
  examCode: z.string(),
  type: z.enum(["transform", "word_formation", "lexical_mc"]),
  count: z.number().int().min(MIN_BATCH).max(MAX_BATCH).default(3),
  topic: z.string().max(60).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

/**
 * POST /api/generate/grammar
 *
 * Generates a fresh batch of grammar items via GPT-4o, persists them
 * with `source = "ai_generated"`, and returns the inserted items so
 * the practice page can append them to its in-memory queue.
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
          "OPENAI_API_KEY is not configured. Add it to .env.local to enable AI generation.",
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
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { examCode, type, count, topic, difficulty } = parsed.data;
  if (!isSupportedExamCode(examCode)) {
    return NextResponse.json(
      { error: `Unsupported exam: ${examCode}` },
      { status: 400 },
    );
  }

  const itemSchema =
    type === "transform"
      ? GeneratedTransformItemSchema
      : type === "word_formation"
        ? GeneratedWordFormationItemSchema
        : GeneratedLexicalMcItemSchema;

  const userPrompt = [
    `Exam: ${examCode === "ege_en" ? "ЕГЭ (английский)" : "ОГЭ (английский)"}`,
    `Task type: ${type}`,
    `Count: ${count} items`,
    topic ? `Topic / grammar focus: ${topic}` : null,
    difficulty ? `Target difficulty: ${difficulty}` : null,
    "Return a JSON array with exactly the requested count of items.",
  ]
    .filter(Boolean)
    .join("\n");

  const model = openai(process.env.OPENAI_MODEL ?? "gpt-4o");
  let generated;
  try {
    const { object } = await generateObject({
      model,
      schema: z.object({ items: z.array(itemSchema).min(1).max(MAX_BATCH) }),
      system: GRAMMAR_GENERATE_PROMPT,
      prompt: userPrompt,
      temperature: 0.7,
    });
    generated = object.items;
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Generation failed: ${err.message}`
            : "Generation failed",
      },
      { status: 502 },
    );
  }

  // Persist with source = "ai_generated".
  const code = taskTemplateCode(examCode, type);
  const result = await persistGeneratedItems({
    section: "grammar",
    taskTemplateCode: code,
    items: generated.map((g) => ({
      stimulusText: g.stimulusText,
      correctAnswers: g.answer,
      metadata: g.metadata,
    })),
  });

  return NextResponse.json({
    inserted: result.inserted,
    duplicates: result.duplicates,
    items: generated,
  });
}
