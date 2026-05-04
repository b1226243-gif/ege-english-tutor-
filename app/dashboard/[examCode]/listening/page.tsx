import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EXAM_DISPLAY, isSupportedExamCode } from "@/lib/exams";
import { listeningTaskTemplateCode } from "@/lib/listening/descriptors";
import { getListeningTaskTemplates } from "@/lib/listening/persistence";

/**
 * Listening section landing page — task-type picker.
 *
 * Lists the listening task templates we have seeded for this exam along
 * with the number of items currently in the bank. Templates with zero
 * items render as dashed placeholders.
 */
export default async function ListeningPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const exam = EXAM_DISPLAY[examCode];
  const templates = await getListeningTaskTemplates(examCode);

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
          <span>Аудирование</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Аудирование · {exam.shortName}
        </h1>
        <p className="text-sm text-zinc-500">
          Жёсткий регламент «два прослушивания», как на реальном экзамене.
          Автопроверка по ключу + AI-разбор с цитатами из аудио. Если
          pre-rendered mp3 нет, аудио читает браузерный голос по транскрипту.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const enabled = t.itemCount > 0;
          const href = `/dashboard/${examCode}/listening/${encodeURIComponent(
            listeningTaskTemplateCode(examCode, t.descriptor.codeSuffix),
          )}`;
          const card = (
            <Card
              className={
                enabled
                  ? "h-full hover:border-zinc-400 dark:hover:border-zinc-600 transition"
                  : "h-full border-dashed opacity-70"
              }
            >
              <CardHeader>
                <CardTitle className="flex items-baseline justify-between gap-2">
                  <span>{t.descriptor.displayName}</span>
                  <span className="text-[11px] font-normal text-zinc-500">
                    №{t.descriptor.fipiTaskRange}
                  </span>
                </CardTitle>
                <CardDescription>
                  {t.descriptor.shortDescription}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-zinc-500">
                {enabled
                  ? `${t.itemCount} ${t.itemCount === 1 ? "задание" : "заданий"} в банке`
                  : "Банк ещё пуст — добавим в следующей итерации."}
              </CardContent>
            </Card>
          );
          return enabled ? (
            <Link key={t.code} href={href} className="block">
              {card}
            </Link>
          ) : (
            <div key={t.code}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
