import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EXAM_DISPLAY, SUPPORTED_EXAM_CODES } from "@/lib/exams";

/**
 * Dashboard landing page — exam picker.
 *
 * Replaces the old Phase 1 "Writing / Speaking" direct links with a proper
 * exam-first navigation. New exams (IELTS, TOEFL, Cambridge) will slot in
 * here without touching any per-section code.
 */
export default function DashboardIndex() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Выберите экзамен
        </h1>
        <p className="text-sm text-zinc-500">
          Подготовка ко всем секциям по официальным критериям FIPI 2024/25.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SUPPORTED_EXAM_CODES.map((code) => {
          const exam = EXAM_DISPLAY[code];
          return (
            <Link
              key={code}
              href={`/dashboard/${code}`}
              className="block transition hover:-translate-y-0.5"
            >
              <Card className="h-full hover:border-zinc-400 dark:hover:border-zinc-600">
                <CardHeader>
                  <CardTitle className="flex items-baseline justify-between gap-2">
                    <span>{exam.shortName}</span>
                    <span className="text-xs font-normal text-zinc-500">
                      {exam.grade}
                    </span>
                  </CardTitle>
                  <CardDescription>{exam.displayName}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-zinc-600 dark:text-zinc-400">
                  {exam.description}
                </CardContent>
              </Card>
            </Link>
          );
        })}

        <Card className="h-full border-dashed opacity-70">
          <CardHeader>
            <CardTitle className="flex items-baseline justify-between gap-2">
              <span>TOEFL · Cambridge</span>
              <span className="text-xs font-normal text-zinc-500">soon</span>
            </CardTitle>
            <CardDescription>Другие международные экзамены</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-500">
            Подключим после полной интеграции IELTS Academic.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
