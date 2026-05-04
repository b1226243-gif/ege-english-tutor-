import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  answers,
  attempts,
  items,
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
