import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import {
  sections,
  taskTemplates,
  items,
  type ExamCode,
} from "../lib/db/schema";
import {
  getGrammarDescriptors,
  taskTemplateCode,
} from "../lib/grammar/descriptors";
import type {
  GrammarAnswer,
  GrammarTaskType,
} from "../lib/grammar/types";
import type { SupportedExamCode } from "../lib/exams";
import { SUPPORTED_EXAM_CODES } from "../lib/exams";

/**
 * Seed grammar task_templates + a starter item bank.
 *
 * Runs after `pnpm db:seed` (which creates the exam + section rows). This
 * script is idempotent:
 *   - task_templates are upserted by their stable `code`.
 *   - items are inserted once, then left alone; re-running does not create
 *     duplicates (we match on (task_template_id, stimulus_text)).
 *
 * The content below is a small hand-curated starter bank so the Grammar
 * UI lands with working material in PR #3. Expansion via the FIPI demo
 * parser and AI generator comes in later PRs.
 */

type SeedItem = {
  stimulusText: string;
  answer: GrammarAnswer;
  metadata?: Record<string, unknown>;
};

type SeedBank = Record<SupportedExamCode, Partial<Record<GrammarTaskType, SeedItem[]>>>;

const SEED: SeedBank = {
  ege_en: {
    transform: [
      {
        stimulusText:
          "Look at Sarah! She ___ (sing) a beautiful song in the garden right now.",
        answer: {
          type: "transform",
          base: "SING",
          answer: "is singing",
          alternatives: ["'s singing", "is singing."],
          hint: "present continuous",
        },
        metadata: { topic: "present_continuous", difficulty: "easy" },
      },
      {
        stimulusText:
          "By the time you arrive tomorrow, I ___ (finish) the report already.",
        answer: {
          type: "transform",
          base: "FINISH",
          answer: "will have finished",
          alternatives: ["shall have finished"],
          hint: "future perfect",
        },
        metadata: { topic: "future_perfect", difficulty: "medium" },
      },
      {
        stimulusText:
          "If I ___ (know) about the problem earlier, I would have helped you.",
        answer: {
          type: "transform",
          base: "KNOW",
          answer: "had known",
          alternatives: [],
          hint: "third conditional",
        },
        metadata: { topic: "conditionals_type_3", difficulty: "medium" },
      },
      {
        stimulusText:
          "The letter ___ (deliver) to the wrong address last week, so the package never reached us.",
        answer: {
          type: "transform",
          base: "DELIVER",
          answer: "was delivered",
          alternatives: [],
          hint: "past simple passive",
        },
        metadata: { topic: "passive_past_simple", difficulty: "easy" },
      },
      {
        stimulusText:
          "This is one of the ___ (good) films I have ever seen at this festival.",
        answer: {
          type: "transform",
          base: "GOOD",
          answer: "best",
          alternatives: [],
          hint: "irregular superlative",
        },
        metadata: { topic: "superlatives", difficulty: "easy" },
      },
    ],
    word_formation: [
      {
        stimulusText:
          "Her ___ to learn new languages impressed everyone on the hiring panel. (ABLE)",
        answer: {
          type: "word_formation",
          base: "ABLE",
          answer: "ABILITY",
          alternatives: ["ability"],
          pos: "noun",
        },
        metadata: { topic: "noun_suffixes_ity", difficulty: "easy" },
      },
      {
        stimulusText:
          "Despite the heavy rain, the team decided to continue the game ___. (PATIENT)",
        answer: {
          type: "word_formation",
          base: "PATIENT",
          answer: "PATIENTLY",
          alternatives: ["patiently"],
          pos: "adverb",
        },
        metadata: { topic: "adverb_suffix_ly", difficulty: "easy" },
      },
      {
        stimulusText:
          "The museum hosts a ___ collection of ancient artefacts from across Asia. (VALUE)",
        answer: {
          type: "word_formation",
          base: "VALUE",
          answer: "VALUABLE",
          alternatives: ["valuable"],
          pos: "adjective",
        },
        metadata: { topic: "adjective_suffix_able", difficulty: "medium" },
      },
      {
        stimulusText:
          "The scientists made a ___ that changed the way we think about black holes. (DISCOVER)",
        answer: {
          type: "word_formation",
          base: "DISCOVER",
          answer: "DISCOVERY",
          alternatives: ["discovery"],
          pos: "noun",
        },
        metadata: { topic: "noun_suffix_y", difficulty: "medium" },
      },
      {
        stimulusText:
          "The new software is far more ___ than the previous version. (USE)",
        answer: {
          type: "word_formation",
          base: "USE",
          answer: "USEFUL",
          alternatives: ["useful"],
          pos: "adjective",
        },
        metadata: { topic: "adjective_suffix_ful", difficulty: "easy" },
      },
    ],
    lexical_mc: [
      {
        stimulusText:
          "She was so tired that she couldn't ___ her eyes open during the lecture.",
        answer: {
          type: "lexical_mc",
          options: ["hold", "keep", "stay", "save"],
          answer: 1,
        },
        metadata: { topic: "collocations_keep", difficulty: "easy" },
      },
      {
        stimulusText:
          "After a long debate, the committee finally ___ a decision everyone could accept.",
        answer: {
          type: "lexical_mc",
          options: ["did", "took", "reached", "gave"],
          answer: 2,
        },
        metadata: { topic: "collocations_reach_decision", difficulty: "medium" },
      },
      {
        stimulusText:
          "The detective quickly ___ out that the witness had been lying the whole time.",
        answer: {
          type: "lexical_mc",
          options: ["found", "looked", "worked", "put"],
          answer: 0,
        },
        metadata: { topic: "phrasal_verbs_find_out", difficulty: "easy" },
      },
      {
        stimulusText:
          "Because of the fog, visibility was poor and we had to ___ our journey.",
        answer: {
          type: "lexical_mc",
          options: ["delay", "postpone", "prevent", "miss"],
          answer: 1,
        },
        metadata: { topic: "delay_vs_postpone", difficulty: "medium" },
      },
      {
        stimulusText:
          "The two companies reached an ___ after three months of negotiations.",
        answer: {
          type: "lexical_mc",
          options: ["argument", "agreement", "arrangement", "achievement"],
          answer: 1,
        },
        metadata: { topic: "noun_confusion", difficulty: "easy" },
      },
    ],
  },
  oge_en: {
    word_formation: [
      {
        stimulusText:
          "My sister is a very ___ person — she never breaks a promise. (RELY)",
        answer: {
          type: "word_formation",
          base: "RELY",
          answer: "RELIABLE",
          alternatives: ["reliable"],
          pos: "adjective",
        },
        metadata: { topic: "adjective_suffix_able", difficulty: "medium" },
      },
      {
        stimulusText:
          "The old castle has been turned into a popular tourist ___. (ATTRACT)",
        answer: {
          type: "word_formation",
          base: "ATTRACT",
          answer: "ATTRACTION",
          alternatives: ["attraction"],
          pos: "noun",
        },
        metadata: { topic: "noun_suffix_tion", difficulty: "easy" },
      },
      {
        stimulusText:
          "It was ___ of her to forget about the meeting again. (CARE)",
        answer: {
          type: "word_formation",
          base: "CARE",
          answer: "CARELESS",
          alternatives: ["careless"],
          pos: "adjective",
        },
        metadata: { topic: "adjective_suffix_less", difficulty: "easy" },
      },
      {
        stimulusText:
          "The children laughed ___ when they saw the clown on stage. (HAPPY)",
        answer: {
          type: "word_formation",
          base: "HAPPY",
          answer: "HAPPILY",
          alternatives: ["happily"],
          pos: "adverb",
        },
        metadata: { topic: "adverb_suffix_ly", difficulty: "easy" },
      },
      {
        stimulusText:
          "Alexander was the ___ person in his class to finish the test on time. (ONE)",
        answer: {
          type: "word_formation",
          base: "ONE",
          answer: "FIRST",
          alternatives: ["first"],
          pos: "adjective",
        },
        metadata: { topic: "ordinal_numbers", difficulty: "easy" },
      },
    ],
    transform: [
      {
        stimulusText:
          "Last weekend my family ___ (go) to the countryside for a picnic.",
        answer: {
          type: "transform",
          base: "GO",
          answer: "went",
          alternatives: [],
          hint: "past simple, irregular",
        },
        metadata: { topic: "past_simple_irregular", difficulty: "easy" },
      },
      {
        stimulusText:
          "There ___ (be) five children playing in the yard right now.",
        answer: {
          type: "transform",
          base: "BE",
          answer: "are",
          alternatives: [],
          hint: "there is / there are",
        },
        metadata: { topic: "there_is_are", difficulty: "easy" },
      },
      {
        stimulusText:
          "If it ___ (rain) tomorrow, we will stay at home and watch a film.",
        answer: {
          type: "transform",
          base: "RAIN",
          answer: "rains",
          alternatives: [],
          hint: "first conditional",
        },
        metadata: { topic: "conditionals_type_1", difficulty: "medium" },
      },
      {
        stimulusText:
          "This book is much ___ (interesting) than the one we read last term.",
        answer: {
          type: "transform",
          base: "INTERESTING",
          answer: "more interesting",
          alternatives: [],
          hint: "comparative of long adjectives",
        },
        metadata: { topic: "comparatives", difficulty: "easy" },
      },
      {
        stimulusText:
          "She ___ (live) in this city since 2010 and still loves it.",
        answer: {
          type: "transform",
          base: "LIVE",
          answer: "has lived",
          alternatives: ["'s lived"],
          hint: "present perfect + since",
        },
        metadata: { topic: "present_perfect", difficulty: "medium" },
      },
    ],
  },
};

// FIPI task-number ranges per exam, used on the `task_template` row.
function taskNumberFor(
  examCode: SupportedExamCode,
  type: GrammarTaskType,
): number | null {
  if (examCode === "ege_en") {
    if (type === "transform") return 19;
    if (type === "word_formation") return 25;
    if (type === "lexical_mc") return 30;
  } else {
    if (type === "word_formation") return 18;
    if (type === "transform") return 27;
  }
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  for (const examCode of SUPPORTED_EXAM_CODES) {
    // Locate the grammar section for this exam.
    const [grammarSection] = await db
      .select({ id: sections.id })
      .from(sections)
      .where(
        and(
          eq(sections.examCode, examCode as ExamCode),
          eq(sections.kind, "grammar"),
        ),
      )
      .limit(1);
    if (!grammarSection) {
      console.warn(
        `⚠ skipping ${examCode}: grammar section not found. Run pnpm db:seed first.`,
      );
      continue;
    }

    const descriptors = getGrammarDescriptors(examCode);
    for (const descriptor of descriptors) {
      const code = taskTemplateCode(examCode, descriptor.codeSuffix);
      const taskNumber = taskNumberFor(examCode, descriptor.type);
      const rubric = { correct: 1, incorrect: 0, maxPerItem: 1 };

      // Upsert task template by its unique code.
      const [template] = await db
        .insert(taskTemplates)
        .values({
          sectionId: grammarSection.id,
          taskNumber,
          code,
          title: descriptor.displayName,
          instructions: descriptor.shortDescription,
          rubric,
          maxScore: 1,
          timeLimitSeconds: null,
          config: { grammarType: descriptor.type },
        })
        .onConflictDoUpdate({
          target: taskTemplates.code,
          set: {
            title: descriptor.displayName,
            instructions: descriptor.shortDescription,
            rubric,
            config: { grammarType: descriptor.type },
          },
        })
        .returning({ id: taskTemplates.id });

      const bank = SEED[examCode][descriptor.type] ?? [];
      let inserted = 0;
      for (const seed of bank) {
        // Dedup by (task_template_id, stimulus_text).
        const existing = await db
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.taskTemplateId, template.id),
              eq(items.stimulusText, seed.stimulusText),
            ),
          )
          .limit(1);
        if (existing.length > 0) continue;
        await db.insert(items).values({
          taskTemplateId: template.id,
          source: "user_authored",
          stimulusText: seed.stimulusText,
          correctAnswers: seed.answer,
          metadata: seed.metadata ?? null,
        });
        inserted += 1;
      }

      console.log(
        `✓ ${examCode}.${descriptor.codeSuffix}: template upserted, +${inserted} new items (${bank.length} total in bank).`,
      );
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
