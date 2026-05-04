import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getSpeakingItemWithPayload,
  getSpeakingTaskTemplateByCode,
  persistSpeakingAnswer,
} from "@/lib/speaking/persistence";
import {
  SpeakingScoreSchema,
  type SpeakingAnswer,
  type SpeakingRawAnswer,
} from "@/lib/speaking/types";
import { totalSpeakingMax } from "@/lib/speaking/descriptors";
import { SPEAKING_SCORE_PROMPT } from "@/lib/prompts";

export const maxDuration = 60;

/**
 * POST /api/speaking/submit
 *
 * Accepts multipart/form-data with:
 *   - audio:    Blob (webm/opus from MediaRecorder, mp3, wav, m4a, ogg…)
 *   - itemId:   UUID of the speaking item
 *   - taskCode: task_template.code (so we can resolve the descriptor server-side)
 *   - durationSeconds: optional client-reported recording duration
 *
 * Pipeline: Whisper transcription → GPT-4o structured scoring via
 * `generateObject` against the per-task rubric → persist an `answer` row
 * plus one `rubric_score` per criterion. Returns the parsed score object
 * so the UI can render it immediately.
 *
 * The audio itself is deliberately NOT stored: we keep the transcript,
 * duration, and scores on the `answer` row and throw the raw blob away.
 * This avoids needing a Vercel Blob / S3 token for PR #6 and is also the
 * privacy-friendlier default.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Add it to .env.local to enable speaking submissions.",
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 },
    );
  }

  const audio = form.get("audio");
  const itemId = String(form.get("itemId") ?? "");
  const taskCode = String(form.get("taskCode") ?? "");
  const durationRaw = form.get("durationSeconds");
  const durationSeconds =
    typeof durationRaw === "string" && durationRaw.length > 0
      ? Number(durationRaw)
      : null;

  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json(
      { error: "Missing or empty `audio` field" },
      { status: 400 },
    );
  }
  if (audio.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Audio exceeds 25 MB limit (Whisper cap)." },
      { status: 413 },
    );
  }
  if (!itemId || !taskCode) {
    return NextResponse.json(
      { error: "Missing itemId or taskCode" },
      { status: 400 },
    );
  }

  const [item, template] = await Promise.all([
    getSpeakingItemWithPayload(itemId),
    getSpeakingTaskTemplateByCode(taskCode),
  ]);
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (!template || template.id !== item.taskTemplateId) {
    return NextResponse.json(
      { error: "Item does not belong to the provided task template" },
      { status: 400 },
    );
  }

  // --- 1. Whisper transcription --------------------------------------------
  let transcript: string;
  try {
    transcript = await transcribeWithWhisper(audio);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Whisper transcription failed: ${err.message}`
            : "Whisper transcription failed",
      },
      { status: 502 },
    );
  }

  const trimmed = transcript.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      {
        error:
          "Whisper returned an empty transcript. Try recording again in a quieter environment.",
      },
      { status: 400 },
    );
  }

  // --- 2. Structured scoring via generateObject ----------------------------
  const model = openai(process.env.OPENAI_MODEL ?? "gpt-4o");
  const userPrompt = buildSpeakingScoringPrompt({
    examLabel: template.examCode === "ege_en" ? "ЕГЭ" : "ОГЭ",
    descriptor: template.descriptor,
    stimulus: item.payload,
    transcript: trimmed,
  });

  let score: SpeakingRawAnswer["score"];
  try {
    const { object } = await generateObject({
      model,
      schema: SpeakingScoreSchema,
      system: SPEAKING_SCORE_PROMPT,
      prompt: userPrompt,
      temperature: 0.3,
    });
    score = object;
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Scoring failed: ${err.message}`
            : "Scoring failed",
      },
      { status: 502 },
    );
  }

  // Clamp every score at its declared max as a last-line safety net.
  const maxByCode = new Map(
    template.descriptor.rubric.map((c) => [c.code, c.max] as const),
  );
  score.scores = score.scores.map((s) => ({
    ...s,
    max: maxByCode.get(s.code) ?? s.max,
    score: Math.max(0, Math.min(s.score, maxByCode.get(s.code) ?? s.max)),
  }));

  // --- 3. Persist ----------------------------------------------------------
  const rawAnswer: SpeakingRawAnswer = {
    type: "speaking",
    transcript: trimmed,
    audioDurationSeconds:
      typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
        ? Math.round(durationSeconds)
        : null,
    score,
  };

  try {
    const { answerId, totalScore, totalMax } = await persistSpeakingAnswer({
      userId: session.user.id,
      itemId,
      rawAnswer,
    });
    return NextResponse.json({
      answerId,
      transcript: trimmed,
      score,
      totalScore,
      totalMax,
      maxPossible: totalSpeakingMax(template.descriptor.rubric),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to persist answer",
      },
      { status: 500 },
    );
  }
}

async function transcribeWithWhisper(audio: Blob): Promise<string> {
  const form = new FormData();
  const extension = extensionFromType(audio.type);
  const file = new File([audio], `recording.${extension}`, {
    type: audio.type || `audio/${extension}`,
  });
  form.append("file", file);
  form.append("model", process.env.OPENAI_WHISPER_MODEL ?? "whisper-1");
  form.append("response_format", "text");
  form.append("language", "en");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }
  return await res.text();
}

function extensionFromType(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "webm";
}

function buildSpeakingScoringPrompt(params: {
  examLabel: string;
  descriptor: {
    displayName: string;
    fipiTaskRange: string;
    format: string;
    rubric: { code: string; label: string; max: number; description: string }[];
  };
  stimulus: SpeakingAnswer;
  transcript: string;
}): string {
  const { examLabel, descriptor, stimulus, transcript } = params;
  const rubricJson = JSON.stringify(descriptor.rubric, null, 2);
  const stimulusBlock = stimulusToPromptBlock(stimulus);
  return [
    `Exam: ${examLabel}.`,
    `Task: ${descriptor.displayName} (№${descriptor.fipiTaskRange}).`,
    `Format: ${descriptor.format}.`,
    "",
    "Rubric (JSON):",
    rubricJson,
    "",
    "Stimulus:",
    stimulusBlock,
    "",
    "Student transcript (from Whisper, may have minor ASR errors):",
    `"""${transcript}"""`,
  ].join("\n");
}

function stimulusToPromptBlock(s: SpeakingAnswer): string {
  switch (s.type) {
    case "speaking_read_aloud":
      return `Passage to be read aloud:\n${s.passage}`;
    case "speaking_ask_questions":
      return [
        `Advert / announcement:`,
        s.advert,
        ``,
        `Required aspects to ask about (4 direct questions, one per aspect):`,
        s.aspects.map((a, i) => `${i + 1}. ${a}`).join("\n"),
      ].join("\n");
    case "speaking_interview":
      return [
        `Context: ${s.context}`,
        ``,
        `Interviewer questions (in order, student must answer each):`,
        s.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
      ].join("\n");
    case "speaking_picture_compare":
      return [
        `Topic: ${s.topic}`,
        `Picture 1 caption: ${s.imageCaptions[0]}`,
        `Picture 2 caption: ${s.imageCaptions[1]}`,
        ``,
        `FIPI 5-point plan:`,
        s.plan.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      ].join("\n");
    case "speaking_monologue_topic":
      return [
        `Topic: ${s.topic}`,
        ``,
        `Plan (3 points, all must be covered):`,
        s.plan.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      ].join("\n");
  }
}
