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
  getReadingDescriptors,
  readingTaskTemplateCode,
} from "@/lib/reading/descriptors";
import {
  gradeReadingAnswer,
  ReadingAnswerSchema,
  type ReadingAnswer,
  type ReadingPracticeItem,
  type ReadingStudentAnswer,
  type ReadingTaskDescriptor,
} from "@/lib/reading/types";

/**
 * DB access layer for the reading section. Mirrors `lib/grammar/persistence.ts`
 * — one `attempt` (mode `practice`) per user × task_template, one `answer` +
 * one `rubric_score` per submitted response.
 *
 * The reading passage lives in `item.metadata.passage` and the question in
 * `item.stimulusText`; we join them into a single `ReadingPracticeItem`
 * shape for the UI.
 */

export type ReadingTaskTemplateLite = {
  id: string;
  code: string;
  title: string;
  instructions: string;
  descriptor: ReadingTaskDescriptor;
  itemCount: number;
};

export async function getReadingTaskTemplates(
  examCode: SupportedExamCode,
): Promise<ReadingTaskTemplateLite[]> {
  const descriptors = getReadingDescriptors(examCode);
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
        eq(sections.kind, "reading"),
      ),
    )
    .groupBy(taskTemplates.id);

  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out: ReadingTaskTemplateLite[] = [];
  for (const descriptor of descriptors) {
    const row = byCode.get(
      readingTaskTemplateCode(examCode, descriptor.codeSuffix),
    );
    if (!row) continue;
    out.push({ ...row, descriptor });
  }
  return out;
}

export async function getReadingTaskTemplateByCode(code: string): Promise<
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

/**
 * Pull practice items for a reading task template, joining passage +
 * question + payload into a single shape for the UI.
 */
export async function listReadingItemsForTemplate(
  templateId: string,
): Promise<ReadingPracticeItem[]> {
  const rows = await db()
    .select({
      id: items.id,
      stimulusText: items.stimulusText,
      correctAnswers: items.correctAnswers,
      metadata: items.metadata,
    })
    .from(items)
    .where(eq(items.taskTemplateId, templateId))
    .orderBy(items.createdAt);

  return rows.flatMap((r) => {
    if (!r.stimulusText) return [];
    const parsed = ReadingAnswerSchema.safeParse(r.correctAnswers);
    if (!parsed.success) return [];
    const meta = (r.metadata as Record<string, unknown> | null) ?? null;
    const passage =
      typeof meta?.passage === "string" && meta.passage.trim().length > 0
        ? meta.passage
        : "";
    if (!passage) return [];
    return [
      {
        id: r.id,
        passage,
        question: r.stimulusText,
        payload: parsed.data,
        metadata: meta,
      },
    ];
  });
}

export async function getReadingItemWithAnswer(itemId: string): Promise<
  | {
      id: string;
      passage: string;
      question: string;
      payload: ReadingAnswer;
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
      metadata: items.metadata,
      taskTemplateId: items.taskTemplateId,
      examCode: sections.examCode,
    })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(eq(items.id, itemId))
    .limit(1);
  if (!row || !row.stimulusText) return null;
  const parsed = ReadingAnswerSchema.safeParse(row.correctAnswers);
  if (!parsed.success) return null;
  const meta = (row.metadata as Record<string, unknown> | null) ?? null;
  const passage =
    typeof meta?.passage === "string" && meta.passage.trim().length > 0
      ? meta.passage
      : "";
  if (!passage) return null;
  return {
    id: row.id,
    passage,
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

export async function gradeAndPersistReadingAnswer(params: {
  userId: string;
  itemId: string;
  response: ReadingStudentAnswer;
}): Promise<{
  correct: boolean;
  expected: string;
  answerId: string;
  itemPayload: ReadingAnswer;
  itemPassage: string;
  itemQuestion: string;
}> {
  const item = await getReadingItemWithAnswer(params.itemId);
  if (!item) throw new Error("Reading item not found");

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

  const { correct, expected } = gradeReadingAnswer(
    item.payload,
    params.response,
  );

  const answerId = await db().transaction(async (tx) => {
    const [upserted] = await tx
      .insert(answers)
      .values({
        attemptId,
        itemId: item.id,
        rawAnswer: params.response,
        autoScore: correct ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [answers.attemptId, answers.itemId],
        set: {
          rawAnswer: params.response,
          autoScore: correct ? 1 : 0,
        },
      })
      .returning({ id: answers.id });

    await tx.delete(rubricScores).where(eq(rubricScores.answerId, upserted.id));
    await tx.insert(rubricScores).values({
      answerId: upserted.id,
      criterionCode: "CORRECT",
      criterionLabel: "Правильность ответа",
      score: correct ? 1 : 0,
      maxScore: 1,
    });

    return upserted.id;
  });

  return {
    correct,
    expected,
    answerId,
    itemPayload: item.payload,
    itemPassage: item.passage,
    itemQuestion: item.question,
  };
}

export async function getReadingTemplateStats(params: {
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
