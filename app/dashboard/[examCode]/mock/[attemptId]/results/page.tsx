import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";

import { auth } from "@/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EXAM_DISPLAY, isSupportedExamCode } from "@/lib/exams";
import {
  getMockAttempt,
  readMockResults,
  submitMockAttempt,
} from "@/lib/mock/persistence";

/**
 * Mock-exam results protocol.
 *
 * Idempotently submits the attempt if it's still in progress (so a user
 * who lands here after auto-submit or after the timer expired sees real
 * results instead of an empty page), then renders the per-section
 * breakdown plus a per-item table with the correct answer for review.
 */
export default async function MockResultsPage({
  params,
}: {
  params: Promise<{ examCode: string; attemptId: string }>;
}) {
  const { examCode, attemptId } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(
      `/sign-in?redirect=${encodeURIComponent(
        `/dashboard/${examCode}/mock/${attemptId}/results`,
      )}`,
    );
  }

  const attempt = await getMockAttempt(attemptId);
  if (!attempt || attempt.userId !== session.user.id) notFound();
  if (attempt.examCode !== examCode) notFound();

  if (attempt.status === "in_progress") {
    await submitMockAttempt({
      userId: session.user.id,
      attemptId,
    });
  }

  const results = await readMockResults(attemptId);
  const exam = EXAM_DISPLAY[examCode];
  const percent =
    results.maxScore > 0
      ? Math.round((results.totalScore / results.maxScore) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">
          Экзамены
        </Link>
        <span>›</span>
        <Link href={`/dashboard/${examCode}`} className="hover:underline">
          {exam.shortName}
        </Link>
        <span>›</span>
        <Link href={`/dashboard/${examCode}/mock`} className="hover:underline">
          Mock-экзамен
        </Link>
        <span>›</span>
        <span>Протокол</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Итоговый протокол · {exam.shortName}</CardTitle>
          <CardDescription>
            Сессия от {new Date(results.startedAt).toLocaleString("ru-RU")} ·
            длительность {formatHMS(results.durationSeconds)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <div className="text-3xl font-semibold">
                {results.totalScore}{" "}
                <span className="text-lg text-zinc-500">
                  / {results.maxScore}
                </span>
              </div>
              <div className="text-xs text-zinc-500">
                Первичный балл по объективным секциям
              </div>
            </div>
            <div>
              <div className="text-3xl font-semibold">{percent}%</div>
              <div className="text-xs text-zinc-500">
                Доля верных ответов
              </div>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Письмо и устная часть в этом пробнике не оцениваются — для
            полной FIPI-оценки откройте их отдельные модули ниже.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              href={`/dashboard/${examCode}/writing`}
            >
              Открыть Письмо <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              href={`/dashboard/${examCode}/speaking`}
            >
              Открыть Устную часть <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {results.sections.map((s) => (
          <Card key={s.kind}>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {s.displayName}
              </CardTitle>
              <CardDescription>
                {s.totalScore} / {s.maxScore} ·{" "}
                {s.attempts}{" "}
                {pluralize(s.attempts, "ответ", "ответа", "ответов")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProgressBar
                value={s.maxScore > 0 ? (s.totalScore / s.maxScore) * 100 : 0}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {results.sections.map((s) => (
        <Card key={s.kind}>
          <CardHeader>
            <CardTitle>{s.displayName} — разбор по заданиям</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {s.items.map((it, idx) => (
                <li
                  key={it.itemId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      №{idx + 1} · {it.taskTemplateTitle}
                    </div>
                    <div className="font-medium">
                      Ваш ответ:{" "}
                      <span className="font-normal">
                        {it.studentResponse || (
                          <span className="text-zinc-400">— не отвечено —</span>
                        )}
                      </span>
                    </div>
                    {it.correct === false && it.expected && (
                      <div className="text-xs text-zinc-500">
                        Правильный ответ:{" "}
                        <span className="font-medium">{it.expected}</span>
                      </div>
                    )}
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                      it.correct === true
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                        : it.correct === false
                          ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                          : "border-zinc-300 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100",
                    )}
                  >
                    {it.correct === true ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : it.correct === false ? (
                      <XCircle className="h-3.5 w-3.5" />
                    ) : null}
                    {it.score}/{it.maxScore}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="text-xs text-zinc-500">
            Хотите ещё один прогон? План перетасуется заново.
          </div>
          <div className="flex gap-2">
            <Link
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              href={`/dashboard/${examCode}/mock`}
            >
              Назад к старту
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <div
        className="h-full bg-emerald-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function formatHMS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}ч ${m}м ${sec}с`;
  }
  return `${m}м ${sec}с`;
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
