import { notFound } from "next/navigation";

import { SectionStub } from "@/components/section-stub";
import { isSupportedExamCode } from "@/lib/exams";

export default async function MockExamPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  return (
    <SectionStub
      examCode={examCode}
      sectionTitle="Mock Exam — полный вариант"
      plannedIn="PR #7"
      whatWillYouGet={[
        examCode === "ege_en"
          ? "Полный ЕГЭ: 180 минут письменная часть (Listening → Reading → Grammar → Writing) + устная часть."
          : "Полный ОГЭ: 120 минут письменная часть + устная часть.",
        "Единый таймер по регламенту FIPI, без возможности вернуться к пройденной секции после истечения времени.",
        "Автосохранение прогресса — можно продолжить, если закрыли вкладку.",
        "Итоговый протокол: баллы по каждой секции, первичные → тестовые, прогноз оценки.",
        "История всех сданных mock-экзаменов с динамикой прогресса.",
      ]}
    />
  );
}
