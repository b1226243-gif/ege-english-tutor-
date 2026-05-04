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
  getGrammarDescriptors,
  taskTemplateCode,
} from "@/lib/grammar/descriptors";
import {
  gradeGrammarAnswer,
  GrammarAnswerSchema,
  type GrammarAnswer,
  type GrammarStudentAnswer,
  type GrammarTaskDescriptor,
} from "@/lib/grammar/types";

/**
 * DB access layer for the grammar section.
 *
 * Each student sitting in Grammar is modelled as one `attempt` row in
 * `practice` mode, scoped to a single `task_template` (e.g. "ege_en.grammar.transform").
 * Every submitted response inserts an `answer` row and a matching
 * `rubric_score` row.
 */

export type GrammarItem = {
  id: string;
  stimulusText: string;
  payload: GrammarAnswer;
  metadata: Record<string, unknown> | null;
};

export type TaskTemplateLite = {
  id: string;
  code: string;
  title: string;
  instructions: string;
  descriptor: GrammarTaskDescriptor;
  itemCount: number;
};

export async function getGrammarTaskTemplates(
  examCode: SupportedExamCode,
): Promise<TaskTemplateLite[]> {
  const descriptors = getGrammarDescriptors(examCode);
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
        eq(sections.kind, "grammar"),
      ),
    )
    .groupBy(taskTemplates.id);

  // Pair rows with their descriptor (drops any templates not in the
  // descriptor list, e.g. stale rows from a removed task type).
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out: TaskTemplateLite[] = [];
  for (const descriptor of descriptors) {
    const row = byCode.get(taskTemplateCode(examCode, descriptor.codeSuffix));
    if (!row) continue;
    out.push({ ...row, descriptor });
  }
  return out;
}

export async function getTaskTemplateByCode(
  code: string,
): Promise<
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

export async function listItemsForTemplate(
  templateId: string,
): Promise<GrammarItem[]> {
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
    const parsed = GrammarAnswerSchema.safeParse(r.correctAnswers);
    if (!parsed.success) return [];
    return [
      {
        id: r.id,
        stimulusText: r.stimulusText,
        payload: parsed.data,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      },
    ];
  });
}

export async function getItemWithAnswer(
  itemId: string,
): Promise<
  | {
      id: string;
      stimulusText: string;
      payload: GrammarAnswer;
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
      taskTemplateId: items.taskTemplateId,
      examCode: sections.examCode,
    })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(eq(items.id, itemId))
    .limit(1);
  if (!row || !row.stimulusText) return null;
  const parsed = GrammarAnswerSchema.safeParse(row.correctAnswers);
  if (!parsed.success) return null;
  return {
    id: row.id,
    stimulusText: row.stimulusText,
    payload: parsed.data,
    taskTemplateId: row.taskTemplateId,
    examCode: row.examCode,
  };
}

/** Find or open a `practice` attempt for this user × task template. */
export async function getOrCreatePracticeAttempt(params: {
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

/** Grade a response, persist answer + rubric_score rows. */
export async function gradeAndPersistAnswer(params: {
  userId: string;
  itemId: string;
  response: GrammarStudentAnswer;
}): Promise<{
  correct: boolean;
  expected: string;
  answerId: string;
  itemPayload: GrammarAnswer;
  itemStimulus: string;
}> {
  const item = await getItemWithAnswer(params.itemId);
  if (!item) throw new Error("Item not found");
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

  const { correct, expected } = gradeGrammarAnswer(
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
    itemStimulus: item.stimulusText,
  };
}

/** Session stats for the current attempt (or lifetime for this template). */
export async function getTemplateStats(params: {
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
