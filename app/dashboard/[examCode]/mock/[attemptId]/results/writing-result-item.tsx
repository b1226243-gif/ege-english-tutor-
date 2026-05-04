"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WritingScore = {
  total: number;
  max: number;
  scores: { code: string; label: string; score: number; max: number; notes: string }[];
  summary: string;
  errors: { quote: string; question: string }[];
};

type Props = {
  attemptId: string;
  itemId: string;
  index: number;
  taskTemplateTitle: string;
  studentResponse: string;
  initialScore: WritingScore | null;
  wordCount: number;
  minWords: number;
  maxWords: number;
  hardMin: number;
  maxScore: number;
};

/**
 * Renders one writing item on the mock results page.
 *
 * Two states:
 * 1. Not yet graded — shows the draft + word count + a "Grade now" button
 *    that POSTs to /api/mock/writing/score, then renders the same FIPI
 *    breakdown the speaking module uses.
 * 2. Already graded (rubric_scores rows present) — renders the breakdown
 *    immediately and exposes a "Re-grade" affordance for re-evaluation.
 */
export function WritingResultItem(props: Props) {
  const {
    attemptId,
    itemId,
    index,
    taskTemplateTitle,
    studentResponse,
    initialScore,
    wordCount,
    minWords,
    maxWords,
    hardMin,
    maxScore,
  } = props;
  const [score, setScore] = React.useState<WritingScore | null>(initialScore);
  const [grading, setGrading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // True after the first scoring attempt completes (success or error). Lets
  // us tell "we have not tried yet" apart from "we tried and it errored or
  // succeeded" — drives the auto-trigger below and the button copy.
  const [attempted, setAttempted] = React.useState<boolean>(initialScore !== null);
  const empty = studentResponse.trim().length === 0;

  const handleGrade = React.useCallback(async () => {
    setError(null);
    setGrading(true);
    try {
      const res = await fetch("/api/mock/writing/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptId, itemId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { score: WritingScore; error?: string }
        | { error: string }
        | null;
      if (!res.ok || !data || !("score" in data)) {
        setError(
          (data && "error" in data ? data.error : null) ||
            `Ошибка ${res.status}`,
        );
        return;
      }
      setScore(data.score);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGrading(false);
      setAttempted(true);
    }
  }, [attemptId, itemId]);

  // Auto-trigger AI scoring on mount so the results page renders FIPI
  // breakdowns without a manual click. Skips empty drafts (zero score by
  // default) and rows that were already graded server-side. The ref
  // guards against React 18 strict-mode double-effect re-firing.
  const autoFiredRef = React.useRef(false);
  React.useEffect(() => {
    if (autoFiredRef.current) return;
    if (empty) return;
    if (score) return;
    autoFiredRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void handleGrade();
  }, [empty, score, handleGrade]);

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs text-zinc-500">
          №{index + 1} · {taskTemplateTitle}
        </div>
        <div
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs",
            score
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
              : empty
                ? "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200"
                : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
          )}
        >
          {score
            ? `${score.total}/${score.max}`
            : empty
              ? `0/${maxScore}`
              : grading
                ? `Оцениваем AI · max ${maxScore}`
                : `Ожидает AI · max ${maxScore}`}
        </div>
      </div>

      {empty ? (
        <div className="text-sm text-zinc-400">— не отвечено —</div>
      ) : (
        <div className="rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
            Черновик · {wordCount} слов
            {wordCount < hardMin
              ? ` · ниже ${hardMin} → К1 = 0`
              : wordCount < minWords
                ? ` · ниже ${minWords}`
                : wordCount > maxWords
                  ? ` · уйдут после ${maxWords}`
                  : ` · в диапазоне ${minWords}–${maxWords}`}
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-sm">
            {studentResponse}
          </pre>
        </div>
      )}

      {!empty && !score && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={grading}
            onClick={handleGrade}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {grading
              ? "Оцениваем AI (K1–K5)…"
              : attempted
                ? "Повторить оценку AI"
                : "Оценить AI (FIPI рубрика)"}
          </Button>
          {error && <span className="text-xs text-red-600">⚠ {error}</span>}
        </div>
      )}

      {score && (
        <div className="space-y-2 rounded-md border p-3 text-xs dark:border-zinc-800">
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <div className="font-medium">FIPI рубрика</div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={grading}
              onClick={handleGrade}
              className="h-6 px-2 text-[11px]"
            >
              {grading ? "Переоцениваем…" : "Переоценить"}
            </Button>
          </div>
          <ul className="space-y-1.5">
            {score.scores.map((c) => (
              <li key={c.code} className="space-y-0.5">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {c.code} — {c.label}
                  </span>
                  <span className="font-mono">
                    {c.score}/{c.max}
                  </span>
                </div>
                {c.notes && (
                  <div className="text-zinc-600 dark:text-zinc-400">
                    {c.notes}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {score.summary && (
            <div className="border-t pt-2 text-zinc-700 dark:text-zinc-300">
              {score.summary}
            </div>
          )}
          {score.errors.length > 0 && (
            <div className="space-y-1.5 border-t pt-2">
              <div className="font-medium">Сократические подсказки</div>
              <ul className="space-y-1">
                {score.errors.map((e, i) => (
                  <li
                    key={i}
                    className="rounded bg-zinc-50 p-1.5 dark:bg-zinc-900/40"
                  >
                    <div className="font-mono text-[11px] text-zinc-500">
                      «{e.quote}»
                    </div>
                    <div>{e.question}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
      )}
    </li>
  );
}
