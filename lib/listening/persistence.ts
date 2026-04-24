import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  attempts,
  answers,
  items,
  rubricScores,
  sections,
  taskTemplates,
  type ExamCode,
} from "@/lib/db/schema";
import type { SupportedExamCode } from "@/lib/exams";
import {
  getListeningDescriptors,
  listeningTaskTemplateCode,
} from "@/lib/listening/descriptors";
import {
  gradeListeningAnswer,
  ListeningAnswerSchema,
  ListeningAssetsSchema,
  type ListeningAnswer,
  type ListeningPracticeItem,
  type ListeningStudentAnswer,
  type ListeningTaskDescriptor,
} from "@/lib/listening/types";

/**
 * DB access layer for the listening section. Mirrors
 * `lib/reading/persistence.ts` — one `attempt` (mode `practice`) per user ×
 * task_template, one `answer` + one `rubric_score` per submitted response.
 *
 * The audio URL lives in `item.stimulusAudioUrl` (nullable — client falls
 * back to browser TTS on `transcript`), the question in `item.stimulusText`,
 * and the transcript + voice hint in `item.assets`.
 */

export type ListeningTaskTemplateLite = {
  id: string;
  code: string;
  title: string;
  instructions: string;
  descriptor: ListeningTaskDescriptor;
  itemCount: number;
};

export async function getListeningTaskTemplates(
  examCode: SupportedExamCode,
): Promise<ListeningTaskTemplateLite[]> {
  const descriptors = getListeningDescriptors(examCode);
  const rows = await db()
    .select({
      id: taskTemplates.id,
      code: taskTemplates.code,
      title: taskTemplates.title,
      instructions: taskTemplates.instructions,
      itemCount: sql<number>`count(${items.id})::int`.as("item_count"),
    })
    .from(taskTemplates)
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .leftJoin(items, eq(items.taskTemplateId, taskTemplates.id))
    .where(
      and(
        eq(sections.examCode, examCode as ExamCode),
        eq(sections.kind, "listening"),
      ),
    )
    .groupBy(taskTemplates.id);

  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out: ListeningTaskTemplateLite[] = [];
  for (const descriptor of descriptors) {
    const row = byCode.get(
      listeningTaskTemplateCode(examCode, descriptor.codeSuffix),
    );
    if (!row) continue;
    out.push({ ...row, descriptor });
  }
  return out;
}

export async function getListeningTaskTemplateByCode(code: string): Promise<
  | {
      id: string;
      code: string;
      title: string;
      instructions: string;
      examCode: ExamCode;
      sectionId: string;
    }
  | null
> {
  const [row] = await db()
    .select({
      id: taskTemplates.id,
      code: taskTemplates.code,
      title: taskTemplates.title,
      instructions: taskTemplates.instructions,
      examCode: sections.examCode,
      sectionId: sections.id,
    })
    .from(taskTemplates)
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(eq(taskTemplates.code, code))
    .limit(1);
  return row ?? null;
}

function rowToPracticeItem(r: {
  id: string;
  stimulusText: string | null;
  stimulusAudioUrl: string | null;
  correctAnswers: unknown;
  assets: unknown;
  metadata: unknown;
}): ListeningPracticeItem | null {
  if (!r.stimulusText) return null;
  const parsed = ListeningAnswerSchema.safeParse(r.correctAnswers);
  if (!parsed.success) return null;
  const parsedAssets = ListeningAssetsSchema.safeParse(r.assets);
  if (!parsedAssets.success) return null;
  const meta = (r.metadata as Record<string, unknown> | null) ?? null;
  return {
    id: r.id,
    audioUrl: r.stimulusAudioUrl,
    transcript: parsedAssets.data.transcript,
    voice: parsedAssets.data.voice ?? null,
    question: r.stimulusText,
    payload: parsed.data,
    metadata: meta,
  };
}

export async function listListeningItemsForTemplate(
  templateId: string,
): Promise<ListeningPracticeItem[]> {
  const rows = await db()
    .select({
      id: items.id,
      stimulusText: items.stimulusText,
      stimulusAudioUrl: items.stimulusAudioUrl,
      correctAnswers: items.correctAnswers,
      assets: items.assets,
      metadata: items.metadata,
    })
    .from(items)
    .where(eq(items.taskTemplateId, templateId))
    .orderBy(items.createdAt);

  return rows.flatMap((r) => {
    const it = rowToPracticeItem(r);
    return it ? [it] : [];
  });
}

export async function getListeningItemWithAnswer(itemId: string): Promise<
  | {
      id: string;
      transcript: string;
      question: string;
      payload: ListeningAnswer;
      taskTemplateId: string;
      examCode: ExamCode;
    }
  | null
> {
  const [row] = await db()
    .select({
      id: items.id,
      stimulusText: items.stimulusText,
      correctAnswers: items.correctAnswers,
      assets: items.assets,
      taskTemplateId: items.taskTemplateId,
      examCode: sections.examCode,
    })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(eq(items.id, itemId))
    .limit(1);
  if (!row || !row.stimulusText) return null;
  const parsed = ListeningAnswerSchema.safeParse(row.correctAnswers);
  if (!parsed.success) return null;
  const parsedAssets = ListeningAssetsSchema.safeParse(row.assets);
  if (!parsedAssets.success) return null;
  return {
    id: row.id,
    transcript: parsedAssets.data.transcript,
    question: row.stimulusText,
    payload: parsed.data,
    taskTemplateId: row.taskTemplateId,
    examCode: row.examCode,
  };
}

async function getOrCreatePracticeAttempt(params: {
  userId: string;
  examCode: ExamCode;
  taskTemplateId: string;
  sectionId: string;
}): Promise<string> {
  const existing = await db()
    .select({ id: attempts.id })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, params.userId),
        eq(attempts.taskTemplateId, params.taskTemplateId),
        eq(attempts.status, "in_progress"),
      ),
    )
    .orderBy(desc(attempts.startedAt))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const [inserted] = await db()
    .insert(attempts)
    .values({
      userId: params.userId,
      examCode: params.examCode,
      sectionId: params.sectionId,
      taskTemplateId: params.taskTemplateId,
      mode: "practice",
      status: "in_progress",
    })
    .returning({ id: attempts.id });
  return inserted.id;
}

export async function gradeAndPersistListeningAnswer(params: {
  userId: string;
  itemId: string;
  response: ListeningStudentAnswer;
}): Promise<{
  correct: boolean;
  expected: string;
  answerId: string;
  itemPayload: ListeningAnswer;
  itemTranscript: string;
  itemQuestion: string;
}> {
  const item = await getListeningItemWithAnswer(params.itemId);
  if (!item) throw new Error("Listening item not found");

  const template = await db()
    .select({ sectionId: taskTemplates.sectionId })
    .from(taskTemplates)
    .where(eq(taskTemplates.id, item.taskTemplateId))
    .limit(1);
  if (template.length === 0) throw new Error("Task template not found");

  const attemptId = await getOrCreatePracticeAttempt({
    userId: params.userId,
    examCode: item.examCode,
    taskTemplateId: item.taskTemplateId,
    sectionId: template[0].sectionId,
  });

  const { correct, expected } = gradeListeningAnswer(
    item.payload,
    params.response,
  );

  const [answer] = await db()
    .insert(answers)
    .values({
      attemptId,
      itemId: item.id,
      rawAnswer: params.response,
      autoScore: correct ? 1 : 0,
    })
    .returning({ id: answers.id });

  await db().insert(rubricScores).values({
    answerId: answer.id,
    criterionCode: "CORRECT",
    criterionLabel: "Правильность ответа",
    score: correct ? 1 : 0,
    maxScore: 1,
  });

  return {
    correct,
    expected,
    answerId: answer.id,
    itemPayload: item.payload,
    itemTranscript: item.transcript,
    itemQuestion: item.question,
  };
}

export async function getListeningTemplateStats(params: {
  userId: string;
  taskTemplateId: string;
}): Promise<{ correct: number; total: number }> {
  const rows = await db()
    .select({
      correct: sql<number>`coalesce(sum(case when ${answers.autoScore} = 1 then 1 else 0 end), 0)::int`.as(
        "correct",
      ),
      total: sql<number>`count(${answers.id})::int`.as("total"),
    })
    .from(answers)
    .innerJoin(attempts, eq(answers.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.userId, params.userId),
        eq(attempts.taskTemplateId, params.taskTemplateId),
      ),
    );
  const row = rows[0];
  return { correct: row?.correct ?? 0, total: row?.total ?? 0 };
}
