import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { savePendingSpeakingAnswer } from "@/lib/mock/persistence";

export const maxDuration = 60;

/**
 * POST /api/mock/speaking/transcribe
 *
 * Mock-mode speaking endpoint. Accepts the audio blob recorded by the
 * runner's `SpeakingStimulus`, transcribes it with Whisper, and persists
 * a pending speaking answer (`{ type: "speaking", transcript, …,
 * score: null }`). AI scoring is deliberately deferred — students click
 * "Оценить AI" on the results page to call `/api/mock/speaking/score`.
 *
 * Audio bytes are NOT stored — only the transcript + duration end up in
 * the DB, mirroring the standalone `/api/speaking/submit` endpoint.
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
          "OPENAI_API_KEY is not configured. Add it to .env.local to enable speaking transcription.",
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
  const attemptId = String(form.get("attemptId") ?? "");
  const itemId = String(form.get("itemId") ?? "");
  const durationRaw = form.get("durationSeconds");
  const audioDurationSeconds =
    typeof durationRaw === "string" && durationRaw.length > 0
      ? Number(durationRaw)
      : 0;

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
  if (!attemptId || !itemId) {
    return NextResponse.json(
      { error: "Missing attemptId or itemId" },
      { status: 400 },
    );
  }

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

  try {
    const { answerId } = await savePendingSpeakingAnswer({
      userId: session.user.id,
      attemptId,
      itemId,
      transcript: trimmed,
      audioDurationSeconds: Number.isFinite(audioDurationSeconds)
        ? audioDurationSeconds
        : 0,
    });
    return NextResponse.json({
      answerId,
      transcript: trimmed,
      audioDurationSeconds: Math.max(
        0,
        Math.round(Number.isFinite(audioDurationSeconds) ? audioDurationSeconds : 0),
      ),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Save failed";
    const status =
      msg === "Forbidden"
        ? 403
        : msg.startsWith("Mock attempt")
          ? 410
          : msg === "Item not found" || msg === "Item is not a speaking item"
            ? 404
            : 400;
    return NextResponse.json({ error: msg }, { status });
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
