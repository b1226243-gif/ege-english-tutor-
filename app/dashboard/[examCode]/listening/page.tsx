import { notFound } from "next/navigation";

import { SectionStub } from "@/components/section-stub";
import { isSupportedExamCode } from "@/lib/exams";

export default async function ListeningPage({
  params,
}: {
  params: Promise<{ examCode: string }>;
}) {
  const { examCode } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  return (
    <SectionStub
      examCode={examCode}
      sectionTitle="Аудирование"
      plannedIn="PR #5"
      whatWillYouGet={[
        "Задания 1–11: matching утверждений, true/false, multiple choice.",
        "Аудио-плеер с жёстким регламентом «два прослушивания», как на реальном экзамене.",
        "Хранение аудиофайлов в Vercel Blob (для AI-сгенерированных — OpenAI TTS).",
        "Автоматическая проверка + разбор ошибок с таймкодами («на 1:23 говорящий говорит X, а не Y»).",
        "Banки аутентичных FIPI-файлов + бесконечная тренировка на AI-контенте.",
      ]}
    />
  );
}
