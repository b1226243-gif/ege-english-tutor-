import { z } from "zod";

import { SUPPORTED_EXAM_CODES } from "@/lib/exams";
import { GrammarAnswerSchema } from "@/lib/grammar/types";
import { ListeningAnswerSchema } from "@/lib/listening/types";
import { ReadingAnswerSchema } from "@/lib/reading/types";

/**
 * FIPI manifest format: a stable JSON shape the operator hand-crafts (or
 * generates from a PDF text dump) and feeds to `pnpm db:import:fipi`.
 *
 * The manifest sits between FIPI source material (PDF demo variants on
 * fipi.ru) and the database. We deliberately do NOT try to parse PDFs
 * into manifests automatically yet — FIPI changes formatting yearly and
 * heuristic extractors break silently. The honest workflow is:
 *
 *   1. Operator downloads a demo PDF from fipi.ru.
 *   2. Operator extracts text (e.g. via `pdftotext -layout demo.pdf`).
 *   3. Operator hand-edits a manifest JSON, paragraph by paragraph,
 *      filling in passage / question / options / answer index.
 *   4. `pnpm db:import:fipi <path>` validates the manifest + idempotently
 *      upserts items into the bank under the matching task_template.
 *
 * The dedup key per item is section-aware (see `data/fipi/README.md`):
 *   - Reading: (template, stimulusText, metadata.passage)
 *   - Listening: (template, stimulusText, metadata.transcript)
 *   - Grammar: (template, stimulusText)
 *
 * Items are inserted with `source = "fipi"` so dashboards can later
 * filter / weight them differently from user-authored content.
 */

export const FIPI_MANIFEST_VERSION = 1 as const;

const ExamCodeSchema = z.enum(
  SUPPORTED_EXAM_CODES as readonly [string, ...string[]],
);

const ReadingItemSchema = z.object({
  /** Reading passage rendered above the question (Markdown). */
  passage: z.string().min(20),
  /** Question stem / task prompt. */
  question: z.string().min(3),
  answer: ReadingAnswerSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ListeningItemSchema = z.object({
  /** Full transcript of the audio fragment. Used both for grading-side
   *  evidence and as the dedup key, since stimulusText alone is often
   *  generic ("What does the speaker mean?"). */
  transcript: z.string().min(20),
  question: z.string().min(3),
  answer: ListeningAnswerSchema,
  /** Optional FIPI fragment voice (m / f / dialog) — purely informational. */
  voice: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const GrammarItemSchema = z.object({
  /** The cloze / word-formation prompt with `___` for the gap. */
  stimulusText: z.string().min(3),
  answer: GrammarAnswerSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const SectionEntrySchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("reading"),
    /** Stable task_template.code, e.g. "ege_en.reading.matching_headings". */
    taskTemplateCode: z.string().min(1),
    items: z.array(ReadingItemSchema).min(1),
  }),
  z.object({
    section: z.literal("listening"),
    taskTemplateCode: z.string().min(1),
    items: z.array(ListeningItemSchema).min(1),
  }),
  z.object({
    section: z.literal("grammar"),
    taskTemplateCode: z.string().min(1),
    items: z.array(GrammarItemSchema).min(1),
  }),
]);

export const FipiManifestSchema = z.object({
  /** Schema version — bumped on breaking changes. */
  version: z.literal(FIPI_MANIFEST_VERSION),
  /** Which exam these items belong to. */
  examCode: ExamCodeSchema,
  /**
   * Free-form provenance label, surfaced in `item.metadata.fipi_source`
   * so dashboards can later filter "demo 2025" vs "demo 2024" etc.
   */
  source: z.string().min(1),
  /** Optional URL of the original FIPI demo PDF — recorded on each item. */
  sourceUrl: z.string().url().optional(),
  /** Each section block targets one task_template by its stable code. */
  sections: z.array(SectionEntrySchema).min(1),
});

export type FipiManifest = z.infer<typeof FipiManifestSchema>;
export type FipiSectionEntry = z.infer<typeof SectionEntrySchema>;
export type FipiReadingItem = z.infer<typeof ReadingItemSchema>;
export type FipiListeningItem = z.infer<typeof ListeningItemSchema>;
export type FipiGrammarItem = z.infer<typeof GrammarItemSchema>;
