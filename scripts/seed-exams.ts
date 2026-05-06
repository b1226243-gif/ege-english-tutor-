import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import {
  exams,
  sections,
  type ExamCode,
  type SectionKind,
} from "../lib/db/schema";

/**
 * Seed script — idempotently inserts the two launch exams (ОГЭ + ЕГЭ) and
 * their 5 sections (listening, reading, grammar, writing, speaking).
 *
 * Run with: `pnpm db:seed`.
 *
 * Re-running is safe: we `ON CONFLICT DO NOTHING` for exams and upsert
 * sections by (exam_code, kind).
 */

type SectionSeed = {
  kind: SectionKind;
  orderIdx: number;
  displayName: string;
  description: string;
  timeLimitSeconds: number | null;
  maxScore: number;
  config?: Record<string, unknown>;
};

type ExamSeed = {
  code: ExamCode;
  displayName: string;
  description: string;
  sections: SectionSeed[];
};

// ────────────── EGE (11th grade) ──────────────
// Total test time: 180 min (writing) + ~15 min (speaking).
// Official max: 99 primary points (2024/25 spec).
const EGE_SECTIONS: SectionSeed[] = [
  {
    kind: "listening",
    orderIdx: 1,
    displayName: "Аудирование",
    description: "Задания 1–11. Два прослушивания каждого фрагмента.",
    timeLimitSeconds: 30 * 60,
    maxScore: 14,
    config: { taskCount: 11, listeningPlayCount: 2 },
  },
  {
    kind: "reading",
    orderIdx: 2,
    displayName: "Чтение",
    description: "Задания 12–18. Matching + multiple choice.",
    timeLimitSeconds: 30 * 60,
    maxScore: 11,
    config: { taskCount: 7 },
  },
  {
    kind: "grammar",
    orderIdx: 3,
    displayName: "Грамматика и лексика",
    description: "Задания 19–36. Gap fill, word formation, cloze.",
    timeLimitSeconds: 40 * 60,
    maxScore: 18,
    config: { taskCount: 18 },
  },
  {
    kind: "writing",
    orderIdx: 4,
    displayName: "Письмо",
    description: "Задание 37 (email 100–140 слов), задание 38 (эссе 180–275 слов).",
    timeLimitSeconds: 80 * 60,
    maxScore: 20,
    config: { taskNumbers: [37, 38] },
  },
  {
    kind: "speaking",
    orderIdx: 5,
    displayName: "Устная часть",
    description: "Задания 1–4. ~15 минут, раздельная запись ответа.",
    timeLimitSeconds: 15 * 60,
    maxScore: 20,
    config: { taskNumbers: [1, 2, 3, 4] },
  },
];

// ────────────── OGE (9th grade) ──────────────
// Total test time: 120 min (written) + 15 min (speaking).
// Official max: 68 primary points (2024/25 spec).
const OGE_SECTIONS: SectionSeed[] = [
  {
    kind: "listening",
    orderIdx: 1,
    displayName: "Аудирование",
    description: "Задания 1–11. Два прослушивания каждого фрагмента.",
    timeLimitSeconds: 30 * 60,
    maxScore: 15,
    config: { taskCount: 11, listeningPlayCount: 2 },
  },
  {
    kind: "reading",
    orderIdx: 2,
    displayName: "Чтение",
    description: "Задания 12–17. Matching + multiple choice.",
    timeLimitSeconds: 30 * 60,
    maxScore: 13,
    config: { taskCount: 6 },
  },
  {
    kind: "grammar",
    orderIdx: 3,
    displayName: "Грамматика и лексика",
    description: "Задания 18–32. Word formation + gap fill.",
    timeLimitSeconds: 30 * 60,
    maxScore: 15,
    config: { taskCount: 15 },
  },
  {
    kind: "writing",
    orderIdx: 4,
    displayName: "Письмо",
    description: "Задание 33 — email 100–120 слов.",
    timeLimitSeconds: 30 * 60,
    maxScore: 10,
    config: { taskNumbers: [33] },
  },
  {
    kind: "speaking",
    orderIdx: 5,
    displayName: "Устная часть",
    description: "Задания 1 (чтение вслух), 2 (диалог), 3 (монолог 2 минуты).",
    timeLimitSeconds: 15 * 60,
    maxScore: 15,
    config: { taskNumbers: [1, 2, 3] },
  },
];

const EXAM_SEEDS: ExamSeed[] = [
  {
    code: "ege_en",
    displayName: "ЕГЭ по английскому",
    description: "Единый государственный экзамен, 11 класс. FIPI 2024/25.",
    sections: EGE_SECTIONS,
  },
  {
    code: "oge_en",
    displayName: "ОГЭ по английскому",
    description: "Основной государственный экзамен, 9 класс. FIPI 2024/25.",
    sections: OGE_SECTIONS,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  for (const exam of EXAM_SEEDS) {
    await db
      .insert(exams)
      .values({
        code: exam.code,
        displayName: exam.displayName,
        description: exam.description,
      })
      .onConflictDoUpdate({
        target: exams.code,
        set: {
          displayName: exam.displayName,
          description: exam.description,
        },
      });

    for (const s of exam.sections) {
      const existing = await db
        .select({ id: sections.id })
        .from(sections)
        .where(and(eq(sections.examCode, exam.code), eq(sections.kind, s.kind)))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(sections)
          .set({
            orderIdx: s.orderIdx,
            displayName: s.displayName,
            description: s.description,
            timeLimitSeconds: s.timeLimitSeconds,
            maxScore: s.maxScore,
            config: s.config ?? null,
          })
          .where(eq(sections.id, existing[0].id));
      } else {
        await db.insert(sections).values({
          examCode: exam.code,
          kind: s.kind,
          orderIdx: s.orderIdx,
          displayName: s.displayName,
          description: s.description,
          timeLimitSeconds: s.timeLimitSeconds,
          maxScore: s.maxScore,
          config: s.config ?? null,
        });
      }
    }

    console.log(`✓ seeded ${exam.code} + ${exam.sections.length} sections`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
