import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  answers,
  attempts,
  items,
  rubricScores,
  sections,
  taskTemplates,
  type ExamCode,
  type SectionKind,
} from "@/lib/db/schema";
import { GrammarAnswerSchema, gradeGrammarAnswer } from "@/lib/grammar/types";
import {
  ListeningAnswerSchema,
  gradeListeningAnswer,
} from "@/lib/listening/types";
import {
  ReadingAnswerSchema,
  gradeReadingAnswer,
} from "@/lib/reading/types";
import type {
  MockAnswerRequest,
  MockPlan,
  MockResults,
  MockSectionResult,
} from "@/lib/mock/types";

/**
 * Server-side persistence for the mock-exam runner. Each mock attempt is
 * a single `attempts` row with mode='mock_full'; per-item answers go on
 * the same attempt and are recovered later by joining
 *  answers → items → task_templates → sections.
 *
 * We grade auto-graded sections (listening / reading / grammar) in-line
 * here so the results page can be rendered without any additional AI
 * calls. Each answer also gets a `rubric_score` row for backwards
 * compatibility with the per-section dashboards.
 */

export type MockAttempt = {
  id: string;
  userId: string;
  examCode: ExamCode;
  startedAt: Date;
  completedAt: Date | null;
  status: "in_progress" | "completed" | "abandoned";
  totalScore: number | null;
  maxScore: number | null;
  /** Frozen plan from start time. Null for legacy mock attempts created before the plan column existed. */
  plan: MockPlan | null;
};

export async function startMockAttempt(params: {
  userId: string;
  examCode: ExamCode;
  plan: MockPlan;
}): Promise<{ id: string; startedAt: Date }> {
  const [row] = await db()
    .insert(attempts)
    .values({
      userId: params.userId,
      examCode: params.examCode,
      mode: "mock_full",
      status: "in_progress",
      plan: params.plan,
    })
    .returning({ id: attempts.id, startedAt: attempts.startedAt });
  return row;
}

export async function getMockAttempt(
  attemptId: string,
): Promise<MockAttempt | null> {
  const [row] = await db()
    .select({
      id: attempts.id,
      userId: attempts.userId,
      examCode: attempts.examCode,
      startedAt: attempts.startedAt,
      completedAt: attempts.completedAt,
      status: attempts.status,
      totalScore: attempts.totalScore,
      maxScore: attempts.maxScore,
      mode: attempts.mode,
      plan: attempts.plan,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);
  if (!row || row.mode !== "mock_full") return null;
  return {
    id: row.id,
    userId: row.userId,
    examCode: row.examCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    status: row.status,
    totalScore: row.totalScore,
    maxScore: row.maxScore,
    plan: (row.plan as MockPlan | null) ?? null,
  };
}

/**
 * Save one mock-mode answer. Auto-grades immediately but does NOT reveal
 * the verdict to the client (the runner stays "blind" until submit, like
 * a real exam). Verdicts surface only on the results page.
 */
export async function saveMockAnswer(params: {
  userId: string;
  request: MockAnswerRequest;
}): Promise<{ answerId: string }> {
  const { request, userId } = params;
  const attempt = await getMockAttempt(request.attemptId);
  if (!attempt) throw new Error("Mock attempt not found");
  if (attempt.userId !== userId) throw new Error("Forbidden");
  if (attempt.status !== "in_progress") {
    throw new Error("Mock attempt is already submitted");
  }

  const [item] = await db()
    .select({
      id: items.id,
      correctAnswers: items.correctAnswers,
      taskTemplateId: items.taskTemplateId,
      sectionKind: sections.kind,
    })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(eq(items.id, request.itemId))
    .limit(1);
  if (!item) throw new Error("Item not found");

  const graded = gradeRequest(request, item.correctAnswers, item.sectionKind);
  if (!graded) throw new Error("Cannot grade this item type in mock mode");

  // Wrap the answer upsert AND the rubric_scores reset in a single
  // transaction. The upsert by itself is atomic (DB-level UNIQUE on
  // (attempt_id, item_id)), but without a transaction two concurrent
  // requests for the same item can both reach the rubric_scores reset
  // with the same answerId and interleave their DELETE + INSERT
  // statements, leaving multiple rubric rows behind. `readMockResults`
  // sums criterion scores across rows, so duplicates would still
  // inflate `totalScore`/`maxScore` even though the answer row itself
  // is unique.
  const answerId = await db().transaction(async (tx) => {
    const [upserted] = await tx
      .insert(answers)
      .values({
        attemptId: request.attemptId,
        itemId: request.itemId,
        rawAnswer: graded.rawAnswer,
        autoScore: graded.score,
      })
      .onConflictDoUpdate({
        target: [answers.attemptId, answers.itemId],
        set: {
          rawAnswer: graded.rawAnswer,
          autoScore: graded.score,
        },
      })
      .returning({ id: answers.id });

    await tx.delete(rubricScores).where(eq(rubricScores.answerId, upserted.id));
    await tx.insert(rubricScores).values({
      answerId: upserted.id,
      criterionCode: graded.score === graded.max ? "CORRECT" : "INCORRECT",
      criterionLabel: "Auto-grade",
      score: graded.score,
      maxScore: graded.max,
      notes: graded.notes,
    });

    return upserted.id;
  });

  return { answerId };
}

type Graded = {
  rawAnswer: Record<string, unknown>;
  score: number;
  max: number;
  notes: string;
};

function gradeRequest(
  request: MockAnswerRequest,
  correctAnswers: unknown,
  sectionKind: SectionKind,
): Graded | null {
  if (
    request.kind === "listening_mc" &&
    sectionKind === "listening"
  ) {
    const parsed = ListeningAnswerSchema.safeParse(correctAnswers);
    if (!parsed.success || parsed.data.type !== "listening_mc") return null;
    const result = gradeListeningAnswer(parsed.data, {
      type: "listening_mc",
      choice: request.choice,
    });
    return {
      rawAnswer: { type: "listening_mc", choice: request.choice },
      score: result.correct ? 1 : 0,
      max: 1,
      notes: result.expected,
    };
  }
  if (request.kind === "reading_mc" && sectionKind === "reading") {
    const parsed = ReadingAnswerSchema.safeParse(correctAnswers);
    if (!parsed.success || parsed.data.type !== "reading_mc") return null;
    const result = gradeReadingAnswer(parsed.data, {
      type: "reading_mc",
      choice: request.choice,
    });
    return {
      rawAnswer: { type: "reading_mc", choice: request.choice },
      score: result.correct ? 1 : 0,
      max: 1,
      notes: result.expected,
    };
  }
  if (sectionKind !== "grammar") return null;
  const parsed = GrammarAnswerSchema.safeParse(correctAnswers);
  if (!parsed.success) return null;
  if (request.kind === "grammar_text") {
    if (parsed.data.type === "lexical_mc") return null;
    const result = gradeGrammarAnswer(parsed.data, {
      type: parsed.data.type,
      value: request.value,
    });
    return {
      rawAnswer: { type: parsed.data.type, value: request.value },
      score: result.correct ? 1 : 0,
      max: 1,
      notes: result.expected,
    };
  }
  if (request.kind === "grammar_lexical_mc") {
    if (parsed.data.type !== "lexical_mc") return null;
    const result = gradeGrammarAnswer(parsed.data, {
      type: "lexical_mc",
      choice: request.choice,
    });
    return {
      rawAnswer: { type: "lexical_mc", choice: request.choice },
      score: result.correct ? 1 : 0,
      max: 1,
      notes: result.expected,
    };
  }
  return null;
}

/**
 * Mark the attempt as submitted, compute aggregates, and return the full
 * results payload for the results page.
 */
export async function submitMockAttempt(params: {
  userId: string;
  attemptId: string;
}): Promise<MockResults> {
  const attempt = await getMockAttempt(params.attemptId);
  if (!attempt) throw new Error("Mock attempt not found");
  if (attempt.userId !== params.userId) throw new Error("Forbidden");

  const results = await readMockResults(params.attemptId);
  if (attempt.status === "in_progress") {
    await db()
      .update(attempts)
      .set({
        status: "completed",
        completedAt: new Date(),
        totalScore: results.totalScore,
        maxScore: results.maxScore,
      })
      .where(eq(attempts.id, attempt.id));
  }

  return {
    ...results,
    completedAt: results.completedAt ?? new Date().toISOString(),
  };
}

export async function readMockResults(
  attemptId: string,
): Promise<MockResults> {
  const attempt = await getMockAttempt(attemptId);
  if (!attempt) throw new Error("Mock attempt not found");

  const rows = await db()
    .select({
      answerId: answers.id,
      itemId: answers.itemId,
      rawAnswer: answers.rawAnswer,
      autoScore: answers.autoScore,
      sectionKind: sections.kind,
      sectionDisplayName: sections.displayName,
      sectionOrderIdx: sections.orderIdx,
      templateTitle: taskTemplates.title,
      criterionScore: rubricScores.score,
      criterionMax: rubricScores.maxScore,
      criterionNotes: rubricScores.notes,
      itemCorrectAnswers: items.correctAnswers,
    })
    .from(answers)
    .innerJoin(items, eq(answers.itemId, items.id))
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .leftJoin(rubricScores, eq(rubricScores.answerId, answers.id))
    .where(eq(answers.attemptId, attemptId))
    .orderBy(asc(sections.orderIdx), asc(taskTemplates.code), asc(answers.createdAt));

  // Group rows by answerId so multiple rubric_scores collapse cleanly.
  type AggregatedAnswer = {
    itemId: string;
    rawAnswer: unknown;
    sectionKind: SectionKind;
    sectionDisplayName: string;
    sectionOrderIdx: number;
    templateTitle: string;
    score: number;
    max: number;
    notes: string | null;
    itemCorrectAnswers: unknown;
  };
  const byAnswer = new Map<string, AggregatedAnswer>();
  for (const r of rows) {
    const cur = byAnswer.get(r.answerId);
    if (cur) {
      cur.score += r.criterionScore ?? 0;
      cur.max += r.criterionMax ?? 0;
      if (!cur.notes && r.criterionNotes) cur.notes = r.criterionNotes;
    } else {
      byAnswer.set(r.answerId, {
        itemId: r.itemId,
        rawAnswer: r.rawAnswer,
        sectionKind: r.sectionKind,
        sectionDisplayName: r.sectionDisplayName,
        sectionOrderIdx: r.sectionOrderIdx,
        templateTitle: r.templateTitle,
        score: r.criterionScore ?? r.autoScore ?? 0,
        max: r.criterionMax ?? 1,
        notes: r.criterionNotes ?? null,
        itemCorrectAnswers: r.itemCorrectAnswers,
      });
    }
  }

  // Index answers by itemId for plan-driven assembly below.
  const byItemId = new Map<string, AggregatedAnswer>();
  for (const a of byAnswer.values()) {
    byItemId.set(a.itemId, a);
  }

  let sectionsOut: MockSectionResult[];
  if (attempt.plan) {
    // Plan-driven assembly: include EVERY item in the frozen plan, even
    // ones the student never answered. This is what the FIPI rubric
    // expects — skipped questions count as 0/maxScore, not "not in the
    // denominator". Without this, a student who answered 5 of 15 items
    // correctly would see 5/5 = 100% instead of 5/15 ≈ 33%.
    sectionsOut = [];
    for (const planSec of attempt.plan.sections) {
      // Mock plan kinds are a subset of SectionKind, all valid here.
      const kind = planSec.kind as SectionKind;
      const sec: MockSectionResult = {
        kind,
        displayName: planSec.displayName,
        totalScore: 0,
        maxScore: 0,
        attempts: 0,
        items: [],
      };
      for (const planItem of planSec.items) {
        const a = byItemId.get(planItem.id);
        if (a) {
          sec.totalScore += a.score;
          sec.maxScore += a.max;
          sec.attempts += 1;
          sec.items.push({
            itemId: planItem.id,
            correct: a.score === a.max ? true : a.score === 0 ? false : null,
            score: a.score,
            maxScore: a.max,
            expected: a.notes,
            studentResponse: stringifyStudentResponse(
              a.rawAnswer,
              a.itemCorrectAnswers,
            ),
            taskTemplateTitle: planItem.taskTemplateTitle,
          });
        } else {
          // Auto-graded mock items are all worth 1 point in PR #7. Keep
          // the denominator honest by counting them anyway.
          const itemMax = 1;
          sec.maxScore += itemMax;
          sec.items.push({
            itemId: planItem.id,
            correct: null,
            score: 0,
            maxScore: itemMax,
            expected: null,
            studentResponse: "",
            taskTemplateTitle: planItem.taskTemplateTitle,
          });
        }
      }
      sectionsOut.push(sec);
    }
  } else {
    // Legacy attempts (created before the plan column existed): fall
    // back to summing only answered items. The denominator may still be
    // wrong, but there is no plan to recover the full set from.
    const sectionMap = new Map<SectionKind, MockSectionResult>();
    for (const a of byAnswer.values()) {
      let sec = sectionMap.get(a.sectionKind);
      if (!sec) {
        sec = {
          kind: a.sectionKind,
          displayName: a.sectionDisplayName,
          totalScore: 0,
          maxScore: 0,
          attempts: 0,
          items: [],
        };
        sectionMap.set(a.sectionKind, sec);
      }
      sec.totalScore += a.score;
      sec.maxScore += a.max;
      sec.attempts += 1;
      sec.items.push({
        itemId: a.itemId,
        correct: a.score === a.max ? true : a.score === 0 ? false : null,
        score: a.score,
        maxScore: a.max,
        expected: a.notes,
        studentResponse: stringifyStudentResponse(
          a.rawAnswer,
          a.itemCorrectAnswers,
        ),
        taskTemplateTitle: a.templateTitle,
      });
    }
    sectionsOut = [...sectionMap.values()].sort(
      (s1, s2) => sectionOrder(s1.kind) - sectionOrder(s2.kind),
    );
  }

  const totalScore = sectionsOut.reduce((a, s) => a + s.totalScore, 0);
  const maxScore = sectionsOut.reduce((a, s) => a + s.maxScore, 0);
  const startedAt = attempt.startedAt;
  const completedAt = attempt.completedAt;
  const durationSeconds = completedAt
    ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
    : Math.round((Date.now() - startedAt.getTime()) / 1000);

  return {
    attemptId,
    examCode: attempt.examCode as MockResults["examCode"],
    startedAt: startedAt.toISOString(),
    completedAt: completedAt ? completedAt.toISOString() : null,
    durationSeconds,
    totalScore,
    maxScore,
    sections: sectionsOut,
  };
}

function sectionOrder(kind: SectionKind): number {
  switch (kind) {
    case "listening":
      return 1;
    case "reading":
      return 2;
    case "grammar":
      return 3;
    case "writing":
      return 4;
    case "speaking":
      return 5;
  }
}

function stringifyStudentResponse(
  rawAnswer: unknown,
  itemPayload: unknown,
): string {
  if (!rawAnswer || typeof rawAnswer !== "object") return "";
  const r = rawAnswer as Record<string, unknown>;
  if (typeof r.value === "string") return r.value;
  if (typeof r.choice === "number") {
    const options = extractOptions(itemPayload);
    return options[r.choice] ?? `Вариант ${String.fromCharCode(65 + r.choice)}`;
  }
  return "";
}

function extractOptions(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as { options?: unknown };
  if (Array.isArray(p.options)) {
    return p.options.filter((x): x is string => typeof x === "string");
  }
  return [];
}

export const _internal = { sectionOrder };
