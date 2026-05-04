import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  items,
  sections,
  taskTemplates,
  type ExamCode,
} from "@/lib/db/schema";
import type { SupportedExamCode } from "@/lib/exams";
import { GrammarAnswerSchema } from "@/lib/grammar/types";
import { ListeningAnswerSchema } from "@/lib/listening/types";
import { ReadingAnswerSchema } from "@/lib/reading/types";
import {
  WRITING_DESCRIPTORS,
  type WritingFormat,
} from "@/lib/writing/descriptors";
import type {
  MockPlan,
  MockSectionKind,
  MockSectionPlan,
  MockSectionPlanItem,
} from "@/lib/mock/types";

/**
 * Build a fresh mock plan from the existing item bank.
 *
 * Strategy: take ITEMS_PER_TEMPLATE random items per task_template across
 * the requested kinds, pool them into MockSectionPlan, attach the stimulus
 * shape the runner UI expects.
 *
 * Total time budgets are FIPI 2024/25 regulations split across the
 * objective-graded sections we support in PR #7.
 *
 *   ЕГЭ (3 hours total): listening 30 min · reading 30 min · grammar 40 min
 *   ОГЭ (2 hours total): listening 30 min · reading 30 min · grammar 30 min
 *
 * Writing & speaking are intentionally out of mock mode in PR #7 — the
 * results page links them as a follow-up.
 */

/** How many items per template enter the mock. Keeps total ≈ 12 items per section. */
const ITEMS_PER_TEMPLATE: Record<MockSectionKind, number> = {
  listening: 3,
  reading: 3,
  grammar: 3,
  // Writing only ever picks ONE prompt per template — students never write
  // 3 × Task 37 in a single sitting on a real exam.
  writing: 1,
};

const TIME_BUDGET_SECONDS: Record<
  SupportedExamCode,
  Record<MockSectionKind, number>
> = {
  ege_en: {
    listening: 30 * 60,
    reading: 30 * 60,
    grammar: 40 * 60,
    // ЕГЭ Task 37 (≈30 min) + Task 38 (≈50 min) = 80 min for the writing section.
    writing: 80 * 60,
  },
  oge_en: {
    listening: 30 * 60,
    reading: 30 * 60,
    grammar: 30 * 60,
    // ОГЭ Task 33 — single email, FIPI suggests 30 min.
    writing: 30 * 60,
  },
};

const SECTION_DISPLAY_NAMES: Record<MockSectionKind, string> = {
  listening: "Аудирование",
  reading: "Чтение",
  grammar: "Грамматика и лексика",
  writing: "Письмо",
};

export async function buildMockPlan(
  examCode: SupportedExamCode,
): Promise<MockPlan> {
  const kinds: MockSectionKind[] = [
    "listening",
    "reading",
    "grammar",
    "writing",
  ];
  const sectionPlans: MockSectionPlan[] = [];

  for (const kind of kinds) {
    const sectionPlan = await buildSectionPlan(examCode, kind);
    if (sectionPlan.items.length > 0) sectionPlans.push(sectionPlan);
  }

  const totalSeconds = sectionPlans.reduce(
    (sum, s) => sum + s.timeBudgetSeconds,
    0,
  );

  return {
    examCode,
    totalSeconds,
    sections: sectionPlans,
  };
}

async function buildSectionPlan(
  examCode: SupportedExamCode,
  kind: MockSectionKind,
): Promise<MockSectionPlan> {
  const rows = await db()
    .select({
      itemId: items.id,
      stimulusText: items.stimulusText,
      stimulusAudioUrl: items.stimulusAudioUrl,
      assets: items.assets,
      correctAnswers: items.correctAnswers,
      metadata: items.metadata,
      templateCode: taskTemplates.code,
      templateTitle: taskTemplates.title,
      templateId: taskTemplates.id,
      // a per-template row number to allow `take K per template` slicing
      rn: sql<number>`row_number() over (
        partition by ${taskTemplates.id}
        order by random()
      )`.as("rn"),
    })
    .from(items)
    .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
    .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
    .where(
      and(
        eq(sections.examCode, examCode as ExamCode),
        eq(sections.kind, kind),
      ),
    );

  const wanted = ITEMS_PER_TEMPLATE[kind];
  const filtered = rows.filter((r) => r.rn <= wanted);

  const planItems: MockSectionPlanItem[] = [];
  for (const r of filtered) {
    const item = rowToPlanItem(kind, r);
    if (item) planItems.push(item);
  }

  // shuffle across templates so the student doesn't see all matching first
  shuffleInPlace(planItems);

  return {
    kind,
    displayName: SECTION_DISPLAY_NAMES[kind],
    timeBudgetSeconds: TIME_BUDGET_SECONDS[examCode][kind],
    items: planItems,
  };
}

type Row = {
  itemId: string;
  stimulusText: string | null;
  stimulusAudioUrl: string | null;
  assets: unknown;
  correctAnswers: unknown;
  metadata: unknown;
  templateCode: string;
  templateTitle: string;
};

function rowToPlanItem(
  kind: MockSectionKind,
  r: Row,
): MockSectionPlanItem | null {
  if (kind === "listening") {
    const parsed = ListeningAnswerSchema.safeParse(r.correctAnswers);
    if (!parsed.success) return null;
    const assets = (r.assets ?? {}) as {
      transcript?: string;
      voice?: string | null;
    };
    if (parsed.data.type !== "listening_mc") return null;
    return {
      id: r.itemId,
      taskTemplateCode: r.templateCode,
      taskTemplateTitle: r.templateTitle,
      stimulus: {
        kind: "listening",
        audioUrl: r.stimulusAudioUrl ?? null,
        transcript: assets.transcript ?? "",
        voice: assets.voice ?? null,
        question: r.stimulusText ?? "",
        options: parsed.data.options,
      },
    };
  }
  if (kind === "writing") {
    const assets = (r.assets ?? {}) as {
      stimulus?: unknown;
      title?: string;
    };
    const stim = assets.stimulus as
      | {
          kind: "task_33_email" | "task_37_email";
          friendName: string;
          friendLetter: string;
          questions: string[];
        }
      | {
          kind: "task_38_essay";
          topic: string;
          prompt: string;
          table: { caption: string; rows: { label: string; value: string }[] };
          planLabels: string[];
        }
      | undefined;
    if (!stim) return null;
    // The descriptor that matches the prompt format — drives word limits.
    const format: WritingFormat =
      stim.kind === "task_38_essay"
        ? "task_38_essay"
        : stim.kind === "task_37_email"
          ? "task_37_email"
          : "task_33_email";
    const descriptor = WRITING_DESCRIPTORS.find((d) => d.format === format);
    if (!descriptor) return null;
    if (stim.kind === "task_38_essay") {
      return {
        id: r.itemId,
        taskTemplateCode: r.templateCode,
        taskTemplateTitle: r.templateTitle,
        stimulus: {
          kind: "writing_essay",
          format: "task_38_essay",
          taskNumber: descriptor.fipiTaskNumber,
          prompt: r.stimulusText ?? "",
          topic: stim.topic,
          table: stim.table,
          planLabels: stim.planLabels,
          minWords: descriptor.minWords,
          maxWords: descriptor.maxWords,
          hardMin: descriptor.hardMin,
        },
      };
    }
    return {
      id: r.itemId,
      taskTemplateCode: r.templateCode,
      taskTemplateTitle: r.templateTitle,
      stimulus: {
        kind: "writing_email",
        format: stim.kind === "task_37_email" ? "task_37_email" : "task_33_email",
        taskNumber: descriptor.fipiTaskNumber,
        prompt: r.stimulusText ?? "",
        friendName: stim.friendName,
        friendLetter: stim.friendLetter,
        questions: stim.questions,
        minWords: descriptor.minWords,
        maxWords: descriptor.maxWords,
        hardMin: descriptor.hardMin,
      },
    };
  }
  if (kind === "reading") {
    const parsed = ReadingAnswerSchema.safeParse(r.correctAnswers);
    if (!parsed.success || parsed.data.type !== "reading_mc") return null;
    const meta = (r.metadata ?? {}) as { passage?: string };
    return {
      id: r.itemId,
      taskTemplateCode: r.templateCode,
      taskTemplateTitle: r.templateTitle,
      stimulus: {
        kind: "reading",
        passage: meta.passage ?? "",
        question: r.stimulusText ?? "",
        options: parsed.data.options,
      },
    };
  }
  // grammar
  const parsed = GrammarAnswerSchema.safeParse(r.correctAnswers);
  if (!parsed.success) return null;
  if (parsed.data.type === "transform") {
    return {
      id: r.itemId,
      taskTemplateCode: r.templateCode,
      taskTemplateTitle: r.templateTitle,
      stimulus: {
        kind: "grammar_open_cloze",
        prompt: r.stimulusText ?? "",
        base: parsed.data.base,
        hint: parsed.data.hint ?? null,
      },
    };
  }
  if (parsed.data.type === "word_formation") {
    return {
      id: r.itemId,
      taskTemplateCode: r.templateCode,
      taskTemplateTitle: r.templateTitle,
      stimulus: {
        kind: "grammar_word_formation",
        prompt: r.stimulusText ?? "",
        base: parsed.data.base,
        pos: parsed.data.pos ?? null,
      },
    };
  }
  return {
    id: r.itemId,
    taskTemplateCode: r.templateCode,
    taskTemplateTitle: r.templateTitle,
    stimulus: {
      kind: "grammar_lexical_mc",
      prompt: r.stimulusText ?? "",
      options: parsed.data.options,
    },
  };
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
