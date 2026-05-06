"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Headphones, AlertTriangle, Send, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SupportedExamCode } from "@/lib/exams";
import type {
  MockAnswerRequest,
  MockPlan,
  MockSectionPlan,
  MockSectionPlanItem,
} from "@/lib/mock/types";

type Props = {
  examCode: SupportedExamCode;
  attemptId: string;
  startedAtIso: string;
};

const PLAN_KEY_PREFIX = "mock-plan:";
const ANSWERS_KEY_PREFIX = "mock-answers:";
// Per-attempt listening play counts. Lifted to MockRunner state (and
// mirrored to localStorage) so switching section tabs — or reloading
// the page — cannot reset the FIPI 2-play limit.
const PLAYS_KEY_PREFIX = "mock-plays:";
const MAX_LISTENING_PLAYS = 2;

type LocalAnswer =
  | { kind: "mc"; choice: number }
  | { kind: "text"; value: string }
  | { kind: "writing"; value: string }
  | {
      kind: "speaking";
      transcript: string;
      audioDurationSeconds: number;
    };

type LocalAnswers = Record<string, LocalAnswer>;

/**
 * Client-side mock runner. Hydrates plan from localStorage (set by
 * MockStartButton) or refetches it from the server. Drives section
 * navigation, the global timer, autosave on every answer change, and
 * final submission. Verdicts stay hidden until submission.
 */
export function MockRunner({ examCode, attemptId, startedAtIso }: Props) {
  const router = useRouter();
  const [plan, setPlan] = React.useState<MockPlan | null>(null);
  const [planError, setPlanError] = React.useState<string | null>(null);
  const [activeSection, setActiveSection] = React.useState(0);
  const [answers, setAnswers] = React.useState<LocalAnswers>({});
  const [savingItemId, setSavingItemId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [listeningPlays, setListeningPlays] = React.useState<
    Record<string, number>
  >({});

  const incrementListeningPlays = React.useCallback(
    (itemId: string) => {
      setListeningPlays((prev) => {
        const current = prev[itemId] ?? 0;
        if (current >= MAX_LISTENING_PLAYS) return prev;
        const next = { ...prev, [itemId]: current + 1 };
        try {
          window.localStorage.setItem(
            `${PLAYS_KEY_PREFIX}${attemptId}`,
            JSON.stringify(next),
          );
        } catch {
          // ignore quota errors
        }
        return next;
      });
    },
    [attemptId],
  );

  // Tracks in-flight `/api/mock/answer` POSTs so the manual submit button
  // and the timer-driven AutoSubmit can wait for the latest grammar text
  // edit to land server-side before they POST `/api/mock/submit`. Without
  // this, a student typing into a grammar text box at the moment the
  // timer expires (or who hits "Завершить" right after typing) would lose
  // their last keystroke — debounced commits and post-blur saves would
  // race against the submit, and saveMockAnswer would reject them with
  // "already submitted".
  const pendingSavesRef = React.useRef<Set<Promise<unknown>>>(new Set());

  // Surface for non-`/api/mock/answer` saves (currently: speaking
  // uploads to `/api/mock/speaking/transcribe`) to register themselves
  // with the same flush set, so the timer-driven AutoSubmit waits for
  // an in-flight Whisper upload before it POSTs `/api/mock/submit`.
  const registerPending = React.useCallback(<T,>(p: Promise<T>) => {
    pendingSavesRef.current.add(p);
    void p.finally(() => pendingSavesRef.current.delete(p));
    return p;
  }, []);

  const flushPendingSaves = React.useCallback(async () => {
    // Force any focused textarea to commit its current value (blur fires
    // an immediate `onCommit`, which schedules a save we can wait on).
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }
    // Yield a couple of ticks so the blur-driven setState + the
    // resulting fetch register their promises in pendingSavesRef before
    // we snapshot it.
    await new Promise((r) => setTimeout(r, 50));
    await Promise.allSettled([...pendingSavesRef.current]);
  }, []);

  // ----- hydrate plan + saved answers ------------------------------------
  // Mount-time load from localStorage and (if missing) the server. The
  // setState() calls below sync external persistent storage into React
  // state — exactly the use case React 19 still allows; the lint rule
  // is suppressed line-by-line.
  React.useEffect(() => {
    const planKey = `${PLAN_KEY_PREFIX}${attemptId}`;
    const answersKey = `${ANSWERS_KEY_PREFIX}${attemptId}`;
    let cancelled = false;
    let foundLocal = false;
    try {
      const stored = window.localStorage.getItem(planKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { plan: MockPlan };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPlan(parsed.plan);
        foundLocal = true;
      }
      const storedAnswers = window.localStorage.getItem(answersKey);
      if (storedAnswers) {
        setAnswers(JSON.parse(storedAnswers) as LocalAnswers);
      }
      const storedPlays = window.localStorage.getItem(
        `${PLAYS_KEY_PREFIX}${attemptId}`,
      );
      if (storedPlays) {
        setListeningPlays(JSON.parse(storedPlays) as Record<string, number>);
      }
    } catch {
      // ignore JSON / localStorage errors
    }
    if (!foundLocal) {
      void (async () => {
        try {
          // Recover the plan for THIS attempt without creating a new
          // one. Calling `/api/mock/start` here would leak an orphan
          // attempt every time localStorage is missing.
          const res = await fetch(
            `/api/mock/plan?attemptId=${encodeURIComponent(attemptId)}`,
            { method: "GET" },
          );
          if (!res.ok) throw new Error("Не удалось загрузить план пробника");
          const data = (await res.json()) as { plan: MockPlan };
          if (!cancelled) {
            setPlan(data.plan);
            try {
              window.localStorage.setItem(
                planKey,
                JSON.stringify({ startedAt: startedAtIso, plan: data.plan }),
              );
            } catch {
              // ignore
            }
          }
        } catch (err) {
          if (!cancelled) {
            setPlanError(err instanceof Error ? err.message : String(err));
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [attemptId, startedAtIso]);

  // ----- global ticking timer -------------------------------------------
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (planError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Не удалось запустить пробник
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">{planError}</CardContent>
      </Card>
    );
  }
  if (!plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Загружаем пробник…</CardTitle>
        </CardHeader>
        <CardContent />
      </Card>
    );
  }

  const startedAt = new Date(startedAtIso).getTime();
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const remaining = Math.max(0, plan.totalSeconds - elapsed);

  const totalItems = plan.sections.reduce(
    (sum, s) => sum + s.items.length,
    0,
  );
  const answered = Object.keys(answers).length;
  const section = plan.sections[activeSection];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Mock-экзамен · {examCode === "ege_en" ? "ЕГЭ" : "ОГЭ"}
          </CardTitle>
          <CardDescription>
            Глобальный таймер · отвечено {answered} из {totalItems}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <GlobalTimer remaining={remaining} total={plan.totalSeconds} />
          <SectionTabs
            sections={plan.sections}
            active={activeSection}
            onSelect={setActiveSection}
            answers={answers}
          />
        </CardContent>
      </Card>

      {section && (
        <SectionRunner
          attemptId={attemptId}
          section={section}
          answers={answers}
          savingItemId={savingItemId}
          listeningPlays={listeningPlays}
          onListeningPlay={incrementListeningPlays}
          registerPending={registerPending}
          onAnswer={(item, next) => {
            setAnswers((prev) => {
              const copy = { ...prev, [item.id]: next };
              try {
                window.localStorage.setItem(
                  `${ANSWERS_KEY_PREFIX}${attemptId}`,
                  JSON.stringify(copy),
                );
              } catch {
                // ignore quota errors
              }
              return copy;
            });
            const req = buildRequest(attemptId, item, next);
            if (!req) return;
            setSavingItemId(item.id);
            const work = (async () => {
              try {
                const res = await fetch("/api/mock/answer", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(req),
                });
                if (!res.ok) {
                  const payload = await safeJson(res);
                  console.warn(
                    "mock save failed",
                    payload?.error ?? `${res.status}`,
                  );
                }
              } catch (err) {
                console.warn("mock save failed", err);
              } finally {
                setSavingItemId(null);
              }
            })();
            pendingSavesRef.current.add(work);
            void work.finally(() =>
              pendingSavesRef.current.delete(work),
            );
          }}
        />
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="text-xs text-zinc-500">
            Когда таймер дойдёт до 00:00, пробник отправится автоматически.
            Можно завершить раньше.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {submitError && (
              <span className="text-xs text-red-600">{submitError}</span>
            )}
            <Button
              onClick={async () => {
                setSubmitError(null);
                setSubmitting(true);
                // Flush any focused textarea + wait for the in-flight
                // `/api/mock/answer` POST it triggers, so no last-second
                // grammar edit is lost after submit closes the attempt.
                await flushPendingSaves();
                try {
                  const res = await fetch("/api/mock/submit", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ attemptId }),
                  });
                  if (!res.ok) {
                    const payload = await safeJson(res);
                    throw new Error(
                      (payload?.error as string) || `Ошибка ${res.status}`,
                    );
                  }
                  try {
                    window.localStorage.removeItem(
                      `${PLAN_KEY_PREFIX}${attemptId}`,
                    );
                    window.localStorage.removeItem(
                      `${ANSWERS_KEY_PREFIX}${attemptId}`,
                    );
                    window.localStorage.removeItem(
                      `${PLAYS_KEY_PREFIX}${attemptId}`,
                    );
                  } catch {
                    // ignore
                  }
                  router.push(
                    `/dashboard/${examCode}/mock/${attemptId}/results`,
                  );
                } catch (err) {
                  setSubmitError(
                    err instanceof Error ? err.message : String(err),
                  );
                  setSubmitting(false);
                }
              }}
              disabled={submitting || remaining > plan.totalSeconds}
            >
              <Send className="mr-2 h-4 w-4" />
              {submitting ? "Отправляем…" : "Завершить и отправить"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AutoSubmit
        remaining={remaining}
        attemptId={attemptId}
        examCode={examCode}
        flush={flushPendingSaves}
      />
    </div>
  );
}

function buildRequest(
  attemptId: string,
  item: MockSectionPlanItem,
  ans: LocalAnswer,
): MockAnswerRequest | null {
  const stim = item.stimulus;
  if (stim.kind === "listening" && ans.kind === "mc") {
    return { kind: "listening_mc", attemptId, itemId: item.id, choice: ans.choice };
  }
  if (stim.kind === "reading" && ans.kind === "mc") {
    return { kind: "reading_mc", attemptId, itemId: item.id, choice: ans.choice };
  }
  if (stim.kind === "grammar_lexical_mc" && ans.kind === "mc") {
    return {
      kind: "grammar_lexical_mc",
      attemptId,
      itemId: item.id,
      choice: ans.choice,
    };
  }
  if (
    (stim.kind === "grammar_open_cloze" ||
      stim.kind === "grammar_word_formation") &&
    ans.kind === "text"
  ) {
    return { kind: "grammar_text", attemptId, itemId: item.id, value: ans.value };
  }
  if (
    (stim.kind === "writing_email" || stim.kind === "writing_essay") &&
    ans.kind === "writing"
  ) {
    return {
      kind: "writing_essay",
      attemptId,
      itemId: item.id,
      text: ans.value,
    };
  }
  return null;
}

function GlobalTimer({
  remaining,
  total,
}: {
  remaining: number;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.max(0, (remaining / total) * 100);
  const danger = remaining <= 60;
  const warn = remaining <= 5 * 60;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <div className="font-medium">Осталось: {formatHMS(remaining)}</div>
        <div className="text-xs text-zinc-500">
          из {formatHMS(total)}
        </div>
      </div>
      <div
        className={cn(
          "mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800",
          danger && "bg-red-200 dark:bg-red-900/40",
        )}
      >
        <div
          className={cn(
            "h-full transition-all",
            danger
              ? "bg-red-500"
              : warn
                ? "bg-amber-500"
                : "bg-emerald-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SectionTabs({
  sections,
  active,
  onSelect,
  answers,
}: {
  sections: MockSectionPlan[];
  active: number;
  onSelect: (i: number) => void;
  answers: LocalAnswers;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {sections.map((s, i) => {
        const answeredHere = s.items.filter((it) => answers[it.id]).length;
        const total = s.items.length;
        const isActive = i === active;
        return (
          <button
            key={s.kind}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs",
              isActive
                ? "border-zinc-800 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-900/40",
            )}
          >
            <div className="font-medium">{s.displayName}</div>
            <div className="opacity-70">
              {answeredHere}/{total}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SectionRunner({
  attemptId,
  section,
  answers,
  savingItemId,
  listeningPlays,
  onListeningPlay,
  registerPending,
  onAnswer,
}: {
  attemptId: string;
  section: MockSectionPlan;
  answers: LocalAnswers;
  savingItemId: string | null;
  listeningPlays: Record<string, number>;
  onListeningPlay: (itemId: string) => void;
  registerPending: <T>(p: Promise<T>) => Promise<T>;
  onAnswer: (item: MockSectionPlanItem, next: LocalAnswer) => void;
}) {
  return (
    <div className="space-y-3">
      {section.items.map((it, idx) => (
        <ItemCard
          key={it.id}
          attemptId={attemptId}
          index={idx}
          total={section.items.length}
          item={it}
          answer={answers[it.id]}
          saving={savingItemId === it.id}
          plays={listeningPlays[it.id] ?? 0}
          onListeningPlay={() => onListeningPlay(it.id)}
          registerPending={registerPending}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
}

function ItemCard({
  attemptId,
  index,
  total,
  item,
  answer,
  saving,
  plays,
  onListeningPlay,
  registerPending,
  onAnswer,
}: {
  attemptId: string;
  index: number;
  total: number;
  item: MockSectionPlanItem;
  answer: LocalAnswer | undefined;
  saving: boolean;
  plays: number;
  onListeningPlay: () => void;
  registerPending: <T>(p: Promise<T>) => Promise<T>;
  onAnswer: (item: MockSectionPlanItem, next: LocalAnswer) => void;
}) {
  const stim = item.stimulus;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2 text-sm font-medium">
          <span>
            №{index + 1} / {total} · {item.taskTemplateTitle}
          </span>
          <span className="text-[11px] font-normal text-zinc-500">
            {answer ? (saving ? "сохраняем…" : "сохранено") : "не отвечено"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {stim.kind === "listening" && (
          <ListeningStimulus
            audioUrl={stim.audioUrl}
            transcript={stim.transcript}
            voice={stim.voice}
            plays={plays}
            onPlay={onListeningPlay}
          />
        )}
        {stim.kind === "reading" && (
          <ReadingStimulus passage={stim.passage} />
        )}
        {(stim.kind === "grammar_open_cloze" ||
          stim.kind === "grammar_word_formation") && (
          <GrammarTextStimulus stim={stim} />
        )}
        {stim.kind === "grammar_lexical_mc" && (
          <GrammarMcStimulus prompt={stim.prompt} />
        )}

        {(stim.kind === "listening" ||
          stim.kind === "reading" ||
          stim.kind === "grammar_lexical_mc") && (
          <McChoices
            options={
              stim.kind === "listening"
                ? stim.options
                : stim.kind === "reading"
                  ? stim.options
                  : stim.options
            }
            question={
              stim.kind === "listening"
                ? stim.question
                : stim.kind === "reading"
                  ? stim.question
                  : null
            }
            chosen={answer?.kind === "mc" ? answer.choice : null}
            onChoose={(idx) => onAnswer(item, { kind: "mc", choice: idx })}
          />
        )}
        {(stim.kind === "grammar_open_cloze" ||
          stim.kind === "grammar_word_formation") && (
          <GrammarTextInput
            value={answer?.kind === "text" ? answer.value : ""}
            onChange={(v) => onAnswer(item, { kind: "text", value: v })}
          />
        )}
        {(stim.kind === "writing_email" || stim.kind === "writing_essay") && (
          <WritingStimulus
            stim={stim}
            value={answer?.kind === "writing" ? answer.value : ""}
            onCommit={(v) => onAnswer(item, { kind: "writing", value: v })}
          />
        )}
        {(stim.kind === "speaking_read_aloud" ||
          stim.kind === "speaking_ask_questions" ||
          stim.kind === "speaking_interview" ||
          stim.kind === "speaking_picture_compare" ||
          stim.kind === "speaking_monologue") && (
          <SpeakingStimulus
            attemptId={attemptId}
            itemId={item.id}
            stim={stim}
            answer={answer?.kind === "speaking" ? answer : null}
            registerPending={registerPending}
            onSaved={(next) => onAnswer(item, next)}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ----- stimulus subcomponents -------------------------------------------

function WritingStimulus({
  stim,
  value,
  onCommit,
}: {
  stim: Extract<
    MockSectionPlanItem["stimulus"],
    { kind: "writing_email" } | { kind: "writing_essay" }
  >;
  value: string;
  onCommit: (v: string) => void;
}) {
  // Word counter is recomputed from the most recent committed value.
  // Edits flow through the same DebouncedTextarea path that grammar
  // uses, so flushPendingSaves() also covers writing on auto-submit.
  // The 300ms commit debounce means the counter lags by one debounce
  // window — fine for a UX hint.
  const wordCount = React.useMemo(() => countWords(value), [value]);
  const meta = React.useMemo(() => {
    const min = stim.minWords;
    const max = stim.maxWords;
    const hardMin = stim.hardMin;
    if (wordCount === 0) return { tone: "neutral" as const, label: `Цель: ${min}–${max} слов` };
    if (wordCount < hardMin) {
      return {
        tone: "danger" as const,
        label: `${wordCount} слов · ниже ${hardMin} — К1 = 0`,
      };
    }
    if (wordCount < min) {
      return {
        tone: "warn" as const,
        label: `${wordCount} слов · нужно ${min}+`,
      };
    }
    if (wordCount > max) {
      return {
        tone: "warn" as const,
        label: `${wordCount} слов · уйдут после ${max}`,
      };
    }
    return {
      tone: "ok" as const,
      label: `${wordCount} слов · в диапазоне ${min}–${max}`,
    };
  }, [wordCount, stim.minWords, stim.maxWords, stim.hardMin]);

  return (
    <div className="space-y-3">
      {stim.kind === "writing_email" ? (
        <div className="space-y-2 rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Письмо от {stim.friendName}
          </div>
          <pre className="whitespace-pre-wrap font-sans">
            {stim.friendLetter}
          </pre>
          <ol className="ml-5 list-decimal space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
            {stim.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Эссе · Task {stim.taskNumber}
          </div>
          <p className="font-medium">{stim.topic}</p>
          <p>{stim.prompt}</p>
          <div className="mt-1 rounded border bg-white p-2 text-xs dark:bg-zinc-950">
            <div className="font-medium">{stim.table.caption}</div>
            <ul className="mt-1 space-y-0.5">
              {stim.table.rows.map((row, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{row.label}</span>
                  <span className="font-mono">{row.value}</span>
                </li>
              ))}
            </ul>
          </div>
          <ol className="ml-5 list-decimal space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
            {stim.planLabels.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      )}
      <DebouncedTextarea
        // Re-key on hydration only; subsequent edits keep the same input.
        key={`writing-${value === "" ? "empty" : "draft"}`}
        initial={value}
        onCommit={onCommit}
        placeholder={
          stim.kind === "writing_email"
            ? "Dear …,\n\n…\n\nBest wishes,\n…"
            : "Some people believe that …"
        }
        className="min-h-[260px] font-sans text-sm leading-relaxed"
      />
      <div
        className={cn(
          "text-xs",
          meta.tone === "danger" && "text-red-600",
          meta.tone === "warn" && "text-amber-600",
          meta.tone === "ok" && "text-emerald-600",
          meta.tone === "neutral" && "text-zinc-500",
        )}
      >
        {meta.label}
      </div>
    </div>
  );
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

type SpeakingStim = Extract<
  MockSectionPlanItem["stimulus"],
  | { kind: "speaking_read_aloud" }
  | { kind: "speaking_ask_questions" }
  | { kind: "speaking_interview" }
  | { kind: "speaking_picture_compare" }
  | { kind: "speaking_monologue" }
>;

/**
 * Speaking task UI for mock mode. Drives a 3-phase flow:
 *   1. Show prompt with a "preparation" countdown — student reads silently.
 *   2. Once prep timer runs out (or on click), MediaRecorder starts and
 *      a "speak" countdown runs; when it hits zero we auto-stop.
 *   3. The recorded blob is uploaded to `/api/mock/speaking/transcribe`,
 *      Whisper transcribes it, and the transcript replaces the LocalAnswer.
 *
 * Audio bytes never leave the browser as a persistent artefact — we
 * keep only the transcript + duration on the answer row, mirroring the
 * standalone speaking module.
 */
function SpeakingStimulus({
  attemptId,
  itemId,
  stim,
  answer,
  registerPending,
  onSaved,
}: {
  attemptId: string;
  itemId: string;
  stim: SpeakingStim;
  answer:
    | { kind: "speaking"; transcript: string; audioDurationSeconds: number }
    | null;
  registerPending: <T>(p: Promise<T>) => Promise<T>;
  onSaved: (next: {
    kind: "speaking";
    transcript: string;
    audioDurationSeconds: number;
  }) => void;
}) {
  type Phase = "idle" | "preparing" | "recording" | "uploading" | "saved" | "error";
  const [phase, setPhase] = React.useState<Phase>(answer ? "saved" : "idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [prepRemaining, setPrepRemaining] = React.useState(stim.prepareSeconds);
  const [speakRemaining, setSpeakRemaining] = React.useState(stim.speakSeconds);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef<number>(0);
  const prepTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const speakTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = React.useCallback(() => {
    if (prepTimerRef.current) {
      clearInterval(prepTimerRef.current);
      prepTimerRef.current = null;
    }
    if (speakTimerRef.current) {
      clearInterval(speakTimerRef.current);
      speakTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const stopRecording = React.useCallback(() => {
    if (speakTimerRef.current) {
      clearInterval(speakTimerRef.current);
      speakTimerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startRecording = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setErrorMsg("Браузер не поддерживает запись звука.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        const durationSeconds = Math.max(
          0,
          Math.round((Date.now() - startedAtRef.current) / 1000),
        );
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (blob.size === 0) {
          setPhase("error");
          setErrorMsg("Запись пуста. Попробуйте ещё раз.");
          return;
        }
        setPhase("uploading");
        const work = (async () => {
          try {
            const form = new FormData();
            form.append("audio", blob, "recording.webm");
            form.append("attemptId", attemptId);
            form.append("itemId", itemId);
            form.append("durationSeconds", String(durationSeconds));
            const res = await fetch("/api/mock/speaking/transcribe", {
              method: "POST",
              body: form,
            });
            if (!res.ok) {
              const payload = (await res.json().catch(() => null)) as
                | { error?: string }
                | null;
              throw new Error(payload?.error ?? `${res.status}`);
            }
            const data = (await res.json()) as {
              transcript: string;
              audioDurationSeconds: number;
            };
            onSaved({
              kind: "speaking",
              transcript: data.transcript,
              audioDurationSeconds: data.audioDurationSeconds,
            });
            setPhase("saved");
          } catch (err) {
            setPhase("error");
            setErrorMsg(
              err instanceof Error ? err.message : "Не удалось загрузить запись.",
            );
          }
        })();
        void registerPending(work);
      };
      startedAtRef.current = Date.now();
      rec.start();
      setPhase("recording");
      setSpeakRemaining(stim.speakSeconds);
      speakTimerRef.current = setInterval(() => {
        setSpeakRemaining((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setPhase("error");
      setErrorMsg(
        err instanceof Error
          ? `Микрофон недоступен: ${err.message}`
          : "Микрофон недоступен.",
      );
    }
  }, [
    attemptId,
    itemId,
    onSaved,
    registerPending,
    stim.speakSeconds,
    stopRecording,
  ]);

  const beginPreparation = React.useCallback(() => {
    setErrorMsg(null);
    setPhase("preparing");
    setPrepRemaining(stim.prepareSeconds);
    if (prepTimerRef.current) clearInterval(prepTimerRef.current);
    prepTimerRef.current = setInterval(() => {
      setPrepRemaining((prev) => {
        if (prev <= 1) {
          if (prepTimerRef.current) {
            clearInterval(prepTimerRef.current);
            prepTimerRef.current = null;
          }
          void startRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stim.prepareSeconds, startRecording]);

  const skipPreparation = React.useCallback(() => {
    if (prepTimerRef.current) {
      clearInterval(prepTimerRef.current);
      prepTimerRef.current = null;
    }
    setPrepRemaining(0);
    void startRecording();
  }, [startRecording]);

  const reset = React.useCallback(() => {
    cleanup();
    setPhase("idle");
    setErrorMsg(null);
    setPrepRemaining(stim.prepareSeconds);
    setSpeakRemaining(stim.speakSeconds);
  }, [cleanup, stim.prepareSeconds, stim.speakSeconds]);

  return (
    <div className="space-y-3">
      <SpeakingPrompt stim={stim} />

      {phase === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={beginPreparation}>Подготовиться</Button>
          <span className="text-xs text-zinc-500">
            Подготовка: {formatHMS(stim.prepareSeconds)} · речь:{" "}
            {formatHMS(stim.speakSeconds)}
          </span>
        </div>
      )}

      {phase === "preparing" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            Подготовка: {formatHMS(prepRemaining)}
          </span>
          <Button variant="outline" onClick={skipPreparation}>
            Начать запись сейчас
          </Button>
        </div>
      )}

      {phase === "recording" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-900 dark:bg-red-950/60 dark:text-red-200">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            Запись · {formatHMS(speakRemaining)}
          </span>
          <Button variant="outline" onClick={stopRecording}>
            Остановить
          </Button>
        </div>
      )}

      {phase === "uploading" && (
        <div className="text-xs text-zinc-500">
          Расшифровываем запись…
        </div>
      )}

      {phase === "saved" && answer && (
        <div className="space-y-2 rounded-md border bg-emerald-50/50 p-3 text-xs dark:bg-emerald-950/30">
          <div className="font-medium text-emerald-900 dark:text-emerald-200">
            Сохранено · {formatHMS(answer.audioDurationSeconds)} речи
          </div>
          <pre className="whitespace-pre-wrap font-sans text-zinc-700 dark:text-zinc-300">
            {answer.transcript}
          </pre>
          <Button variant="outline" onClick={reset}>
            Перезаписать
          </Button>
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2">
          {errorMsg && (
            <div className="text-xs text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}
          <Button variant="outline" onClick={reset}>
            Попробовать снова
          </Button>
        </div>
      )}
    </div>
  );
}

function SpeakingPrompt({ stim }: { stim: SpeakingStim }) {
  const header = (
    <div className="text-xs uppercase tracking-wide text-zinc-500">
      Устная часть · №{stim.fipiTaskRange}
    </div>
  );
  if (stim.kind === "speaking_read_aloud") {
    return (
      <div className="space-y-2 rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
        {header}
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Прочитайте текст вслух.
        </p>
        <pre className="whitespace-pre-wrap font-sans">{stim.passage}</pre>
      </div>
    );
  }
  if (stim.kind === "speaking_ask_questions") {
    return (
      <div className="space-y-2 rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
        {header}
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Изучите объявление и задайте по нему 4 прямых вопроса.
        </p>
        <pre className="whitespace-pre-wrap font-sans">{stim.advert}</pre>
        <ol className="ml-5 list-decimal space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
          {stim.aspects.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ol>
      </div>
    );
  }
  if (stim.kind === "speaking_interview") {
    return (
      <div className="space-y-2 rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
        {header}
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Условный диалог: ответьте на вопросы интервьюера по очереди.
        </p>
        <p className="font-medium">{stim.context}</p>
        <ol className="ml-5 list-decimal space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
          {stim.questions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      </div>
    );
  }
  if (stim.kind === "speaking_picture_compare") {
    return (
      <div className="space-y-2 rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
        {header}
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Сравните две фотографии. Тема: <span className="font-medium">{stim.topic}</span>.
        </p>
        <ul className="ml-5 list-disc space-y-1 text-xs">
          <li>Фото 1: {stim.imageCaptions[0]}</li>
          <li>Фото 2: {stim.imageCaptions[1]}</li>
        </ul>
        <ol className="ml-5 list-decimal space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
          {stim.plan.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
      {header}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Монолог по теме. Раскройте все пункты плана.
      </p>
      <p className="font-medium">{stim.topic}</p>
      <ol className="ml-5 list-decimal space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
        {stim.plan.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ol>
    </div>
  );
}

function ListeningStimulus({
  audioUrl,
  transcript,
  voice,
  plays,
  onPlay: notifyParentPlay,
}: {
  audioUrl: string | null;
  transcript: string;
  voice: string | null;
  /**
   * Total plays *for this item* across the entire mock attempt. Lifted to
   * MockRunner state and persisted to localStorage so switching section
   * tabs / reloading the page cannot reset the FIPI 2-play limit.
   */
  plays: number;
  /** Called when the student successfully starts a new playback. */
  onPlay: () => void;
}) {
  const [audioFailed, setAudioFailed] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const canPlay = plays < MAX_LISTENING_PLAYS;
  const useTtsFallback = !audioUrl || audioFailed;

  const handlePlay = () => {
    if (!canPlay) return;
    notifyParentPlay();
    if (useTtsFallback) {
      try {
        if (typeof window === "undefined" || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(transcript);
        u.lang = "en-US";
        u.rate = 0.95;
        if (voice) {
          // mark voice in case multiple voices match — best effort
          const voices = window.speechSynthesis.getVoices();
          const match = voices.find((v) =>
            v.name.toLowerCase().includes((voice || "").toLowerCase()),
          );
          if (match) u.voice = match;
        }
        window.speechSynthesis.speak(u);
      } catch {
        // ignore
      }
      return;
    }
    // Real audio URL: play through the hidden <audio> element so the
    // button is the *only* trigger — keeps the FIPI 2-play limit honest.
    const el = audioRef.current;
    if (!el) return;
    try {
      el.currentTime = 0;
      void el.play().catch(() => setAudioFailed(true));
    } catch {
      setAudioFailed(true);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPlay}
          onClick={handlePlay}
        >
          {useTtsFallback ? (
            <Volume2 className="mr-2 h-4 w-4" />
          ) : (
            <Headphones className="mr-2 h-4 w-4" />
          )}
          {canPlay
            ? `Прослушать (${plays + 1}/${MAX_LISTENING_PLAYS})`
            : "Прослушивания исчерпаны"}
        </Button>
        {!useTtsFallback && audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            onError={() => setAudioFailed(true)}
            preload="auto"
            // No `controls` — the button is the sole playback trigger,
            // otherwise the native player would let the student replay
            // an unlimited number of times and bypass the 2-play rule.
            className="hidden"
          />
        )}
      </div>
    </div>
  );
}

function ReadingStimulus({ passage }: { passage: string }) {
  return (
    <div className="rounded-md border bg-zinc-50/50 p-3 text-sm leading-relaxed dark:bg-zinc-900/40">
      <pre className="whitespace-pre-wrap font-sans">{passage}</pre>
    </div>
  );
}

function GrammarTextStimulus({
  stim,
}: {
  stim:
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
      };
}) {
  return (
    <div className="space-y-1">
      <p className="leading-relaxed">{stim.prompt}</p>
      <div className="text-xs text-zinc-500">
        База: <span className="font-mono uppercase">{stim.base}</span>
        {stim.kind === "grammar_word_formation" && stim.pos
          ? ` · часть речи: ${stim.pos}`
          : ""}
        {stim.kind === "grammar_open_cloze" && stim.hint
          ? ` · подсказка: ${stim.hint}`
          : ""}
      </div>
    </div>
  );
}

function GrammarMcStimulus({ prompt }: { prompt: string }) {
  return <p className="leading-relaxed">{prompt}</p>;
}

function McChoices({
  options,
  question,
  chosen,
  onChoose,
}: {
  options: string[];
  question: string | null;
  chosen: number | null;
  onChoose: (idx: number) => void;
}) {
  return (
    <div className="space-y-2">
      {question && <p className="font-medium">{question}</p>}
      <div className="flex flex-col gap-1.5">
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChoose(i)}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm",
              chosen === i
                ? "border-zinc-800 bg-zinc-100 dark:border-zinc-200 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-900/40",
            )}
          >
            <span className="mr-2 font-mono text-xs text-zinc-500">
              {String.fromCharCode(65 + i)}
            </span>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function GrammarTextInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Do NOT key on `value` here. The parent <ItemCard /> already keys on
  // the item id, so distinct items get distinct DebouncedTextarea
  // instances. Keying on `value` would force a remount every time the
  // debounce fires (parent updates `value` → key changes), which both
  // (a) destroys the DOM textarea and steals focus mid-typing, and
  // (b) re-runs DebouncedTextarea's unmount-flush, double-firing
  // `onCommit` for the same edit.
  return <DebouncedTextarea initial={value} onCommit={onChange} />;
}

const DEBOUNCED_COMMIT_MS = 300;

function DebouncedTextarea({
  initial,
  onCommit,
  placeholder = "Ваш ответ",
  className = "min-h-[60px] font-mono text-sm",
}: {
  initial: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [local, setLocal] = React.useState(initial);
  // Keep latest values in refs so the unmount cleanup can read them
  // without becoming a stale closure (which would otherwise re-fire
  // every render).
  const localRef = React.useRef(local);
  const initialRef = React.useRef(initial);
  const onCommitRef = React.useRef(onCommit);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    localRef.current = local;
  }, [local]);
  React.useEffect(() => {
    initialRef.current = initial;
  }, [initial]);
  React.useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const flush = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (localRef.current !== initialRef.current) {
      onCommitRef.current(localRef.current);
    }
  }, []);

  // Cleanup: if the component unmounts (e.g. AutoSubmit navigates to
  // results) while a debounced commit is pending, flush it synchronously
  // so localStorage at least captures the final draft. The corresponding
  // /api/mock/answer POST may still race the submit; the parent's
  // pendingSavesRef + flushPendingSaves handles that side.
  React.useEffect(() => {
    return () => flush();
  }, [flush]);

  return (
    <Textarea
      value={local}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        // Auto-commit shortly after the user stops typing, so the parent
        // (and the server save it triggers) stays current without
        // depending on a blur that may never fire — e.g. when the timer
        // hits 00:00 and AutoSubmit navigates away mid-keystroke.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (next !== initialRef.current) onCommitRef.current(next);
        }, DEBOUNCED_COMMIT_MS);
      }}
      onBlur={flush}
      placeholder={placeholder}
      className={className}
    />
  );
}

function AutoSubmit({
  remaining,
  attemptId,
  examCode,
  flush,
}: {
  remaining: number;
  attemptId: string;
  examCode: SupportedExamCode;
  flush: () => Promise<void>;
}) {
  const router = useRouter();
  // Use a ref guard so we don't trigger a state update inside the effect.
  const firedRef = React.useRef(false);
  React.useEffect(() => {
    if (remaining > 0 || firedRef.current) return;
    firedRef.current = true;
    void (async () => {
      // Flush any focused textarea + await any in-flight
      // `/api/mock/answer` POSTs, so the last grammar text edit lands
      // server-side before the attempt is closed.
      await flush();
      try {
        await fetch("/api/mock/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ attemptId }),
        });
      } catch {
        // ignore — user can retry on results page
      }
      try {
        window.localStorage.removeItem(`${PLAN_KEY_PREFIX}${attemptId}`);
        window.localStorage.removeItem(`${ANSWERS_KEY_PREFIX}${attemptId}`);
        window.localStorage.removeItem(`${PLAYS_KEY_PREFIX}${attemptId}`);
      } catch {
        // ignore quota / disabled localStorage
      }
      router.push(`/dashboard/${examCode}/mock/${attemptId}/results`);
    })();
  }, [remaining, attemptId, examCode, router, flush]);
  return null;
}

function formatHMS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
