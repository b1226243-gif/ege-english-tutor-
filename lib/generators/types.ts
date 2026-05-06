import { z } from "zod";

import {
  LexicalMcAnswerSchema,
  TransformAnswerSchema,
  WordFormationAnswerSchema,
} from "@/lib/grammar/types";
import { ReadingMcAnswerSchema } from "@/lib/reading/types";

/**
 * Schemas for AI-generator outputs. We deliberately mirror the existing
 * answer schemas so a generated item is shaped identically to a hand-
 * curated item in the bank — same `correctAnswers` JSON, same grading
 * path, same metadata shape.
 *
 * The metadata field is required (not optional) on generator output so
 * we always have at least { topic, difficulty } for filtering later
 * (PR #12 dashboards).
 */

const GeneratorMetadataSchema = z.object({
  topic: z.string().min(1).max(60),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

export const GeneratedTransformItemSchema = z.object({
  stimulusText: z.string().min(8).max(400),
  answer: TransformAnswerSchema,
  metadata: GeneratorMetadataSchema,
});

export const GeneratedWordFormationItemSchema = z.object({
  stimulusText: z.string().min(8).max(400),
  answer: WordFormationAnswerSchema,
  metadata: GeneratorMetadataSchema,
});

export const GeneratedLexicalMcItemSchema = z.object({
  stimulusText: z.string().min(8).max(400),
  answer: LexicalMcAnswerSchema,
  metadata: GeneratorMetadataSchema,
});

export const GeneratedReadingItemSchema = z.object({
  passage: z.string().min(80).max(2000),
  question: z.string().min(5).max(300),
  answer: ReadingMcAnswerSchema,
  metadata: GeneratorMetadataSchema,
});

export type GeneratedTransformItem = z.infer<
  typeof GeneratedTransformItemSchema
>;
export type GeneratedWordFormationItem = z.infer<
  typeof GeneratedWordFormationItemSchema
>;
export type GeneratedLexicalMcItem = z.infer<
  typeof GeneratedLexicalMcItemSchema
>;
export type GeneratedReadingItem = z.infer<typeof GeneratedReadingItemSchema>;

/** Number of items per generation request — kept small to bound cost + latency. */
export const MIN_BATCH = 1;
export const MAX_BATCH = 5;
