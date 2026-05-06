"use client";

import * as React from "react";
import { Mic, Square, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  SpeakingAnswer,
  SpeakingPracticeItem,
  SpeakingScore,
  SpeakingTaskDescriptor,
} from "@/lib/speaking/types";
import { totalSpeakingMax } from "@/lib/speaking/descriptors";

type Props = {
  examLabel: string;
  taskCode: string;
  taskTemplateId: string;
  title: string;
  instructions: string;
  descriptor: SpeakingTaskDescriptor;
  items: SpeakingPracticeItem[];
  initialStats: { attempts: number; totalScore: number; totalMax: number };
};

type Phase = "idle" | "prepare" | "record" | "uploading" | "done";

type SubmitResult = {
  transcript: string;
  score: SpeakingScore;
  totalScore: number;
  totalMax: number;
  maxPossible: number;
};

/**
 * Speaking practice loop for a single task template.
 *
 * Phases: idle → prepare (timer counts down) → record (MediaRecorder
 * captures webm/opus, timer counts down; button stops early) → uploading
 * (FormData POST to /api/speaking/submit; server transcribes via Whisper
 * and scores via GPT-4o structured output) → done (render score table +
 * Socratic feedback; next item button).
 *
 * No audio is persisted server-side — only the Whisper transcript + the
 * scored rubric end up in the DB.
 */
export function SpeakingPractice({
  examLabel,
  taskCode,
  taskTemplateId,
  title,
  instructions,
  descriptor,
  items,
  initialStats,
}: Props) {
  const [restarting, setRestarting] = React.useState(false);
  const [restartError, setRestartError] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const [recordingBlob, setRecordingBlob] = React.useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = React.useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = React.useState<number | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<SubmitResult | null>(null);
  const [sessionStats, setSessionStats] = React.useState({
    attempts: 0,
    scoreSum: 0,
    maxSum: 0,
  });

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = React.useRef<number | null>(null);
  // Mirror of recordingUrl so the unmount cleanup (with empty deps) can
  // see the latest blob URL and revoke it. The closure over the state
  // captures the initial value (null), so without the ref we'd leak.
  const recordingUrlRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    recordingUrlRef.current = recordingUrl;
  }, [recordingUrl]);

  const item = items[index];
  const completed = index >= items.length;
  const maxPossible = totalSpeakingMax(descriptor.rubric);

  // cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopTimer();
      stopStream();
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    };
  }, []);

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  const reset = () => {
    stopTimer();
    stopStream();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setPhase("idle");
    setSecondsLeft(0);
    setRecordingBlob(null);
    setRecordingUrl(null);
    setRecordingDuration(null);
    setError(null);
    setResult(null);
  };

  const onNext = () => {
    reset();
    setIndex((i) => i + 1);
  };

  const onStart = async () => {
    setError(null);
    if (descriptor.timing.prepareSeconds > 0) {
      startPrepare();
    } else {
      await startRecord();
    }
  };

  const startPrepare = () => {
    setPhase("prepare");
    setSecondsLeft(descriptor.timing.prepareSeconds);
    stopTimer();
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          stopTimer();
          void startRecord();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  async function startRecord() {
    setError(null);
    setPhase("record");
    setSecondsLeft(descriptor.timing.speakSeconds);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recordingStartRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const duration = recordingStartRef.current
          ? (Date.now() - recordingStartRef.current) / 1000
          : null;
        recordingStartRef.current = null;
        const type = chunksRef.current[0]?.type || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const url = URL.createObjectURL(blob);
        setRecordingBlob(blob);
        setRecordingUrl(url);
        setRecordingDuration(duration);
        stopStream();
        setPhase("done");
      };
      recorder.start();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Не удалось получить доступ к микрофону: ${err.message}`
          : "Не удалось получить доступ к микрофону.",
      );
      setPhase("idle");
      return;
    }

    stopTimer();
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          stopTimer();
          stopRecorder();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  function stopRecorder() {
    const r = mediaRecorderRef.current;
    if (r && r.state !== "inactive") {
      r.stop();
    } else {
      stopStream();
    }
  }

  const onStopEarly = () => {
    stopTimer();
    stopRecorder();
  };

  async function onSubmit() {
    if (!item || !recordingBlob) return;
    setSubmitting(true);
    setError(null);
    setPhase("uploading");
    try {
      const form = new FormData();
      form.append(
        "audio",
        new File([recordingBlob], "recording.webm", {
          type: recordingBlob.type || "audio/webm",
        }),
      );
      form.append("itemId", item.id);
      form.append("taskCode", taskCode);
      if (recordingDuration !== null) {
        form.append("durationSeconds", String(recordingDuration));
      }
      const res = await fetch("/api/speaking/submit", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const payload = await safeJson(res);
        throw new Error((payload?.error as string) || `Ошибка ${res.status}`);
      }
      const data = (await res.json()) as SubmitResult;
      setResult(data);
      setSessionStats((s) => ({
        attempts: s.attempts + 1,
        scoreSum: s.scoreSum + data.totalScore,
        maxSum: s.maxSum + data.totalMax,
      }));
      // Drop the "Обрабатываем…" badge — the result card is now visible.
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("done");
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    const pct = sessionStats.maxSum
      ? Math.round((sessionStats.scoreSum / sessionStats.maxSum) * 100)
      : 0;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Сессия завершена · {examLabel}</CardTitle>
          <CardDescription>{title}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Пройдено сюжетов:{" "}
            <span className="font-semibold">{sessionStats.attempts}</span>.
            Сумма:{" "}
            <span className="font-semibold">{sessionStats.scoreSum}</span>/
            <span className="font-semibold">{sessionStats.maxSum}</span> ({pct}
            %).
          </p>
          <Button
            onClick={async () => {
              if (restarting) return;
              setRestarting(true);
              setRestartError(null);
              try {
                const res = await fetch("/api/practice/restart", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ taskTemplateId }),
                });
                if (!res.ok) {
                  let msg = `Ошибка ${res.status}`;
                  try {
                    const payload = (await res.json()) as {
                      error?: string;
                    };
                    if (payload.error) msg = payload.error;
                  } catch {
                    /* ignore */
                  }
                  throw new Error(msg);
                }
                setIndex(0);
                reset();
                setSessionStats({ attempts: 0, scoreSum: 0, maxSum: 0 });
              } catch (err) {
                setRestartError(
                  err instanceof Error ? err.message : String(err),
                );
              } finally {
                setRestarting(false);
              }
            }}
            disabled={restarting}
          >
            {restarting ? "Закрываем попытку…" : "Начать новый круг"}
          </Button>
          {restartError && (
            <p className="text-xs text-red-600">⚠ {restartError}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {title} · {examLabel}
          </h1>
          <p className="text-sm text-zinc-500">{instructions}</p>
        </div>
        <div className="text-xs text-zinc-500 text-right">
          <div>
            Сюжет {index + 1} / {items.length}
          </div>
          <div>
            Макс: {maxPossible} баллов · Сессия:{" "}
            {sessionStats.attempts > 0
              ? `${sessionStats.scoreSum}/${sessionStats.maxSum}`
              : "—"}
          </div>
          {initialStats.attempts > 0 && (
            <div>
              Всего сдано: {initialStats.attempts} ({initialStats.totalScore}/
              {initialStats.totalMax})
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Стимул</CardTitle>
        </CardHeader>
        <CardContent>
          <SpeakingStimulus payload={item.payload} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Запись</CardTitle>
          <CardDescription>
            Разрешите доступ к микрофону. Таймеры соответствуют регламенту
            ФИПИ: подготовка {descriptor.timing.prepareSeconds} сек, ответ{" "}
            {descriptor.timing.speakSeconds} сек.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PhaseControls
            phase={phase}
            secondsLeft={secondsLeft}
            onStart={onStart}
            onStopEarly={onStopEarly}
          />

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}

          {phase === "done" && recordingBlob && !result && (
            <div className="flex flex-wrap items-center gap-2">
              {recordingUrl && (
                <audio controls src={recordingUrl} className="h-8" />
              )}
              <Button onClick={onSubmit} disabled={submitting}>
                <Play className="mr-2 h-4 w-4" /> Отправить на проверку
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                }}
                disabled={submitting}
              >
                Перезаписать
              </Button>
            </div>
          )}

          {phase === "uploading" && (
            <div className="text-xs text-zinc-500">
              Транскрибируем через Whisper и просим GPT-4o оценить по рубрике
              — это занимает 10–20 секунд.
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Оценка по рубрике ФИПИ
            </CardTitle>
            <CardDescription>
              Итог: {result.totalScore}/{result.totalMax} баллов · GPT-4o
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScoreTable score={result.score} />

            <div className="rounded-md border bg-zinc-50/50 p-3 text-sm dark:bg-zinc-900/50">
              <div className="mb-1 text-xs font-medium text-zinc-500">
                Разбор и следующий шаг
              </div>
              <div className="whitespace-pre-line leading-relaxed">
                {result.score.feedback}
              </div>
            </div>

            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer text-xs text-zinc-500">
                Показать транскрипт Whisper
              </summary>
              <div className="mt-2 whitespace-pre-line leading-relaxed">
                {result.transcript}
              </div>
            </details>

            <div>
              <Button onClick={onNext}>
                {index + 1 < items.length ? "Следующий сюжет" : "Завершить"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

function PhaseControls({
  phase,
  secondsLeft,
  onStart,
  onStopEarly,
}: {
  phase: Phase;
  secondsLeft: number;
  onStart: () => void;
  onStopEarly: () => void;
}) {
  if (phase === "idle") {
    return (
      <div className="flex items-center gap-2">
        <Button onClick={onStart}>
          <Mic className="mr-2 h-4 w-4" /> Начать
        </Button>
        <span className="text-xs text-zinc-500">Ожидание</span>
      </div>
    );
  }
  if (phase === "prepare") {
    return (
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Подготовка: {formatSeconds(secondsLeft)}
        </div>
        <span className="text-xs text-zinc-500">
          Когда таймер закончится, запись начнётся автоматически.
        </span>
      </div>
    );
  }
  if (phase === "record") {
    return (
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-red-100 px-3 py-1 text-sm font-medium text-red-900 dark:bg-red-900/40 dark:text-red-200">
          ● Запись: {formatSeconds(secondsLeft)}
        </div>
        <Button variant="destructive" onClick={onStopEarly}>
          <Square className="mr-2 h-4 w-4" /> Остановить
        </Button>
      </div>
    );
  }
  if (phase === "uploading") {
    return (
      <div className="flex items-center gap-2">
        <div className="rounded-md bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
          Обрабатываем…
        </div>
      </div>
    );
  }
  // done
  return null;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function SpeakingStimulus({ payload }: { payload: SpeakingAnswer }) {
  switch (payload.type) {
    case "speaking_read_aloud":
      return (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Прочитайте вслух
          </div>
          <p className="whitespace-pre-line text-base leading-relaxed">
            {payload.passage}
          </p>
        </div>
      );
    case "speaking_ask_questions":
      return (
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Объявление
            </div>
            <p className="whitespace-pre-line text-base leading-relaxed">
              {payload.advert}
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Задайте 4 прямых вопроса по следующим аспектам
            </div>
            <ol className="ml-5 list-decimal text-sm">
              {payload.aspects.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </div>
        </div>
      );
    case "speaking_interview":
      return (
        <div className="space-y-3">
          <p className="text-sm italic text-zinc-600 dark:text-zinc-300">
            {payload.context}
          </p>
          <ol className="ml-5 list-decimal space-y-1 text-sm">
            {payload.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      );
    case "speaking_picture_compare":
      return (
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Тема
            </div>
            <p className="text-sm">{payload.topic}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PictureCaption index={1} caption={payload.imageCaptions[0]} />
            <PictureCaption index={2} caption={payload.imageCaptions[1]} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              План
            </div>
            <ol className="ml-5 list-decimal space-y-1 text-sm">
              {payload.plan.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>
        </div>
      );
    case "speaking_monologue_topic":
      return (
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Тема
            </div>
            <p className="text-sm font-medium">{payload.topic}</p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              План
            </div>
            <ol className="ml-5 list-decimal space-y-1 text-sm">
              {payload.plan.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>
        </div>
      );
  }
}

function PictureCaption({
  index,
  caption,
}: {
  index: number;
  caption: string;
}) {
  return (
    <div className="rounded-md border bg-zinc-50 p-3 text-sm dark:bg-zinc-900/40">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        Картинка {index}
      </div>
      <div className="mt-1 italic text-zinc-600 dark:text-zinc-300">
        {caption}
      </div>
    </div>
  );
}

function ScoreTable({ score }: { score: SpeakingScore }) {
  return (
    <div className="divide-y rounded-md border text-sm">
      {score.scores.map((s) => {
        const perfect = s.score >= s.max;
        return (
          <div key={s.code} className="p-3 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-medium">{s.label}</div>
              <div
                className={cn(
                  "font-mono text-sm",
                  perfect
                    ? "text-green-700 dark:text-green-300"
                    : s.score === 0
                      ? "text-red-700 dark:text-red-300"
                      : "text-zinc-700 dark:text-zinc-200",
                )}
              >
                {s.score}/{s.max}
              </div>
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-300">
              {s.comment}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
