import type { SupportedExamCode } from "@/lib/exams";
import type { ListeningTaskDescriptor } from "@/lib/listening/types";

/**
 * Per-exam listening descriptors.
 *
 * Each one corresponds 1-to-1 to a `task_template` row seeded in
 * `scripts/seed-listening.ts`. Keeping the list here (rather than in the
 * seed script) lets the UI render placeholders for types that have zero
 * seeded items yet.
 */
export function getListeningDescriptors(
  examCode: SupportedExamCode,
): ListeningTaskDescriptor[] {
  if (examCode === "ege_en") {
    return [
      {
        type: "listening_mc",
        format: "matching_speakers",
        codeSuffix: "matching_speakers",
        displayName: "Подбор утверждений к говорящим",
        shortDescription:
          "Задание 1 ЕГЭ. Прослушайте короткий монолог и выберите утверждение, которое ему соответствует.",
        fipiTaskRange: "1",
      },
      {
        type: "listening_mc",
        format: "true_false_stated",
        codeSuffix: "true_false_stated",
        displayName: "True / False / Not stated",
        shortDescription:
          "Задание 2 ЕГЭ. Определите, верно ли утверждение согласно прослушанному.",
        fipiTaskRange: "2",
      },
      {
        type: "listening_mc",
        format: "mc_detail",
        codeSuffix: "mc_detail",
        displayName: "Детальное понимание",
        shortDescription:
          "Задания 3–9 ЕГЭ. Выберите правильный ответ по содержанию прослушанного.",
        fipiTaskRange: "3–9",
      },
    ];
  }
  // oge_en
  return [
    {
      type: "listening_mc",
      format: "matching_speakers",
      codeSuffix: "matching_speakers",
      displayName: "Подбор к говорящим",
      shortDescription:
        "Задания 1–4 ОГЭ. Прослушайте короткий монолог и выберите подходящее утверждение.",
      fipiTaskRange: "1–4",
    },
    {
      type: "listening_mc",
      format: "mc_detail",
      codeSuffix: "mc_detail",
      displayName: "Детальное понимание",
      shortDescription:
        "Задания 7–11 ОГЭ. Выберите правильный ответ по содержанию прослушанного текста.",
      fipiTaskRange: "7–11",
    },
  ];
}

export function listeningTaskTemplateCode(
  examCode: SupportedExamCode,
  codeSuffix: string,
): string {
  return `${examCode}.listening.${codeSuffix}`;
}
