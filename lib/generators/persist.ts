import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { items, taskTemplates } from "@/lib/db/schema";

/**
 * Persist a batch of AI-generated items under an existing task_template
 * (resolved by stable code). Idempotent against the dedup key the
 * generator currently uses (stimulusText alone is enough for grammar;
 * for reading we also key on the passage to avoid colliding when the
 * same question stem is reused across passages).
 *
 * Items are written with `source = "ai_generated"` so dashboards (PR
 * #12) can filter / weight them differently from FIPI demo items.
 */

type Section = "grammar" | "reading";

type PersistInput = {
  section: Section;
  taskTemplateCode: string;
  items: Array<{
    stimulusText: string;
    correctAnswers: unknown;
    /**
     * For reading items, callers pre-merge `passage` into metadata.
     * For grammar items, callers can pass topic/difficulty/etc.
     */
    metadata: Record<string, unknown>;
  }>;
};

export type PersistResult = {
  taskTemplateId: string;
  inserted: number;
  duplicates: number;
};

export async function persistGeneratedItems(
  input: PersistInput,
): Promise<PersistResult> {
  const [template] = await db()
    .select({ id: taskTemplates.id })
    .from(taskTemplates)
    .where(eq(taskTemplates.code, input.taskTemplateCode))
    .limit(1);
  if (!template) {
    throw new Error(
      `Task template not found for code "${input.taskTemplateCode}".`,
    );
  }

  let inserted = 0;
  let duplicates = 0;
  for (const it of input.items) {
    const passage =
      typeof it.metadata.passage === "string" ? it.metadata.passage : null;
    const dupQuery = db()
      .select({ id: items.id })
      .from(items)
      .where(
        passage
          ? and(
              eq(items.taskTemplateId, template.id),
              eq(items.stimulusText, it.stimulusText),
              sql`${items.metadata}->>'passage' = ${passage}`,
            )
          : and(
              eq(items.taskTemplateId, template.id),
              eq(items.stimulusText, it.stimulusText),
            ),
      )
      .limit(1);
    const existing = await dupQuery;
    if (existing.length > 0) {
      duplicates += 1;
      continue;
    }
    await db().insert(items).values({
      taskTemplateId: template.id,
      source: "ai_generated",
      stimulusText: it.stimulusText,
      correctAnswers: it.correctAnswers as never,
      metadata: it.metadata,
    });
    inserted += 1;
  }
  return { taskTemplateId: template.id, inserted, duplicates };
}
