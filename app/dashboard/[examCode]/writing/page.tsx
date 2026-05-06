import { notFound } from "next/navigation";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WritingWorkspace } from "./writing-workspace";
import {
  EXAM_DISPLAY,
  getWritingTasks,
  isSupportedExamCode,
} from "@/lib/exams";

export default async function WritingPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const exam = EXAM_DISPLAY[examCode];
  const tasks = getWritingTasks(examCode);

  const breadcrumbs = (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <Link href="/dashboard" className="hover:underline">
        Экзамены
      </Link>
      <span>›</span>
      <Link href={`/dashboard/${examCode}`} className="hover:underline">
        {exam.shortName}
      </Link>
      <span>›</span>
      <span>Письмо</span>
    </div>
  );

  // Exams that don't define any FIPI-shaped writing tasks (IELTS today,
  // because its TR/CC/LR/GRA rubric doesn't fit the FIPI K1–K5 module
  // shape that `WritingWorkspace` consumes) render a "В разработке"
  // notice instead of the workspace. WritingWorkspace assumes a
  // non-empty `tasks` array — accessing `tasks[0].module` would crash.
  if (tasks.length === 0) {
    return (
      <div className="space-y-4">
        {breadcrumbs}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Письмо · {exam.shortName}</CardTitle>
            <CardDescription>
              Модуль письма для {exam.shortName} ещё не подключён. Рубрики и
              банк заданий появятся в следующих PR.
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

  return (
    <div className="flex flex-col gap-4">
      {breadcrumbs}
      <WritingWorkspace examCode={examCode} tasks={tasks} />
    </div>
  );
}
