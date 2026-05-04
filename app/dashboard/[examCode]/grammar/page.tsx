import { notFound } from "next/navigation";

import { SectionStub } from "@/components/section-stub";
import { isSupportedExamCode } from "@/lib/exams";

export default async function GrammarPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  return (
    <SectionStub
      examCode={examCode}
      sectionTitle="Грамматика и лексика"
      plannedIn="PR #3"
      whatWillYouGet={[
        examCode === "ege_en"
          ? "Задания 19–36 ЕГЭ: word formation, gap fill, cloze."
          : "Задания 18–32 ОГЭ: word formation, gap fill.",
        "Мгновенная автопроверка по ключу — без ожидания GPT.",
        "Разбор каждой ошибки в сократическом режиме: «какое время должно быть, если указан маркер since?».",
        "Прогресс по темам (articles, conditionals, phrasal verbs, modal verbs, ...).",
        "AI-генератор бесконечной серии заданий по выбранной теме и уровню.",
      ]}
    />
  );
}
