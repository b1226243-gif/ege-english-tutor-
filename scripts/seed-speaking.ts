import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import {
  sections,
  taskTemplates,
  items,
  type ExamCode,
} from "../lib/db/schema";
import {
  getSpeakingDescriptors,
  speakingTaskTemplateCode,
  totalSpeakingMax,
} from "../lib/speaking/descriptors";
import type {
  SpeakingAnswer,
  SpeakingFormat,
} from "../lib/speaking/types";
import type { SupportedExamCode } from "../lib/exams";
import { SUPPORTED_EXAM_CODES } from "../lib/exams";

/**
 * Seed speaking task_templates + a starter item bank for ЕГЭ and ОГЭ.
 * Idempotent on (template_id, metadata.slug).
 *
 * The rubric + timing for each task live in `lib/speaking/descriptors.ts`
 * and are pushed into `task_template.config` + `task_template.rubric` here,
 * so the runtime UI and the `/api/speaking/submit` route read exactly the
 * same numbers.
 */

type SeedItem = {
  slug: string;
  title: string;
  payload: SpeakingAnswer;
  metadata?: Record<string, unknown>;
};

type SeedBank = Record<
  SupportedExamCode,
  Partial<Record<SpeakingFormat, SeedItem[]>>
>;

const FIPI_TASK4_PLAN: string[] = [
  "Give a brief description of the two pictures (action, location).",
  "Say what the two pictures have in common.",
  "Say in what way the pictures are different.",
  "Say which kind of activity depicted in the pictures you'd prefer.",
  "Explain why you'd prefer that activity.",
];

const SEED: SeedBank = {
  ege_en: {
    read_aloud: [
      {
        slug: "ege-ra-01-polar-bears",
        title: "Чтение вслух — Polar bears",
        payload: {
          type: "speaking_read_aloud",
          passage:
            "Polar bears are among the largest carnivores on Earth, and they depend almost entirely on sea ice to hunt. A female bear typically gives birth to one or two cubs in a snow den, where she remains for several months without eating. As the climate warms, the hunting season becomes shorter every year, and scientists warn that many populations may decline dramatically within a few decades.",
        },
        metadata: { topic: "ecology", difficulty: "medium" },
      },
      {
        slug: "ege-ra-02-space-tourism",
        title: "Чтение вслух — Space tourism",
        payload: {
          type: "speaking_read_aloud",
          passage:
            "Space tourism was science fiction until the early two thousands. The first private passengers paid tens of millions of dollars for a single trip. Today several companies offer suborbital flights that last only a few minutes but reach the edge of space. Experts argue that ticket prices will fall sharply once reusable rockets become standard, although the environmental impact of frequent launches remains a serious concern.",
        },
        metadata: { topic: "technology", difficulty: "medium" },
      },
    ],
    ask_questions: [
      {
        slug: "ege-aq-01-cooking-course",
        title: "4 вопроса — Cooking course",
        payload: {
          type: "speaking_ask_questions",
          advert:
            "Join our two-week cooking course this summer! Learn from professional chefs in a cosy London kitchen. Places are limited, so book now.",
          aspects: [
            "the exact starting date of the course",
            "the price per participant",
            "whether the ingredients are included in the price",
            "the maximum number of students in one group",
          ],
        },
        metadata: { topic: "lifestyle", difficulty: "medium" },
      },
      {
        slug: "ege-aq-02-photo-contest",
        title: "4 вопроса — Photography contest",
        payload: {
          type: "speaking_ask_questions",
          advert:
            "National Photography Contest is open! Submit your best shot from the last twelve months and compete for a five-thousand-pound prize. Open to all amateurs over sixteen.",
          aspects: [
            "the submission deadline",
            "whether there is an entry fee",
            "how many photos one person can submit",
            "who will judge the competition",
          ],
        },
        metadata: { topic: "arts", difficulty: "medium" },
      },
    ],
    interview: [
      {
        slug: "ege-in-01-hobbies",
        title: "Интервью — Free time & hobbies",
        payload: {
          type: "speaking_interview",
          context:
            "You are taking part in an international survey on how teenagers spend their free time.",
          questions: [
            "What do you usually do in your free time on weekdays?",
            "How much time do you spend on your hobbies each week?",
            "Do you prefer outdoor or indoor activities, and why?",
            "Why do you think hobbies are important for young people?",
            "What new hobby would you like to try in the future and why?",
          ],
        },
        metadata: { topic: "lifestyle", difficulty: "easy" },
      },
      {
        slug: "ege-in-02-future-career",
        title: "Интервью — Future career",
        payload: {
          type: "speaking_interview",
          context:
            "A radio station is interviewing school leavers about their career plans.",
          questions: [
            "What profession are you considering and why?",
            "What subjects at school are helping you with this choice?",
            "How important is salary when choosing a job, in your opinion?",
            "Do you think young people should work during their studies? Why?",
            "What advice would you give to someone who cannot decide on a career?",
          ],
        },
        metadata: { topic: "education", difficulty: "medium" },
      },
    ],
    picture_compare: [
      {
        slug: "ege-pc-01-city-village",
        title: "Сравнение фото — City vs village",
        payload: {
          type: "speaking_picture_compare",
          topic: "Two lifestyles: city vs village",
          imageCaptions: [
            "A busy urban street with skyscrapers, traffic and crowds.",
            "A quiet countryside village with wooden houses and open fields.",
          ],
          plan: FIPI_TASK4_PLAN,
        },
        metadata: { topic: "lifestyle", difficulty: "medium" },
      },
      {
        slug: "ege-pc-02-sport-individual",
        title: "Сравнение фото — Team vs individual sport",
        payload: {
          type: "speaking_picture_compare",
          topic: "Two ways of doing sport",
          imageCaptions: [
            "A football team playing on a stadium, cheered by supporters.",
            "A lone runner jogging through an empty forest path at sunrise.",
          ],
          plan: FIPI_TASK4_PLAN,
        },
        metadata: { topic: "sport", difficulty: "medium" },
      },
    ],
  },
  oge_en: {
    read_aloud: [
      {
        slug: "oge-ra-01-dolphins",
        title: "Чтение вслух — Dolphins",
        payload: {
          type: "speaking_read_aloud",
          passage:
            "Dolphins are highly intelligent sea mammals. They live in small groups called pods and communicate with each other using a wide range of sounds. Dolphins can be trained to perform tricks, but many scientists now believe it is kinder to study them in the wild. In recent years, several aquariums around the world have released their dolphins back into the ocean.",
        },
        metadata: { topic: "ecology", difficulty: "easy" },
      },
      {
        slug: "oge-ra-02-bicycle",
        title: "Чтение вслух — Bicycle invention",
        payload: {
          type: "speaking_read_aloud",
          passage:
            "The bicycle was invented more than two hundred years ago. The first models had no pedals and no brakes, so riders had to push themselves along with their feet. Modern bicycles look very different, but they remain one of the cheapest and healthiest forms of transport in the world. Today millions of people use bicycles every day, and many cities are now building special cycle paths.",
        },
        metadata: { topic: "history", difficulty: "easy" },
      },
    ],
    interview: [
      {
        slug: "oge-in-01-school-life",
        title: "Интервью — School life",
        payload: {
          type: "speaking_interview",
          context:
            "You are taking part in an international radio survey about secondary-school life in Russia.",
          questions: [
            "How many hours a day do you usually spend on homework?",
            "What is your favourite subject at school and why?",
            "Do you think school uniforms are a good idea? Why or why not?",
            "How do you usually prepare for important tests?",
            "What changes would you like to see at your school next year?",
            "Would you recommend your school to other students? Why?",
          ],
        },
        metadata: { topic: "school", difficulty: "easy" },
      },
      {
        slug: "oge-in-02-healthy-lifestyle",
        title: "Интервью — Healthy lifestyle",
        payload: {
          type: "speaking_interview",
          context:
            "A teenage magazine is interviewing school students about healthy habits.",
          questions: [
            "How often do you do sport or physical exercise?",
            "What kind of food do you eat most often?",
            "How many hours of sleep do you usually get on school nights?",
            "Do you think modern teenagers have a healthy lifestyle? Why?",
            "What advice would you give to a friend who wants to feel fitter?",
            "Would you join a sports club at your school? Why or why not?",
          ],
        },
        metadata: { topic: "lifestyle", difficulty: "easy" },
      },
    ],
    monologue_topic: [
      {
        slug: "oge-mt-01-family",
        title: "Монолог — My family",
        payload: {
          type: "speaking_monologue_topic",
          topic: "Your family and how you spend time together",
          plan: [
            "who the members of your family are and what they are like",
            "what activities you enjoy doing together",
            "why family traditions are important for you",
          ],
        },
        metadata: { topic: "family", difficulty: "easy" },
      },
      {
        slug: "oge-mt-02-travel",
        title: "Монолог — Travelling",
        payload: {
          type: "speaking_monologue_topic",
          topic: "Travelling",
          plan: [
            "why many people enjoy travelling",
            "what kind of places you personally like to visit",
            "what was your most memorable trip and why",
          ],
        },
        metadata: { topic: "travel", difficulty: "easy" },
      },
    ],
  },
  // IELTS Speaking descriptors and items will land in the IELTS bank PR.
  ielts: {},
};

function slugHash(slug: string): string {
  return createHash("sha1").update(slug).digest("hex").slice(0, 16);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const client = postgres(url, { prepare: false });
  const d = drizzle(client);

  try {
    for (const examCode of SUPPORTED_EXAM_CODES) {
      const [section] = await d
        .select({ id: sections.id })
        .from(sections)
        .where(
          and(
            eq(sections.examCode, examCode as ExamCode),
            eq(sections.kind, "speaking"),
          ),
        )
        .limit(1);
      if (!section) {
        console.warn(
          `[skip] ${examCode} — no speaking section; run \`pnpm db:seed\` first.`,
        );
        continue;
      }

      const descriptors = getSpeakingDescriptors(examCode);
      for (const descriptor of descriptors) {
        const seedItems = SEED[examCode]?.[descriptor.format];
        if (!seedItems) continue;

        const templateCode = speakingTaskTemplateCode(
          examCode,
          descriptor.codeSuffix,
        );
        const taskNumber = Number(descriptor.fipiTaskRange) || null;
        const templateValues = {
          sectionId: section.id,
          taskNumber,
          code: templateCode,
          title: `${descriptor.displayName}`,
          instructions: descriptor.shortDescription,
          rubric: {
            total: totalSpeakingMax(descriptor.rubric),
            criteria: descriptor.rubric,
          },
          maxScore: totalSpeakingMax(descriptor.rubric),
          timeLimitSeconds:
            descriptor.timing.prepareSeconds + descriptor.timing.speakSeconds,
          config: {
            format: descriptor.format,
            timing: descriptor.timing,
          },
        };

        const existing = await d
          .select({ id: taskTemplates.id })
          .from(taskTemplates)
          .where(eq(taskTemplates.code, templateCode))
          .limit(1);

        let templateId: string;
        if (existing.length > 0) {
          templateId = existing[0].id;
          await d
            .update(taskTemplates)
            .set(templateValues)
            .where(eq(taskTemplates.id, templateId));
        } else {
          const [inserted] = await d
            .insert(taskTemplates)
            .values(templateValues)
            .returning({ id: taskTemplates.id });
          templateId = inserted.id;
        }

        let inserts = 0;
        for (const seed of seedItems) {
          const hash = slugHash(seed.slug);
          const dup = await d
            .select({ id: items.id })
            .from(items)
            .where(
              and(
                eq(items.taskTemplateId, templateId),
                sql`${items.metadata}->>'hash' = ${hash}`,
              ),
            )
            .limit(1);
          if (dup.length > 0) continue;

          await d.insert(items).values({
            taskTemplateId: templateId,
            source: "user_authored",
            stimulusText: seed.title,
            correctAnswers: seed.payload,
            metadata: {
              ...(seed.metadata ?? {}),
              slug: seed.slug,
              hash,
            },
          });
          inserts += 1;
        }
        console.log(
          `✓ ${examCode}.speaking.${descriptor.codeSuffix}: template upserted, +${inserts} new items (${seedItems.length} total curated).`,
        );
      }
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
