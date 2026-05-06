import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { items, taskTemplates } from "@/lib/db/schema";

import type { FipiManifest, FipiSectionEntry } from "./manifest";

export type ImportSectionResult = {
  section: FipiSectionEntry["section"];
  taskTemplateCode: string;
  taskTemplateId: string;
  inserted: number;
  duplicates: number;
  totalInBank: number;
};

export type ImportSummary = {
  examCode: FipiManifest["examCode"];
  source: FipiManifest["source"];
  sections: ImportSectionResult[];
  totalInserted: number;
  totalDuplicates: number;
};

/**
 * Idempotently import a parsed FIPI manifest. Each section block is
 * resolved to its existing `task_template` by stable code; failure to
 * find a template throws (we never silently create new templates from
 * a manifest because templates carry rubric / max_score / FIPI task
 * range that are owned by the codebase, not by content).
 *
 * Items are deduped by section-specific keys:
 *   - reading: (template, stimulusText, metadata.passage)
 *   - listening: (template, stimulusText, metadata.transcript)
 *   - grammar: (template, stimulusText)
 *
 * `dryRun=true` runs the validation + dedup checks without inserting.
 */
export async function importFipiManifest(
  db: PostgresJsDatabase<Record<string, never>>,
  manifest: FipiManifest,
  options: { dryRun?: boolean } = {},
): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const out: ImportSectionResult[] = [];
  let totalInserted = 0;
  let totalDuplicates = 0;

  for (const block of manifest.sections) {
    const [template] = await db
      .select({ id: taskTemplates.id })
      .from(taskTemplates)
      .where(eq(taskTemplates.code, block.taskTemplateCode))
      .limit(1);
    if (!template) {
      throw new Error(
        `Task template not found for code "${block.taskTemplateCode}". ` +
          `Run \`pnpm db:seed:${block.section}\` first to create the template.`,
      );
    }

    let inserted = 0;
    let duplicates = 0;
    for (const item of block.items) {
      const dup = await isDuplicate(db, template.id, block, item);
      if (dup) {
        duplicates += 1;
        continue;
      }
      if (!dryRun) {
        await insertItem(db, template.id, manifest, block, item);
      }
      inserted += 1;
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(eq(items.taskTemplateId, template.id));

    out.push({
      section: block.section,
      taskTemplateCode: block.taskTemplateCode,
      taskTemplateId: template.id,
      inserted,
      duplicates,
      totalInBank: Number(count),
    });
    totalInserted += inserted;
    totalDuplicates += duplicates;
  }

  return {
    examCode: manifest.examCode,
    source: manifest.source,
    sections: out,
    totalInserted,
    totalDuplicates,
  };
}

async function isDuplicate(
  db: PostgresJsDatabase<Record<string, never>>,
  taskTemplateId: string,
  block: FipiSectionEntry,
  item: FipiSectionEntry["items"][number],
): Promise<boolean> {
  if (block.section === "reading") {
    const it = item as Extract<typeof item, { passage: string }>;
    const existing = await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.taskTemplateId, taskTemplateId),
          eq(items.stimulusText, it.question),
          sql`${items.metadata}->>'passage' = ${it.passage}`,
        ),
      )
      .limit(1);
    return existing.length > 0;
  }
  if (block.section === "listening") {
    const it = item as Extract<typeof item, { transcript: string }>;
    const existing = await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.taskTemplateId, taskTemplateId),
          eq(items.stimulusText, it.question),
          sql`${items.metadata}->>'transcript' = ${it.transcript}`,
        ),
      )
      .limit(1);
    return existing.length > 0;
  }
  // grammar
  const it = item as Extract<typeof item, { stimulusText: string }>;
  const existing = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.taskTemplateId, taskTemplateId),
        eq(items.stimulusText, it.stimulusText),
      ),
    )
    .limit(1);
  return existing.length > 0;
}

async function insertItem(
  db: PostgresJsDatabase<Record<string, never>>,
  taskTemplateId: string,
  manifest: FipiManifest,
  block: FipiSectionEntry,
  item: FipiSectionEntry["items"][number],
): Promise<void> {
  const baseMetadata: Record<string, unknown> = {
    fipi_source: manifest.source,
    ...(manifest.sourceUrl ? { fipi_source_url: manifest.sourceUrl } : {}),
  };
  if (block.section === "reading") {
    const it = item as Extract<typeof item, { passage: string }>;
    await db.insert(items).values({
      taskTemplateId,
      source: "fipi_demo",
      stimulusText: it.question,
      correctAnswers: it.answer,
      metadata: {
        ...baseMetadata,
        passage: it.passage,
        ...(it.metadata ?? {}),
      },
    });
    return;
  }
  if (block.section === "listening") {
    const it = item as Extract<typeof item, { transcript: string }>;
    await db.insert(items).values({
      taskTemplateId,
      source: "fipi_demo",
      stimulusText: it.question,
      correctAnswers: it.answer,
      metadata: {
        ...baseMetadata,
        transcript: it.transcript,
        ...(it.voice ? { voice: it.voice } : {}),
        ...(it.metadata ?? {}),
      },
    });
    return;
  }
  // grammar
  const it = item as Extract<typeof item, { stimulusText: string }>;
  await db.insert(items).values({
    taskTemplateId,
    source: "fipi_demo",
    stimulusText: it.stimulusText,
    correctAnswers: it.answer,
    metadata: {
      ...baseMetadata,
      ...(it.metadata ?? {}),
    },
  });
}
