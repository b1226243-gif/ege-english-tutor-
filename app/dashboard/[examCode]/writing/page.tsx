import { notFound } from "next/navigation";
import Link from "next/link";

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

  return (
    <div className="flex flex-col gap-4">
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
      <WritingWorkspace examCode={examCode} tasks={tasks} />
    </div>
  );
}
