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
  WRITING_DESCRIPTORS,
  type WritingFormat,
  totalWritingMax,
  writingTaskTemplateCode,
} from "../lib/writing/descriptors";
import { SUPPORTED_EXAM_CODES, type SupportedExamCode } from "../lib/exams";

/**
 * Seed writing task_templates + a starter prompt bank for ЕГЭ + ОГЭ.
 *
 * Idempotent on (template_id, metadata.hash). Re-run with:
 *   pnpm db:seed:writing
 *
 * Each seed row stores the prompt that the student sees as `stimulus_text`
 * and any structured stimulus (questions to answer, table data, etc.) on
 * the `assets` jsonb column. `correct_answers` stays null — writing is
 * AI-graded.
 */

type WritingPromptStimulus =
  | {
      kind: "task_33_email" | "task_37_email";
      friendName: string;
      friendLetter: string;
      questions: string[];
      contextNote?: string;
    }
  | {
      kind: "task_38_essay";
      topic: string;
      prompt: string;
      table: { caption: string; rows: { label: string; value: string }[] };
      planLabels: string[];
    };

type SeedItem = {
  slug: string;
  title: string;
  prompt: string;
  stimulus: WritingPromptStimulus;
  metadata?: Record<string, unknown>;
};

type SeedBank = Record<SupportedExamCode, Partial<Record<WritingFormat, SeedItem[]>>>;

const SEED: SeedBank = {
  ege_en: {
    task_37_email: [
      {
        slug: "ege37-01-summer-camp",
        title: "Email — Summer camp",
        prompt:
          "You have received a letter from your English-speaking friend Mark, who writes about his plans for the summer holidays. Reply to his letter answering his three questions and asking your own.",
        stimulus: {
          kind: "task_37_email",
          friendName: "Mark",
          friendLetter:
            "…I'm so excited — my parents have finally agreed to let me go to a summer language camp in Wales! It's going to be two weeks of English lessons in the morning and outdoor activities in the afternoon. What kind of camps are popular with teenagers in your country? Which outdoor activities would you most want to try at a camp like this? And how important do you think it is to attend a language camp abroad?\n\nLet me know what you think,\nMark",
          questions: [
            "What kind of camps are popular with teenagers in your country?",
            "Which outdoor activities would you most want to try at a camp?",
            "How important do you think it is to attend a language camp abroad?",
          ],
        },
        metadata: { topic: "education", difficulty: "medium" },
      },
      {
        slug: "ege37-02-volunteer",
        title: "Email — Volunteering project",
        prompt:
          "Reply to your English-speaking friend Lucy, who is asking about volunteering work. Answer all three of her questions and ask one of your own.",
        stimulus: {
          kind: "task_37_email",
          friendName: "Lucy",
          friendLetter:
            "…last weekend I volunteered at a local animal shelter — I walked dogs and helped clean the cages. I felt completely exhausted but also happy. What kind of volunteering is popular among teenagers in your country? What skills do you think volunteering helps young people develop? Would you ever consider volunteering abroad, and if so, where?\n\nWrite back soon,\nLucy",
          questions: [
            "What kind of volunteering is popular among teenagers in your country?",
            "What skills do you think volunteering helps young people develop?",
            "Would you ever consider volunteering abroad, and if so, where?",
          ],
        },
        metadata: { topic: "volunteering", difficulty: "medium" },
      },
      {
        slug: "ege37-03-screen-time",
        title: "Email — Screen time",
        prompt:
          "Reply to your English-speaking friend Tom about phone usage among teenagers. Answer his three questions and ask one of your own.",
        stimulus: {
          kind: "task_37_email",
          friendName: "Tom",
          friendLetter:
            "…my parents have just installed a screen-time app on my phone — it logs every minute I spend scrolling. The data is honestly scary. How much time do teenagers in your country spend on their phones every day? What apps do you and your friends use most often? Do you think parents should be allowed to limit their kids' screen time?\n\nTake care,\nTom",
          questions: [
            "How much time do teenagers in your country spend on their phones every day?",
            "What apps do you and your friends use most often?",
            "Do you think parents should be allowed to limit their kids' screen time?",
          ],
        },
        metadata: { topic: "technology", difficulty: "medium" },
      },
      {
        slug: "ege37-04-future-job",
        title: "Email — Choosing a future job",
        prompt:
          "Reply to your English-speaking friend Olivia about choosing a future career. Answer her three questions and ask one of your own.",
        stimulus: {
          kind: "task_37_email",
          friendName: "Olivia",
          friendLetter:
            "…I'm in my last year of school and I still have absolutely no idea what to study at university — it's stressful! When did you start thinking seriously about your future profession? What jobs are considered prestigious among your classmates? Do you think a job should be about money or about doing something you love?\n\nLooking forward to your reply,\nOlivia",
          questions: [
            "When did you start thinking seriously about your future profession?",
            "What jobs are considered prestigious among your classmates?",
            "Do you think a job should be about money or about doing something you love?",
          ],
        },
        metadata: { topic: "career", difficulty: "medium" },
      },
      {
        slug: "ege37-05-reading-habits",
        title: "Email — Reading habits",
        prompt:
          "Reply to your English-speaking friend Daniel about reading habits among teenagers. Answer his three questions and ask one of your own.",
        stimulus: {
          kind: "task_37_email",
          friendName: "Daniel",
          friendLetter:
            "…I've just finished a 600-page novel in one weekend and I'm proud of myself — my friends say nobody reads paper books any more. Do teenagers in your country read for pleasure, or only for school? What was the last book that really impressed you, and why? Do you prefer paper books, e-readers or audiobooks, and why?\n\nAll the best,\nDaniel",
          questions: [
            "Do teenagers in your country read for pleasure, or only for school?",
            "What was the last book that really impressed you, and why?",
            "Do you prefer paper books, e-readers or audiobooks, and why?",
          ],
        },
        metadata: { topic: "culture", difficulty: "medium" },
      },
      {
        slug: "ege37-06-healthy-eating",
        title: "Email — Healthy eating",
        prompt:
          "Reply to your English-speaking friend Sophie about food and healthy eating. Answer her three questions and ask one of your own.",
        stimulus: {
          kind: "task_37_email",
          friendName: "Sophie",
          friendLetter:
            "…my school has just changed the canteen menu — no more chips, only salads and grilled chicken. Most of my classmates are unhappy. What kind of food is usually served in school canteens in your country? How healthy is the typical teenager's diet where you live? Do you think schools should ban junk food completely, and why or why not?\n\nKeep in touch,\nSophie",
          questions: [
            "What kind of food is usually served in school canteens in your country?",
            "How healthy is the typical teenager's diet where you live?",
            "Do you think schools should ban junk food completely, and why or why not?",
          ],
        },
        metadata: { topic: "health", difficulty: "medium" },
      },
    ],
    task_38_essay: [
      {
        slug: "ege38-01-leisure-time",
        title: "Opinion essay — Teenagers' leisure time",
        prompt:
          "Comment on the data in the table below. Use the official 5-paragraph FIPI plan.",
        stimulus: {
          kind: "task_38_essay",
          topic: "How Russian teenagers spend their leisure time",
          prompt:
            "The table below shows how Russian teenagers (aged 14–17) spend their leisure time on weekdays, in percent of respondents in a 2024 survey.",
          table: {
            caption: "Activities on a typical weekday (% of teenagers)",
            rows: [
              { label: "Browsing social media / videos", value: "78%" },
              { label: "Playing computer / mobile games", value: "54%" },
              { label: "Reading books or articles", value: "23%" },
              { label: "Doing sport / outdoor activity", value: "31%" },
              { label: "Spending time with family", value: "47%" },
            ],
          },
          planLabels: [
            "Make an opening statement on the topic.",
            "Select and report 2–3 facts from the table.",
            "Make 1–2 comparisons.",
            "Outline a problem the data implies and suggest a solution.",
            "Conclude by giving and explaining your opinion on the topic.",
          ],
        },
        metadata: { topic: "lifestyle", difficulty: "medium" },
      },
      {
        slug: "ege38-02-environment",
        title: "Opinion essay — Climate concerns",
        prompt:
          "Comment on the data in the table. Follow the 5-paragraph FIPI plan.",
        stimulus: {
          kind: "task_38_essay",
          topic: "Climate change concerns among Russians",
          prompt:
            "The table below shows the share of Russians (aged 18+) who say a given environmental issue worries them, in percent of respondents in a 2024 survey.",
          table: {
            caption: "Environmental issues worrying Russians (% of adults)",
            rows: [
              { label: "Air pollution in cities", value: "62%" },
              { label: "Plastic waste in oceans", value: "55%" },
              { label: "Deforestation", value: "44%" },
              { label: "Loss of wildlife species", value: "38%" },
              { label: "Climate change", value: "47%" },
            ],
          },
          planLabels: [
            "Make an opening statement on the topic.",
            "Select and report 2–3 facts from the table.",
            "Make 1–2 comparisons.",
            "Outline a problem the data implies and suggest a solution.",
            "Conclude by giving and explaining your opinion on the topic.",
          ],
        },
        metadata: { topic: "ecology", difficulty: "hard" },
      },
      {
        slug: "ege38-03-news-sources",
        title: "Opinion essay — Where teenagers get news",
        prompt:
          "Comment on the data in the table. Follow the 5-paragraph FIPI plan.",
        stimulus: {
          kind: "task_38_essay",
          topic: "Where Russian teenagers get their news",
          prompt:
            "The table below shows the share of Russian teenagers (aged 14–17) who use a given source to follow current events at least weekly, in percent of respondents in a 2024 survey.",
          table: {
            caption: "News sources used at least weekly (% of teenagers)",
            rows: [
              { label: "Telegram channels", value: "71%" },
              { label: "Short-form video apps (TikTok, Reels)", value: "58%" },
              { label: "Online news sites", value: "34%" },
              { label: "TV news programmes", value: "22%" },
              { label: "Printed newspapers", value: "4%" },
            ],
          },
          planLabels: [
            "Make an opening statement on the topic.",
            "Select and report 2–3 facts from the table.",
            "Make 1–2 comparisons.",
            "Outline a problem the data implies and suggest a solution.",
            "Conclude by giving and explaining your opinion on the topic.",
          ],
        },
        metadata: { topic: "media", difficulty: "hard" },
      },
      {
        slug: "ege38-04-foreign-languages",
        title: "Opinion essay — Studying foreign languages",
        prompt:
          "Comment on the data in the table. Follow the 5-paragraph FIPI plan.",
        stimulus: {
          kind: "task_38_essay",
          topic: "Foreign languages studied by Russian schoolchildren",
          prompt:
            "The table below shows the share of Russian schoolchildren who study a given foreign language at school, in percent of pupils in a 2024 Ministry of Education report.",
          table: {
            caption: "Foreign languages studied at school (% of pupils)",
            rows: [
              { label: "English", value: "86%" },
              { label: "German", value: "6%" },
              { label: "French", value: "3%" },
              { label: "Chinese", value: "4%" },
              { label: "Spanish", value: "1%" },
            ],
          },
          planLabels: [
            "Make an opening statement on the topic.",
            "Select and report 2–3 facts from the table.",
            "Make 1–2 comparisons.",
            "Outline a problem the data implies and suggest a solution.",
            "Conclude by giving and explaining your opinion on the topic.",
          ],
        },
        metadata: { topic: "education", difficulty: "hard" },
      },
    ],
  },
  oge_en: {
    task_33_email: [
      {
        slug: "oge33-01-school-trip",
        title: "Email — School trip to Saint-Petersburg",
        prompt:
          "You have received an email from your English-speaking pen-friend Alex. Write back. Answer all three questions and ask one of your own.",
        stimulus: {
          kind: "task_33_email",
          friendName: "Alex",
          friendLetter:
            "…last week our class went on a three-day trip to Saint-Petersburg. We visited the Hermitage and watched the bridges open at night — fantastic! Have you ever been to Saint-Petersburg? What city in your country would you recommend a foreign tourist to visit, and why? How important do you think school trips are for teenagers?\n\nWrite back soon,\nAlex",
          questions: [
            "Have you ever been to Saint-Petersburg?",
            "What city in your country would you recommend a foreign tourist to visit, and why?",
            "How important do you think school trips are for teenagers?",
          ],
        },
        metadata: { topic: "travel", difficulty: "easy" },
      },
      {
        slug: "oge33-02-pets",
        title: "Email — Family pet",
        prompt:
          "Reply to your English-speaking friend Emma. Answer all three questions and ask one of your own.",
        stimulus: {
          kind: "task_33_email",
          friendName: "Emma",
          friendLetter:
            "…we've just got a kitten — her name is Pepper and she is full of energy! Do you have a pet at home? What pet would you choose if you could have any animal, and why? How can having a pet teach a teenager something useful?\n\nMiss you,\nEmma",
          questions: [
            "Do you have a pet at home?",
            "What pet would you choose if you could have any animal, and why?",
            "How can having a pet teach a teenager something useful?",
          ],
        },
        metadata: { topic: "lifestyle", difficulty: "easy" },
      },
      {
        slug: "oge33-03-sport",
        title: "Email — Doing sport",
        prompt:
          "Reply to your English-speaking friend Sam. Answer all three questions and ask one of your own.",
        stimulus: {
          kind: "task_33_email",
          friendName: "Sam",
          friendLetter:
            "…I've just joined the school basketball team — practice is twice a week and I love it! What kind of sport is popular at your school? Do you do sport regularly, and if so, what? Why do you think doing sport is important for teenagers?\n\nCheers,\nSam",
          questions: [
            "What kind of sport is popular at your school?",
            "Do you do sport regularly, and if so, what?",
            "Why do you think doing sport is important for teenagers?",
          ],
        },
        metadata: { topic: "sport", difficulty: "easy" },
      },
      {
        slug: "oge33-04-favourite-subject",
        title: "Email — Favourite school subject",
        prompt:
          "Reply to your English-speaking friend Lily. Answer all three questions and ask one of your own.",
        stimulus: {
          kind: "task_33_email",
          friendName: "Lily",
          friendLetter:
            "…at my school we've just had end-of-term exams and I'm so glad they're over! What is your favourite subject at school, and why? Which subject do you find the most difficult? How do you usually prepare for important exams?\n\nWrite back soon,\nLily",
          questions: [
            "What is your favourite subject at school, and why?",
            "Which subject do you find the most difficult?",
            "How do you usually prepare for important exams?",
          ],
        },
        metadata: { topic: "education", difficulty: "easy" },
      },
      {
        slug: "oge33-05-summer-plans",
        title: "Email — Summer plans",
        prompt:
          "Reply to your English-speaking friend Jack. Answer all three questions and ask one of your own.",
        stimulus: {
          kind: "task_33_email",
          friendName: "Jack",
          friendLetter:
            "…I can't wait for the summer holidays — my family is going to drive across Europe in a camper van! What are your plans for the coming summer? What kind of holidays do you enjoy most — active or relaxing? Do you prefer travelling with your family or with friends, and why?\n\nSee you,\nJack",
          questions: [
            "What are your plans for the coming summer?",
            "What kind of holidays do you enjoy most — active or relaxing?",
            "Do you prefer travelling with your family or with friends, and why?",
          ],
        },
        metadata: { topic: "travel", difficulty: "easy" },
      },
      {
        slug: "oge33-06-best-friend",
        title: "Email — Best friend",
        prompt:
          "Reply to your English-speaking friend Mia. Answer all three questions and ask one of your own.",
        stimulus: {
          kind: "task_33_email",
          friendName: "Mia",
          friendLetter:
            "…my best friend is moving to another city next month and I'm really sad about it. Do you have a best friend, and how long have you known each other? What do you usually do together when you spend time? Why do you think true friendship is important for a teenager?\n\nMiss you,\nMia",
          questions: [
            "Do you have a best friend, and how long have you known each other?",
            "What do you usually do together when you spend time?",
            "Why do you think true friendship is important for a teenager?",
          ],
        },
        metadata: { topic: "friendship", difficulty: "easy" },
      },
    ],
  },
};

function slugHash(slug: string): string {
  return createHash("sha1").update(slug).digest("hex").slice(0, 12);
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
            eq(sections.kind, "writing"),
          ),
        )
        .limit(1);
      if (!section) {
        console.warn(
          `[skip] ${examCode} — no writing section; run \`pnpm db:seed\` first.`,
        );
        continue;
      }

      const descriptors = WRITING_DESCRIPTORS.filter(
        (d) => d.examCode === examCode,
      );
      for (const descriptor of descriptors) {
        const seedItems = SEED[examCode]?.[descriptor.format];
        if (!seedItems) continue;

        const templateCode = writingTaskTemplateCode(descriptor);
        const templateValues = {
          sectionId: section.id,
          taskNumber: descriptor.fipiTaskNumber,
          code: templateCode,
          title: descriptor.displayName,
          instructions: descriptor.fipiInstructions,
          rubric: {
            total: totalWritingMax(descriptor.rubric),
            criteria: descriptor.rubric,
          },
          maxScore: totalWritingMax(descriptor.rubric),
          timeLimitSeconds: descriptor.timeBudgetSeconds,
          config: {
            format: descriptor.format,
            minWords: descriptor.minWords,
            maxWords: descriptor.maxWords,
            hardMin: descriptor.hardMin,
            hardMax: descriptor.hardMax,
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
            stimulusText: seed.prompt,
            assets: { stimulus: seed.stimulus, title: seed.title },
            // Writing is AI-graded — no auto-key.
            correctAnswers: null,
            metadata: {
              ...(seed.metadata ?? {}),
              slug: seed.slug,
              hash,
            },
          });
          inserts += 1;
        }
        console.log(
          `✓ ${examCode}.writing.${descriptor.format}: template upserted, +${inserts} new items (${seedItems.length} total curated).`,
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
