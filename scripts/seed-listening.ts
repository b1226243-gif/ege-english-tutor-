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
  getListeningDescriptors,
  listeningTaskTemplateCode,
} from "../lib/listening/descriptors";
import type {
  ListeningAnswer,
  ListeningFormat,
} from "../lib/listening/types";
import type { SupportedExamCode } from "../lib/exams";
import { SUPPORTED_EXAM_CODES } from "../lib/exams";

/**
 * Seed listening task_templates + a starter item bank for ЕГЭ and ОГЭ.
 *
 * Runs after `pnpm db:seed` (which creates exam + section rows) and is
 * idempotent by task-template `code` + (template_id, question, transcript
 * hash).
 *
 * Each listening item stores:
 * - the question in `stimulus_text` (what the UI shows below the audio)
 * - the audio URL in `stimulus_audio_url` (points to
 *   `/public/audio/listening/<slug>.mp3`; run
 *   `pnpm listening:generate-audio` to render the mp3s with OpenAI TTS;
 *   missing files are handled client-side via speechSynthesis fallback)
 * - the transcript + voice in `assets` (used for TTS + AI context + UI
 *   transcript reveal after answering)
 * - the grading key in `correct_answers` (ListeningAnswer shape)
 *
 * Content is hand-curated so the Listening UI lands with working material
 * in PR #5. FIPI demo-paper parsing and AI generation come in later PRs.
 */

type SeedItem = {
  slug: string;
  voice: string;
  transcript: string;
  question: string;
  answer: ListeningAnswer;
  metadata?: Record<string, unknown>;
};

type SeedBank = Record<
  SupportedExamCode,
  Partial<Record<ListeningFormat, SeedItem[]>>
>;

const SEED: SeedBank = {
  ege_en: {
    matching_speakers: [
      {
        slug: "ege-ms-01-elena-library",
        voice: "nova",
        transcript:
          "Honestly, I used to think libraries were just for studying, but now I go to ours mainly to read comics. They started a graphic novel section last year and it's the only reason I still visit on weekends.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker visits the library mainly to study quietly.",
            "The speaker visits the library to read graphic novels.",
            "The speaker has stopped visiting the library completely.",
          ],
          answer: 1,
          evidence: "I go to ours mainly to read comics",
        },
        metadata: { topic: "libraries", difficulty: "easy" },
      },
      {
        slug: "ege-ms-02-viktor-cycling",
        voice: "onyx",
        transcript:
          "I cycle to work every day, and the thing I'm really proud of is that I haven't used a car this whole year. My colleagues thought I'd give up in winter, but a decent jacket and good lights solved that problem.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker gave up cycling during winter.",
            "The speaker cycles to work all year round.",
            "The speaker recently started cycling as a hobby.",
          ],
          answer: 1,
          evidence: "I haven't used a car this whole year",
        },
        metadata: { topic: "lifestyle", difficulty: "medium" },
      },
      {
        slug: "ege-ms-03-polina-choir",
        voice: "shimmer",
        transcript:
          "Our choir has been around for twelve years, but last month we had our first concert abroad. We performed in Tallinn, and although the audience was small, they followed every word of our Russian folk songs.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The choir has just been founded this year.",
            "The choir performed abroad for the first time recently.",
            "The choir refused an invitation to sing in Tallinn.",
          ],
          answer: 1,
          evidence: "we had our first concert abroad",
        },
        metadata: { topic: "music", difficulty: "medium" },
      },
      {
        slug: "ege-ms-04-ivan-gap-year",
        voice: "echo",
        transcript:
          "After school I took a gap year, mostly to earn money. I worked at a bakery, saved a bit, and then travelled across Georgia for three weeks. I start university this September \u2014 my parents are relieved it finally happens.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker will never go to university.",
            "The speaker spent a gap year working and travelling.",
            "The speaker's parents paid for all his travels.",
          ],
          answer: 1,
          evidence: "I worked at a bakery, saved a bit, and then travelled",
        },
        metadata: { topic: "education", difficulty: "medium" },
      },
      {
        slug: "ege-ms-05-marina-plant-based",
        voice: "alloy",
        transcript:
          "People assume I turned vegetarian for ethical reasons, but honestly it was the bill at the supermarket. Once meat prices jumped last spring, I tried cooking with more beans and lentils, and I genuinely feel lighter now.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker changed her diet for moral reasons.",
            "The speaker went vegetarian to save money.",
            "The speaker still eats meat every week.",
          ],
          answer: 1,
          evidence: "honestly it was the bill at the supermarket",
        },
        metadata: { topic: "food", difficulty: "medium" },
      },
      {
        slug: "ege-ms-06-kirill-film-club",
        voice: "onyx",
        transcript:
          "We started a film club at the engineering faculty and I was sure nobody would show up. Forty-seven people came to the first screening \u2014 we had to bring in extra chairs from the corridor, and now it's a regular Wednesday event.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The first screening of the film club was almost empty.",
            "Far more people came to the first screening than expected.",
            "The film club was cancelled after the first week.",
          ],
          answer: 1,
          evidence: "Forty-seven people came to the first screening",
        },
        metadata: { topic: "student_life", difficulty: "medium" },
      },
      {
        slug: "ege-ms-07-alina-pottery",
        voice: "shimmer",
        transcript:
          "Pottery is relaxing, people say, but honestly my first six months were frustrating. Nothing kept its shape. Then my teacher told me to slow down \u2014 literally to halve the wheel speed \u2014 and suddenly every bowl came out even.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker mastered pottery within the first week.",
            "Slowing the wheel down dramatically improved her work.",
            "The speaker has given up on pottery.",
          ],
          answer: 1,
          evidence: "literally to halve the wheel speed \u2014 and suddenly every bowl came out even",
        },
        metadata: { topic: "hobbies", difficulty: "medium" },
      },
      {
        slug: "ege-ms-08-timur-app",
        voice: "echo",
        transcript:
          "I built a language-exchange app over the summer holiday, thinking five friends would try it. It's been live for four months and we now have over two thousand users. I still can't quite believe the numbers on my dashboard each morning.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker's app attracted more users than expected.",
            "The speaker's app was shut down after launch.",
            "The speaker built the app only for his own use.",
          ],
          answer: 0,
          evidence: "we now have over two thousand users",
        },
        metadata: { topic: "technology", difficulty: "medium" },
      },
      {
        slug: "ege-ms-09-diana-swim",
        voice: "nova",
        transcript:
          "I couldn't swim until I was twenty-six, which felt embarrassing. Last winter I finally took adult lessons at the local pool. It cost me almost nothing, and by March I managed my first length without stopping.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker learned to swim as a child.",
            "The speaker took affordable adult swimming lessons.",
            "The speaker still cannot swim at all.",
          ],
          answer: 1,
          evidence: "I finally took adult lessons at the local pool",
        },
        metadata: { topic: "sport", difficulty: "easy" },
      },
      {
        slug: "ege-ms-10-pavel-coffee",
        voice: "onyx",
        transcript:
          "I used to drink six coffees a day. Last October my doctor strongly recommended cutting down, so now I allow myself exactly two \u2014 one at home, one after lunch. The headaches from withdrawal lasted less than a week.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker drinks no coffee at all now.",
            "The speaker has reduced his coffee intake to two a day.",
            "The speaker's doctor told him to drink more coffee.",
          ],
          answer: 1,
          evidence: "now I allow myself exactly two",
        },
        metadata: { topic: "health", difficulty: "medium" },
      },
    ],
    true_false_stated: [
      {
        slug: "ege-tfs-01-startup",
        voice: "onyx",
        transcript:
          "Our startup was founded in Kazan in twenty eighteen. We make accessibility software for museums \u2014 audio guides that describe paintings for blind visitors. We started with the Hermitage, then added eleven regional museums. We employ twenty-four people and all of them work remotely.",
        question:
          "Statement: The startup employs more than thirty people.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "We employ twenty-four people",
        },
        metadata: { topic: "business", difficulty: "medium" },
      },
      {
        slug: "ege-tfs-02-beekeeper",
        voice: "shimmer",
        transcript:
          "My grandmother keeps bees in the Altai region. She has thirty-two hives, which is unusual for a woman of seventy-six. Last summer she sold almost four hundred kilos of honey to a shop in Novosibirsk. She never advertises \u2014 the customers find her through word of mouth.",
        question: "Statement: The grandmother advertises her honey online.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "She never advertises",
        },
        metadata: { topic: "family", difficulty: "easy" },
      },
      {
        slug: "ege-tfs-03-marathon",
        voice: "echo",
        transcript:
          "I ran my first marathon two years ago, in Saint Petersburg. My time was five hours and twelve minutes \u2014 very slow, but I finished. This year I'm training for Kazan, hoping to cut at least thirty minutes from that time. My coach thinks I can manage it easily.",
        question:
          "Statement: The speaker has run marathons in other countries.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 2,
          evidence:
            "(the text mentions Saint Petersburg and Kazan only, no foreign cities)",
        },
        metadata: { topic: "sport", difficulty: "medium" },
      },
      {
        slug: "ege-tfs-04-bookshop",
        voice: "nova",
        transcript:
          "My parents run a small bookshop in Yekaterinburg. It has been in the same family since nineteen ninety-three. They don't sell any e-books \u2014 they believe their customers come specifically for the printed editions. They also host poetry readings on the last Friday of every month.",
        question:
          "Statement: The bookshop sells both printed books and e-books.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "They don't sell any e-books",
        },
        metadata: { topic: "business", difficulty: "medium" },
      },
      {
        slug: "ege-tfs-05-language",
        voice: "alloy",
        transcript:
          "I've been learning Korean for three years now. I started because of a TV series, but after six months I became more interested in the grammar than in the drama. Last year I spent a month in Seoul, mainly studying at a small language school near the university district.",
        question: "Statement: The speaker started learning Korean at school.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "I started because of a TV series",
        },
        metadata: { topic: "languages", difficulty: "medium" },
      },
      {
        slug: "ege-tfs-06-volcano",
        voice: "onyx",
        transcript:
          "Kamchatka has twenty-nine active volcanoes, and I've climbed seven of them. The hardest was Mutnovsky, not because of altitude but because of sulphur fumes near the crater. Even my guide, who had done it nine times before, had to stop twice on the way up.",
        question:
          "Statement: The speaker found Mutnovsky hardest because of its height.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "not because of altitude but because of sulphur fumes",
        },
        metadata: { topic: "travel", difficulty: "hard" },
      },
      {
        slug: "ege-tfs-07-drone",
        voice: "echo",
        transcript:
          "A farm outside Samara uses drones to check crop health every morning. Each drone flight takes about twenty minutes and covers roughly thirty hectares. The owners saved almost forty per cent on fertiliser in the first year. They have not yet decided whether to expand the system to irrigation.",
        question:
          "Statement: The farm has already used drones to manage irrigation.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "have not yet decided whether to expand the system to irrigation",
        },
        metadata: { topic: "agriculture", difficulty: "hard" },
      },
      {
        slug: "ege-tfs-08-theatre",
        voice: "shimmer",
        transcript:
          "Our amateur theatre in Perm puts on three productions a year. We rehearse in the basement of a children's library, which is free, but very cold in winter. Last spring our production of The Seagull was invited to a festival in Minsk. Unfortunately, two of our actors had to cancel at the last minute.",
        question:
          "Statement: The theatre performed at a festival in Minsk last spring.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 2,
          evidence:
            "(they were invited, but two actors cancelled \u2014 the text does not say whether the performance went ahead)",
        },
        metadata: { topic: "arts", difficulty: "hard" },
      },
      {
        slug: "ege-tfs-09-school",
        voice: "alloy",
        transcript:
          "At our school we have a rule: no mobile phones during any class. Students may keep them in their bags, but the phones have to stay off. Teachers who break the rule get warned twice. After the third warning, they are asked to hand in the phone at the start of each lesson.",
        question: "Statement: Teachers are punished more strictly than students for using phones in class.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 2,
          evidence:
            "(the text describes the teacher rule, but does not describe any punishment for students at all)",
        },
        metadata: { topic: "education", difficulty: "hard" },
      },
      {
        slug: "ege-tfs-10-weather",
        voice: "nova",
        transcript:
          "Our family spent the whole of August in a village in Karelia. There was no mobile coverage at all, but the lake was beautiful. We went fishing almost every morning. The weather was mostly sunny \u2014 it rained properly only twice, and both times at night.",
        question:
          "Statement: The village had no mobile phone coverage in August.",
        answer: {
          type: "listening_mc",
          options: ["True", "False", "Not stated"],
          answer: 0,
          evidence: "There was no mobile coverage at all",
        },
        metadata: { topic: "travel", difficulty: "easy" },
      },
    ],
    mc_detail: [
      {
        slug: "ege-mc-01-architect",
        voice: "onyx",
        transcript:
          "Interviewer: So you trained as an architect but now work as a baker? Speaker: Yes, and people always ask me why. Honestly, after eight years of drawing other people's buildings, I wanted to make something that lasts a day but makes people happy immediately. A loaf of sourdough does that. A block of flats, frankly, does not.",
        question: "Why did the speaker change career?",
        answer: {
          type: "listening_mc",
          options: [
            "Architecture did not pay enough money.",
            "She wanted work that gave immediate satisfaction.",
            "She was dismissed from her architectural firm.",
            "Her parents owned an existing bakery.",
          ],
          answer: 1,
          evidence: "I wanted to make something that lasts a day but makes people happy immediately",
        },
        metadata: { topic: "careers", difficulty: "medium" },
      },
      {
        slug: "ege-mc-02-railway",
        voice: "echo",
        transcript:
          "Host: Tell us about the new Moscow-Kazan high-speed line. Guest: Construction began in twenty twenty-two, and the first section opened last month. Journey time is now three hours and forty minutes, which is almost half of what it used to be. Fares, however, have stayed surprisingly similar to the old route.",
        question: "What is surprising about the new high-speed line?",
        answer: {
          type: "listening_mc",
          options: [
            "The journey time has doubled.",
            "The fares have stayed similar despite the speed increase.",
            "Construction took less than one year.",
            "Only tourists are allowed to use it.",
          ],
          answer: 1,
          evidence: "Fares, however, have stayed surprisingly similar",
        },
        metadata: { topic: "transport", difficulty: "medium" },
      },
      {
        slug: "ege-mc-03-coral",
        voice: "shimmer",
        transcript:
          "Scientist: Our lab has been growing coral fragments in saltwater tanks for five years. We transplant them to a damaged reef every summer. Last year only about seventy per cent of the transplants survived. That sounds low, but honestly it is better than we ever expected.",
        question:
          "How does the scientist feel about last year's seventy-per-cent survival rate?",
        answer: {
          type: "listening_mc",
          options: [
            "She considers the result very disappointing.",
            "She feels it is a much better outcome than expected.",
            "She believes the rate should reach one hundred per cent.",
            "She thinks it is too early to say anything.",
          ],
          answer: 1,
          evidence: "honestly it is better than we ever expected",
        },
        metadata: { topic: "ecology", difficulty: "medium" },
      },
      {
        slug: "ege-mc-04-ballet",
        voice: "alloy",
        transcript:
          "Dancer: I joined the Bolshoi company at twenty-two, which is late by ballet standards. Most of my colleagues started auditioning at seventeen or eighteen. I spent those years training in Kazan, working full hours and saving money for the move. It was not the classic path, but it gave me a calm head by the time I arrived.",
        question: "What does the speaker say about joining the Bolshoi at twenty-two?",
        answer: {
          type: "listening_mc",
          options: [
            "It was unusually late but gave her emotional stability.",
            "It was earlier than most of her colleagues.",
            "It was the normal age for ballet auditions.",
            "It was forced upon her by her parents.",
          ],
          answer: 0,
          evidence: "it gave me a calm head by the time I arrived",
        },
        metadata: { topic: "arts", difficulty: "hard" },
      },
      {
        slug: "ege-mc-05-insurance",
        voice: "onyx",
        transcript:
          "Consultant: The biggest mistake small businesses make with insurance is waiting until after a burglary or fire. By then, your premiums become much more expensive. You may even be refused cover entirely. My advice is simple \u2014 get a basic policy on the first day you sign the lease.",
        question: "What does the consultant recommend?",
        answer: {
          type: "listening_mc",
          options: [
            "Waiting until a burglary has already occurred.",
            "Getting a basic insurance policy from the very start.",
            "Refusing all insurance altogether.",
            "Switching insurance provider every year.",
          ],
          answer: 1,
          evidence: "get a basic policy on the first day you sign the lease",
        },
        metadata: { topic: "business", difficulty: "medium" },
      },
      {
        slug: "ege-mc-06-whale",
        voice: "shimmer",
        transcript:
          "Researcher: We tagged twelve grey whales in the Sea of Okhotsk last August. All of them have now travelled over six thousand kilometres along the Pacific coast. The real surprise is that two of them turned back north in December, instead of continuing south as every previous study predicted.",
        question: "What surprised the researcher?",
        answer: {
          type: "listening_mc",
          options: [
            "The whales travelled very slowly.",
            "Two of the whales turned back north instead of going south.",
            "All twelve whales died before reaching warmer waters.",
            "The tags stopped working in November.",
          ],
          answer: 1,
          evidence: "two of them turned back north in December",
        },
        metadata: { topic: "science", difficulty: "hard" },
      },
      {
        slug: "ege-mc-07-fashion",
        voice: "nova",
        transcript:
          "Designer: My new collection uses only recycled fabric. People imagine recycled clothes look rough, but modern technology allows very smooth textures now. The hardest part isn't the material \u2014 it's convincing retail buyers that customers will pay full price for something not made of fresh fibre.",
        question: "According to the designer, what is the hardest part of her work?",
        answer: {
          type: "listening_mc",
          options: [
            "Finding recycled fabric that is smooth enough.",
            "Persuading retail buyers that customers accept it.",
            "Keeping production costs below those of competitors.",
            "Training new staff in her workshop.",
          ],
          answer: 1,
          evidence: "convincing retail buyers that customers will pay full price",
        },
        metadata: { topic: "fashion", difficulty: "hard" },
      },
      {
        slug: "ege-mc-08-doctor",
        voice: "echo",
        transcript:
          "Doctor: Family practice in rural areas is different from city work. You see the same patients for decades. You know their children, their parents, sometimes their grandparents. The medical decisions are often easier than in a city clinic, but the emotional weight is much heavier.",
        question: "What does the doctor say about rural family practice?",
        answer: {
          type: "listening_mc",
          options: [
            "The medical decisions are technically more demanding.",
            "The emotional load is heavier than in a city clinic.",
            "Doctors rarely see the same patient twice.",
            "It is impossible to build long-term trust.",
          ],
          answer: 1,
          evidence: "the emotional weight is much heavier",
        },
        metadata: { topic: "health", difficulty: "hard" },
      },
      {
        slug: "ege-mc-09-chess",
        voice: "alloy",
        transcript:
          "Coach: The biggest change in children's chess over the last ten years has not been stronger players, but faster ones. Young students now solve tactical puzzles in half the time I used to need. Whether this produces better long-term thinkers, however, remains an open question.",
        question: "What is the coach uncertain about?",
        answer: {
          type: "listening_mc",
          options: [
            "Whether modern children enjoy chess.",
            "Whether faster tactical solving leads to better long-term thinking.",
            "Whether chess puzzles are becoming easier.",
            "Whether children will continue to play chess.",
          ],
          answer: 1,
          evidence: "Whether this produces better long-term thinkers \u2026 remains an open question",
        },
        metadata: { topic: "education", difficulty: "hard" },
      },
      {
        slug: "ege-mc-10-chef",
        voice: "onyx",
        transcript:
          "Chef: We opened our restaurant during the pandemic. It was terrible timing, obviously, and we almost closed after three months. The reason we survived is simple \u2014 our suppliers were neighbours, not giant chains, and they gave us credit when no bank would. I still buy from every single one of them today.",
        question: "Why did the chef's restaurant survive?",
        answer: {
          type: "listening_mc",
          options: [
            "The government paid for all of their food.",
            "Local suppliers gave them credit when banks would not.",
            "They switched to delivery-only from the start.",
            "They sold the restaurant to another owner.",
          ],
          answer: 1,
          evidence: "they gave us credit when no bank would",
        },
        metadata: { topic: "business", difficulty: "medium" },
      },
    ],
  },
  oge_en: {
    matching_speakers: [
      {
        slug: "oge-ms-01-anna-football",
        voice: "nova",
        transcript:
          "I play football every Saturday with my friends from school. Last month our team won the district tournament for the first time. We don't have a coach, we just practise together in the park.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker's team has a professional coach.",
            "The speaker's team won a local tournament recently.",
            "The speaker prefers football to all other sports.",
          ],
          answer: 1,
          evidence: "our team won the district tournament for the first time",
        },
        metadata: { topic: "sport", difficulty: "easy" },
      },
      {
        slug: "oge-ms-02-oleg-pets",
        voice: "onyx",
        transcript:
          "I have a cat called Barsik. He is six years old. He is afraid of dogs but loves watching birds through the window. My sister is allergic to him, so she visits our grandmother instead of us.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "Barsik is a very young kitten.",
            "Oleg's sister is allergic to his cat.",
            "Barsik likes playing with other dogs.",
          ],
          answer: 1,
          evidence: "My sister is allergic to him",
        },
        metadata: { topic: "family", difficulty: "easy" },
      },
      {
        slug: "oge-ms-03-lena-school",
        voice: "shimmer",
        transcript:
          "My favourite subject at school is history, because our teacher tells real stories instead of reading from the book. My least favourite is PE \u2014 I'm always the slowest runner in my class. Luckily, PE is only twice a week.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker likes history best and struggles with PE.",
            "The speaker dislikes history because of the boring teacher.",
            "The speaker is the fastest runner in the class.",
          ],
          answer: 0,
          evidence:
            "My favourite subject at school is history \u2026 My least favourite is PE",
        },
        metadata: { topic: "school", difficulty: "easy" },
      },
      {
        slug: "oge-ms-04-dima-music",
        voice: "echo",
        transcript:
          "I started playing the guitar a year ago, just because my older brother has one. At first I was terrible, but now I can play five or six songs quite well. I mostly play for myself at home.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker has played guitar since childhood.",
            "The speaker learned to play to copy his brother.",
            "The speaker plays the guitar in a famous band.",
          ],
          answer: 1,
          evidence: "just because my older brother has one",
        },
        metadata: { topic: "music", difficulty: "easy" },
      },
      {
        slug: "oge-ms-05-tanya-cooking",
        voice: "nova",
        transcript:
          "My mum taught me to make pelmeni last winter. The first time I made them, half of them fell apart in the water. Now I can make them perfectly, and my little brother is my biggest fan \u2014 he eats ten at a time.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "Tanya learned to cook pelmeni from a cookbook.",
            "Tanya now makes pelmeni very well.",
            "Tanya's brother dislikes her pelmeni.",
          ],
          answer: 1,
          evidence: "Now I can make them perfectly",
        },
        metadata: { topic: "food", difficulty: "easy" },
      },
      {
        slug: "oge-ms-06-ivan-train",
        voice: "onyx",
        transcript:
          "I love travelling by train. You can watch the countryside go by, read a book, or simply talk to strangers. Planes are much faster, but I always feel tired when I get off. On a train, I arrive feeling calm.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker prefers planes to trains.",
            "The speaker finds train travel more pleasant than flying.",
            "The speaker has never travelled alone.",
          ],
          answer: 1,
          evidence: "On a train, I arrive feeling calm",
        },
        metadata: { topic: "travel", difficulty: "easy" },
      },
      {
        slug: "oge-ms-07-kate-birthday",
        voice: "shimmer",
        transcript:
          "For my birthday this year, I didn't want a big party. I went to a concert with three close friends instead. My mum was a bit disappointed, but I think smaller celebrations are better when you're my age.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker had a big birthday party this year.",
            "The speaker preferred a small celebration this year.",
            "The speaker's friends forgot her birthday.",
          ],
          answer: 1,
          evidence: "I didn't want a big party",
        },
        metadata: { topic: "family", difficulty: "easy" },
      },
      {
        slug: "oge-ms-08-sam-weather",
        voice: "echo",
        transcript:
          "This winter has been the coldest I remember. In my city we had minus thirty degrees for almost a week. Luckily, our school closed on the coldest days, so we stayed at home and played board games with the family.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The winter was unusually warm.",
            "School was cancelled during the coldest days.",
            "The speaker was ill throughout the cold week.",
          ],
          answer: 1,
          evidence: "our school closed on the coldest days",
        },
        metadata: { topic: "weather", difficulty: "easy" },
      },
      {
        slug: "oge-ms-09-mira-reading",
        voice: "nova",
        transcript:
          "I read about one book a week. My favourite genre is detective stories because they make you think. My friends mostly watch series on their phones instead. I don't mind \u2014 everyone relaxes in their own way.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker reads slowly and rarely finishes books.",
            "The speaker prefers detective novels to other genres.",
            "The speaker's friends read more than she does.",
          ],
          answer: 1,
          evidence: "My favourite genre is detective stories",
        },
        metadata: { topic: "reading", difficulty: "easy" },
      },
      {
        slug: "oge-ms-10-leo-tennis",
        voice: "onyx",
        transcript:
          "I play tennis four times a week at our local club. The coach is strict but fair \u2014 he notices every small mistake. My goal this year is to win a match against my older cousin, who has been playing for eight years.",
        question: "Какое утверждение отражает слова говорящего?",
        answer: {
          type: "listening_mc",
          options: [
            "The speaker only plays tennis for fun, with no goals.",
            "The speaker wants to beat his more experienced cousin this year.",
            "The speaker's coach ignores minor mistakes.",
          ],
          answer: 1,
          evidence:
            "My goal this year is to win a match against my older cousin",
        },
        metadata: { topic: "sport", difficulty: "easy" },
      },
    ],
    mc_detail: [
      {
        slug: "oge-mc-01-park",
        voice: "shimmer",
        transcript:
          "Announcer: Welcome to Central Park. The park opens at eight in the morning and closes at ten in the evening. Dogs are allowed, but only on a lead. Please do not feed the ducks at the main pond \u2014 bread makes them ill.",
        question: "What does the announcer say about dogs?",
        answer: {
          type: "listening_mc",
          options: [
            "Dogs are not allowed in the park at all.",
            "Dogs are allowed only if they are on a lead.",
            "Dogs can run freely in the park.",
            "Only small dogs are allowed.",
          ],
          answer: 1,
          evidence: "Dogs are allowed, but only on a lead",
        },
        metadata: { topic: "community", difficulty: "easy" },
      },
      {
        slug: "oge-mc-02-shop",
        voice: "alloy",
        transcript:
          "Cashier: Our shop is open every day except Monday. On Tuesdays we close at six instead of nine, because of staff meetings. On Saturdays and Sundays we are open from ten until eight. We accept only card payments \u2014 no cash.",
        question: "On which day is the shop closed?",
        answer: {
          type: "listening_mc",
          options: ["Sunday", "Monday", "Tuesday", "Saturday"],
          answer: 1,
          evidence: "our shop is open every day except Monday",
        },
        metadata: { topic: "community", difficulty: "easy" },
      },
      {
        slug: "oge-mc-03-interview",
        voice: "echo",
        transcript:
          "Girl: My name is Nina. I'm fourteen. I live in Tyumen with my parents and my younger sister. My hobbies are swimming and drawing. At school I like English best because I want to be a journalist one day.",
        question: "Why does Nina like English best at school?",
        answer: {
          type: "listening_mc",
          options: [
            "Because her parents are English teachers.",
            "Because she wants to become a journalist.",
            "Because English is the easiest subject.",
            "Because her sister helps her with it.",
          ],
          answer: 1,
          evidence: "I want to be a journalist one day",
        },
        metadata: { topic: "school", difficulty: "easy" },
      },
      {
        slug: "oge-mc-04-museum",
        voice: "shimmer",
        transcript:
          "Guide: Welcome to the Natural History Museum. Our most popular exhibit is the mammoth skeleton on the first floor. Photography is allowed everywhere except in the fossil room, where flashes might damage the specimens. The cafe on the ground floor closes at four o'clock.",
        question: "Where is photography not allowed?",
        answer: {
          type: "listening_mc",
          options: [
            "In the main entrance.",
            "In the cafe on the ground floor.",
            "In the fossil room.",
            "On the first floor near the mammoth.",
          ],
          answer: 2,
          evidence:
            "Photography is allowed everywhere except in the fossil room",
        },
        metadata: { topic: "culture", difficulty: "easy" },
      },
      {
        slug: "oge-mc-05-weather",
        voice: "nova",
        transcript:
          "Forecaster: Tomorrow in Moscow will be cloudy with some snow in the morning. The temperature will drop to minus eight in the afternoon. Strong wind is expected from the north. We do not expect any rain until the weekend.",
        question: "What will the weather be in Moscow tomorrow?",
        answer: {
          type: "listening_mc",
          options: [
            "Sunny and warm all day.",
            "Cloudy with morning snow.",
            "Heavy rain all afternoon.",
            "Thunderstorms in the evening.",
          ],
          answer: 1,
          evidence: "Tomorrow in Moscow will be cloudy with some snow in the morning",
        },
        metadata: { topic: "weather", difficulty: "easy" },
      },
      {
        slug: "oge-mc-06-train",
        voice: "onyx",
        transcript:
          "Conductor: Ladies and gentlemen, the next station is Tula. The train will stop for five minutes only. Please do not leave the platform. The restaurant car is at the front of the train, between cars three and four.",
        question: "How long will the train stop at Tula?",
        answer: {
          type: "listening_mc",
          options: ["Two minutes", "Five minutes", "Ten minutes", "Twenty minutes"],
          answer: 1,
          evidence: "The train will stop for five minutes only",
        },
        metadata: { topic: "travel", difficulty: "easy" },
      },
      {
        slug: "oge-mc-07-club",
        voice: "echo",
        transcript:
          "Teacher: Our drama club meets every Wednesday after classes. We need about ten new members this year. You don't need any previous experience \u2014 we teach everyone from the start. The most important thing is that you come regularly.",
        question: "What does the teacher say is most important?",
        answer: {
          type: "listening_mc",
          options: [
            "Having previous acting experience.",
            "Coming to meetings regularly.",
            "Being the best actor in the school.",
            "Paying a membership fee each month.",
          ],
          answer: 1,
          evidence: "The most important thing is that you come regularly",
        },
        metadata: { topic: "school", difficulty: "easy" },
      },
      {
        slug: "oge-mc-08-library",
        voice: "shimmer",
        transcript:
          "Librarian: You can borrow up to five books at a time. You keep each book for two weeks, and after that you must either return it or extend the loan online. If you lose a book, you pay its full price. We do not charge any late fees.",
        question: "What happens if you return a book late?",
        answer: {
          type: "listening_mc",
          options: [
            "You pay a small fee for each day.",
            "You pay the full price of the book.",
            "You cannot borrow books again.",
            "Nothing \u2014 there are no late fees.",
          ],
          answer: 3,
          evidence: "We do not charge any late fees",
        },
        metadata: { topic: "community", difficulty: "medium" },
      },
      {
        slug: "oge-mc-09-trip",
        voice: "alloy",
        transcript:
          "Teacher: Our class trip to Suzdal will be on Friday. The bus leaves at seven in the morning from the main school entrance. Please bring lunch with you \u2014 the cafe in the museum is too small for forty students. You must return the signed permission slip by Wednesday.",
        question: "By when must the signed permission slip be returned?",
        answer: {
          type: "listening_mc",
          options: ["Monday", "Tuesday", "Wednesday", "Friday"],
          answer: 2,
          evidence:
            "You must return the signed permission slip by Wednesday",
        },
        metadata: { topic: "school", difficulty: "easy" },
      },
      {
        slug: "oge-mc-10-hotel",
        voice: "nova",
        transcript:
          "Receptionist: Breakfast is served between seven and ten. Your room key works for the lift and the swimming pool on floor minus one. The spa is extra and costs two hundred roubles per visit. Check-out time is eleven in the morning.",
        question: "How much does using the spa cost?",
        answer: {
          type: "listening_mc",
          options: [
            "It is free with the room.",
            "Two hundred roubles per visit.",
            "Only guests under sixteen pay.",
            "It depends on the time of day.",
          ],
          answer: 1,
          evidence: "The spa is extra and costs two hundred roubles per visit",
        },
        metadata: { topic: "travel", difficulty: "medium" },
      },
    ],
  },
  // IELTS Listening descriptors and items will land in the IELTS bank PR.
  ielts: {},
};

function transcriptHash(transcript: string): string {
  return createHash("sha1").update(transcript).digest("hex").slice(0, 16);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }

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
            eq(sections.kind, "listening"),
          ),
        )
        .limit(1);
      if (!section) {
        console.warn(
          `[skip] ${examCode} — no listening section; run \`pnpm db:seed\` first.`,
        );
        continue;
      }

      const descriptors = getListeningDescriptors(examCode);
      for (const descriptor of descriptors) {
        const seedItems = SEED[examCode]?.[descriptor.format];
        if (!seedItems) continue;

        const templateCode = listeningTaskTemplateCode(
          examCode,
          descriptor.codeSuffix,
        );
        const taskNumber = listeningTaskNumberFor(descriptor.codeSuffix);

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
            .set({
              taskNumber,
              title: `${descriptor.displayName} (№${descriptor.fipiTaskRange})`,
              instructions: descriptor.shortDescription,
              rubric: { correct: 1, incorrect: 0 },
              maxScore: 1,
              config: {
                format: descriptor.format,
                maxPlays: 2,
              },
            })
            .where(eq(taskTemplates.id, templateId));
        } else {
          const [inserted] = await d
            .insert(taskTemplates)
            .values({
              sectionId: section.id,
              taskNumber,
              code: templateCode,
              title: `${descriptor.displayName} (№${descriptor.fipiTaskRange})`,
              instructions: descriptor.shortDescription,
              rubric: { correct: 1, incorrect: 0 },
              maxScore: 1,
              config: {
                format: descriptor.format,
                maxPlays: 2,
              },
            })
            .returning({ id: taskTemplates.id });
          templateId = inserted.id;
        }

        let inserts = 0;
        for (const seed of seedItems) {
          const hash = transcriptHash(seed.transcript);
          const dup = await d
            .select({ id: items.id })
            .from(items)
            .where(
              and(
                eq(items.taskTemplateId, templateId),
                eq(items.stimulusText, seed.question),
                sql`${items.assets}->>'hash' = ${hash}`,
              ),
            )
            .limit(1);
          if (dup.length > 0) continue;

          await d.insert(items).values({
            taskTemplateId: templateId,
            source: "user_authored",
            stimulusText: seed.question,
            stimulusAudioUrl: `/audio/listening/${seed.slug}.mp3`,
            assets: {
              transcript: seed.transcript,
              voice: seed.voice,
              hash,
            },
            correctAnswers: seed.answer,
            metadata: seed.metadata ?? null,
          });
          inserts += 1;
        }
        console.log(
          `✓ ${examCode}.listening.${descriptor.codeSuffix}: template upserted, +${inserts} new items (${seedItems.length} in bank).`,
        );
      }
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

function listeningTaskNumberFor(codeSuffix: string): number | null {
  switch (codeSuffix) {
    case "matching_speakers":
      return 1;
    case "true_false_stated":
      return 2;
    case "mc_detail":
      return 3;
    default:
      return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
