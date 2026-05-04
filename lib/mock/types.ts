import { z } from "zod";

import type { SectionKind } from "@/lib/db/schema";
import type { WritingFormat } from "@/lib/writing/descriptors";

/**
 * Mock-exam types — the timed, FIPI-style full sitting.
 *
 * A mock attempt is a single `attempts` row with `mode = "mock_full"` and
 * no `taskTemplateId`. Inside it we store one `answer` row per item the
 * student touched, and per-criterion scores in `rubric_score`. Sections
 * are recovered at read-time by joining `answers → items → task_templates →
 * sections`, so we don't need a new table or schema migration.
 *
 * The "plan" — which sections are included, how long each one runs, which
 * items were drawn for it — is built at mock start (`/api/mock/start`),
 * persisted to `attempt.plan` (jsonb) and returned to the client. The
 * client also stores it in localStorage for snappier reloads. When the
 * client storage is gone (private window, cleared cache, different
 * device), `/api/mock/plan?attemptId=…` rehydrates the *exact same*
 * plan from the DB so the student keeps seeing the items they already
 * answered.
 *
 * PR #7 shipped the auto-graded sections (listening, reading,
 * grammar). PR #8 adds the writing section: students draft a real
 * FIPI prompt inside the mock, the text is saved as `answer.rawAnswer`,
 * and a per-item AI grader on the results page produces FIPI rubric
 * scores on demand. Speaking joins in PR #9.
 */

export const MockSectionKindSchema = z.enum([
  "listening",
  "reading",
  "grammar",
  "writing",
]);
/** Sections wired into the mock loop. PR #8 adds "writing". */
export type MockSectionKind = z.infer<typeof MockSectionKindSchema>;

export type MockSectionPlanItem = {
  id: string;
  /** Code of the task_template this item belongs to ("ege_en.reading.matching_headings", …). */
  taskTemplateCode: string;
  /** Human label for this group ("Чтение · Подбор заголовков"). */
  taskTemplateTitle: string;
  /** Stimulus to display. Shape varies by section. */
  stimulus: MockStimulus;
};

export type MockStimulus =
  | {
      kind: "listening";
      audioUrl: string | null;
      transcript: string;
      voice: string | null;
      question: string;
      options: string[];
    }
  | {
      kind: "reading";
      passage: string;
      question: string;
      options: string[];
    }
  | {
      kind: "grammar_open_cloze";
      prompt: string;
      base: string;
      hint: string | null;
    }
  | {
      kind: "grammar_word_formation";
      prompt: string;
      base: string;
      pos: string | null;
    }
  | {
      kind: "grammar_lexical_mc";
      prompt: string;
      options: string[];
    }
  | {
      kind: "writing_email";
      /** Format from the FIPI rubric — drives the word counter limits. */
      format: Extract<WritingFormat, "task_33_email" | "task_37_email">;
      taskNumber: number;
      prompt: string;
      friendName: string;
      friendLetter: string;
      questions: string[];
      minWords: number;
      maxWords: number;
      hardMin: number;
    }
  | {
      kind: "writing_essay";
      format: Extract<WritingFormat, "task_38_essay">;
      taskNumber: number;
      prompt: string;
      topic: string;
      table: { caption: string; rows: { label: string; value: string }[] };
      planLabels: string[];
      minWords: number;
      maxWords: number;
      hardMin: number;
    };

export type MockSectionPlan = {
  kind: MockSectionKind;
  displayName: string;
  /** Soft per-section budget in seconds (informational; the global timer is the hard one). */
  timeBudgetSeconds: number;
  items: MockSectionPlanItem[];
};

export type MockPlan = {
  examCode: "ege_en" | "oge_en";
  /** Hard total time limit for the whole mock, seconds. */
  totalSeconds: number;
  sections: MockSectionPlan[];
};

/** A response the client posts as it goes. */
export const MockAnswerRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("listening_mc"),
    attemptId: z.string().uuid(),
    itemId: z.string().uuid(),
    choice: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("reading_mc"),
    attemptId: z.string().uuid(),
    itemId: z.string().uuid(),
    choice: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("grammar_text"),
    attemptId: z.string().uuid(),
    itemId: z.string().uuid(),
    /** Used for transform / word_formation. */
    value: z.string().min(0).max(200),
  }),
  z.object({
    kind: z.literal("grammar_lexical_mc"),
    attemptId: z.string().uuid(),
    itemId: z.string().uuid(),
    choice: z.number().int().min(0).max(3),
  }),
  z.object({
    kind: z.literal("writing_essay"),
    attemptId: z.string().uuid(),
    itemId: z.string().uuid(),
    /**
     * The full essay text the student typed. We trim & cap on the
     * server but keep the cap loose enough to allow over-the-limit
     * drafts (FIPI penalises them by truncating to maxWords, not by
     * rejecting the submission).
     */
    text: z.string().min(0).max(8000),
  }),
]);
export type MockAnswerRequest = z.infer<typeof MockAnswerRequestSchema>;

export type MockAnswerResponse = {
  answerId: string;
  /** Echoed for client-side bookkeeping. Mock mode does NOT reveal the verdict during the run. */
  saved: true;
};

export type MockSectionResult = {
  kind: SectionKind;
  displayName: string;
  totalScore: number;
  maxScore: number;
  attempts: number;
  items: {
    itemId: string;
    correct: boolean | null;
    score: number;
    maxScore: number;
    expected: string | null;
    studentResponse: string;
    taskTemplateTitle: string;
    /**
     * Present only for writing items — lets the results page render a
     * draft preview, the FIPI rubric breakdown (when graded) and a
     * "Grade now" affordance (when not).
     */
    writing?: {
      format: "task_33_email" | "task_37_email" | "task_38_essay";
      wordCount: number;
      minWords: number;
      maxWords: number;
      hardMin: number;
      score: {
        total: number;
        max: number;
        scores: { code: string; label: string; score: number; max: number; notes: string }[];
        summary: string;
        errors: { quote: string; question: string }[];
      } | null;
    };
  }[];
};

export type MockResults = {
  attemptId: string;
  examCode: "ege_en" | "oge_en";
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number;
  totalScore: number;
  maxScore: number;
  sections: MockSectionResult[];
};
