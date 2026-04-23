import { z } from "zod";

/**
 * Reading section item payload schemas.
 *
 * Every reading `item` stores its grading key in `item.correct_answers` as
 * JSON (`ReadingAnswer`) and the reading passage in `item.metadata.passage`
 * (the UI renders it above the question). A `stimulusText` holds the
 * question itself so item listings stay readable.
 *
 * PR #4 exposes a single unifying task type — `reading_mc` — with a
 * variable number of options (2 to 6). Different exam sections (matching
 * headings, true/false/not-stated, multiple-choice comprehension) all
 * reduce to this shape; the difference lives in the seed content and the
 * descriptor's FIPI task range. Full exam-faithful modelling (7 paragraphs
 * with a shared 8-heading pool, etc.) is deferred to a follow-up PR.
 */

export const ReadingMcAnswerSchema = z.object({
  type: z.literal("reading_mc"),
  /** 2–6 answer choices, each 1–200 chars. */
  options: z.array(z.string().min(1).max(200)).min(2).max(6),
  /** 0-based index into `options` of the correct choice. */
  answer: z.number().int().min(0),
  /** Short source cue (which sentence/paragraph supports the answer). */
  evidence: z.string().optional(),
});

export const ReadingAnswerSchema = z.discriminatedUnion("type", [
  ReadingMcAnswerSchema,
]);

export type ReadingMcAnswer = z.infer<typeof ReadingMcAnswerSchema>;
export type ReadingAnswer = z.infer<typeof ReadingAnswerSchema>;

export type ReadingTaskType = ReadingAnswer["type"];

export const ReadingStudentAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reading_mc"),
    choice: z.number().int().min(0),
  }),
]);

export type ReadingStudentAnswer = z.infer<typeof ReadingStudentAnswerSchema>;

/** Which FIPI task families each descriptor maps to. */
export type ReadingFormat =
  | "matching_headings" // EGE 10 / OGE 9 — match heading to paragraph
  | "matching_statements" // EGE 11 — match statement to gap / paragraph
  | "mc_detail" // EGE 12–18 / OGE 13–17 — comprehension MC
  | "true_false_stated"; // OGE T/F/Not stated

export type ReadingTaskDescriptor = {
  /** Underlying item payload shape (only `reading_mc` for now). */
  type: ReadingTaskType;
  /** Exam-specific format this descriptor represents. */
  format: ReadingFormat;
  /** Stable slug used in URLs / task_template.code. */
  codeSuffix: string;
  displayName: string;
  shortDescription: string;
  fipiTaskRange: string;
};

/** Item shape after we've joined passage + question + payload together. */
export type ReadingPracticeItem = {
  id: string;
  /** Reading passage (Markdown). Rendered above the question. */
  passage: string;
  /** The question / task prompt shown below the passage. */
  question: string;
  payload: ReadingAnswer;
  metadata: Record<string, unknown> | null;
};

/**
 * Grade a student's response against the canonical item payload.
 */
export function gradeReadingAnswer(
  item: ReadingAnswer,
  response: ReadingStudentAnswer,
): { correct: boolean; expected: string } {
  if (item.type !== response.type) {
    return { correct: false, expected: renderExpected(item) };
  }
  switch (item.type) {
    case "reading_mc": {
      const choice = response.choice;
      const inRange = choice >= 0 && choice < item.options.length;
      return {
        correct: inRange && choice === item.answer,
        expected: item.options[item.answer] ?? "",
      };
    }
  }
}

function renderExpected(item: ReadingAnswer): string {
  switch (item.type) {
    case "reading_mc":
      return item.options[item.answer] ?? "";
  }
}
