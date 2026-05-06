import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EXAM_DISPLAY, type SupportedExamCode } from "@/lib/exams";

type Props = {
  examCode: SupportedExamCode;
  sectionTitle: string;
  plannedIn: string;
  whatWillYouGet: string[];
};

/**
 * Shared "coming soon" placeholder for sections that are in the backlog
 * (Reading, Listening, Grammar, Mock Exam). Renders the exam breadcrumb,
 * a clear "in development" badge, and the roadmap so the user knows what
 * this section will do when it lands.
 */
export function SectionStub({
  examCode,
  sectionTitle,
  plannedIn,
  whatWillYouGet,
}: Props) {
  const exam = EXAM_DISPLAY[examCode];

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
          <span>{sectionTitle}</span>
        </div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          {sectionTitle}
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {plannedIn}
          </span>
        </h1>
        <p className="text-sm text-zinc-500">
          Секция в разработке. Ниже — план того, что появится, когда мы её
          выпустим.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Что будет в этой секции</CardTitle>
          <CardDescription>
            Эти фичи реализуются в {plannedIn} — схема БД уже готова, нужен
            только UI, автограда и контент.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {whatWillYouGet.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
