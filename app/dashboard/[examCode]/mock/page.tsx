import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { attempts as attemptsTable } from "@/lib/db/schema";
import { EXAM_DISPLAY, getMockMode, isSupportedExamCode } from "@/lib/exams";
import { MockStartButton } from "./mock-start-button";
import { and, desc, eq } from "drizzle-orm";

/**
 * Mock-exam landing page.
 *
 * Shows the FIPI regulation summary for this exam, a "Start mock"
 * button (POSTs to /api/mock/start and redirects to the runner), and a
 * list of the user's recent mock attempts so they can revisit results.
 *
 * PR #7 limits the timed loop to listening + reading + grammar. Writing
 * and speaking are intentionally absent here; students can take those
 * separately in their dedicated modules and the results page links them.
 */
export default async function MockLandingPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const session = await auth();
  const exam = EXAM_DISPLAY[examCode];
  const mock = getMockMode(examCode);

  // Mock mode is gated per-exam: scaffolded exams (IELTS today) advertise
  // their plan in the picker but refuse to start an attempt until rubric
  // and bank infra is in place. Render a "В разработке" notice instead
  // of querying attempts that the rest of the page assumes exist.
  if (mock.status === "planned") {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Link href="/dashboard" className="hover:underline">
              Экзамены
            </Link>
            <span>›</span>
            <Link href={`/dashboard/${examCode}`} className="hover:underline">
              {exam.shortName}
            </Link>
            <span>›</span>
            <span>Mock</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {mock.displayName}
          </h1>
          <p className="text-sm text-zinc-500">{mock.description}</p>
        </div>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Скоро</CardTitle>
            <CardDescription>
              Пробник для {exam.shortName} ещё не подключён. Сейчас вы можете
              начать практиковаться по отдельным секциям как только в банке
              появятся задания.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/dashboard/${examCode}`}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Вернуться к секциям {exam.shortName}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const recent = session?.user?.id
    ? await db()
        .select({
          id: attemptsTable.id,
          startedAt: attemptsTable.startedAt,
          completedAt: attemptsTable.completedAt,
          status: attemptsTable.status,
          totalScore: attemptsTable.totalScore,
          maxScore: attemptsTable.maxScore,
        })
        .from(attemptsTable)
        .where(
          and(
            eq(attemptsTable.userId, session.user.id),
            eq(attemptsTable.examCode, examCode),
            eq(attemptsTable.mode, "mock_full"),
          ),
        )
        .orderBy(desc(attemptsTable.startedAt))
        .limit(5)
    : [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Экзамены
          </Link>
          <span>›</span>
          <Link href={`/dashboard/${examCode}`} className="hover:underline">
            {exam.shortName}
          </Link>
          <span>›</span>
          <span>Mock-экзамен</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Mock-экзамен · {exam.shortName}
        </h1>
        <p className="text-sm text-zinc-500">
          Таймированный пробник по регламенту ФИПИ 2024/25. Пройдите
          объективные секции в условиях экзамена и получите итоговый
          протокол с разбором по каждому заданию.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Что входит в этот пробник</CardTitle>
            <CardDescription>
              {examCode === "ege_en"
                ? "ЕГЭ · 100 минут на 3 секции"
                : "ОГЭ · 90 минут на 3 секции"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-medium">Аудирование</span> ·{" "}
                {examCode === "ege_en" ? "30 минут" : "30 минут"} ·
                лимит «2 прослушивания» соблюдается клиентом.
              </li>
              <li>
                <span className="font-medium">Чтение</span> ·{" "}
                {examCode === "ege_en" ? "30 минут" : "30 минут"} ·
                задания на сопоставление и MC.
              </li>
              <li>
                <span className="font-medium">Грамматика и лексика</span> ·{" "}
                {examCode === "ege_en" ? "40 минут" : "30 минут"} ·
                Open Cloze, словообразование, лексическое MC.
              </li>
            </ul>
            <p className="text-xs text-zinc-500">
              Письмо и устная часть проходят отдельно — после результатов
              откроется ссылка на их полноценные модули с FIPI-оценкой и
              транскрипцией.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Правила сессии</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Таймер запускается с момента нажатия «Начать» и идёт без
                остановок.
              </li>
              <li>
                Во время прохождения вердикты и разборы скрыты — как на
                реальном ЕГЭ.
              </li>
              <li>
                Можно переключаться между секциями и пропускать пункты;
                итоговая отправка запечатывает попытку.
              </li>
              <li>
                По истечении таймера пробник отправляется автоматически.
              </li>
            </ul>
            <div className="pt-2">
              <MockStartButton examCode={examCode} />
            </div>
          </CardContent>
        </Card>
      </div>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>История пробников</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="divide-y">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium">
                      {new Date(r.startedAt).toLocaleString("ru-RU")}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {r.status === "completed"
                        ? `Завершён · ${r.totalScore ?? 0}/${r.maxScore ?? 0} баллов`
                        : r.status === "in_progress"
                          ? "В процессе"
                          : "Прерван"}
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    {r.status === "completed" && (
                      <Link
                        className="rounded-md border px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                        href={`/dashboard/${examCode}/mock/${r.id}/results`}
                      >
                        Открыть протокол
                      </Link>
                    )}
                    {r.status === "in_progress" && (
                      <Link
                        className="rounded-md border px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                        href={`/dashboard/${examCode}/mock/${r.id}`}
                      >
                        Продолжить
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
