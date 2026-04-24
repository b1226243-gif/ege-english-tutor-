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
  getSpeakingDescriptors,
  speakingTaskTemplateCode,
} from "@/lib/speaking/descriptors";
import {
  SpeakingAnswerSchema,
  type SpeakingAnswer,
  type SpeakingPracticeItem,
  type SpeakingRawAnswer,
  type SpeakingTaskDescriptor,
} from "@/lib/speaking/types";

export type SpeakingTaskTemplateLite = {
  id: string;
  code: string;
  title: string;
  instructions: string;
  descriptor: SpeakingTaskDescriptor;
  itemCount: number;
};

export async function getSpeakingTaskTemplates(
  examCode: SupportedExamCode,
): Promise<SpeakingTaskTemplateLite[]> {
  const descriptors = getSpeakingDescriptors(examCode);
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
        eq(sections.kind, "speaking"),
      ),
    )
    .groupBy(taskTemplates.id);

  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out: SpeakingTaskTemplateLite[] = [];
  for (const descriptor of descriptors) {
    const row = byCode.get(
      speakingTaskTemplateCode(examCode, descriptor.codeSuffix),
    );
    if (!row) continue;
    out.push({ ...row, descriptor });
  }
  return out;
}

export async function getSpeakingTaskTemplateByCode(code: string): Promise<
  | {
      id: string;
      code: string;
      title: string;
      instructions: string;
      examCode: ExamCode;
      sectionId: string;
      descriptor: SpeakingTaskDescriptor;
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
  if (!row) return null;
  const descriptor = getSpeakingDescriptors(
    row.examCode as SupportedExamCode,
  ).find(
    (d) =>
      speakingTaskTemplateCode(row.examCode as SupportedExamCode, d.codeSuffix) ===
      row.code,
  );
  if (!descriptor) return null;
  return { ...row, descriptor };
}

function rowToPracticeItem(r: {
  id: string;
  correctAnswers: unknown;
  metadata: unknown;
}): SpeakingPracticeItem | null {
  const parsed = SpeakingAnswerSchema.safeParse(r.correctAnswers);
  if (!parsed.success) return null;
  return {
    id: r.id,
    payload: parsed.data,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  };
}

export async function listSpeakingItemsForTemplate(
  templateId: string,
): Promise<SpeakingPracticeItem[]> {
  const rows = await db()
    .select({
      id: items.id,
      correctAnswers: items.correctAnswers,
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

export async function getSpeakingItemWithPayload(itemId: string): Promise<
  | {
      id: string;
      payload: SpeakingAnswer;
      taskTemplateId: string;
      sectionId: string;
      examCode: ExamCode;
    }
  | null
> {
  const [row] = await db()
    .select({
      id: items.id,
      correctAnswers: items.correctAnswers,
      taskTemplateId: items.taskTemplateId,
      sectionId: taskTemplates.sectionId,
      examCode: sections.examCode,
    })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(eq(items.id, itemId))
    .limit(1);
  if (!row) return null;
  const parsed = SpeakingAnswerSchema.safeParse(row.correctAnswers);
  if (!parsed.success) return null;
  return {
    id: row.id,
    payload: parsed.data,
    taskTemplateId: row.taskTemplateId,
    sectionId: row.sectionId,
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

export async function persistSpeakingAnswer(params: {
  userId: string;
  itemId: string;
  rawAnswer: SpeakingRawAnswer;
}): Promise<{ answerId: string; totalScore: number; totalMax: number }> {
  const item = await getSpeakingItemWithPayload(params.itemId);
  if (!item) throw new Error("Speaking item not found");

  const attemptId = await getOrCreatePracticeAttempt({
    userId: params.userId,
    examCode: item.examCode,
    taskTemplateId: item.taskTemplateId,
    sectionId: item.sectionId,
  });

  const total = params.rawAnswer.score.scores.reduce(
    (acc, s) => {
      acc.score += s.score;
      acc.max += s.max;
      return acc;
    },
    { score: 0, max: 0 },
  );

  const [answer] = await db()
    .insert(answers)
    .values({
      attemptId,
      itemId: item.id,
      rawAnswer: params.rawAnswer,
      autoScore: total.score,
    })
    .returning({ id: answers.id });

  if (params.rawAnswer.score.scores.length > 0) {
    await db()
      .insert(rubricScores)
      .values(
        params.rawAnswer.score.scores.map((s) => ({
          answerId: answer.id,
          criterionCode: s.code,
          criterionLabel: s.label,
          score: s.score,
          maxScore: s.max,
        })),
      );
  }

  return {
    answerId: answer.id,
    totalScore: total.score,
    totalMax: total.max,
  };
}

export async function getSpeakingTemplateStats(params: {
  userId: string;
  taskTemplateId: string;
}): Promise<{ attempts: number; totalScore: number; totalMax: number }> {
  const rows = await db()
    .select({
      scoreSum: sql<number>`coalesce(sum(${rubricScores.score}), 0)::int`.as(
        "score_sum",
      ),
      maxSum: sql<number>`coalesce(sum(${rubricScores.maxScore}), 0)::int`.as(
        "max_sum",
      ),
      attemptCount: sql<number>`count(distinct ${answers.id})::int`.as(
        "attempt_count",
      ),
    })
    .from(rubricScores)
    .innerJoin(answers, eq(rubricScores.answerId, answers.id))
    .innerJoin(attempts, eq(answers.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.userId, params.userId),
        eq(attempts.taskTemplateId, params.taskTemplateId),
      ),
    );
  const row = rows[0];
  return {
    attempts: row?.attemptCount ?? 0,
    totalScore: row?.scoreSum ?? 0,
    totalMax: row?.maxSum ?? 0,
  };
}
