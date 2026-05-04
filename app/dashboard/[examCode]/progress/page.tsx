import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EXAM_DISPLAY, isSupportedExamCode } from "@/lib/exams";
import {
  SOURCE_FILTERS,
  getAiOverview,
  getProgressOverview,
  isSourceFilter,
} from "@/lib/progress/queries";
import type { AiSectionRollup, AiCriterionRollup } from "@/lib/progress/queries";
import type { SectionKind } from "@/lib/db/schema";

const SECTION_LABEL: Record<SectionKind, string> = {
  reading: "Чтение",
  listening: "Аудирование",
  grammar: "Грамматика и лексика",
  writing: "Письмо",
  speaking: "Устная часть",
};

export default async function ProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ examCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/sign-in?next=/dashboard/${examCode}/progress`);
  }

  const sp = await searchParams;
  const sourceParam = typeof sp.source === "string" ? sp.source : "all";
  const source = isSourceFilter(sourceParam) ? sourceParam : "all";

  const [overview, ai] = await Promise.all([
    getProgressOverview({
      userId: session.user.id,
      examCode,
      source,
    }),
    getAiOverview({
      userId: session.user.id,
      examCode,
    }),
  ]);

  const exam = EXAM_DISPLAY[examCode];
  const totalPct =
    overview.total.attempted > 0
      ? Math.round((overview.total.correct / overview.total.attempted) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">
          Экзамены
        </Link>
        <span>›</span>
        <Link href={`/dashboard/${examCode}`} className="hover:underline">
          {exam.shortName}
        </Link>
        <span>›</span>
        <span>Прогресс</span>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Прогресс по темам · {exam.shortName}
        </h1>
        <p className="text-sm text-zinc-500">
          Точность по объективным секциям (Чтение / Аудирование / Грамматика)
          сверху. Ниже — суммарные баллы по AI-секциям (Письмо / Устная)
          по К-критериям FIPI.
        </p>
      </div>

      <SourceFilter examCode={examCode} active={source} />

      {overview.total.attempted === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Пока нет данных</CardTitle>
            <CardDescription>
              {source === "all"
                ? "Решите хотя бы одно задание в Чтении, Аудировании или Грамматике, чтобы увидеть прогресс."
                : "Нет ответов по выбранному источнику. Попробуйте другой фильтр или решите задания этого источника."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Общая точность</CardTitle>
              <CardDescription>
                {overview.total.correct} из {overview.total.attempted} ответов
                {totalPct !== null ? ` · ${totalPct}%` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProgressBar
                correct={overview.total.correct}
                attempted={overview.total.attempted}
              />
            </CardContent>
          </Card>

          <div>
            <h2 className="text-lg font-semibold mb-3">По секциям</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {overview.bySection.map((row) => {
                const pct =
                  row.attempted > 0
                    ? Math.round((row.correct / row.attempted) * 100)
                    : 0;
                return (
                  <Card key={row.sectionKind}>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {SECTION_LABEL[row.sectionKind] ?? row.sectionKind}
                      </CardTitle>
                      <CardDescription>
                        {row.correct}/{row.attempted} · {pct}%
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ProgressBar
                        correct={row.correct}
                        attempted={row.attempted}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">По темам</h2>
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-zinc-500">
                    <tr className="border-b">
                      <th className="px-3 py-2 font-medium">Тема</th>
                      <th className="px-3 py-2 font-medium">Секция</th>
                      <th className="px-3 py-2 font-medium text-right">
                        Ответов
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Верно
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Точность
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.byTopic.map((row, i) => {
                      const pct =
                        row.attempted > 0
                          ? Math.round((row.correct / row.attempted) * 100)
                          : 0;
                      const isUntagged = row.topic === "__untagged";
                      return (
                        <tr
                          key={`${row.topic}-${row.sectionKind}-${i}`}
                          className="border-b last:border-0"
                        >
                          <td className="px-3 py-2">
                            {isUntagged ? (
                              <span className="text-zinc-400 italic">
                                без темы
                              </span>
                            ) : (
                              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
                                {row.topic}
                              </code>
                            )}
                          </td>
                          <td className="px-3 py-2 text-zinc-500">
                            {SECTION_LABEL[row.sectionKind] ?? row.sectionKind}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.attempted}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.correct}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span
                              className={
                                pct >= 75
                                  ? "text-green-700 dark:text-green-300"
                                  : pct >= 50
                                    ? "text-amber-700 dark:text-amber-300"
                                    : "text-red-700 dark:text-red-300"
                              }
                            >
                              {pct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <AiSections sections={ai.bySection} />
    </div>
  );
}

function AiSections({ sections }: { sections: AiSectionRollup[] }) {
  if (sections.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-3">AI-секции (Письмо · Устная)</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Пока нет AI-оценок</CardTitle>
            <CardDescription>
              Сдайте пробный экзамен или запросите AI-оценку у ответа Письма /
              Устной — здесь появятся суммы баллов по К-критериям FIPI.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">
        AI-секции (Письмо · Устная)
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((s) => {
          const pct =
            s.maxSum > 0 ? Math.round((s.scoreSum / s.maxSum) * 100) : 0;
          return (
            <Card key={s.sectionKind}>
              <CardHeader>
                <CardTitle className="text-base">
                  {SECTION_LABEL[s.sectionKind] ?? s.sectionKind}
                </CardTitle>
                <CardDescription>
                  {s.scoreSum}/{s.maxSum} баллов · {pct}% · оценено{" "}
                  {s.graded}{" "}
                  {pluralAnswers(s.graded)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <ProgressBar correct={s.scoreSum} attempted={s.maxSum} />
                <ul className="space-y-1.5 pt-1 text-xs">
                  {s.byCriterion.map((c) => (
                    <CriterionRow key={c.code} c={c} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CriterionRow({ c }: { c: AiCriterionRollup }) {
  const pct = c.maxSum > 0 ? Math.round((c.scoreSum / c.maxSum) * 100) : 0;
  const tone =
    pct >= 75
      ? "text-green-700 dark:text-green-300"
      : pct >= 50
        ? "text-amber-700 dark:text-amber-300"
        : "text-red-700 dark:text-red-300";
  return (
    <li className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className="font-mono font-medium">{c.code}</span>
          {c.label && (
            <span className="truncate text-zinc-500">— {c.label}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 tabular-nums">
        <span className="font-medium">
          {c.scoreSum}/{c.maxSum}
        </span>{" "}
        <span className={tone}>({pct}%)</span>
      </div>
    </li>
  );
}

function pluralAnswers(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "ответов";
  const last = n % 10;
  if (last === 1) return "ответ";
  if (last >= 2 && last <= 4) return "ответа";
  return "ответов";
}

function SourceFilter({
  examCode,
  active,
}: {
  examCode: string;
  active: string;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {SOURCE_FILTERS.map((f) => (
        <Link
          key={f.value}
          href={`/dashboard/${examCode}/progress${f.value === "all" ? "" : `?source=${f.value}`}`}
          className={
            active === f.value
              ? "rounded-full bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-full border px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }
        >
          {f.label}
        </Link>
      ))}
    </div>
  );
}

function ProgressBar({
  correct,
  attempted,
}: {
  correct: number;
  attempted: number;
}) {
  const pct = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className={
          pct >= 75
            ? "h-full bg-green-500"
            : pct >= 50
              ? "h-full bg-amber-500"
              : "h-full bg-red-500"
        }
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
