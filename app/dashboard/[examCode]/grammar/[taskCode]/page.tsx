import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { EXAM_DISPLAY, isSupportedExamCode } from "@/lib/exams";
import {
  getTaskTemplateByCode,
  listItemsForTemplate,
  getTemplateStats,
} from "@/lib/grammar/persistence";
import { GrammarPractice } from "./grammar-practice";

export default async function GrammarTaskPage({
  params,
}: {
  params: Promise<{ examCode: string; taskCode: string }>;
}) {
  const { examCode, taskCode: rawTaskCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const taskCode = decodeURIComponent(rawTaskCode);
  const [template, session] = await Promise.all([
    getTaskTemplateByCode(taskCode),
    auth(),
  ]);
  if (!template || template.examCode !== examCode) notFound();

  const items = await listItemsForTemplate(template.id);
  if (items.length === 0) notFound();

  const stats = session?.user?.id
    ? await getTemplateStats({
        userId: session.user.id,
        taskTemplateId: template.id,
      })
    : { correct: 0, total: 0 };

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
          href={`/dashboard/${examCode}/grammar`}
          className="hover:underline"
        >
          Грамматика
        </Link>
        <span>›</span>
        <span>{template.title}</span>
      </div>
      <GrammarPractice
        examLabel={exam.shortName}
        title={template.title}
        instructions={template.instructions}
        items={items}
        initialStats={stats}
        generateConfig={(() => {
          const suffix = taskCode.split(".").pop();
          if (
            suffix === "transform" ||
            suffix === "word_formation" ||
            suffix === "lexical_mc"
          ) {
            return { examCode, type: suffix };
          }
          return undefined;
        })()}
      />
    </div>
  );
}
