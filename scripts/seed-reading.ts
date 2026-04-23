import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";

import {
  sections,
  taskTemplates,
  items,
  type ExamCode,
} from "../lib/db/schema";
import {
  getReadingDescriptors,
  readingTaskTemplateCode,
} from "../lib/reading/descriptors";
import type { ReadingAnswer, ReadingFormat } from "../lib/reading/types";
import type { SupportedExamCode } from "../lib/exams";
import { SUPPORTED_EXAM_CODES } from "../lib/exams";

/**
 * Seed reading task_templates + a starter item bank for ЕГЭ and ОГЭ.
 *
 * Runs after `pnpm db:seed` (which creates exam + section rows) and is
 * idempotent by task-template `code` + (template_id, stimulus_text).
 *
 * Each item stores:
 * - the question in `stimulus_text` (what the UI shows below the passage)
 * - the reading passage in `metadata.passage` (shown above the question)
 * - the grading key in `correct_answers` (ReadingAnswer shape)
 *
 * Content is hand-curated so the Reading UI lands with working material in
 * PR #4. FIPI demo-paper parsing and AI generation come in later PRs.
 */

type SeedItem = {
  passage: string;
  question: string;
  answer: ReadingAnswer;
  metadata?: Record<string, unknown>;
};

type SeedBank = Record<
  SupportedExamCode,
  Partial<Record<ReadingFormat, SeedItem[]>>
>;

const SEED: SeedBank = {
  ege_en: {
    matching_headings: [
      {
        passage:
          "Antarctica's ice sheet holds about 70 per cent of the world's fresh water, but almost none of it is drinkable without treatment. Scientists at a research station near the Ross Sea spend more energy melting snow than they do on heating their labs. A small desalination plant, flown in last summer, now produces 400 litres of potable water a day — just enough for a crew of twelve and a handful of visiting journalists.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "A frozen continent's thirsty scientists",
            "How tourism is changing Antarctica",
            "The history of polar exploration",
            "New discoveries under the ice",
          ],
          answer: 0,
          evidence:
            "almost none of it is drinkable without treatment; a small desalination plant … produces 400 litres … for a crew of twelve",
        },
        metadata: { topic: "ecology", difficulty: "medium" },
      },
      {
        passage:
          "When the café on Baker Street reopened after the pandemic, its owners decided to keep a single change from lockdown: the menus were tied to a QR code, not printed on paper. Customers aged seventy and over complained. The owners compromised — one laminated menu is kept behind the counter. Three years on, 95 per cent of orders still go through the QR code, but the laminated copy, they say, has saved them at least twenty regulars.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "Why print menus are disappearing everywhere",
            "A small café's compromise between old and new",
            "Health benefits of contactless ordering",
            "The economics of running a London café",
          ],
          answer: 1,
          evidence:
            "the owners compromised — one laminated menu is kept behind the counter … the laminated copy … has saved them at least twenty regulars",
        },
        metadata: { topic: "lifestyle", difficulty: "easy" },
      },
      {
        passage:
          "In the 1960s, only five per cent of Japanese students played football. Baseball was everything. Today, fifty years after the launch of the J.League, schools across the country run football clubs alongside their baseball teams, and the national women's team is a two-time World Cup finalist. The shift did not happen because baseball became less popular — attendance at professional games has held steady — but because football offered a sport that did not require expensive gloves or mitts.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "The decline of Japanese baseball",
            "Why women's football is growing worldwide",
            "How football joined, not replaced, Japan's baseball tradition",
            "Equipment costs in amateur sport",
          ],
          answer: 2,
          evidence:
            "The shift did not happen because baseball became less popular … but because football offered a sport that did not require expensive gloves or mitts",
        },
        metadata: { topic: "sport_culture", difficulty: "medium" },
      },
      {
        passage:
          "The library on the top floor of the old town hall has no staff. Members apply for a key card online and use the space at any hour. Books are returned by leaving them on any table: a volunteer comes in on Sundays to reshelve them. Since the self-service system was introduced in 2019, membership has tripled, and the council has recorded only seven missing books out of a collection of more than four thousand.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "The decline of public libraries",
            "A 24-hour library that runs on trust",
            "How to apply for a library card",
            "Volunteers: the heart of the community",
          ],
          answer: 1,
          evidence:
            "Members apply for a key card online and use the space at any hour … only seven missing books out of a collection of more than four thousand",
        },
        metadata: { topic: "community", difficulty: "easy" },
      },
      {
        passage:
          "The Faroe Islands, halfway between Scotland and Iceland, have started translating their landscape. Volunteer guides — mostly sheep farmers — walk with tourists while wearing a live-translation earpiece developed by a Tórshavn start-up. Visitors hear the farmer's stories in their own language a few seconds later. The tool only works well for English, Spanish and Chinese so far; with German and French it sometimes turns poetic descriptions of the cliffs into gardening advice.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "Farming challenges in the North Atlantic",
            "The best walking routes in the Faroe Islands",
            "A start-up that helps farmers become guides",
            "Why tourism is a threat to rural life",
          ],
          answer: 2,
          evidence:
            "Volunteer guides — mostly sheep farmers — walk with tourists while wearing a live-translation earpiece developed by a Tórshavn start-up",
        },
        metadata: { topic: "technology_tourism", difficulty: "medium" },
      },
    ],
    matching_statements: [
      {
        passage:
          "Professional chess players have always valued silence. But in 2023 the World Chess Federation ruled that small, shielded headphones playing white noise were allowed during classical games. The reason was practical: several major tournaments take place in convention centres where ___. The ruling split the community — some grandmasters felt it unfairly helped players who train with audio distractions, while others simply called it common sense.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "audiences are forbidden from entering the hall",
            "construction noise from nearby halls is common",
            "the temperature is kept uncomfortably low",
            "television cameras were banned until 2020",
          ],
          answer: 1,
          evidence:
            "small, shielded headphones playing white noise were allowed … convention centres",
        },
        metadata: { topic: "sport_culture", difficulty: "medium" },
      },
      {
        passage:
          "When Marta moved to Lisbon, she brought nothing but a rucksack and an old film camera. Her plan was to photograph one stranger a day for a year and print the results on a single wall of her flat. By month four she had run out of wall, and by month seven ___. The final exhibition, opened on her first anniversary in the city, covered every flat surface of the apartment, including the ceiling above the bed.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "she had abandoned the project completely",
            "she had started attaching the prints to the furniture",
            "she had sold the camera for rent money",
            "she had begun photographing only tourists",
          ],
          answer: 1,
          evidence:
            "By month four she had run out of wall … The final exhibition … covered every flat surface of the apartment, including the ceiling",
        },
        metadata: { topic: "lifestyle_arts", difficulty: "medium" },
      },
      {
        passage:
          "Most modern running shoes are designed to last about 800 kilometres. Beyond that distance the foam that absorbs impact begins to compress permanently, even though the outside of the shoe can look brand new. Runners training for a marathon therefore often keep two pairs at once, rotating them every other session. The rotation also helps because ___, giving the midsole time to recover between runs.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "new shoes are more expensive than old ones",
            "the foam takes roughly 24 hours to decompress",
            "professional runners change sponsors frequently",
            "different brands use different lacing patterns",
          ],
          answer: 1,
          evidence:
            "rotating them every other session … giving the midsole time to recover between runs",
        },
        metadata: { topic: "sport_science", difficulty: "medium" },
      },
      {
        passage:
          "The Elephant Orchestra of Lampang is not a gimmick. Its members — six retired logging elephants — have been taught to tap percussion instruments with their trunks, and their handlers insist that the elephants choose whether to take part in a session. If an animal walks away, the session ends. This rule means that ___, and visitors are warned in advance that a performance may be cut short without notice.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "tickets are sold at a heavy discount",
            "no two concerts have the same length",
            "human musicians are never allowed on stage",
            "the instruments are tuned to a special scale",
          ],
          answer: 1,
          evidence:
            "If an animal walks away, the session ends … a performance may be cut short without notice",
        },
        metadata: { topic: "animals", difficulty: "medium" },
      },
      {
        passage:
          "Passive houses — homes so well insulated that they barely need central heating — were once thought impossible outside Scandinavia. Architects in Andalucía, where summer temperatures reach forty degrees, proved otherwise. By pairing thick walls with shaded courtyards and a cooling tower inspired by traditional Arabic design, they cut air-conditioning use by roughly ninety per cent. ___, which is why the first certified Spanish passive house still sits empty as a showcase rather than a home.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "The insulation materials are cheap to import",
            "The upfront cost of construction remains very high",
            "Local builders have refused to be trained",
            "The Spanish climate is too dry for the technology",
          ],
          answer: 1,
          evidence:
            "the first certified Spanish passive house still sits empty as a showcase rather than a home",
        },
        metadata: { topic: "architecture_ecology", difficulty: "hard" },
      },
    ],
    mc_detail: [
      {
        passage:
          "Dr Kavita Rao, a marine biologist from Goa, spent fifteen years researching seagrass meadows before she realised that her most important colleagues were not scientists at all. It was the local fishermen who first noticed that a rare species of seahorse had returned to the bay. They had no scientific training, but they could tell from the colour of the water where the seagrass was healthiest. In 2022 Dr Rao launched a joint monitoring programme: fishermen report weekly, and in return the research institute trains their children free of charge.",
        question:
          "According to the passage, why were the fishermen so valuable to Dr Rao's research?",
        answer: {
          type: "reading_mc",
          options: [
            "They had formal training in marine ecology.",
            "They were the first to observe the return of a rare species.",
            "They ran the research institute's outreach programme.",
            "They helped to design the new monitoring instruments.",
          ],
          answer: 1,
          evidence:
            "It was the local fishermen who first noticed that a rare species of seahorse had returned to the bay",
        },
        metadata: { topic: "ecology", difficulty: "easy" },
      },
      {
        passage:
          "The idea of a four-day working week is not new, but until recently few employers had tested it seriously. In 2022 a trial in the UK involved sixty-one companies of very different sizes, from small charities to a fish-and-chip shop. Salaries stayed the same; only the hours fell. Most managers expected productivity to drop. Instead, on average it rose — partly because employees took fewer short breaks, and partly because companies simplified meetings that had been stretching long into the day. When the trial ended, fifty-six of the firms kept the new schedule.",
        question: "What does the passage say about productivity during the trial?",
        answer: {
          type: "reading_mc",
          options: [
            "It fell sharply during the first month.",
            "It rose on average across the sixty-one firms.",
            "It stayed exactly the same as before the trial.",
            "It depended entirely on the size of the company.",
          ],
          answer: 1,
          evidence: "Instead, on average it rose",
        },
        metadata: { topic: "workplace", difficulty: "easy" },
      },
      {
        passage:
          "The cinema in Ventanas, a village of 300 people in northern Spain, was closed in 2007 after the only projectionist retired. For twelve years the building stood empty. Then a group of neighbours formed a cooperative, each buying a symbolic share of ten euros, and renovated the hall themselves. They could not afford a full-time projectionist, so they rotate: everyone who takes a turn gets to choose the next film. The cinema now shows three films a week and, unusually, has no fixed programme published in advance.",
        question:
          "Why does the Ventanas cinema not publish a fixed programme?",
        answer: {
          type: "reading_mc",
          options: [
            "The film distributor does not deliver titles in time.",
            "Each week's projectionist chooses the next film.",
            "The cooperative cannot decide which genres to show.",
            "Advertising a programme is too expensive for the village.",
          ],
          answer: 1,
          evidence:
            "everyone who takes a turn gets to choose the next film",
        },
        metadata: { topic: "community", difficulty: "medium" },
      },
      {
        passage:
          "Coffee rust, a fungus that destroys coffee leaves, was once largely a Latin American problem. In the last decade it has reached Ethiopia, the crop's birthplace. Researchers disagree about the main reason. Some blame climate change, which allows the fungus to thrive at altitudes it once avoided. Others point to international trade: plant material moved between farms can carry spores across continents. A new study suggests that both factors work together, and that neither alone would have triggered the outbreak observed since 2019.",
        question:
          "What does the new study suggest about the recent rust outbreak?",
        answer: {
          type: "reading_mc",
          options: [
            "Climate change is the single main cause.",
            "International trade is the single main cause.",
            "The outbreak required both climate and trade factors.",
            "Neither factor has any real effect on the fungus.",
          ],
          answer: 2,
          evidence:
            "both factors work together, and that neither alone would have triggered the outbreak",
        },
        metadata: { topic: "agriculture_science", difficulty: "hard" },
      },
      {
        passage:
          "Sofía Vergara, head chef at Buenos Aires' smallest restaurant, serves only eight guests a night. She has never advertised, and the waiting list stretches to nearly a year. What makes her kitchen unusual is not the menu but the rule that diners may bring exactly one ingredient from home. Every evening she improvises a dish that uses every guest's contribution. Regulars say the most memorable meals have come from the strangest ingredients: a single lemon from a grandmother's garden, a square of chocolate from a child's birthday.",
        question: "Which detail is mentioned in the passage?",
        answer: {
          type: "reading_mc",
          options: [
            "Sofía advertises her restaurant only on social media.",
            "Guests are asked to pay for ingredients separately.",
            "The menu changes depending on what guests bring.",
            "The kitchen employs twelve chefs in total.",
          ],
          answer: 2,
          evidence:
            "Every evening she improvises a dish that uses every guest's contribution",
        },
        metadata: { topic: "lifestyle", difficulty: "easy" },
      },
    ],
  },
  oge_en: {
    matching_headings: [
      {
        passage:
          "Every Sunday morning a small crowd gathers in the park near the river. They are not there for a run or a picnic, but for a free English class. The teacher, Marina, is a retired translator who offers lessons to anyone who wants to come. There are no tests and no grades. \"People stop coming when they feel they are ready,\" she says. \"That is how I know the class has worked.\"",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "A retired teacher's free Sunday lessons",
            "How to prepare for an English exam",
            "The history of language teaching in Russia",
            "Why translators earn so little money",
          ],
          answer: 0,
          evidence:
            "a retired translator who offers lessons to anyone who wants to come",
        },
        metadata: { topic: "community", difficulty: "easy" },
      },
      {
        passage:
          "When I was ten, my father made me a bookshelf out of an old door. It had five shelves and still smelled of paint. I put my favourite books on the top and my schoolbooks on the bottom. Twenty years later the shelf is still in my room, and my little daughter now uses it for her own books. The paint has worn off in places, but the shelf itself is as strong as ever.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "A present from grandmother",
            "A handmade bookshelf that lasted for years",
            "How to save money on furniture",
            "My daughter's favourite books",
          ],
          answer: 1,
          evidence:
            "my father made me a bookshelf out of an old door … Twenty years later the shelf is still in my room",
        },
        metadata: { topic: "family", difficulty: "easy" },
      },
      {
        passage:
          "Tomato and apple may seem like a strange mix, but together they make a delicious salad. Cut one large tomato and one green apple into small cubes. Add a little olive oil, salt and black pepper. Some people put in a few walnuts, too. The salad is ready in five minutes and is especially good on a hot summer day when no one wants to cook.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "The history of the tomato",
            "A quick summer salad recipe",
            "Why apples are good for your health",
            "Cooking with a lot of time",
          ],
          answer: 1,
          evidence:
            "The salad is ready in five minutes and is especially good on a hot summer day",
        },
        metadata: { topic: "food", difficulty: "easy" },
      },
      {
        passage:
          "Our school has started a new programme: every Friday the last lesson is replaced by a club. You can choose from chess, photography, cooking or robotics. Teachers do not give you marks in the clubs; the idea is to try something new. In the first month most students tried robotics, but by the end of the term chess became the most popular club of all.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "Why Friday lessons are the hardest",
            "A school club programme that lets you try new hobbies",
            "How to become a good chess player",
            "The problem with school uniforms",
          ],
          answer: 1,
          evidence:
            "every Friday the last lesson is replaced by a club … the idea is to try something new",
        },
        metadata: { topic: "school", difficulty: "easy" },
      },
      {
        passage:
          "My uncle lives in a small village in the north of England. Last summer I visited him for a week. He has a farm with sheep, two dogs and a very old tractor. Every morning we fed the sheep and took the dogs for a walk. In the evening we read books by the fire. There is no internet in the village, and for the first two days I missed my phone. By the end of the week, I didn't want to go home.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "A busy city holiday",
            "A week on my uncle's quiet farm",
            "Why the internet is important",
            "Learning to drive a tractor",
          ],
          answer: 1,
          evidence:
            "He has a farm with sheep, two dogs and a very old tractor … By the end of the week, I didn't want to go home",
        },
        metadata: { topic: "family_travel", difficulty: "easy" },
      },
    ],
    true_false_stated: [
      {
        passage:
          "Anna is fourteen and goes to a music school three times a week. She plays the violin. Her favourite composer is Tchaikovsky. Next year Anna would like to take part in a junior competition in St Petersburg, but her teacher thinks she should practise more before entering. At home Anna also plays the guitar, just for fun.",
        question:
          "Statement: Anna has already taken part in a competition in St Petersburg.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence:
            "Next year Anna would like to take part … her teacher thinks she should practise more before entering",
        },
        metadata: { topic: "school_hobbies", difficulty: "easy" },
      },
      {
        passage:
          "Mike works as a guide at the city zoo. He started working there five years ago, right after he finished university, where he studied biology. His favourite animal is the red panda, although most visitors only want to see the lions. In winter he gives fewer tours because the zoo is less busy; instead, he helps the keepers to feed the animals.",
        question: "Statement: Mike studied biology at university.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 0,
          evidence: "he finished university, where he studied biology",
        },
        metadata: { topic: "work", difficulty: "easy" },
      },
      {
        passage:
          "The new library near the metro station opened in September. It is open from 10 a.m. to 8 p.m. every day except Monday. Children under twelve can borrow up to three books at a time; adults can take five. On Saturdays there is a reading club for teenagers. The library also has a small café, but you are not allowed to eat next to the shelves.",
        question:
          "Statement: The library is open every day of the week, including Mondays.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "open from 10 a.m. to 8 p.m. every day except Monday",
        },
        metadata: { topic: "community", difficulty: "easy" },
      },
      {
        passage:
          "Olga bought her first bicycle when she was thirty-two. Before that, she had always travelled to work by bus. After a month of cycling, she noticed that she felt less tired at the end of the day. She is now thinking about buying a second bicycle for her husband, who has never learned to ride. Her daughter already cycles to school.",
        question:
          "Statement: Olga's husband is a more experienced cyclist than she is.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence:
            "a second bicycle for her husband, who has never learned to ride",
        },
        metadata: { topic: "lifestyle", difficulty: "easy" },
      },
      {
        passage:
          "Our football team, the Tigers, has won the regional league for three years in a row. Our coach, Mr Ivanov, says the secret is not talent but practice. Every member of the team has to come to training at least four times a week. One of our strikers, Nikita, also trains with a gym coach on weekends, but this is not required by the club.",
        question:
          "Statement: Nikita earns the highest salary among the Tigers players.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 2,
          evidence:
            "(no information about salaries is given in the text)",
        },
        metadata: { topic: "sport", difficulty: "medium" },
      },
    ],
  },
};

/** FIPI task number where this descriptor begins. */
function taskNumberFor(
  examCode: SupportedExamCode,
  format: ReadingFormat,
): number | null {
  if (examCode === "ege_en") {
    if (format === "matching_headings") return 10;
    if (format === "matching_statements") return 11;
    if (format === "mc_detail") return 12;
  } else {
    if (format === "matching_headings") return 9;
    if (format === "true_false_stated") return 12;
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
    const [readingSection] = await db
      .select({ id: sections.id })
      .from(sections)
      .where(
        and(
          eq(sections.examCode, examCode as ExamCode),
          eq(sections.kind, "reading"),
        ),
      )
      .limit(1);
    if (!readingSection) {
      console.warn(
        `⚠ skipping ${examCode}: reading section not found. Run pnpm db:seed first.`,
      );
      continue;
    }

    const descriptors = getReadingDescriptors(examCode);
    for (const descriptor of descriptors) {
      const code = readingTaskTemplateCode(examCode, descriptor.codeSuffix);
      const taskNumber = taskNumberFor(examCode, descriptor.format);
      const rubric = { correct: 1, incorrect: 0, maxPerItem: 1 };

      const [template] = await db
        .insert(taskTemplates)
        .values({
          sectionId: readingSection.id,
          taskNumber,
          code,
          title: descriptor.displayName,
          instructions: descriptor.shortDescription,
          rubric,
          maxScore: 1,
          timeLimitSeconds: null,
          config: {
            readingType: descriptor.type,
            readingFormat: descriptor.format,
          },
        })
        .onConflictDoUpdate({
          target: taskTemplates.code,
          set: {
            title: descriptor.displayName,
            instructions: descriptor.shortDescription,
            rubric,
            config: {
              readingType: descriptor.type,
              readingFormat: descriptor.format,
            },
          },
        })
        .returning({ id: taskTemplates.id });

      const bank = SEED[examCode][descriptor.format] ?? [];
      let inserted = 0;
      for (const seed of bank) {
        // Dedup on (template, question, passage). The question string alone
        // can be identical across items (e.g. "Which heading matches the
        // text best?"), so we also match on the passage stored in metadata.
        const existing = await db
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.taskTemplateId, template.id),
              eq(items.stimulusText, seed.question),
              sql`${items.metadata}->>'passage' = ${seed.passage}`,
            ),
          )
          .limit(1);
        if (existing.length > 0) continue;
        await db.insert(items).values({
          taskTemplateId: template.id,
          source: "user_authored",
          stimulusText: seed.question,
          correctAnswers: seed.answer,
          metadata: {
            passage: seed.passage,
            ...(seed.metadata ?? {}),
          },
        });
        inserted += 1;
      }

      console.log(
        `✓ ${examCode}.reading.${descriptor.codeSuffix}: template upserted, +${inserted} new items (${bank.length} total in bank).`,
      );
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
