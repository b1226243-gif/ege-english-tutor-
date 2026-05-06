import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { persistGeneratedItems } from "@/lib/generators/persist";
import {
  GeneratedReadingItemSchema,
  MAX_BATCH,
  MIN_BATCH,
} from "@/lib/generators/types";
import { isSupportedExamCode } from "@/lib/exams";
import { READING_GENERATE_PROMPT } from "@/lib/prompts";
import {
  getReadingDescriptors,
  readingTaskTemplateCode,
} from "@/lib/reading/descriptors";

export const maxDuration = 60;

const RequestSchema = z.object({
  examCode: z.string(),
  format: z.enum([
    "matching_headings",
    "matching_statements",
    "mc_detail",
    "true_false_stated",
  ]),
  count: z.number().int().min(MIN_BATCH).max(MAX_BATCH).default(2),
  topic: z.string().max(60).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

/**
 * POST /api/generate/reading
 *
 * Generates a fresh batch of reading-MC items (passage + question) via
 * GPT-4o, persists them with `source = "ai_generated"`, and returns
 * the items so the practice page can append them to its queue.
 *
 * Note: count defaults to 2 (not 3 like grammar) because each reading
 * item carries an 80–180 word passage — generating 5 of these in one
 * batch routinely hits LLM token limits.
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
  const { examCode, format, count, topic, difficulty } = parsed.data;
  if (!isSupportedExamCode(examCode)) {
    return NextResponse.json(
      { error: `Unsupported exam: ${examCode}` },
      { status: 400 },
    );
  }

  // Verify this exam supports the requested reading format.
  const descriptors = getReadingDescriptors(examCode);
  const descriptor = descriptors.find((d) => d.format === format);
  if (!descriptor) {
    return NextResponse.json(
      {
        error: `Reading format "${format}" is not configured for ${examCode}.`,
      },
      { status: 400 },
    );
  }

  const userPrompt = [
    `Exam: ${examCode === "ege_en" ? "ЕГЭ (английский)" : "ОГЭ (английский)"}`,
    `Reading format: ${format} (${descriptor.displayName})`,
    `Count: ${count} items`,
    topic ? `Topic: ${topic}` : null,
    difficulty ? `Target difficulty: ${difficulty}` : null,
    "Return a JSON object with `items` — an array of exactly the requested count.",
  ]
    .filter(Boolean)
    .join("\n");

  const model = openai(process.env.OPENAI_MODEL ?? "gpt-4o");
  let generated;
  try {
    const { object } = await generateObject({
      model,
      schema: z.object({
        items: z.array(GeneratedReadingItemSchema).min(1).max(MAX_BATCH),
      }),
      system: READING_GENERATE_PROMPT,
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

  const code = readingTaskTemplateCode(examCode, descriptor.codeSuffix);
  const result = await persistGeneratedItems({
    section: "reading",
    taskTemplateCode: code,
    items: generated.map((g) => ({
      stimulusText: g.question,
      correctAnswers: g.answer,
      metadata: { passage: g.passage, ...g.metadata },
    })),
  });

  return NextResponse.json({
    inserted: result.inserted,
    duplicates: result.duplicates,
    items: generated,
  });
}
