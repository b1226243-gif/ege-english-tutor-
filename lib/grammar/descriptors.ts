import type { SupportedExamCode } from "@/lib/exams";
import type { GrammarTaskDescriptor } from "@/lib/grammar/types";

/**
 * Per-exam grammar task types we expose in the UI. Each descriptor
 * corresponds 1-to-1 to a `task_template` row (seed in
 * `scripts/seed-grammar.ts`).
 */
export function getGrammarDescriptors(
  examCode: SupportedExamCode,
): GrammarTaskDescriptor[] {
  if (examCode === "ielts") {
    // IELTS doesn't have a stand-alone Grammar & Vocabulary section —
    // grammar/lexis are scored as part of Writing & Speaking.
    return [];
  }
  if (examCode === "ege_en") {
    return [
      {
        type: "transform",
        codeSuffix: "transform",
        displayName: "Open Cloze — формы слова",
        shortDescription:
          "Задания 19–24 ЕГЭ. Поставьте слово в скобках в нужную форму.",
        fipiTaskRange: "19–24",
      },
      {
        type: "word_formation",
        codeSuffix: "word_formation",
        displayName: "Словообразование",
        shortDescription:
          "Задания 25–29 ЕГЭ. Образуйте однокоренное слово нужной части речи.",
        fipiTaskRange: "25–29",
      },
      {
        type: "lexical_mc",
        codeSuffix: "lexical_mc",
        displayName: "Лексика — множественный выбор",
        shortDescription:
          "Задания 30–36 ЕГЭ. Выберите подходящую по смыслу лексическую единицу.",
        fipiTaskRange: "30–36",
      },
    ];
  }
  // oge_en
  return [
    {
      type: "word_formation",
      codeSuffix: "word_formation",
      displayName: "Словообразование",
      shortDescription:
        "Задания 18–26 ОГЭ. Образуйте однокоренное слово нужной части речи.",
      fipiTaskRange: "18–26",
    },
    {
      type: "transform",
      codeSuffix: "transform",
      displayName: "Грамматические формы",
      shortDescription:
        "Задания 27–32 ОГЭ. Поставьте слово в скобках в нужную грамматическую форму.",
      fipiTaskRange: "27–32",
    },
  ];
}

export function taskTemplateCode(
  examCode: SupportedExamCode,
  codeSuffix: string,
): string {
  return `${examCode}.grammar.${codeSuffix}`;
}
