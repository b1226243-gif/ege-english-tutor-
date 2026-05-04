import { notFound } from "next/navigation";

import { SectionStub } from "@/components/section-stub";
import { isSupportedExamCode } from "@/lib/exams";

export default async function ReadingPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  return (
    <SectionStub
      examCode={examCode}
      sectionTitle="Чтение"
      plannedIn="PR #4"
      whatWillYouGet={[
        examCode === "ege_en"
          ? "Задания 12–18 ЕГЭ: matching заголовков, заполнение пропусков, multiple choice."
          : "Задания 12–17 ОГЭ: matching заголовков, multiple choice.",
        "Автоматическая проверка по ключу + разбор ошибок с цитатами из текста.",
        "AI-разбор «почему ответ B, а не A» в сократическом режиме.",
        "Банк аутентичных демоверсий FIPI + AI-генератор новых текстов по уровню CEFR.",
        "Статистика по темам (science, lifestyle, history, ecology и т.д.).",
      ]}
    />
  );
}
