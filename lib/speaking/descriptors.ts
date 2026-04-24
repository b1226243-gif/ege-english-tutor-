import type { SupportedExamCode } from "@/lib/exams";
import type {
  SpeakingCriterion,
  SpeakingTaskDescriptor,
} from "@/lib/speaking/types";

/**
 * Per-exam speaking descriptors. Timings follow FIPI 2024/25 regulations;
 * rubrics follow the published maximum scores (phonetics for Task 1,
 * К1–К4 on Task 2's four questions, К1–К3 on Task 3/OGE2 interviews,
 * К1–К3 on Task 4 picture comparison, etc.).
 */

// --- ЕГЭ rubrics ---------------------------------------------------------

const EGE_TASK1_RUBRIC: SpeakingCriterion[] = [
  {
    code: "PHON",
    label: "Фонетическое оформление",
    max: 1,
    description:
      "Произношение понятно; ударения, ритм и интонация в целом верные; допускается не более 5 ошибок, искажающих смысл или затрудняющих понимание.",
  },
];

const EGE_TASK2_RUBRIC: SpeakingCriterion[] = [
  {
    code: "Q1",
    label: "Вопрос 1",
    max: 1,
    description:
      "Вопрос сформулирован грамматически верно, по запрошенному аспекту, полностью соответствует ситуации.",
  },
  {
    code: "Q2",
    label: "Вопрос 2",
    max: 1,
    description:
      "Вопрос сформулирован грамматически верно, по запрошенному аспекту, полностью соответствует ситуации.",
  },
  {
    code: "Q3",
    label: "Вопрос 3",
    max: 1,
    description:
      "Вопрос сформулирован грамматически верно, по запрошенному аспекту, полностью соответствует ситуации.",
  },
  {
    code: "Q4",
    label: "Вопрос 4",
    max: 1,
    description:
      "Вопрос сформулирован грамматически верно, по запрошенному аспекту, полностью соответствует ситуации.",
  },
];

const EGE_TASK3_RUBRIC: SpeakingCriterion[] = [
  {
    code: "K1",
    label: "К1 · Решение коммуникативной задачи",
    max: 3,
    description:
      "Все 5 ответов полные, соответствуют заданным вопросам, уместные, логичные; продемонстрирована достаточная содержательность.",
  },
  {
    code: "K2",
    label: "К2 · Языковое оформление",
    max: 2,
    description:
      "Лексико-грамматические ошибки незначительны (допускается не более 3–4 негрубых ошибок).",
  },
];

const EGE_TASK4_RUBRIC: SpeakingCriterion[] = [
  {
    code: "K1",
    label: "К1 · Решение коммуникативной задачи",
    max: 3,
    description:
      "Все 5 пунктов плана раскрыты; монолог логичен, ясен; нет затяжных пауз.",
  },
  {
    code: "K2",
    label: "К2 · Организация текста",
    max: 2,
    description:
      "Есть вступление, основная часть и заключение; средства связи используются корректно.",
  },
  {
    code: "K3",
    label: "К3 · Языковое оформление",
    max: 5,
    description:
      "Речь беглая, лексико-грамматические ошибки не искажают смысла; употребляются разнообразные структуры.",
  },
];

// --- ОГЭ rubrics ---------------------------------------------------------

const OGE_TASK1_RUBRIC: SpeakingCriterion[] = [
  {
    code: "PHON",
    label: "Фонетическое оформление",
    max: 2,
    description:
      "Произношение соответствует современной фонетической норме; ошибки не искажают смысла и не затрудняют понимание; не более 4 фонетических ошибок.",
  },
];

const OGE_TASK2_RUBRIC: SpeakingCriterion[] = [
  {
    code: "K1",
    label: "К1 · Полнота ответов",
    max: 2,
    description:
      "Даны ответы на все 6 вопросов; ответы уместны, логичны, содержат запрошенную информацию.",
  },
  {
    code: "K2",
    label: "К2 · Языковое оформление",
    max: 2,
    description:
      "Ответы грамматически корректны; лексика разнообразна; произношение ясное; допускается не более 3 негрубых ошибок в сумме.",
  },
];

const OGE_TASK3_RUBRIC: SpeakingCriterion[] = [
  {
    code: "K1",
    label: "К1 · Решение коммуникативной задачи",
    max: 3,
    description:
      "Раскрыты все 3 пункта плана; высказывание логично; объём — не менее 10–12 фраз.",
  },
  {
    code: "K2",
    label: "К2 · Организация текста",
    max: 2,
    description:
      "Есть вступление и заключение; средства связи применяются корректно.",
  },
  {
    code: "K3",
    label: "К3 · Языковое оформление",
    max: 2,
    description:
      "Речь понятная; лексико-грамматические ошибки не искажают смысл; допускается не более 3 ошибок.",
  },
];

// --- Descriptors ---------------------------------------------------------

const EGE_DESCRIPTORS: SpeakingTaskDescriptor[] = [
  {
    format: "read_aloud",
    codeSuffix: "read_aloud",
    displayName: "Задание 1 · Чтение вслух",
    shortDescription:
      "Прочитайте научно-популярный текст вслух. 1,5 минуты на подготовку, 1,5 минуты на чтение.",
    fipiTaskRange: "1",
    timing: { prepareSeconds: 90, speakSeconds: 90 },
    rubric: EGE_TASK1_RUBRIC,
  },
  {
    format: "ask_questions",
    codeSuffix: "ask_questions",
    displayName: "Задание 2 · 4 прямых вопроса",
    shortDescription:
      "Задайте 4 прямых вопроса по рекламному объявлению. 1,5 минуты подготовки, по 20 секунд на каждый вопрос.",
    fipiTaskRange: "2",
    timing: { prepareSeconds: 90, speakSeconds: 80 },
    rubric: EGE_TASK2_RUBRIC,
  },
  {
    format: "interview",
    codeSuffix: "interview",
    displayName: "Задание 3 · Условный диалог-интервью",
    shortDescription:
      "Ответьте на 5 вопросов интервьюера. 2,5 минуты, по 40 секунд на ответ.",
    fipiTaskRange: "3",
    timing: { prepareSeconds: 0, speakSeconds: 200 },
    rubric: EGE_TASK3_RUBRIC,
  },
  {
    format: "picture_compare",
    codeSuffix: "picture_compare",
    displayName: "Задание 4 · Сравнение двух фото",
    shortDescription:
      "Сравните две картинки по плану из 5 пунктов. 2,5 минуты на ответ (12–15 фраз).",
    fipiTaskRange: "4",
    timing: { prepareSeconds: 90, speakSeconds: 150 },
    rubric: EGE_TASK4_RUBRIC,
  },
];

const OGE_DESCRIPTORS: SpeakingTaskDescriptor[] = [
  {
    format: "read_aloud",
    codeSuffix: "read_aloud",
    displayName: "Задание 1 · Чтение вслух",
    shortDescription:
      "Прочитайте вслух научно-популярный текст. 1,5 минуты подготовки, 2 минуты на чтение.",
    fipiTaskRange: "1",
    timing: { prepareSeconds: 90, speakSeconds: 120 },
    rubric: OGE_TASK1_RUBRIC,
  },
  {
    format: "interview",
    codeSuffix: "interview",
    displayName: "Задание 2 · Ответы на 6 вопросов",
    shortDescription:
      "Ответьте на 6 коротких вопросов интервьюера. По 40 секунд на ответ.",
    fipiTaskRange: "2",
    timing: { prepareSeconds: 0, speakSeconds: 240 },
    rubric: OGE_TASK2_RUBRIC,
  },
  {
    format: "monologue_topic",
    codeSuffix: "monologue_topic",
    displayName: "Задание 3 · Монолог по теме",
    shortDescription:
      "Монолог 10–12 фраз по предложенной теме. 1,5 минуты подготовки, 2 минуты речь.",
    fipiTaskRange: "3",
    timing: { prepareSeconds: 90, speakSeconds: 120 },
    rubric: OGE_TASK3_RUBRIC,
  },
];

export function getSpeakingDescriptors(
  examCode: SupportedExamCode,
): SpeakingTaskDescriptor[] {
  return examCode === "ege_en" ? EGE_DESCRIPTORS : OGE_DESCRIPTORS;
}

export function speakingTaskTemplateCode(
  examCode: SupportedExamCode,
  codeSuffix: string,
): string {
  return `${examCode}.speaking.${codeSuffix}`;
}

export function totalSpeakingMax(rubric: SpeakingCriterion[]): number {
  return rubric.reduce((sum, c) => sum + c.max, 0);
}
