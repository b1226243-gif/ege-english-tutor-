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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  GrammarAnswer,
  GrammarStudentAnswer,
} from "@/lib/grammar/types";

export type PracticeItem = {
  id: string;
  stimulusText: string;
  payload: GrammarAnswer;
  metadata: Record<string, unknown> | null;
};

type Props = {
  examLabel: string;
  title: string;
  instructions: string;
  taskTemplateId: string;
  items: PracticeItem[];
  initialStats: { correct: number; total: number };
  generateConfig?: {
    examCode: string;
    type: "transform" | "word_formation" | "lexical_mc";
  };
};

type AnswerResult = {
  correct: boolean;
  expected: string;
  studentDisplay: string;
};

/**
 * Single-question-at-a-time practice loop.
 *
 * Flow: render item → student answers → POST /api/grammar/answer (instant
 * auto-grade, persists) → render verdict banner → fetch streaming
 * explanation from /api/grammar/explain → student clicks "дальше".
 */
export function GrammarPractice({
  examLabel,
  title,
  instructions,
  taskTemplateId,
  items,
  initialStats,
  generateConfig,
}: Props) {
  const [restarting, setRestarting] = React.useState(false);
  const [restartError, setRestartError] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [draft, setDraft] = React.useState<string>("");
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
    setDraft("");
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

  async function onRestart() {
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
        const payload = await safeJson(res);
        throw new Error(
          (payload?.error as string) || `Ошибка ${res.status}`,
        );
      }
      setIndex(0);
      setSessionStats({ correct: 0, attempted: 0 });
      reset();
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestarting(false);
    }
  }

  async function onGenerate() {
    if (!generateConfig || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/generate/grammar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          examCode: generateConfig.examCode,
          type: generateConfig.type,
          count: 3,
        }),
      });
      if (!res.ok) {
        const payload = await safeJson(res);
        throw new Error(
          (payload?.error as string) || `Ошибка ${res.status}`,
        );
      }
      // The endpoint returned freshly persisted items, but we don't get
      // their DB ids back — so refetch is the cleanest path. Reload the
      // page to pick up the new bank.
      window.location.reload();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item || submitting || result) return;

    let response: GrammarStudentAnswer;
    let studentDisplay = "";
    if (item.payload.type === "lexical_mc") {
      if (choice === null) return;
      response = { type: "lexical_mc", choice };
      studentDisplay = `${String.fromCharCode(65 + choice)} — ${item.payload.options[choice]}`;
    } else {
      const value = draft.trim();
      if (!value) return;
      response = { type: item.payload.type, value };
      studentDisplay = value;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/grammar/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, response }),
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
      void streamExplanation(item.id, studentDisplay, data.correct);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function streamExplanation(
    itemId: string,
    studentAnswer: string,
    correct: boolean,
  ) {
    setExplaining(true);
    setExplanation("");
    try {
      const res = await fetch("/api/grammar/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, studentAnswer, correct }),
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
        setExplanation((prev) => prev + decoder.decode(value, { stream: true }));
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={onRestart} disabled={restarting}>
              {restarting ? "Закрываем попытку…" : "Начать новый круг"}
            </Button>
            {generateConfig && (
              <Button
                variant="outline"
                onClick={onGenerate}
                disabled={generating}
              >
                {generating
                  ? "Генерируем…"
                  : "Сгенерировать ещё 3 задания (AI)"}
              </Button>
            )}
          </div>
          {restartError && (
            <p className="text-xs text-red-600">⚠ {restartError}</p>
          )}
          {genError && (
            <p className="text-xs text-red-600">⚠ {genError}</p>
          )}
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
          <CardTitle className="text-base font-medium">
            {item.payload.type === "word_formation"
              ? "Образуйте однокоренное слово"
              : item.payload.type === "transform"
                ? "Поставьте слово в правильную форму"
                : "Выберите подходящую по смыслу единицу"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-base leading-relaxed">{item.stimulusText}</p>

            {item.payload.type === "lexical_mc" ? (
              <LexicalMcChoices
                options={item.payload.options}
                selected={choice}
                onSelect={setChoice}
                disabled={!!result}
              />
            ) : (
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  item.payload.type === "word_formation"
                    ? "например, HAPPINESS"
                    : "например, is singing"
                }
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={!!result}
                className="max-w-md"
              />
            )}

            {!result && (
              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    (item.payload.type === "lexical_mc"
                      ? choice === null
                      : !draft.trim())
                  }
                >
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
              <ExplanationPanel
                text={explanation}
                loading={explaining}
              />
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

function LexicalMcChoices({
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
            {String.fromCharCode(65 + idx)}.
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
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {loading ? "Разбор формируется…" : "Разбор тьютора"}
      </div>
      <div className="whitespace-pre-wrap">
        {text || (loading ? "…" : "")}
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
