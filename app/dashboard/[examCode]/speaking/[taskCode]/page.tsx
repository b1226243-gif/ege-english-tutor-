import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { EXAM_DISPLAY, isSupportedExamCode } from "@/lib/exams";
import {
  getSpeakingTaskTemplateByCode,
  getSpeakingTemplateStats,
  listSpeakingItemsForTemplate,
} from "@/lib/speaking/persistence";
import { SpeakingPractice } from "./speaking-practice";

export default async function SpeakingTaskPage({
  params,
}: {
  params: Promise<{ examCode: string; taskCode: string }>;
}) {
  const { examCode, taskCode: rawTaskCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const taskCode = decodeURIComponent(rawTaskCode);
  const [template, session] = await Promise.all([
    getSpeakingTaskTemplateByCode(taskCode),
    auth(),
  ]);
  if (!template || template.examCode !== examCode) notFound();

  const items = await listSpeakingItemsForTemplate(template.id);
  if (items.length === 0) notFound();

  const stats = session?.user?.id
    ? await getSpeakingTemplateStats({
        userId: session.user.id,
        taskTemplateId: template.id,
      })
    : { attempts: 0, totalScore: 0, totalMax: 0 };

  const exam = EXAM_DISPLAY[examCode];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">
          Экзамены
        </Link>
        <span>›</span>
        <Link href={`/dashboard/${examCode}`} className="hover:underline">
          {exam.shortName}
        </Link>
        <span>›</span>
        <Link
          href={`/dashboard/${examCode}/speaking`}
          className="hover:underline"
        >
          Устная часть
        </Link>
        <span>›</span>
        <span>{template.title}</span>
      </div>
      <SpeakingPractice
        examLabel={exam.shortName}
        taskCode={taskCode}
        taskTemplateId={template.id}
        title={template.title}
        instructions={template.instructions}
        descriptor={template.descriptor}
        items={items}
        initialStats={stats}
      />
    </div>
  );
}
