/**
 * FIPI 2024/25 rubric descriptors for the writing tasks. Mirrors
 * `lib/speaking/descriptors.ts` so seeding + scoring + UI all read from
 * a single source of truth.
 *
 *   ОГЭ Task 33 — personal email, 100–120 words, max 10.
 *   ЕГЭ Task 37 — personal email, 100–140 words, max 6.
 *   ЕГЭ Task 38 — opinion essay on a chart/table, 180–275 words, max 14.
 */

import type { SupportedExamCode } from "@/lib/exams";

export type WritingFormat =
  | "task_33_email" // OGE
  | "task_37_email" // EGE
  | "task_38_essay"; // EGE

export type WritingRubricCriterion = {
  code: string;
  label: string;
  max: number;
  description: string;
};

export type WritingDescriptor = {
  format: WritingFormat;
  examCode: SupportedExamCode;
  fipiTaskNumber: number;
  displayName: string;
  fipiInstructions: string;
  /** Inclusive word range students must hit. */
  minWords: number;
  maxWords: number;
  /** Below this → К1 = 0 → entire task = 0. */
  hardMin: number;
  /** Above this → only the first `maxWords` words are graded. */
  hardMax: number;
  /** Per-task suggested time, used as the section budget for the mock. */
  timeBudgetSeconds: number;
  rubric: WritingRubricCriterion[];
};

export const TASK_33_DESCRIPTOR: WritingDescriptor = {
  format: "task_33_email",
  examCode: "oge_en",
  fipiTaskNumber: 33,
  displayName: "Письмо · Task 33 — Personal email (ОГЭ)",
  fipiInstructions:
    "Write a 100–120-word reply to your friend's letter. Greet them, thank them, answer all questions, ask one question of your own, sign off properly.",
  minWords: 100,
  maxWords: 120,
  hardMin: 90,
  hardMax: 132,
  timeBudgetSeconds: 30 * 60,
  rubric: [
    {
      code: "K1",
      label: "Решение коммуникативной задачи",
      max: 3,
      description:
        "Все аспекты, указанные в задании, раскрыты полно; стилевое оформление соответствует неофициальной переписке.",
    },
    {
      code: "K2",
      label: "Организация текста",
      max: 2,
      description:
        "Логичная структура (приветствие, благодарность, ответы, встречный вопрос, прощание, подпись), правильное использование средств логической связи.",
    },
    {
      code: "K3",
      label: "Лексико-грамматическое оформление",
      max: 3,
      description:
        "Используется лексика, соответствующая поставленной задаче, корректные грамматические структуры; ошибки не препятствуют пониманию.",
    },
    {
      code: "K4",
      label: "Орфография и пунктуация",
      max: 2,
      description:
        "Орфографических и пунктуационных ошибок не более 2.",
    },
  ],
};

export const TASK_37_DESCRIPTOR: WritingDescriptor = {
  format: "task_37_email",
  examCode: "ege_en",
  fipiTaskNumber: 37,
  displayName: "Письмо · Task 37 — Personal email (ЕГЭ)",
  fipiInstructions:
    "Write a 100–140-word reply to your friend. Answer ALL questions in the body, ask one question of your own, finish with a polite sign-off and signature on a separate line.",
  minWords: 100,
  maxWords: 140,
  hardMin: 90,
  hardMax: 154,
  timeBudgetSeconds: 30 * 60,
  rubric: [
    {
      code: "K1",
      label: "Решение коммуникативной задачи",
      max: 2,
      description:
        "Заданы все вопросы из стимула, даны полные ответы, регистр — неофициальный.",
    },
    {
      code: "K2",
      label: "Организация текста",
      max: 2,
      description:
        "Структура соблюдена (greeting, opening thanks, body, closing question, sign-off, signature).",
    },
    {
      code: "K3",
      label: "Языковое оформление",
      max: 2,
      description:
        "Лексико-грамматические и орфографические ошибки не препятствуют пониманию.",
    },
  ],
};

export const TASK_38_DESCRIPTOR: WritingDescriptor = {
  format: "task_38_essay",
  examCode: "ege_en",
  fipiTaskNumber: 38,
  displayName: "Письмо · Task 38 — Opinion essay (ЕГЭ)",
  fipiInstructions:
    "Write a 180–275-word opinion essay on the proposed chart/table. Use the 5-paragraph FIPI plan: introduction, 2–3 numerical facts, your opinion + 2 arguments, opposing view + 1 reason, your refutation + conclusion.",
  minWords: 180,
  maxWords: 275,
  hardMin: 160,
  hardMax: 303,
  timeBudgetSeconds: 50 * 60,
  rubric: [
    {
      code: "K1",
      label: "Решение коммуникативной задачи",
      max: 3,
      description:
        "План 5 абзацев соблюдён, цифры из стимула приведены и интерпретированы.",
    },
    {
      code: "K2",
      label: "Организация текста",
      max: 3,
      description:
        "Логика, средства связи, абзацное членение.",
    },
    {
      code: "K3",
      label: "Лексика",
      max: 3,
      description:
        "Лексический запас соответствует уровню; используется тематическая лексика и синонимы.",
    },
    {
      code: "K4",
      label: "Грамматика",
      max: 3,
      description:
        "Используется широкий диапазон грамматических структур.",
    },
    {
      code: "K5",
      label: "Орфография и пунктуация",
      max: 2,
      description:
        "Не более 2 ошибок суммарно.",
    },
  ],
};

export const WRITING_DESCRIPTORS: WritingDescriptor[] = [
  TASK_33_DESCRIPTOR,
  TASK_37_DESCRIPTOR,
  TASK_38_DESCRIPTOR,
];

export function getWritingDescriptors(
  examCode: SupportedExamCode,
): WritingDescriptor[] {
  return WRITING_DESCRIPTORS.filter((d) => d.examCode === examCode);
}

export function writingTaskTemplateCode(d: WritingDescriptor): string {
  return `${d.examCode}.writing.${d.format}`;
}

export function totalWritingMax(rubric: WritingRubricCriterion[]): number {
  return rubric.reduce((s, c) => s + c.max, 0);
}
