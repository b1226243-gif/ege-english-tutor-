import type { ExamCode, SectionKind } from "@/lib/db/schema";

/**
 * Human-readable exam metadata used by the dashboard picker.
 *
 * This is the static view layer of the exam config — the authoritative
 * source is the `exam` / `section` Postgres tables (seeded by
 * `pnpm db:seed`). We mirror the display metadata here so the picker UI
 * can render without awaiting a DB round-trip on every request.
 */

export const SUPPORTED_EXAM_CODES = ["ege_en", "oge_en"] as const;
export type SupportedExamCode = (typeof SUPPORTED_EXAM_CODES)[number];

export const EXAM_DISPLAY: Record<SupportedExamCode, {
  code: SupportedExamCode;
  displayName: string;
  shortName: string;
  grade: string;
  description: string;
}> = {
  ege_en: {
    code: "ege_en",
    displayName: "ЕГЭ по английскому",
    shortName: "ЕГЭ",
    grade: "11 класс",
    description:
      "Единый государственный экзамен. 5 секций, письменная часть 180 минут + устная ~15 минут. Максимум 100 баллов.",
  },
  oge_en: {
    code: "oge_en",
    displayName: "ОГЭ по английскому",
    shortName: "ОГЭ",
    grade: "9 класс",
    description:
      "Основной государственный экзамен. 5 секций, письменная часть 120 минут + устная 15 минут. Максимум 68 первичных баллов.",
  },
};

export function isSupportedExamCode(
  code: string,
): code is SupportedExamCode {
  return (SUPPORTED_EXAM_CODES as readonly string[]).includes(code);
}

export type SectionDescriptor = {
  kind: SectionKind;
  displayName: string;
  description: string;
  href: string;
  /** PR milestone where this lands (for the placeholder UI). */
  status: "available" | "planned";
  plannedIn?: string;
};

export function getSections(
  examCode: SupportedExamCode,
): SectionDescriptor[] {
  const base = `/dashboard/${examCode}`;
  return [
    {
      kind: "reading",
      displayName: "Чтение",
      description:
        examCode === "ege_en"
          ? "Задания 12–18 ЕГЭ. Matching + multiple choice."
          : "Задания 12–17 ОГЭ. Matching + multiple choice.",
      href: `${base}/reading`,
      status: "planned",
      plannedIn: "PR #4",
    },
    {
      kind: "listening",
      displayName: "Аудирование",
      description:
        examCode === "ege_en"
          ? "Задания 1–11 ЕГЭ. Два прослушивания."
          : "Задания 1–11 ОГЭ. Два прослушивания.",
      href: `${base}/listening`,
      status: "planned",
      plannedIn: "PR #5",
    },
    {
      kind: "grammar",
      displayName: "Грамматика и лексика",
      description:
        examCode === "ege_en"
          ? "Задания 19–36 ЕГЭ. Gap fill, word formation, cloze."
          : "Задания 18–32 ОГЭ. Word formation + gap fill.",
      href: `${base}/grammar`,
      status: "planned",
      plannedIn: "PR #3",
    },
    {
      kind: "writing",
      displayName: "Письмо",
      description:
        examCode === "ege_en"
          ? "Задание 37 (email 100–140) и задание 38 (эссе 180–275)."
          : "Задание 33 — email 100–120 слов.",
      href: `${base}/writing`,
      status: "available",
    },
    {
      kind: "speaking",
      displayName: "Устная часть",
      description:
        examCode === "ege_en"
          ? "Задания 1–4 ЕГЭ: чтение, 4 вопроса, диалог, сравнение картинок."
          : "Задания 1–3 ОГЭ: чтение, диалог, монолог.",
      href: `${base}/speaking`,
      status: "available",
    },
  ];
}

export type ExtraPracticeMode = {
  kind: "mock";
  displayName: string;
  description: string;
  href: string;
  status: "available" | "planned";
  plannedIn?: string;
};

export function getMockMode(
  examCode: SupportedExamCode,
): ExtraPracticeMode {
  return {
    kind: "mock",
    displayName: "Mock Exam — таймированный пробник",
    description:
      examCode === "ege_en"
        ? "ЕГЭ · 100 минут на 3 объективные секции (Аудирование, Чтение, Грамматика). Итоговый протокол с разбором."
        : "ОГЭ · 90 минут на 3 объективные секции. Секции Письмо и Устная — отдельными модулями.",
    href: `/dashboard/${examCode}/mock`,
    status: "available",
  };
}

/**
 * Writing-task-code mapping per exam. Drives the task toggle on the
 * Writing page and the `module` we send to `/api/chat`.
 */
export type WritingTaskConfig = {
  module: "writing-33" | "writing-37" | "writing-38";
  /** FIPI task number shown in the UI. */
  taskNumber: number;
  /** Display title for the toggle button. */
  shortLabel: string;
  /** Full card title. */
  longLabel: string;
  cardDescription: string;
  /** Word-count targets. */
  minWords: number;
  maxWords: number;
  /** Hard minimum below which К1 = 0 per FIPI. */
  hardMin: number;
};

export function getWritingTasks(
  examCode: SupportedExamCode,
): WritingTaskConfig[] {
  if (examCode === "ege_en") {
    return [
      {
        module: "writing-37",
        taskNumber: 37,
        shortLabel: "Task 37 · Email",
        longLabel: "Task 37 — Personal email (100–140 words)",
        cardDescription:
          "Напишите дружеский e-mail, ответив на ВСЕ вопросы из задания. Структура: приветствие → благодарность → ответы → вопрос собеседнику → прощание → подпись.",
        minWords: 100,
        maxWords: 140,
        hardMin: 90,
      },
      {
        module: "writing-38",
        taskNumber: 38,
        shortLabel: "Task 38 · Opinion essay",
        longLabel: "Task 38 — Opinion essay on a chart/table (180–275 words)",
        cardDescription:
          "Пятиабзацное эссе по графику/таблице. Вступление → факты → ваше мнение → контрмнение → опровержение + заключение.",
        minWords: 180,
        maxWords: 275,
        hardMin: 160,
      },
    ];
  }
  // oge_en — single email task.
  return [
    {
      module: "writing-33",
      taskNumber: 33,
      shortLabel: "Task 33 · Email",
      longLabel: "Task 33 — Personal email (100–120 words)",
      cardDescription:
        "Ответьте на письмо друга. Структура: адрес/дата → приветствие → благодарность → ответы на вопросы → вопрос собеседнику → прощание → подпись.",
      minWords: 100,
      maxWords: 120,
      hardMin: 90,
    },
  ];
}

/**
 * Narrow `ExamCode` helper — asserts at runtime that a string matches the
 * DB enum so we can pass it to SQL helpers safely.
 */
export function toExamCode(code: string): ExamCode {
  if (isSupportedExamCode(code)) return code;
  throw new Error(`Unsupported exam code: ${code}`);
}
