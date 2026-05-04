import { z } from "zod";

/**
 * Grammar & vocabulary item payload schemas.
 *
 * Each grammar `item` row stores its "grading contract" in
 * `item.correct_answers` as JSON. The shape depends on the task type. We
 * parse it with these schemas both server-side (when grading) and
 * client-side (when rendering the input).
 */

/** Open Cloze (ЕГЭ 19–24 / ОГЭ 27–32). Student types the transformed form. */
export const TransformAnswerSchema = z.object({
  type: z.literal("transform"),
  /** Base word shown in CAPS inside parentheses in the prompt, e.g. "SING". */
  base: z.string().min(1),
  /** Canonical accepted answer (trimmed, case-insensitive by default). */
  answer: z.string().min(1),
  /** Other acceptable surface forms (e.g. contractions). */
  alternatives: z.array(z.string()).default([]),
  /** Optional student-facing grammar hint ("present continuous", "past simple"). */
  hint: z.string().optional(),
});

/** Word Formation (ЕГЭ 25–29 / ОГЭ 18–26). Student types the derived word. */
export const WordFormationAnswerSchema = z.object({
  type: z.literal("word_formation"),
  /** Root word shown in CAPS in the margin, e.g. "HAPPY". */
  base: z.string().min(1),
  /** Canonical answer, usually in CAPS by FIPI convention, e.g. "HAPPINESS". */
  answer: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
  /** Part of speech hint: noun / verb / adjective / adverb. */
  pos: z.enum(["noun", "verb", "adjective", "adverb"]).optional(),
});

/** Lexical Multiple Choice (ЕГЭ 30–36). Student picks one of 4 options. */
export const LexicalMcAnswerSchema = z.object({
  type: z.literal("lexical_mc"),
  options: z.array(z.string()).length(4),
  /** 0-based index into `options` of the correct choice. */
  answer: z.number().int().min(0).max(3),
});

export const GrammarAnswerSchema = z.discriminatedUnion("type", [
  TransformAnswerSchema,
  WordFormationAnswerSchema,
  LexicalMcAnswerSchema,
]);

export type TransformAnswer = z.infer<typeof TransformAnswerSchema>;
export type WordFormationAnswer = z.infer<typeof WordFormationAnswerSchema>;
export type LexicalMcAnswer = z.infer<typeof LexicalMcAnswerSchema>;
export type GrammarAnswer = z.infer<typeof GrammarAnswerSchema>;

export type GrammarTaskType = GrammarAnswer["type"];

/** Raw student response for a single item. */
export const GrammarStudentAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("transform"), value: z.string() }),
  z.object({ type: z.literal("word_formation"), value: z.string() }),
  z.object({
    type: z.literal("lexical_mc"),
    /** Index the student picked (0–3). */
    choice: z.number().int().min(0).max(3),
  }),
]);

export type GrammarStudentAnswer = z.infer<typeof GrammarStudentAnswerSchema>;

/** UI metadata for the dashboard picker. */
export type GrammarTaskDescriptor = {
  type: GrammarTaskType;
  /** Stable slug used in URLs / task_template.code. */
  codeSuffix: string;
  displayName: string;
  shortDescription: string;
  /** Range of FIPI task numbers this covers in the source exam. */
  fipiTaskRange: string;
};

/**
 * Grade a student's response against the canonical item payload. Returns
 * {correct, expected} — the UI uses `expected` to show the right answer
 * after submission.
 */
export function gradeGrammarAnswer(
  item: GrammarAnswer,
  response: GrammarStudentAnswer,
): { correct: boolean; expected: string } {
  if (item.type !== response.type) {
    return { correct: false, expected: renderExpected(item) };
  }
  switch (item.type) {
    case "transform":
    case "word_formation": {
      const resp = (response as { value: string }).value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (!resp) {
        return { correct: false, expected: item.answer };
      }
      const candidates = [item.answer, ...item.alternatives].map((c) =>
        c.trim().toLowerCase().replace(/\s+/g, " "),
      );
      return {
        correct: candidates.includes(resp),
        expected: item.answer,
      };
    }
    case "lexical_mc": {
      const choice = (response as { choice: number }).choice;
      return {
        correct: choice === item.answer,
        expected: item.options[item.answer] ?? "",
      };
    }
  }
}

function renderExpected(item: GrammarAnswer): string {
  switch (item.type) {
    case "transform":
    case "word_formation":
      return item.answer;
    case "lexical_mc":
      return item.options[item.answer] ?? "";
  }
}
