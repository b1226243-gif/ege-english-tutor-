import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  answers,
  attempts,
  items,
  rubricScores,
  sections,
  taskTemplates,
} from "@/lib/db/schema";
import type { ExamCode, SectionKind } from "@/lib/db/schema";

/**
 * Aggregations behind the topic progress dashboard (PR #12).
 *
 * The autograde happens in `/api/{grammar,reading,listening}/answer` and
 * writes `answer.auto_score` (0/1 per item) plus `attempt.exam_code`. We
 * read those rows back here, joined to `items.metadata->>'topic'` and
 * `sections.kind`, and compute accuracy buckets.
 *
 * AI-graded sections (Writing / Speaking) are intentionally excluded:
 * their score lives in `rubric_scores`, not in a per-item correct/
 * incorrect bit, and "accuracy" is the wrong shape for them. Those
 * sections get their own roll-up later if needed.
 */

type SourceFilter = "all" | "fipi_demo" | "ai_generated" | "user_authored";

export type SectionAccuracy = {
  sectionKind: SectionKind;
  attempted: number;
  correct: number;
};

export type TopicAccuracy = {
  topic: string;
  sectionKind: SectionKind;
  attempted: number;
  correct: number;
};

export type ProgressOverview = {
  total: { attempted: number; correct: number };
  bySection: SectionAccuracy[];
  byTopic: TopicAccuracy[];
};

const OBJECTIVE_SECTIONS: SectionKind[] = ["reading", "listening", "grammar"];

/**
 * Pull all answers for a user within one exam, restricted to objective
 * sections, optionally filtered by item.source. Returns aggregates for
 * the per-section and per-topic charts in one round-trip.
 */
export async function getProgressOverview(params: {
  userId: string;
  examCode: ExamCode;
  source?: SourceFilter;
}): Promise<ProgressOverview> {
  const source: SourceFilter = params.source ?? "all";

  const baseWhere = and(
    eq(attempts.userId, params.userId),
    eq(attempts.examCode, params.examCode),
    sql`${sections.kind} = ANY(${sql.raw(
      `ARRAY[${OBJECTIVE_SECTIONS.map((k) => `'${k}'`).join(",")}]::section_kind[]`,
    )})`,
    source === "all" ? sql`true` : eq(items.source, source),
    sql`${answers.autoScore} IS NOT NULL`,
  );

  const sectionRows = await db()
    .select({
      sectionKind: sections.kind,
      attempted: sql<number>`count(*)::int`,
      correct: sql<number>`coalesce(sum(${answers.autoScore}), 0)::int`,
    })
    .from(answers)
    .innerJoin(attempts, eq(answers.attemptId, attempts.id))
    .innerJoin(items, eq(answers.itemId, items.id))
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(baseWhere)
    .groupBy(sections.kind);

  const topicRows = await db()
    .select({
      topic: sql<string>`coalesce(${items.metadata}->>'topic', '__untagged')`,
      sectionKind: sections.kind,
      attempted: sql<number>`count(*)::int`,
      correct: sql<number>`coalesce(sum(${answers.autoScore}), 0)::int`,
    })
    .from(answers)
    .innerJoin(attempts, eq(answers.attemptId, attempts.id))
    .innerJoin(items, eq(answers.itemId, items.id))
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(baseWhere)
    .groupBy(sql`coalesce(${items.metadata}->>'topic', '__untagged')`, sections.kind)
    .orderBy(sql`count(*) desc`);

  const total = sectionRows.reduce(
    (acc, row) => ({
      attempted: acc.attempted + Number(row.attempted),
      correct: acc.correct + Number(row.correct),
    }),
    { attempted: 0, correct: 0 },
  );

  return {
    total,
    bySection: sectionRows.map((r) => ({
      sectionKind: r.sectionKind as SectionKind,
      attempted: Number(r.attempted),
      correct: Number(r.correct),
    })),
    byTopic: topicRows.map((r) => ({
      topic: String(r.topic),
      sectionKind: r.sectionKind as SectionKind,
      attempted: Number(r.attempted),
      correct: Number(r.correct),
    })),
  };
}

/**
 * Per-criterion roll-up for one AI-graded section (writing or speaking).
 * `attempts` here means the number of distinct answers that had at least
 * one rubric_score row (one per task — task 37 + task 38 in EGE writing,
 * tasks 1..4 in EGE speaking). `scoreSum` / `maxSum` add across all
 * criteria across all those answers.
 */
export type AiCriterionRollup = {
  code: string;
  label: string | null;
  scoreSum: number;
  maxSum: number;
  graded: number;
};

export type AiSectionRollup = {
  sectionKind: SectionKind;
  graded: number;
  scoreSum: number;
  maxSum: number;
  byCriterion: AiCriterionRollup[];
};

export type AiOverview = {
  bySection: AiSectionRollup[];
};

/**
 * Aggregations for the AI-graded sections (writing / speaking).
 *
 * Unlike the objective sections we cannot sum a 0/1 `auto_score`, since
 * AI grades on continuous K-criteria rubrics. Instead we sum
 * `rubric_score.score` (and `max_score`) per criterion code per section
 * and let the UI render a "graded N/M" + per-K bar instead of an
 * accuracy percentage.
 *
 * Source filter is intentionally NOT applied here — writing/speaking
 * curated banks don't have meaningful "fipi_demo vs ai_generated"
 * provenance, and the FIPI manifest importer (PR #10) only seeds
 * objective items. If you arrive on this page with `?source=` set
 * we still show the same AI roll-up to keep the picture complete.
 */
export async function getAiOverview(params: {
  userId: string;
  examCode: ExamCode;
}): Promise<AiOverview> {
  const baseWhere = and(
    eq(attempts.userId, params.userId),
    eq(attempts.examCode, params.examCode),
    sql`${sections.kind} = ANY(ARRAY['writing','speaking']::section_kind[])`,
  );

  const rows = await db()
    .select({
      sectionKind: sections.kind,
      criterionCode: rubricScores.criterionCode,
      criterionLabel: rubricScores.criterionLabel,
      score: rubricScores.score,
      max: rubricScores.maxScore,
      answerId: rubricScores.answerId,
    })
    .from(rubricScores)
    .innerJoin(answers, eq(rubricScores.answerId, answers.id))
    .innerJoin(attempts, eq(answers.attemptId, attempts.id))
    .innerJoin(items, eq(answers.itemId, items.id))
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(baseWhere);

  type AccCrit = {
    code: string;
    label: string | null;
    scoreSum: number;
    maxSum: number;
    answerIds: Set<string>;
  };
  const sectionMap = new Map<
    SectionKind,
    {
      answerIds: Set<string>;
      scoreSum: number;
      maxSum: number;
      criteria: Map<string, AccCrit>;
    }
  >();
  for (const r of rows) {
    const kind = r.sectionKind as SectionKind;
    if (!sectionMap.has(kind)) {
      sectionMap.set(kind, {
        answerIds: new Set(),
        scoreSum: 0,
        maxSum: 0,
        criteria: new Map(),
      });
    }
    const sec = sectionMap.get(kind)!;
    sec.answerIds.add(r.answerId);
    sec.scoreSum += r.score;
    sec.maxSum += r.max;

    const crit = sec.criteria.get(r.criterionCode) ?? {
      code: r.criterionCode,
      label: r.criterionLabel,
      scoreSum: 0,
      maxSum: 0,
      answerIds: new Set<string>(),
    };
    crit.scoreSum += r.score;
    crit.maxSum += r.max;
    crit.answerIds.add(r.answerId);
    sec.criteria.set(r.criterionCode, crit);
  }

  // Stable display order: writing first, then speaking. Criteria sort
  // alphanumerically by code (K1..K5 sorts naturally).
  const orderedKinds: SectionKind[] = ["writing", "speaking"];
  const bySection: AiSectionRollup[] = [];
  for (const kind of orderedKinds) {
    const sec = sectionMap.get(kind);
    if (!sec) continue;
    bySection.push({
      sectionKind: kind,
      graded: sec.answerIds.size,
      scoreSum: sec.scoreSum,
      maxSum: sec.maxSum,
      byCriterion: [...sec.criteria.values()]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => ({
          code: c.code,
          label: c.label,
          scoreSum: c.scoreSum,
          maxSum: c.maxSum,
          graded: c.answerIds.size,
        })),
    });
  }
  return { bySection };
}

export const SOURCE_FILTERS: ReadonlyArray<{
  value: SourceFilter;
  label: string;
}> = [
  { value: "all", label: "Все источники" },
  { value: "fipi_demo", label: "ФИПИ" },
  { value: "ai_generated", label: "AI-генератор" },
  { value: "user_authored", label: "Авторские" },
];

export function isSourceFilter(v: string): v is SourceFilter {
  return SOURCE_FILTERS.some((s) => s.value === v);
}
