import { and, asc, eq } from "drizzle-orm";

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
import {
  WRITING_DESCRIPTORS,
  totalWritingMax,
  type WritingFormat,
} from "@/lib/writing/descriptors";
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

  // Writing answers are not auto-graded — they persist as draft text and
  // are AI-graded on demand from the results page (see
  // `/api/mock/writing/score`). They live on the same `answers` row but
  // skip the rubric_scores branch entirely.
  if (request.kind === "writing_essay" && item.sectionKind === "writing") {
    return savePendingWritingAnswer(request);
  }

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

async function savePendingWritingAnswer(
  request: Extract<MockAnswerRequest, { kind: "writing_essay" }>,
): Promise<{ answerId: string }> {
  const text = request.text.trim();
  const wordCount = countWords(text);
  // Lazy import keeps the writing module out of the listening/reading
  // hot path. The descriptor format comes from the plan stored on the
  // attempt — we look it up via the item's task_template.
  const [tpl] = await db()
    .select({ config: taskTemplates.config })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .where(eq(items.id, request.itemId))
    .limit(1);
  const cfg = (tpl?.config ?? {}) as { format?: string };
  const format = cfg.format ?? "task_37_email";

  const rawAnswer = {
    type: "writing" as const,
    format,
    text,
    wordCount,
    score: null,
  };

  const answerId = await db().transaction(async (tx) => {
    const [upserted] = await tx
      .insert(answers)
      .values({
        attemptId: request.attemptId,
        itemId: request.itemId,
        rawAnswer,
        autoScore: null,
      })
      .onConflictDoUpdate({
        target: [answers.attemptId, answers.itemId],
        set: {
          rawAnswer,
          autoScore: null,
        },
      })
      .returning({ id: answers.id });

    // Drop any stale rubric_scores from a previous AI evaluation — when
    // the student edits and resubmits, the old AI score no longer
    // describes the new draft.
    await tx
      .delete(rubricScores)
      .where(eq(rubricScores.answerId, upserted.id));

    return upserted.id;
  });
  return { answerId };
}

/**
 * Persist a Whisper transcript as a pending speaking answer (no AI score
 * yet). Mirrors `savePendingWritingAnswer` — the runner uploads the audio
 * blob to `/api/mock/speaking/transcribe`, which transcribes via Whisper
 * and calls this helper. AI scoring stays deferred until the student
 * clicks "Оценить AI" on the results page.
 */
export async function savePendingSpeakingAnswer(params: {
  userId: string;
  attemptId: string;
  itemId: string;
  transcript: string;
  audioDurationSeconds: number;
}): Promise<{ answerId: string }> {
  const { userId, attemptId, itemId, transcript, audioDurationSeconds } = params;
  const attempt = await getMockAttempt(attemptId);
  if (!attempt) throw new Error("Mock attempt not found");
  if (attempt.userId !== userId) throw new Error("Forbidden");
  if (attempt.status !== "in_progress") {
    throw new Error("Mock attempt is already submitted");
  }

  const [item] = await db()
    .select({
      id: items.id,
      sectionKind: sections.kind,
      templateConfig: taskTemplates.config,
    })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(eq(items.id, itemId))
    .limit(1);
  if (!item) throw new Error("Item not found");
  if (item.sectionKind !== "speaking") {
    throw new Error("Item is not a speaking item");
  }

  const cfg = (item.templateConfig ?? {}) as { format?: string };
  const format = cfg.format ?? "read_aloud";

  const rawAnswer = {
    type: "speaking" as const,
    format,
    transcript: transcript.trim(),
    audioDurationSeconds: Math.max(0, Math.round(audioDurationSeconds)),
    score: null,
  };

  const answerId = await db().transaction(async (tx) => {
    const [upserted] = await tx
      .insert(answers)
      .values({
        attemptId,
        itemId,
        rawAnswer,
        autoScore: null,
      })
      .onConflictDoUpdate({
        target: [answers.attemptId, answers.itemId],
        set: {
          rawAnswer,
          autoScore: null,
        },
      })
      .returning({ id: answers.id });

    // Re-recording invalidates any prior AI score.
    await tx
      .delete(rubricScores)
      .where(eq(rubricScores.answerId, upserted.id));

    return upserted.id;
  });
  return { answerId };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
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
/**
 * Persist an AI-generated writing score for a mock answer. Mirrors the
 * speaking flow: total score is the sum of per-criterion scores; one
 * `rubric_score` row per criterion. Idempotent — re-running replaces
 * the previous evaluation atomically.
 *
 * Caller is responsible for clamping each criterion score to its
 * declared max (we trust the input, but also enforce it again here).
 */
export async function persistMockWritingScore(params: {
  userId: string;
  attemptId: string;
  itemId: string;
  score: {
    total: number;
    max: number;
    scores: { code: string; label: string; score: number; max: number; notes: string }[];
    summary: string;
    errors: { quote: string; question: string }[];
  };
}): Promise<{ answerId: string }> {
  const { userId, attemptId, itemId, score } = params;
  const attempt = await getMockAttempt(attemptId);
  if (!attempt) throw new Error("Mock attempt not found");
  if (attempt.userId !== userId) throw new Error("Forbidden");

  const [row] = await db()
    .select({
      id: answers.id,
      rawAnswer: answers.rawAnswer,
    })
    .from(answers)
    .where(and(eq(answers.attemptId, attemptId), eq(answers.itemId, itemId)))
    .limit(1);
  if (!row) throw new Error("Writing draft not found");
  const raw = (row.rawAnswer ?? {}) as Record<string, unknown>;
  if (raw.type !== "writing") {
    throw new Error("Item is not a writing answer");
  }

  const totalScore = score.scores.reduce((sum, s) => sum + s.score, 0);
  const totalMax = score.scores.reduce((sum, s) => sum + s.max, 0);
  const updatedRaw = {
    ...raw,
    score: {
      total: totalScore,
      max: totalMax,
      scores: score.scores,
      summary: score.summary,
      errors: score.errors,
    },
  };

  await db().transaction(async (tx) => {
    await tx
      .update(answers)
      .set({ rawAnswer: updatedRaw, autoScore: totalScore })
      .where(eq(answers.id, row.id));
    await tx.delete(rubricScores).where(eq(rubricScores.answerId, row.id));
    await tx.insert(rubricScores).values(
      score.scores.map((c) => ({
        answerId: row.id,
        criterionCode: c.code,
        criterionLabel: c.label,
        score: c.score,
        maxScore: c.max,
        notes: c.notes,
      })),
    );
  });

  return { answerId: row.id };
}

/**
 * Persist an AI-generated speaking score for a mock answer. Mirrors
 * `persistMockWritingScore` exactly — same idempotent
 * (update + delete + reinsert) shape, just with a `speaking`-typed raw
 * answer.
 */
export async function persistMockSpeakingScore(params: {
  userId: string;
  attemptId: string;
  itemId: string;
  score: {
    total: number;
    max: number;
    scores: { code: string; label: string; score: number; max: number; notes: string }[];
    summary: string;
    errors: { quote: string; question: string }[];
  };
}): Promise<{ answerId: string }> {
  const { userId, attemptId, itemId, score } = params;
  const attempt = await getMockAttempt(attemptId);
  if (!attempt) throw new Error("Mock attempt not found");
  if (attempt.userId !== userId) throw new Error("Forbidden");

  const [row] = await db()
    .select({ id: answers.id, rawAnswer: answers.rawAnswer })
    .from(answers)
    .where(and(eq(answers.attemptId, attemptId), eq(answers.itemId, itemId)))
    .limit(1);
  if (!row) throw new Error("Speaking transcript not found");
  const raw = (row.rawAnswer ?? {}) as Record<string, unknown>;
  if (raw.type !== "speaking") {
    throw new Error("Item is not a speaking answer");
  }

  const totalScore = score.scores.reduce((sum, s) => sum + s.score, 0);
  const totalMax = score.scores.reduce((sum, s) => sum + s.max, 0);
  const updatedRaw = {
    ...raw,
    score: {
      total: totalScore,
      max: totalMax,
      scores: score.scores,
      summary: score.summary,
      errors: score.errors,
    },
  };

  await db().transaction(async (tx) => {
    await tx
      .update(answers)
      .set({ rawAnswer: updatedRaw, autoScore: totalScore })
      .where(eq(answers.id, row.id));
    await tx.delete(rubricScores).where(eq(rubricScores.answerId, row.id));
    await tx.insert(rubricScores).values(
      score.scores.map((c) => ({
        answerId: row.id,
        criterionCode: c.code,
        criterionLabel: c.label,
        score: c.score,
        maxScore: c.max,
        notes: c.notes,
      })),
    );
  });

  return { answerId: row.id };
}

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
        // Per-item max: writing is rubric-based (FIPI K1..K5 — total 6/10/14
        // depending on format), speaking is rubric-based (FIPI K1..K3 — varies
        // per task), all other mock kinds are worth 1 point each.
        const itemMax = planItemMax(planItem.stimulus);
        const writingItem = isWritingPlanItem(planItem.stimulus);
        const speakingItem = isSpeakingPlanItem(planItem.stimulus);
        const aiGradedItem = writingItem || speakingItem;
        const a = byItemId.get(planItem.id);
        if (a) {
          // For writing/speaking items where the AI grader hasn't run yet,
          // the answer row exists with no rubric_scores — `a.score` is 0
          // and `a.max` defaults to 1. Use the planItem's true max so the
          // denominator stays honest.
          const effectiveMax =
            aiGradedItem && a.max === 1 && a.score === 0 ? itemMax : a.max;
          const correct = aiGradedItem
            ? // "correct" is meaningless for AI-graded items — neutral
              // marker until graded.
              a.score === effectiveMax
              ? true
              : null
            : a.score === effectiveMax
              ? true
              : a.score === 0
                ? false
                : null;
          sec.totalScore += a.score;
          sec.maxScore += effectiveMax;
          sec.attempts += 1;
          sec.items.push({
            itemId: planItem.id,
            correct,
            score: a.score,
            maxScore: effectiveMax,
            expected: a.notes,
            studentResponse: stringifyStudentResponse(
              a.rawAnswer,
              a.itemCorrectAnswers,
            ),
            taskTemplateTitle: planItem.taskTemplateTitle,
            writing: writingPayload(planItem.stimulus, a.rawAnswer),
            speaking: speakingPayload(planItem.stimulus, a.rawAnswer),
          });
        } else {
          sec.maxScore += itemMax;
          sec.items.push({
            itemId: planItem.id,
            correct: null,
            score: 0,
            maxScore: itemMax,
            expected: null,
            studentResponse: "",
            taskTemplateTitle: planItem.taskTemplateTitle,
            writing: writingPayload(planItem.stimulus, null),
            speaking: speakingPayload(planItem.stimulus, null),
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
  if (r.type === "writing" && typeof r.text === "string") return r.text;
  if (r.type === "speaking" && typeof r.transcript === "string") {
    return r.transcript;
  }
  if (typeof r.value === "string") return r.value;
  if (typeof r.choice === "number") {
    const options = extractOptions(itemPayload);
    return options[r.choice] ?? `Вариант ${String.fromCharCode(65 + r.choice)}`;
  }
  return "";
}

function isWritingPlanItem(
  stim: { kind: string },
): boolean {
  return stim.kind === "writing_email" || stim.kind === "writing_essay";
}

function isSpeakingPlanItem(
  stim: { kind: string },
): boolean {
  return stim.kind.startsWith("speaking_");
}

function writingPayload(
  stim: { kind: string; format?: string; minWords?: number; maxWords?: number; hardMin?: number },
  rawAnswer: unknown,
): MockSectionResult["items"][number]["writing"] {
  if (!isWritingPlanItem(stim)) return undefined;
  const format = stim.format as WritingFormat | undefined;
  const descriptor = WRITING_DESCRIPTORS.find((d) => d.format === format);
  if (!descriptor) return undefined;
  const raw = (rawAnswer ?? {}) as Record<string, unknown>;
  const wordCount =
    typeof raw.wordCount === "number" ? (raw.wordCount as number) : 0;
  type WritingPayload = NonNullable<
    MockSectionResult["items"][number]["writing"]
  >;
  const score = (raw.score ?? null) as WritingPayload["score"];
  return {
    format: descriptor.format,
    wordCount,
    minWords: descriptor.minWords,
    maxWords: descriptor.maxWords,
    hardMin: descriptor.hardMin,
    score,
  };
}

function planItemMax(stim: {
  kind: string;
  format?: string;
  maxScore?: number;
}): number {
  if (isSpeakingPlanItem(stim)) {
    return typeof stim.maxScore === "number" ? stim.maxScore : 1;
  }
  if (!isWritingPlanItem(stim)) return 1;
  const format = stim.format as WritingFormat | undefined;
  const descriptor = WRITING_DESCRIPTORS.find((d) => d.format === format);
  if (!descriptor) return 1;
  return totalWritingMax(descriptor.rubric);
}

function speakingPayload(
  stim: {
    kind: string;
    format?: string;
    fipiTaskRange?: string;
    maxScore?: number;
  },
  rawAnswer: unknown,
): MockSectionResult["items"][number]["speaking"] {
  if (!isSpeakingPlanItem(stim)) return undefined;
  const raw = (rawAnswer ?? {}) as Record<string, unknown>;
  const transcript = typeof raw.transcript === "string" ? raw.transcript : "";
  const audioDurationSeconds =
    typeof raw.audioDurationSeconds === "number"
      ? (raw.audioDurationSeconds as number)
      : 0;
  type SpeakingPayload = NonNullable<
    MockSectionResult["items"][number]["speaking"]
  >;
  const score = (raw.score ?? null) as SpeakingPayload["score"];
  return {
    format: (stim.format ?? "read_aloud") as SpeakingPayload["format"],
    taskRange: stim.fipiTaskRange ?? "",
    audioDurationSeconds,
    transcript,
    score,
  };
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
