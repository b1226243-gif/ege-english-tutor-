import { z } from "zod";

/**
 * Listening section item payload schemas.
 *
 * Every listening `item` stores:
 * - the question (what the UI shows below the audio) in `item.stimulusText`
 * - the audio URL in `item.stimulusAudioUrl` (nullable — UI falls back to
 *   browser `speechSynthesis` on the transcript when missing)
 * - the transcript + voice hint in `item.assets` — used by
 *   `scripts/generate-listening-audio.ts` (OpenAI TTS) to render the mp3,
 *   and by the client as a `speechSynthesis` fallback
 * - the grading key in `item.correctAnswers` (ListeningAnswer shape)
 *
 * PR #5 exposes a single unifying task type — `listening_mc` — with 2–6
 * options. Matching speakers to statements (EGE 1 / OGE 1), T/F/Not stated
 * (EGE 2), and comprehension MC (EGE 3–9 / OGE 7–11) all reduce to this
 * shape; the difference lives in the seed content and the descriptor.
 *
 * Full exam-faithful modelling (one long audio with N sequential questions,
 * shared statement pools where each statement is used at most once) is
 * deferred — it will ship alongside the FIPI demo-paper parser.
 */

export const ListeningMcAnswerSchema = z.object({
  type: z.literal("listening_mc"),
  /** 2–6 answer choices, each 1–200 chars. */
  options: z.array(z.string().min(1).max(200)).min(2).max(6),
  /** 0-based index into `options` of the correct choice. */
  answer: z.number().int().min(0),
  /** Short source cue — which phrase in the audio supports the answer. */
  evidence: z.string().optional(),
});

export const ListeningAnswerSchema = z.discriminatedUnion("type", [
  ListeningMcAnswerSchema,
]);

export type ListeningMcAnswer = z.infer<typeof ListeningMcAnswerSchema>;
export type ListeningAnswer = z.infer<typeof ListeningAnswerSchema>;

export type ListeningTaskType = ListeningAnswer["type"];

export const ListeningStudentAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("listening_mc"),
    choice: z.number().int().min(0),
  }),
]);

export type ListeningStudentAnswer = z.infer<
  typeof ListeningStudentAnswerSchema
>;

/** Which FIPI task families each descriptor maps to. */
export type ListeningFormat =
  | "matching_speakers" // EGE 1 / OGE 1 — match statement to speaker
  | "true_false_stated" // EGE 2 — True / False / Not stated
  | "mc_detail"; // EGE 3–9 / OGE 7–11 — comprehension MC

export type ListeningTaskDescriptor = {
  /** Underlying item payload shape (only `listening_mc` for now). */
  type: ListeningTaskType;
  /** Exam-specific format this descriptor represents. */
  format: ListeningFormat;
  /** Stable slug used in URLs / task_template.code. */
  codeSuffix: string;
  displayName: string;
  shortDescription: string;
  fipiTaskRange: string;
};

/** Shape of the `assets` column on a listening item. */
export const ListeningAssetsSchema = z.object({
  /** Full written transcript of the audio. Used for TTS + fallback. */
  transcript: z.string().min(1),
  /** Optional voice hint for OpenAI TTS (alloy, echo, fable, onyx, nova, shimmer). */
  voice: z.string().optional(),
});
export type ListeningAssets = z.infer<typeof ListeningAssetsSchema>;

/** Item shape after we've joined audio + question + payload together. */
export type ListeningPracticeItem = {
  id: string;
  /** Playable mp3 URL. Null → client should use browser TTS on transcript. */
  audioUrl: string | null;
  /** Full transcript. Always present; used for TTS fallback + AI context. */
  transcript: string;
  /** Voice hint for client-side fallback TTS. */
  voice: string | null;
  /** The question / task prompt shown below the audio. */
  question: string;
  payload: ListeningAnswer;
  metadata: Record<string, unknown> | null;
};

/**
 * Grade a student's response against the canonical item payload.
 */
export function gradeListeningAnswer(
  item: ListeningAnswer,
  response: ListeningStudentAnswer,
): { correct: boolean; expected: string } {
  if (item.type !== response.type) {
    return { correct: false, expected: renderExpected(item) };
  }
  switch (item.type) {
    case "listening_mc": {
      const choice = response.choice;
      const inRange = choice >= 0 && choice < item.options.length;
      return {
        correct: inRange && choice === item.answer,
        expected: item.options[item.answer] ?? "",
      };
    }
  }
}

function renderExpected(item: ListeningAnswer): string {
  switch (item.type) {
    case "listening_mc":
      return item.options[item.answer] ?? "";
  }
}
