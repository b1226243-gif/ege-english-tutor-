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
      {
        passage:
          "When the beehives on the roof of a Paris office block were installed in 2019, the building's staff thought of them as a curiosity. Three harvests later they have become a quiet competitive advantage. The honey — bitter from plane-tree pollen, slightly salty from the Seine — is sold in a corporate shop whose profits fund a beekeeping course for schoolchildren in the outer suburbs. The company has started receiving CVs specifically from candidates who mention the course in their cover letters.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "The dangers of urban beekeeping",
            "How rooftop honey became a recruiting tool",
            "A Paris company's financial troubles",
            "Why city honey tastes different from rural honey",
          ],
          answer: 1,
          evidence:
            "profits fund a beekeeping course for schoolchildren … candidates who mention the course in their cover letters",
        },
        metadata: { topic: "urban_ecology", difficulty: "medium" },
      },
      {
        passage:
          "A stretch of the Scottish Highlands that had been managed as a sporting estate for almost two centuries was bought by a charity in 2021. The sheep and red deer that had been kept in artificially high numbers were removed, and within eighteen months small birch and rowan seedlings began pushing through the heather. By year three, salmon had returned to a river that had been nearly empty since the 1990s. The charity admits it is too early to call the project a success; most rewilding efforts, it notes, only show clear results after a decade.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "How deer populations recovered in Scotland",
            "An early look at a Highlands rewilding project",
            "The business case for sporting estates",
            "Why salmon numbers are falling worldwide",
          ],
          answer: 1,
          evidence:
            "small birch and rowan seedlings began pushing through the heather … too early to call the project a success",
        },
        metadata: { topic: "ecology", difficulty: "medium" },
      },
      {
        passage:
          "At seventy-four, Carlos Fuentes should be enjoying retirement. Instead, the former television actor spends three afternoons a week inside a high-security prison in Valencia, running a theatre workshop for inmates. The group has staged four plays in two years, always to an audience of prison staff and, once a year, the inmates' families. Carlos does not get paid, but he receives a handwritten letter from each participant when they are released. \"I have a drawer full of them at home,\" he says, \"and that is enough.\"",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "The hardest roles a Spanish actor ever played",
            "A retired actor running free drama workshops in prison",
            "The rising cost of Spanish theatre tickets",
            "Why amateur theatre is disappearing in Europe",
          ],
          answer: 1,
          evidence:
            "the former television actor spends three afternoons a week inside a high-security prison … running a theatre workshop for inmates",
        },
        metadata: { topic: "community_arts", difficulty: "medium" },
      },
      {
        passage:
          "The tiny-home village outside Helsinki houses forty people who were homeless a year ago. Each cabin is twenty square metres, costs the city about a third of the price of a hostel bed, and comes with its own front door. Residents sign a standard lease and pay rent once they find work; those who do not still keep their cabin. Early critics warned the project would attract trouble. Two years on, the local police station reports that calls from the area have fallen by almost a third since the village opened.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "A Helsinki tiny-home village that beats the critics",
            "The high rental prices in Finland's capital",
            "How to design a small house for one person",
            "Why police stations are closing across Europe",
          ],
          answer: 0,
          evidence:
            "calls from the area have fallen by almost a third since the village opened",
        },
        metadata: { topic: "social_housing", difficulty: "medium" },
      },
      {
        passage:
          "Manned submersibles used to dive to 6,000 metres and come back with a handful of grainy photos. The new generation, tested last spring off the coast of Okinawa, carries eight high-resolution cameras and a robotic arm delicate enough to collect a single snail from the sea floor. What is striking is not the technology itself, but the fact that the data now surfaces in near-real time: a research vessel streams video and telemetry to schoolrooms across Asia the moment the submersible reaches depth.",
        question: "Which heading best matches the paragraph?",
        answer: {
          type: "reading_mc",
          options: [
            "Deep-sea exploration in the classroom next door",
            "The fastest submersibles ever built",
            "Why scientists now prefer robots to divers",
            "How to catch snails on the ocean floor",
          ],
          answer: 0,
          evidence:
            "streams video and telemetry to schoolrooms across Asia the moment the submersible reaches depth",
        },
        metadata: { topic: "science_education", difficulty: "hard" },
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
      {
        passage:
          "A recycling plant in Rotterdam has begun to sort plastic bottles using computer vision. The robots identify each bottle's polymer type from its reflection under a bright lamp, then push it into one of six bins. The system works remarkably well — until the sun goes down. After dark, the hall lights are apparently not bright or stable enough for the cameras, and the machines start making mistakes. The plant runs a night shift of human sorters because ___.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "the robots are too expensive to operate at night",
            "the vision system becomes unreliable in low light",
            "workers prefer to sort plastic after midnight",
            "European law forbids running robots 24 hours",
          ],
          answer: 1,
          evidence:
            "the hall lights are apparently not bright or stable enough for the cameras, and the machines start making mistakes",
        },
        metadata: { topic: "industry_ai", difficulty: "medium" },
      },
      {
        passage:
          "Every spring, a round of cheese is sent rolling down a steep hillside in Gloucestershire. A crowd of runners chases it. The round is far faster than any human, so the rule of the race is simple: whoever reaches the bottom first wins, with or without the cheese. Injuries are common. Local authorities tried to cancel the event in the 2010s, but it had been held unofficially for so long that ___, and the authorities quietly dropped the ban.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "no runners were willing to take part that year",
            "residents simply continued holding it without permission",
            "the government charged each participant a fine",
            "the hillside had been sold to a private developer",
          ],
          answer: 1,
          evidence:
            "it had been held unofficially for so long … the authorities quietly dropped the ban",
        },
        metadata: { topic: "tradition", difficulty: "medium" },
      },
      {
        passage:
          "Copenhagen's new 'smart city' pilot does not rely on cameras or microphones. Instead, bins, lamp-posts and even paving stones carry tiny sensors that measure weight, temperature and moisture. The data is shared openly with anyone who wants it. Transport planners use it to reroute buses around flooded streets, while small businesses have started building niche services — an app, for example, that tells cyclists which routes have the least grit left after winter. City officials say the openness is deliberate because ___.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "citizens had demanded that all data be kept secret",
            "closed sensor networks tend to stagnate once deployed",
            "European law requires that no data ever be published",
            "the pilot had to be cancelled several times before launch",
          ],
          answer: 1,
          evidence:
            "data is shared openly with anyone who wants it … small businesses have started building niche services",
        },
        metadata: { topic: "smart_city", difficulty: "hard" },
      },
      {
        passage:
          "Film stuntmen have always known that their career ends early. Most of them are retired by forty-five, with a collection of injuries and no clear next step. A small training school in Prague has now started offering free transition courses: accounting, film editing, even marine biology. The programme is funded not by film studios, but by insurance companies, ___, who have realised that stable second careers reduce long-term claims.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "who employ most of the former stuntmen themselves",
            "which originally opposed the idea of the school",
            "who cover the stunt performers during their careers",
            "which have been in dispute with the school for years",
          ],
          answer: 2,
          evidence:
            "stable second careers reduce long-term claims",
        },
        metadata: { topic: "careers", difficulty: "medium" },
      },
      {
        passage:
          "At a polytechnic in Kyoto, a lecturer noticed that left-handed students were struggling with the lathe benches in the workshop. The controls were on the right side, in the fifty-year-old position, and the left-handers consistently took longer to complete exercises. Once a few benches were converted — controls moved to the left, tool rests mirrored — the gap in finishing times disappeared within a term. The lecturer now argues that ___ rather than a fixed feature of left-handed learners.",
        question: "Which phrase fits the gap best?",
        answer: {
          type: "reading_mc",
          options: [
            "left-handers are simply slower on any machine",
            "the workshop should stop admitting left-handed students",
            "the original gap reflects the tool design",
            "left-handed students need additional private tuition",
          ],
          answer: 2,
          evidence:
            "Once a few benches were converted … the gap in finishing times disappeared within a term",
        },
        metadata: { topic: "education_research", difficulty: "hard" },
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
      {
        passage:
          "The European weather service has started running its three-day forecasts on a machine-learning model trained on forty years of observations. Traditional models solve the physics of the atmosphere equation by equation; the new one looks for patterns in past weather and estimates what is likely to happen next. In the first year of use, the AI model beat the traditional one on precipitation for city-sized regions but lost to it on wind at high altitude. Engineers now run both and combine the results, rather than choosing a winner.",
        question:
          "According to the passage, how does the weather service use the AI model in its forecasts?",
        answer: {
          type: "reading_mc",
          options: [
            "It has fully replaced the traditional physics-based model.",
            "It is used only for forecasts more than a week ahead.",
            "It is combined with the traditional model rather than used alone.",
            "It has been abandoned after the first year of use.",
          ],
          answer: 2,
          evidence:
            "Engineers now run both and combine the results, rather than choosing a winner",
        },
        metadata: { topic: "science_ai", difficulty: "medium" },
      },
      {
        passage:
          "Sanjay Kumar, a retired post office clerk from Jaipur, can recite the first ten thousand digits of pi without hesitation. He learned the digits in his forties, while waiting in line at the post office on boring days. Once he began memorising, he said, he could not stop. Memory scientists who have tested him say he uses no special technique — no visualisation, no rhyme, no story. He simply reads the digits once, slowly, and they stay. In this respect, they add, he is genuinely unusual.",
        question: "What is unusual about Sanjay's memory, according to the scientists?",
        answer: {
          type: "reading_mc",
          options: [
            "He uses a well-known visualisation technique.",
            "He remembers numbers only if he writes them down.",
            "He does not use any special memorisation method.",
            "He only memorises digits related to his old job.",
          ],
          answer: 2,
          evidence:
            "he uses no special technique — no visualisation, no rhyme, no story",
        },
        metadata: { topic: "memory", difficulty: "easy" },
      },
      {
        passage:
          "A community garden in Berlin's Neukölln district runs on a single rule: no fences between plots. Any member may plant anything anywhere, and any member may harvest from any plot, provided they leave at least half of what is ripe. When the garden was founded in 2014, volunteers expected arguments over tomatoes. In practice, the main disagreement has been about paths — specifically, about whether to lay stepping stones or let walkers wear paths into the soil. Members voted for stepping stones only two years ago, by one vote.",
        question: "What has been the main source of disagreement among garden members?",
        answer: {
          type: "reading_mc",
          options: [
            "Who is allowed to pick the ripe tomatoes.",
            "Whether to install a fence around the whole garden.",
            "Whether to lay stepping stones on the paths.",
            "How much rent each member should pay.",
          ],
          answer: 2,
          evidence:
            "the main disagreement has been about paths … whether to lay stepping stones or let walkers wear paths into the soil",
        },
        metadata: { topic: "community", difficulty: "easy" },
      },
      {
        passage:
          "The saguaro cactus, the tall green landmark of the Sonoran Desert, spends its first eight years entirely underground, putting all its growth into a root system. Only when the roots reach a certain depth does the plant allow itself a single stem above ground. By the time a saguaro is as tall as an adult human, it is usually between sixty and seventy years old. Climate scientists are now worried: seedlings are still appearing, but far fewer of them survive the extra dry summers the region has seen since 2015.",
        question: "Why are climate scientists concerned about the saguaro cactus?",
        answer: {
          type: "reading_mc",
          options: [
            "Its flowers have stopped opening during the day.",
            "Fewer seedlings are surviving the drier summers.",
            "The roots have started growing above the ground.",
            "Wild animals are eating all the adult plants.",
          ],
          answer: 1,
          evidence:
            "far fewer of them survive the extra dry summers the region has seen since 2015",
        },
        metadata: { topic: "ecology", difficulty: "medium" },
      },
      {
        passage:
          "A rural broadband project in west Wales had to choose between two technologies: fibre cables laid under the roads, and wireless antennas on church spires. The local council expected costs to decide the question. In the end, the fact that the wireless option would have required permissions from seventeen different parishes tipped the balance. The fibre cables, though slower to install, ran along a single road owned by the council itself. Service went live eighteen months later.",
        question: "Why did the council choose fibre cables in the end?",
        answer: {
          type: "reading_mc",
          options: [
            "Fibre cables were far cheaper than wireless antennas.",
            "The council already owned the road where cables would run.",
            "Wireless antennas were banned in Welsh villages.",
            "Parishes refused to accept any broadband at all.",
          ],
          answer: 1,
          evidence:
            "the fibre cables … ran along a single road owned by the council itself",
        },
        metadata: { topic: "infrastructure", difficulty: "medium" },
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
      {
        passage:
          "Last winter I found a small grey cat near the supermarket. He was very thin and his ear was hurt. I took him home and called him Misha. My parents said we could keep him if he behaved well. Now Misha sleeps on my bed every night and plays with my little brother. The vet says he is about two years old and perfectly healthy.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "Why cats are better pets than dogs",
            "How I saved a stray cat called Misha",
            "A visit to the local supermarket",
            "My little brother's favourite toys",
          ],
          answer: 1,
          evidence:
            "I found a small grey cat near the supermarket … Now Misha sleeps on my bed every night",
        },
        metadata: { topic: "pets", difficulty: "easy" },
      },
      {
        passage:
          "My mother has always been afraid of bicycles. When she was a child, she fell from one and broke her arm. This summer, at the age of forty, she finally decided to try again. My father and I went with her to a quiet park every Sunday. After five weeks she could already ride without help. Now she says cycling is her favourite way to relax.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "My mother learned to ride a bike at last",
            "Why children often break their arms",
            "The best cycling parks in the city",
            "A difficult summer for my father",
          ],
          answer: 0,
          evidence:
            "at the age of forty, she finally decided to try again … After five weeks she could already ride without help",
        },
        metadata: { topic: "family", difficulty: "easy" },
      },
      {
        passage:
          "My grandmother turned seventy-five last weekend. We decided to surprise her with a party at home. My aunt baked a huge cake with walnuts, my cousin Masha drew a card, and I played the piano for the guests. When grandma came in from the garden and saw everyone, she cried a little. She said it was the best birthday of her life.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "How I learned to play the piano",
            "A surprise birthday party for grandma",
            "My aunt's most famous recipes",
            "The long history of our family garden",
          ],
          answer: 1,
          evidence:
            "We decided to surprise her with a party at home … it was the best birthday of her life",
        },
        metadata: { topic: "family", difficulty: "easy" },
      },
      {
        passage:
          "We bought a robot vacuum cleaner in May. At first our dog, Rex, was terrified of it and hid under the sofa every time it turned on. After about two weeks, Rex began following the robot around the flat. Now he waits by its charging station every morning, and when it starts working, he walks behind it like a curious detective.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "Why modern flats are so easy to clean",
            "How our dog became friends with a robot",
            "The best vacuum cleaners you can buy",
            "Training a puppy in five easy steps",
          ],
          answer: 1,
          evidence:
            "Rex began following the robot around the flat … walks behind it like a curious detective",
        },
        metadata: { topic: "home_tech", difficulty: "easy" },
      },
      {
        passage:
          "On Saturday our class went to the new planetarium downtown. The show was about the planets of our solar system. I liked Saturn most, because of its famous rings. Our teacher said that each ring is made of tiny pieces of ice and rock. After the show we walked around the exhibition, where you can touch a real meteorite. It felt heavier than I expected.",
        question: "Which heading matches the text best?",
        answer: {
          type: "reading_mc",
          options: [
            "Our class trip to the planetarium",
            "How to become an astronaut",
            "The biggest meteorite ever found",
            "My teacher's favourite hobby",
          ],
          answer: 0,
          evidence:
            "On Saturday our class went to the new planetarium downtown",
        },
        metadata: { topic: "school_trip", difficulty: "easy" },
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
      {
        passage:
          "Pavel is a ten-year-old chess player from Yekaterinburg. He started playing at the age of six, when his older brother taught him the rules. Last year Pavel came second in a regional tournament for children under twelve. His coach believes that Pavel could become a candidate master before he finishes school. At home, Pavel plays more often with his father than with his brother.",
        question:
          "Statement: Pavel won the regional tournament for children under twelve.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence:
            "Pavel came second in a regional tournament for children under twelve",
        },
        metadata: { topic: "sport", difficulty: "easy" },
      },
      {
        passage:
          "The new sports hall at our school opened in September. It has two basketball courts, a climbing wall and a small fitness room. Classes for younger children take place in the mornings; senior students use the hall in the afternoons. Any student can reserve the climbing wall online, but only with a teacher present. The fitness room is closed at weekends.",
        question:
          "Statement: Students can use the climbing wall without a teacher being there.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence:
            "Any student can reserve the climbing wall online, but only with a teacher present",
        },
        metadata: { topic: "school", difficulty: "easy" },
      },
      {
        passage:
          "Sasha is fifteen and volunteers at the local animal shelter every Saturday. She helps to feed the dogs and clean their enclosures. She started after her family adopted a dog from the shelter last year. Sasha would like to become a vet one day, but her parents hope she will study medicine instead. Her younger sister does not enjoy helping at the shelter at all.",
        question: "Statement: Sasha adopted a dog from the shelter herself.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence:
            "after her family adopted a dog from the shelter last year",
        },
        metadata: { topic: "community", difficulty: "easy" },
      },
      {
        passage:
          "My dad keeps a small vegetable garden behind our house. He grows tomatoes, cucumbers and sometimes pumpkins. Every summer he tries one new vegetable; last year it was aubergines, which did not do very well. This year he is planning to plant sweetcorn. My mum cooks whatever he brings in from the garden, but she refuses to touch the pumpkins.",
        question:
          "Statement: My dad is planning to grow sweetcorn this year.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 0,
          evidence:
            "This year he is planning to plant sweetcorn",
        },
        metadata: { topic: "family_hobbies", difficulty: "easy" },
      },
      {
        passage:
          "A Sunday morning running group meets in our park every week. Anyone can join — there is no fee and no registration. The leaders are two brothers, both PE teachers at different schools. Most members are over thirty, but teenagers are welcome too. In winter the group sometimes moves to a sports hall because the path in the park becomes icy.",
        question:
          "Statement: You have to pay a monthly fee to join the running group.",
        answer: {
          type: "reading_mc",
          options: ["True", "False", "Not stated"],
          answer: 1,
          evidence: "there is no fee and no registration",
        },
        metadata: { topic: "community_sport", difficulty: "easy" },
      },
    ],
  },
  // IELTS Reading descriptors and items will land in the IELTS bank PR.
  ielts: {},
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
