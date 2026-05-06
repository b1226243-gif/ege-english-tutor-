import { z } from "zod";

/**
 * Speaking section — PR #6.
 *
 * Each `task_template` corresponds to ONE FIPI speaking task (e.g. EGE
 * Task 1 — read aloud, EGE Task 4 — picture comparison). Items inside a
 * template are different stimuli of the same task type.
 *
 * Unlike reading/listening, the student's raw answer is **audio**, not a
 * choice index. On submit, we:
 *
 * 1. Accept a `FormData` with the recorded audio blob.
 * 2. Send it to OpenAI Whisper for transcription.
 * 3. Pass the transcript + the task's rubric into GPT-4o via
 *    `generateObject` and receive per-criterion scores + narrative feedback.
 * 4. Persist: `answer` row (rawAnswer = {transcript, audioDuration, ...}),
 *    one `rubric_score` row per criterion from the rubric, and the
 *    narrative feedback in `answer.rawAnswer.feedback`.
 *
 * The audio itself is **not stored** — it's privacy-friendlier and avoids
 * needing a Vercel Blob token for PR #6. The transcript + score survive.
 */

/** One scoring criterion in a task's rubric. */
export const SpeakingCriterionSchema = z.object({
  code: z.string().min(1).max(16),
  label: z.string().min(1),
  max: z.number().int().min(1).max(10),
  description: z.string(),
});
export type SpeakingCriterion = z.infer<typeof SpeakingCriterionSchema>;

/** How long each phase of a task lasts, in seconds. */
export const SpeakingTimingSchema = z.object({
  prepareSeconds: z.number().int().min(0).max(600),
  speakSeconds: z.number().int().min(10).max(600),
});
export type SpeakingTiming = z.infer<typeof SpeakingTimingSchema>;

/**
 * Per-exam task format. Same `listening_mc` trick as other sections —
 * every task_template uses the same polymorphic payload, differentiated by
 * `format`.
 */
export type SpeakingFormat =
  | "read_aloud" // EGE 1 / OGE 1
  | "ask_questions" // EGE 2
  | "interview" // EGE 3 / OGE 2
  | "picture_compare" // EGE 4
  | "monologue_topic"; // OGE 3

/**
 * Per-item stimulus payload. Stored in `item.correctAnswers` so we can keep
 * the discriminated-union pattern identical to other sections.
 */

/** Task 1 — read the given passage aloud. No "correct answer" — Whisper transcript is compared against the canonical text. */
export const SpeakingReadAloudAnswerSchema = z.object({
  type: z.literal("speaking_read_aloud"),
  /** Exact English text the student must read. */
  passage: z.string().min(20),
});

/** Task 2 — formulate 4 direct questions based on an advert/announcement. */
export const SpeakingAskQuestionsAnswerSchema = z.object({
  type: z.literal("speaking_ask_questions"),
  /** Short ad/announcement blurb shown to the student. */
  advert: z.string().min(20),
  /** The 4 aspects the student has to ask about (e.g. "price", "location"). */
  aspects: z.array(z.string().min(2).max(80)).length(4),
});

/** Task 3 / OGE Task 2 — answer N interview questions in order. */
export const SpeakingInterviewAnswerSchema = z.object({
  type: z.literal("speaking_interview"),
  /** Context sentence ("You took part in an opinion poll on…"). */
  context: z.string().min(10),
  /** The interviewer's questions, in order. */
  questions: z.array(z.string().min(5).max(200)).min(3).max(6),
});

/** Task 4 — compare two pictures per fixed FIPI plan. */
export const SpeakingPictureCompareAnswerSchema = z.object({
  type: z.literal("speaking_picture_compare"),
  /** Short topic blurb. */
  topic: z.string().min(10),
  /** Two image captions (we render captions as text — actual stock images are optional and can be added later). */
  imageCaptions: z.tuple([z.string().min(3), z.string().min(3)]),
  /**
   * The 5 FIPI plan points. Default set is seeded by `seed-speaking.ts`
   * but stored per-item so we can tweak phrasing.
   */
  plan: z.array(z.string().min(5).max(200)).length(5),
});

/** OGE Task 3 — 1.5-min monologue on a given topic with 3 plan points. */
export const SpeakingMonologueAnswerSchema = z.object({
  type: z.literal("speaking_monologue_topic"),
  topic: z.string().min(10),
  plan: z.array(z.string().min(5).max(200)).length(3),
});

export const SpeakingAnswerSchema = z.discriminatedUnion("type", [
  SpeakingReadAloudAnswerSchema,
  SpeakingAskQuestionsAnswerSchema,
  SpeakingInterviewAnswerSchema,
  SpeakingPictureCompareAnswerSchema,
  SpeakingMonologueAnswerSchema,
]);
export type SpeakingAnswer = z.infer<typeof SpeakingAnswerSchema>;
export type SpeakingTaskType = SpeakingAnswer["type"];

/** Task-template descriptor (the UI-facing shape). */
export type SpeakingTaskDescriptor = {
  format: SpeakingFormat;
  codeSuffix: string;
  displayName: string;
  shortDescription: string;
  fipiTaskRange: string;
  /** Timing regulated by FIPI. */
  timing: SpeakingTiming;
  /** Per-criterion rubric. Sum of `max` values = total possible score. */
  rubric: SpeakingCriterion[];
};

/** Per-item shape after DB join — used by the practice UI. */
export type SpeakingPracticeItem = {
  id: string;
  payload: SpeakingAnswer;
  metadata: Record<string, unknown> | null;
};

/** Shape of the JSON we ask GPT-4o to return after scoring. */
export const SpeakingScoreSchema = z.object({
  scores: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      score: z.number(),
      max: z.number(),
      comment: z.string(),
    }),
  ),
  /** Markdown-ready narrative feedback — what to fix, Socratic questions. */
  feedback: z.string(),
});
export type SpeakingScore = z.infer<typeof SpeakingScoreSchema>;

/** Shape of the `rawAnswer` JSON we persist on the `answers` row. */
export const SpeakingRawAnswerSchema = z.object({
  type: z.literal("speaking"),
  transcript: z.string(),
  /** Duration of the uploaded audio in seconds. */
  audioDurationSeconds: z.number().nullable(),
  score: SpeakingScoreSchema,
});
export type SpeakingRawAnswer = z.infer<typeof SpeakingRawAnswerSchema>;
