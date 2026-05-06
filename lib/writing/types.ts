/**
 * Shared types for the writing module — shape of a saved answer & the
 * AI-graded score. Mirrors `lib/speaking/types.ts`.
 *
 * Important: writing AI-grading happens on demand from the mock results
 * page (it is slow and can fail on quota), not inline during the mock
 * run. While the answer waits to be graded, `score` is null.
 */

import { z } from "zod";

import type { WritingFormat } from "@/lib/writing/descriptors";

export const WritingScoreCriterionSchema = z.object({
  code: z.string(),
  label: z.string(),
  score: z.number().int().min(0),
  max: z.number().int().min(0),
  notes: z.string(),
});

export const WritingScoreSchema = z.object({
  total: z.number().int().min(0),
  max: z.number().int().min(0),
  scores: z.array(WritingScoreCriterionSchema).min(1),
  /** Concise overall note in Russian / mixed RU+EN, ≤ 600 chars. */
  summary: z.string().min(1),
  /**
   * Up to 8 specific issues with the student's text — each as a Socratic
   * question quoting the exact problematic phrase, in the spirit of the
   * BASE_SYSTEM_PROMPT.
   */
  errors: z
    .array(
      z.object({
        quote: z.string().min(1).max(280),
        question: z.string().min(1).max(280),
      }),
    )
    .max(8),
});

export type WritingScore = z.infer<typeof WritingScoreSchema>;

/**
 * Persisted shape on `answer.raw_answer` for writing items.
 * - `format` lets the results page pick the right descriptor for redisplay.
 * - `score` is null until AI grading has run.
 */
export type WritingRawAnswer = {
  type: "writing";
  format: WritingFormat;
  text: string;
  wordCount: number;
  score: WritingScore | null;
};
