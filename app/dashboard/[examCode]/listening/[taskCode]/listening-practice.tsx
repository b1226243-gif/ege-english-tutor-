"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ListeningPracticeItem } from "@/lib/listening/types";

type Props = {
  examLabel: string;
  title: string;
  instructions: string;
  items: ListeningPracticeItem[];
  initialStats: { correct: number; total: number };
};

type AnswerResult = {
  correct: boolean;
  expected: string;
  studentDisplay: string;
};

const MAX_PLAYS = 2;

/**
 * Single-item-at-a-time practice loop for the Listening section.
 *
 * Flow: render audio player (with hard 2-play limit) + question + options →
 * student picks → POST /api/listening/answer (instant auto-grade) →
 * render verdict banner + transcript → fetch streaming explanation from
 * /api/listening/explain → student clicks «Дальше».
 *
 * Audio source fallback: if `audioUrl` is missing or the <audio> fails to
 * load, we use the browser's `speechSynthesis` API on the transcript so the
 * practice loop keeps working without pre-rendered mp3s. Play-count limit
 * applies to both paths.
 */
export function ListeningPractice({
  examLabel,
  title,
  instructions,
  items,
  initialStats,
}: Props) {
  const [index, setIndex] = React.useState(0);
  const [choice, setChoice] = React.useState<number | null>(null);
  const [result, setResult] = React.useState<AnswerResult | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [explanation, setExplanation] = React.useState<string>("");
  const [explaining, setExplaining] = React.useState(false);
  const [sessionStats, setSessionStats] = React.useState({
    correct: 0,
    attempted: 0,
  });

  const item = items[index];
  const completed = index >= items.length;

  const reset = React.useCallback(() => {
    setChoice(null);
    setResult(null);
    setError(null);
    setExplanation("");
    setExplaining(false);
  }, []);

  const onNext = () => {
    if (index + 1 < items.length) {
      setIndex(index + 1);
    } else {
      setIndex(items.length);
    }
    reset();
  };

  const onRestart = () => {
    setIndex(0);
    setSessionStats({ correct: 0, attempted: 0 });
    reset();
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item || submitting || result || choice === null) return;

    const studentDisplay = `${String.fromCharCode(65 + choice)} — ${item.payload.options[choice]}`;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/listening/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          response: { type: "listening_mc", choice },
        }),
      });
      if (!res.ok) {
        const payload = await safeJson(res);
        throw new Error(
          (payload?.error as string) || `Ошибка ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        correct: boolean;
        expected: string;
      };
      setResult({
        correct: data.correct,
        expected: data.expected,
        studentDisplay,
      });
      setSessionStats((s) => ({
        correct: s.correct + (data.correct ? 1 : 0),
        attempted: s.attempted + 1,
      }));
      void streamExplanation(item.id, choice, data.correct);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function streamExplanation(
    itemId: string,
    choiceIdx: number,
    correct: boolean,
  ) {
    setExplaining(true);
    setExplanation("");
    try {
      const res = await fetch("/api/listening/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, choice: choiceIdx, correct }),
      });
      if (!res.ok || !res.body) {
        const payload = await safeJson(res);
        setExplanation(
          `> ⚠ Не удалось получить разбор: ${
            (payload?.error as string) || res.statusText
          }`,
        );
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setExplanation((prev) => prev + decoder.decode(value));
      }
    } catch (err) {
      setExplanation(
        `> ⚠ Ошибка сети: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setExplaining(false);
    }
  }

  if (completed) {
    const pct = sessionStats.attempted
      ? Math.round((sessionStats.correct / sessionStats.attempted) * 100)
      : 0;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Сессия завершена · {examLabel}</CardTitle>
          <CardDescription>{title}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Вы ответили правильно на{" "}
            <span className="font-semibold">{sessionStats.correct}</span> из{" "}
            <span className="font-semibold">{sessionStats.attempted}</span>{" "}
            заданий ({pct}%).
          </p>
          <Button onClick={onRestart}>Начать новый круг</Button>
        </CardContent>
      </Card>
    );
  }

  const lifetimePct =
    initialStats.total > 0
      ? Math.round((initialStats.correct / initialStats.total) * 100)
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {title} · {examLabel}
          </h1>
          <p className="text-sm text-zinc-500">{instructions}</p>
        </div>
        <div className="text-xs text-zinc-500">
          Вопрос {index + 1} / {items.length}
          {" · "}
          Сессия: {sessionStats.correct}/{sessionStats.attempted}
          {lifetimePct !== null && (
            <>
              {" · "}
              Всего: {initialStats.correct}/{initialStats.total} ({lifetimePct}
              %)
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Аудио</CardTitle>
          <CardDescription>
            Можно прослушать максимум {MAX_PLAYS} раза — как на реальном
            экзамене.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AudioPlayer
            key={item.id}
            audioUrl={item.audioUrl}
            transcript={item.transcript}
            voice={item.voice}
            showTranscript={!!result}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Вопрос по аудио
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-base leading-relaxed">{item.question}</p>

            <ListeningMcChoices
              options={item.payload.options}
              selected={choice}
              onSelect={setChoice}
              disabled={!!result}
            />

            {!result && (
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={submitting || choice === null}>
                  {submitting ? "Проверяем…" : "Проверить"}
                </Button>
                {error && (
                  <span className="text-xs text-red-600">{error}</span>
                )}
              </div>
            )}
          </form>

          {result && (
            <div className="mt-5 space-y-3">
              <VerdictBanner result={result} />
              <ExplanationPanel text={explanation} loading={explaining} />
              <div>
                <Button onClick={onNext}>
                  {index + 1 < items.length ? "Дальше" : "Завершить"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Plays either the pre-rendered mp3 (if `audioUrl` is present and loadable)
 * or falls back to the browser's SpeechSynthesis API on the transcript.
 * Counts plays in a ref so a hard `MAX_PLAYS` limit can be enforced no
 * matter which path is used.
 */
function AudioPlayer({
  audioUrl,
  transcript,
  voice,
  showTranscript,
}: {
  audioUrl: string | null;
  transcript: string;
  voice: string | null;
  showTranscript: boolean;
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [plays, setPlays] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [mp3Failed, setMp3Failed] = React.useState(false);
  const [speechSupported, setSpeechSupported] = React.useState(true);

  React.useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const canPlay = plays < MAX_PLAYS && !playing;
  const useSpeech = !audioUrl || mp3Failed;

  const startMp3Play = () => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {
      setMp3Failed(true);
    });
  };

  const startSpeechPlay = () => {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) {
      setSpeechSupported(false);
      return;
    }
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(transcript);
    utter.lang = "en-US";
    utter.rate = 0.95;
    if (voice) {
      const match = synth
        .getVoices()
        .find((v) => v.name.toLowerCase().includes(voice.toLowerCase()));
      if (match) utter.voice = match;
    }
    utter.onstart = () => setPlaying(true);
    utter.onend = () => {
      setPlaying(false);
      setPlays((p) => p + 1);
    };
    utter.onerror = () => {
      setPlaying(false);
      setPlays((p) => p + 1);
    };
    synth.speak(utter);
  };

  const onPlayClick = () => {
    if (!canPlay) return;
    if (useSpeech) startSpeechPlay();
    else startMp3Play();
  };

  return (
    <div className="space-y-3">
      {audioUrl && !mp3Failed && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="none"
          onPlay={() => setPlaying(true)}
          onEnded={() => {
            setPlaying(false);
            setPlays((p) => p + 1);
          }}
          onError={() => setMp3Failed(true)}
        />
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={onPlayClick}
          disabled={!canPlay || (useSpeech && !speechSupported)}
        >
          {playing
            ? "Играет…"
            : plays === 0
              ? "Прослушать"
              : plays < MAX_PLAYS
                ? "Прослушать ещё раз"
                : "Лимит прослушиваний исчерпан"}
        </Button>
        <span className="text-xs text-zinc-500">
          Прослушиваний: {plays}/{MAX_PLAYS}
          {useSpeech && (
            <>
              {" · "}
              <span className="italic">голос браузера</span>
            </>
          )}
        </span>
      </div>

      {useSpeech && !speechSupported && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Браузер не поддерживает озвучку текста. Транскрипт появится после
          ответа.
        </div>
      )}

      {showTranscript && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer text-xs text-zinc-500">
            Показать транскрипт
          </summary>
          <div className="mt-2 whitespace-pre-line leading-relaxed">
            {transcript}
          </div>
        </details>
      )}
    </div>
  );
}

function ListeningMcChoices({
  options,
  selected,
  onSelect,
  disabled,
}: {
  options: string[];
  selected: number | null;
  onSelect: (idx: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((opt, idx) => (
        <button
          type="button"
          key={idx}
          onClick={() => !disabled && onSelect(idx)}
          className={cn(
            "rounded-md border px-3 py-2 text-left text-sm transition",
            selected === idx
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600",
            disabled && selected !== idx && "opacity-60",
          )}
          disabled={disabled}
        >
          <span className="mr-2 font-semibold">
            {String.fromCharCode(65 + idx)}
          </span>
          {opt}
        </button>
      ))}
    </div>
  );
}

function VerdictBanner({ result }: { result: AnswerResult }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        result.correct
          ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
          : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
      )}
    >
      <div className="font-medium">
        {result.correct ? "Верно" : "Неверно"}
      </div>
      <div className="mt-1 text-xs">
        Ваш ответ:{" "}
        <span className="font-mono">{result.studentDisplay || "—"}</span>
        {!result.correct && (
          <>
            {" · "}
            Правильно:{" "}
            <span className="font-mono">{result.expected}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ExplanationPanel({
  text,
  loading,
}: {
  text: string;
  loading: boolean;
}) {
  if (!text && !loading) return null;
  return (
    <div className="rounded-md border bg-zinc-50/50 p-3 text-sm dark:bg-zinc-900/50">
      <div className="mb-1 text-xs font-medium text-zinc-500">
        AI-разбор ответа
      </div>
      <div className="whitespace-pre-line leading-relaxed">
        {text || "Готовим разбор…"}
        {loading && <span className="ml-1 animate-pulse text-zinc-400">▋</span>}
      </div>
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
