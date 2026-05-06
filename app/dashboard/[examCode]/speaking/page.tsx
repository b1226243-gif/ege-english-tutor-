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
import { speakingTaskTemplateCode } from "@/lib/speaking/descriptors";
import { totalSpeakingMax } from "@/lib/speaking/descriptors";
import { getSpeakingTaskTemplates } from "@/lib/speaking/persistence";

/**
 * Speaking section landing page — FIPI-task picker.
 *
 * Replaces the Phase 1 `SpeakingWorkspace` (free-form Web Speech API capture)
 * with a structured picker: 4 tasks for ЕГЭ, 3 tasks for ОГЭ. Each card
 * shows timing, max score, and how many items are currently seeded.
 */
export default async function SpeakingPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const exam = EXAM_DISPLAY[examCode];
  const templates = await getSpeakingTaskTemplates(examCode);

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
          <span>Устная часть</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Устная часть · {exam.shortName}
        </h1>
        <p className="text-sm text-zinc-500">
          Запись через микрофон браузера (MediaRecorder), транскрипция через
          OpenAI Whisper и оценка GPT-4o по рубрикам ФИПИ. Аудио не
          сохраняется — остаются транскрипт и баллы.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const enabled = t.itemCount > 0;
          const href = `/dashboard/${examCode}/speaking/${encodeURIComponent(
            speakingTaskTemplateCode(examCode, t.descriptor.codeSuffix),
          )}`;
          const total = totalSpeakingMax(t.descriptor.rubric);
          const prep = t.descriptor.timing.prepareSeconds;
          const speak = t.descriptor.timing.speakSeconds;
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
                    до {total} баллов
                  </span>
                </CardTitle>
                <CardDescription>
                  {t.descriptor.shortDescription}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-zinc-500 space-y-1">
                <div>
                  Подготовка: {formatSeconds(prep)} · Ответ:{" "}
                  {formatSeconds(speak)}
                </div>
                <div>
                  {enabled
                    ? `${t.itemCount} ${t.itemCount === 1 ? "сюжет" : "сюжетов"} в банке`
                    : "Банк ещё пуст."}
                </div>
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

function formatSeconds(s: number): string {
  if (s === 0) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} сек`;
  if (r === 0) return `${m} мин`;
  return `${m} мин ${r} сек`;
}
