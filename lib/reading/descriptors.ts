import type { SupportedExamCode } from "@/lib/exams";
import type { ReadingTaskDescriptor } from "@/lib/reading/types";

/**
 * Per-exam reading descriptors.
 *
 * Each one corresponds 1-to-1 to a `task_template` row seeded in
 * `scripts/seed-reading.ts`. Keeping the list here (rather than in the
 * seed script) lets the UI render placeholders for types that have zero
 * seeded items yet.
 */
export function getReadingDescriptors(
  examCode: SupportedExamCode,
): ReadingTaskDescriptor[] {
  if (examCode === "ege_en") {
    return [
      {
        type: "reading_mc",
        format: "matching_headings",
        codeSuffix: "matching_headings",
        displayName: "Подбор заголовков",
        shortDescription:
          "Задание 10 ЕГЭ. Подберите заголовок, который лучше всего отражает содержание абзаца.",
        fipiTaskRange: "10",
      },
      {
        type: "reading_mc",
        format: "matching_statements",
        codeSuffix: "matching_statements",
        displayName: "Заполнение пропусков",
        shortDescription:
          "Задание 11 ЕГЭ. Выберите фразу, которая логично заполняет пропуск в тексте.",
        fipiTaskRange: "11",
      },
      {
        type: "reading_mc",
        format: "mc_detail",
        codeSuffix: "mc_detail",
        displayName: "Детальное понимание",
        shortDescription:
          "Задания 12–18 ЕГЭ. Выберите правильный ответ по содержанию прочитанного текста.",
        fipiTaskRange: "12–18",
      },
    ];
  }
  // oge_en
  return [
    {
      type: "reading_mc",
      format: "matching_headings",
      codeSuffix: "matching_headings",
      displayName: "Подбор заголовков",
      shortDescription:
        "Задания 9–11 ОГЭ. Подберите заголовок, который лучше всего отражает тему текста.",
      fipiTaskRange: "9–11",
    },
    {
      type: "reading_mc",
      format: "true_false_stated",
      codeSuffix: "true_false_stated",
      displayName: "True / False / Not stated",
      shortDescription:
        "Задания 12–17 ОГЭ. Определите, верно ли утверждение согласно тексту.",
      fipiTaskRange: "12–17",
    },
  ];
}

export function readingTaskTemplateCode(
  examCode: SupportedExamCode,
  codeSuffix: string,
): string {
  return `${examCode}.reading.${codeSuffix}`;
}
