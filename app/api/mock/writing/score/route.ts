import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { answers, items, taskTemplates } from "@/lib/db/schema";
import {
  getMockAttempt,
  persistMockWritingScore,
} from "@/lib/mock/persistence";
import {
  WRITING_TASK_33_PROMPT,
  WRITING_TASK_37_PROMPT,
  WRITING_TASK_38_PROMPT,
} from "@/lib/prompts";
import {
  WRITING_DESCRIPTORS,
  type WritingDescriptor,
  type WritingFormat,
} from "@/lib/writing/descriptors";
import { WritingScoreSchema } from "@/lib/writing/types";

export const maxDuration = 60;

const RequestSchema = z.object({
  attemptId: z.string().uuid(),
  itemId: z.string().uuid(),
});

/**
 * POST /api/mock/writing/score
 *
 * On-demand AI grading of a single mock writing draft. We don't grade
 * inline at submit-time because:
 *   1. AI grading is slow (≈ 5–15 s per essay) and would hold up the
 *      results page render.
 *   2. AI grading can fail (quota / model errors). The mock should
 *      still surface a results page even when grading is unavailable.
 *
 * The endpoint is idempotent — re-running rewrites both `answer.rawAnswer`
 * and the `rubric_scores` rows for that answer atomically.
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
          "OPENAI_API_KEY is not configured. Add it to .env.local to enable writing scoring.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape" },
      { status: 400 },
    );
  }
  const { attemptId, itemId } = parsed.data;

  const attempt = await getMockAttempt(attemptId);
  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }
  if (attempt.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Allow grading both during the run (for sneak-peeks, kept disabled by
  // UI) and after submit. The submit aggregator re-reads results so the
  // total recomputes automatically.

  // Load the writing draft + the descriptor it belongs to.
  const all = await db()
    .select({
      itemId: items.id,
      stimulusText: items.stimulusText,
      assets: items.assets,
      templateConfig: taskTemplates.config,
      rawAnswer: answers.rawAnswer,
    })
    .from(answers)
    .innerJoin(items, eq(answers.itemId, items.id))
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .where(eq(answers.attemptId, attemptId));
  const target = all.find((r) => r.itemId === itemId);
  if (!target) {
    return NextResponse.json(
      { error: "Writing draft not found for this attempt" },
      { status: 404 },
    );
  }

  const raw = (target.rawAnswer ?? {}) as Record<string, unknown>;
  if (raw.type !== "writing" || typeof raw.text !== "string") {
    return NextResponse.json(
      { error: "Item is not a writing answer" },
      { status: 400 },
    );
  }
  const text = String(raw.text);
  if (text.trim().length === 0) {
    return NextResponse.json(
      { error: "Cannot grade an empty draft" },
      { status: 400 },
    );
  }
  const cfg = (target.templateConfig ?? {}) as { format?: string };
  const format = cfg.format as WritingFormat | undefined;
  const descriptor = WRITING_DESCRIPTORS.find((d) => d.format === format);
  if (!descriptor) {
    return NextResponse.json(
      { error: "Unknown writing format on this item" },
      { status: 500 },
    );
  }

  const userPrompt = buildWritingScoringPrompt({
    descriptor,
    promptText: target.stimulusText ?? "",
    stimulus: target.assets,
    studentText: text,
  });
  const system = systemPromptFor(descriptor.format);

  const model = openai(process.env.OPENAI_MODEL ?? "gpt-4o");
  let score;
  try {
    const { object } = await generateObject({
      model,
      schema: WritingScoreSchema,
      system,
      prompt: userPrompt,
      temperature: 0.3,
    });
    score = object;
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Scoring failed: ${err.message}`
            : "Scoring failed",
      },
      { status: 502 },
    );
  }

  // Clamp every score at its declared max as a last-line safety net.
  const maxByCode = new Map(
    descriptor.rubric.map((c) => [c.code, c.max] as const),
  );
  score.scores = score.scores.map((s) => ({
    ...s,
    max: maxByCode.get(s.code) ?? s.max,
    score: Math.max(0, Math.min(s.score, maxByCode.get(s.code) ?? s.max)),
  }));
  // Recompute aggregate totals from clamped per-criterion values so the
  // response matches what `persistMockWritingScore` writes to the DB
  // (otherwise the optimistic UI shows the unclamped AI total until the
  // results page is refreshed).
  score.total = score.scores.reduce((sum, s) => sum + s.score, 0);
  score.max = score.scores.reduce((sum, s) => sum + s.max, 0);

  try {
    const { answerId } = await persistMockWritingScore({
      userId: session.user.id,
      attemptId,
      itemId,
      score,
    });
    return NextResponse.json({ answerId, score });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to persist score",
      },
      { status: 500 },
    );
  }
}

function systemPromptFor(format: WritingFormat): string {
  switch (format) {
    case "task_33_email":
      return WRITING_TASK_33_PROMPT;
    case "task_37_email":
      return WRITING_TASK_37_PROMPT;
    case "task_38_essay":
      return WRITING_TASK_38_PROMPT;
  }
}

function buildWritingScoringPrompt(params: {
  descriptor: WritingDescriptor;
  promptText: string;
  stimulus: unknown;
  studentText: string;
}): string {
  const { descriptor, promptText, stimulus, studentText } = params;
  const rubricJson = JSON.stringify(descriptor.rubric, null, 2);
  const stimBlock = stimulusToPromptBlock(stimulus);
  return [
    `Exam: ${descriptor.examCode === "ege_en" ? "ЕГЭ" : "ОГЭ"}.`,
    `Task: ${descriptor.displayName} (№${descriptor.fipiTaskNumber}).`,
    `Volume: ${descriptor.minWords}–${descriptor.maxWords} words. Hard min: ${descriptor.hardMin}. Above ${descriptor.hardMax} → only the first ${descriptor.maxWords} are graded.`,
    "",
    "Rubric (JSON, criterion codes are stable identifiers — return all of them):",
    rubricJson,
    "",
    "Task prompt shown to the student:",
    promptText,
    "",
    "Stimulus:",
    stimBlock,
    "",
    "Student draft (verbatim — count words yourself, do not trust any pre-counted number):",
    `"""${studentText}"""`,
    "",
    `Return a JSON object matching the WritingScoreSchema:`,
    `- "scores" must contain exactly the criteria from the rubric above with the same codes.`,
    `- "total" = sum of "scores[*].score". "max" = sum of "scores[*].max".`,
    `- "summary": ≤ 600 chars, in Russian or RU+EN mix.`,
    `- "errors": up to 8 specific issues, each as a Socratic question quoting the exact phrase.`,
  ].join("\n");
}

function stimulusToPromptBlock(stimulus: unknown): string {
  const s = (stimulus ?? {}) as { stimulus?: unknown };
  const inner = (s.stimulus ?? {}) as Record<string, unknown>;
  if (inner.kind === "task_33_email" || inner.kind === "task_37_email") {
    const friend = String(inner.friendName ?? "");
    const letter = String(inner.friendLetter ?? "");
    const qs = Array.isArray(inner.questions)
      ? (inner.questions as string[]).map((q, i) => `${i + 1}. ${q}`).join("\n")
      : "";
    return [
      `Letter from ${friend}:`,
      letter,
      ``,
      `Questions the student MUST answer:`,
      qs,
    ].join("\n");
  }
  if (inner.kind === "task_38_essay") {
    const topic = String(inner.topic ?? "");
    const prompt = String(inner.prompt ?? "");
    const table = inner.table as
      | { caption: string; rows: { label: string; value: string }[] }
      | undefined;
    const tableBlock = table
      ? [
          `Stimulus table — ${table.caption}:`,
          ...table.rows.map((r) => `- ${r.label}: ${r.value}`),
        ].join("\n")
      : "";
    const planLabels = Array.isArray(inner.planLabels)
      ? (inner.planLabels as string[])
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")
      : "";
    return [
      `Topic: ${topic}`,
      ``,
      `Prompt: ${prompt}`,
      ``,
      tableBlock,
      ``,
      `Required plan (5 paragraphs):`,
      planLabels,
    ].join("\n");
  }
  return JSON.stringify(stimulus ?? {}, null, 2);
}
