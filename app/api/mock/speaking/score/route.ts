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
  persistMockSpeakingScore,
} from "@/lib/mock/persistence";
import { SPEAKING_SCORE_PROMPT } from "@/lib/prompts";
import {
  getSpeakingDescriptors,
  totalSpeakingMax,
} from "@/lib/speaking/descriptors";
import {
  SpeakingAnswerSchema,
  SpeakingScoreSchema,
  type SpeakingAnswer,
  type SpeakingTaskDescriptor,
} from "@/lib/speaking/types";

export const maxDuration = 60;

const RequestSchema = z.object({
  attemptId: z.string().uuid(),
  itemId: z.string().uuid(),
});

/**
 * POST /api/mock/speaking/score
 *
 * On-demand AI grading of a single mock speaking transcript. Mirrors the
 * writing scoring endpoint exactly — separate from the run, idempotent,
 * and rewrites both `answer.rawAnswer` and `rubric_scores` atomically.
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
          "OPENAI_API_KEY is not configured. Add it to .env.local to enable speaking scoring.",
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

  // Fetch the recorded answer + its task_template so we can resolve the
  // FIPI descriptor (rubric, timings, FIPI task range).
  const all = await db()
    .select({
      itemId: items.id,
      itemPayload: items.correctAnswers,
      templateCode: taskTemplates.code,
      rawAnswer: answers.rawAnswer,
    })
    .from(answers)
    .innerJoin(items, eq(answers.itemId, items.id))
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .where(eq(answers.attemptId, attemptId));
  const target = all.find((r) => r.itemId === itemId);
  if (!target) {
    return NextResponse.json(
      { error: "Speaking transcript not found for this attempt" },
      { status: 404 },
    );
  }

  const raw = (target.rawAnswer ?? {}) as Record<string, unknown>;
  if (raw.type !== "speaking" || typeof raw.transcript !== "string") {
    return NextResponse.json(
      { error: "Item is not a speaking answer" },
      { status: 400 },
    );
  }
  const transcript = String(raw.transcript).trim();
  if (transcript.length === 0) {
    return NextResponse.json(
      { error: "Cannot grade an empty transcript" },
      { status: 400 },
    );
  }

  const stimulusParsed = SpeakingAnswerSchema.safeParse(target.itemPayload);
  if (!stimulusParsed.success) {
    return NextResponse.json(
      { error: "Item payload is not a valid speaking stimulus" },
      { status: 500 },
    );
  }
  const stimulus = stimulusParsed.data;

  // examCode-aware descriptor lookup — read_aloud has different rubric
  // maxes for ЕГЭ vs ОГЭ.
  const codeSuffix = target.templateCode.split(".").pop() ?? "";
  const examCode = attempt.examCode === "oge_en" ? "oge_en" : "ege_en";
  const descriptor = getSpeakingDescriptors(examCode).find(
    (d) => d.codeSuffix === codeSuffix,
  );
  if (!descriptor) {
    return NextResponse.json(
      { error: "Unknown speaking task on this item" },
      { status: 500 },
    );
  }

  const userPrompt = buildSpeakingScoringPrompt({
    examLabel: examCode === "ege_en" ? "ЕГЭ" : "ОГЭ",
    descriptor,
    stimulus,
    transcript,
  });

  const model = openai(process.env.OPENAI_MODEL ?? "gpt-4o");
  let aiScore;
  try {
    const { object } = await generateObject({
      model,
      schema: SpeakingScoreSchema,
      system: SPEAKING_SCORE_PROMPT,
      prompt: userPrompt,
      temperature: 0.3,
    });
    aiScore = object;
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

  // Convert the AI-native shape (`comment` per criterion, free-text
  // `feedback`) into the mock-result shape (`notes` per criterion +
  // structured `summary` / `errors[]`). The standalone speaking module
  // does not capture structured Socratic errors yet, so we surface the
  // narrative feedback as `summary` and leave `errors` empty — the UI
  // already degrades gracefully.
  const maxByCode = new Map(
    descriptor.rubric.map((c) => [c.code, c.max] as const),
  );
  const normalisedScores = aiScore.scores.map((s) => ({
    code: s.code,
    label: s.label,
    score: Math.max(0, Math.min(s.score, maxByCode.get(s.code) ?? s.max)),
    max: maxByCode.get(s.code) ?? s.max,
    notes: s.comment,
  }));
  const score = {
    total: normalisedScores.reduce((sum, s) => sum + s.score, 0),
    max: normalisedScores.reduce((sum, s) => sum + s.max, 0),
    scores: normalisedScores,
    summary: aiScore.feedback,
    errors: [] as { quote: string; question: string }[],
  };

  try {
    const { answerId } = await persistMockSpeakingScore({
      userId: session.user.id,
      attemptId,
      itemId,
      score,
    });
    return NextResponse.json({
      answerId,
      score,
      maxPossible: totalSpeakingMax(descriptor.rubric),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to persist score",
      },
      { status: 500 },
    );
  }
}

function buildSpeakingScoringPrompt(params: {
  examLabel: string;
  descriptor: SpeakingTaskDescriptor;
  stimulus: SpeakingAnswer;
  transcript: string;
}): string {
  const { examLabel, descriptor, stimulus, transcript } = params;
  const rubricJson = JSON.stringify(descriptor.rubric, null, 2);
  const stimulusBlock = stimulusToPromptBlock(stimulus);
  return [
    `Exam: ${examLabel}.`,
    `Task: ${descriptor.displayName} (№${descriptor.fipiTaskRange}).`,
    `Format: ${descriptor.format}.`,
    "",
    "Rubric (JSON):",
    rubricJson,
    "",
    "Stimulus:",
    stimulusBlock,
    "",
    "Student transcript (from Whisper, may have minor ASR errors):",
    `"""${transcript}"""`,
  ].join("\n");
}

function stimulusToPromptBlock(s: SpeakingAnswer): string {
  switch (s.type) {
    case "speaking_read_aloud":
      return `Passage to be read aloud:\n${s.passage}`;
    case "speaking_ask_questions":
      return [
        `Advert / announcement:`,
        s.advert,
        ``,
        `Required aspects to ask about (4 direct questions, one per aspect):`,
        s.aspects.map((a, i) => `${i + 1}. ${a}`).join("\n"),
      ].join("\n");
    case "speaking_interview":
      return [
        `Context: ${s.context}`,
        ``,
        `Interviewer questions (in order, student must answer each):`,
        s.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
      ].join("\n");
    case "speaking_picture_compare":
      return [
        `Topic: ${s.topic}`,
        `Picture 1 caption: ${s.imageCaptions[0]}`,
        `Picture 2 caption: ${s.imageCaptions[1]}`,
        ``,
        `FIPI 5-point plan:`,
        s.plan.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      ].join("\n");
    case "speaking_monologue_topic":
      return [
        `Topic: ${s.topic}`,
        ``,
        `Plan (3 points, all must be covered):`,
        s.plan.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      ].join("\n");
  }
}
