import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EXAM_DISPLAY,
  getMockMode,
  getSections,
  isSupportedExamCode,
} from "@/lib/exams";

/**
 * Section picker for a single exam (e.g. `/dashboard/ege_en`).
 *
 * Shows the 5 FIPI sections + Mock Exam Mode card. Sections which are
 * already implemented link directly; the rest show a "планируется в PR #N"
 * badge so the user knows what's coming.
 */
export default async function ExamSectionsPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const exam = EXAM_DISPLAY[examCode];
  const sections = getSections(examCode);
  const mock = getMockMode(examCode);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Экзамены
          </Link>
          <span>›</span>
          <span>{exam.shortName}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {exam.displayName}
        </h1>
        <p className="text-sm text-zinc-500">{exam.description}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <SectionCard key={s.kind} {...s} />
        ))}
        <SectionCard {...mock} />
      </div>
    </div>
  );
}

function SectionCard({
  displayName,
  description,
  href,
  status,
  plannedIn,
}: {
  displayName: string;
  description: string;
  href: string;
  status: "available" | "planned";
  plannedIn?: string;
}) {
  const content = (
    <Card
      className={
        status === "available"
          ? "h-full hover:border-zinc-400 dark:hover:border-zinc-600 transition"
          : "h-full border-dashed opacity-70"
      }
    >
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2">
          <span>{displayName}</span>
          {status === "available" ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-200">
              Готово
            </span>
          ) : (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {plannedIn ?? "скоро"}
            </span>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-zinc-500">
        {status === "available"
          ? "Нажмите, чтобы начать."
          : "В разработке — откроется в заглушке с планом."}
      </CardContent>
    </Card>
  );

  // All section cards are clickable (even stubs render a planned-page body).
  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}
