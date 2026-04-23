import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  pgEnum,
  primaryKey,
  boolean,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/**
 * Drizzle schema for the EGE English Tutor.
 *
 * Domain tables:
 *   users            — application + Auth.js user row.
 *   accounts         — OAuth provider accounts (Auth.js required).
 *   sessions         — database-backed sessions (Auth.js required).
 *   verificationTokens — email magic-link tokens (Auth.js required).
 *   chats            — one conversation (writing session, speaking session, etc.).
 *   messages         — individual turns in a chat.
 *   evaluations      — per-turn FIPI scoring snapshots for analytics.
 *
 * Migrations are generated with `pnpm db:generate` and applied with `pnpm db:migrate`.
 */

// ──────────────────────────── Auth.js tables ────────────────────────────

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
  /** bcrypt hash for the credentials provider. NULL when the user only uses OAuth. */
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// ──────────────────────────── Domain tables ────────────────────────────

export const tutorModuleEnum = pgEnum("tutor_module", [
  "base",
  "writing-37",
  "writing-38",
  "speaking",
]);

export const chats = pgTable("chat", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  module: tutorModuleEnum("module").notNull().default("base"),
  title: text("title"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const messages = pgTable("message", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  /** AI SDK v5+ UIMessage `parts` array (text / tool-call / reasoning). */
  parts: jsonb("parts").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const evaluations = pgTable("evaluation", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  module: tutorModuleEnum("module").notNull(),
  /** Per-criterion scores as JSON, e.g. `{ K1: { score: 2, max: 3 }, ... }`. */
  scores: jsonb("scores").notNull(),
  totalScore: integer("total_score").notNull(),
  maxScore: integer("max_score").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ──────────────────────────── Multi-exam platform (Phase 2) ────────────────────────────
//
// The chat/message/evaluation tables above are the Phase 1 plumbing for the
// Writing & Speaking AI tutor. Phase 2 adds a proper exam/section/task model
// so we can plug in Reading, Listening, Grammar, and full Mock Exams — for
// ОГЭ, ЕГЭ now and IELTS / TOEFL / Cambridge later. Phase 1 tables are kept
// intact for backwards compatibility during the roll-out.

export const examCodeEnum = pgEnum("exam_code", [
  "oge_en",      // ОГЭ, 9 класс
  "ege_en",      // ЕГЭ, 11 класс
  "ielts",       // reserved
  "toefl",       // reserved
  "cambridge",   // reserved
]);

export const sectionKindEnum = pgEnum("section_kind", [
  "listening",
  "reading",
  "grammar",     // Grammar & Vocabulary
  "writing",
  "speaking",
]);

export const taskSourceEnum = pgEnum("task_source", [
  "fipi_demo",
  "ai_generated",
  "user_authored",
]);

export const attemptModeEnum = pgEnum("attempt_mode", [
  "practice",
  "mock_section",
  "mock_full",
]);

export const attemptStatusEnum = pgEnum("attempt_status", [
  "in_progress",
  "completed",
  "abandoned",
]);

/**
 * One row per exam we support. `code` doubles as the URL segment, e.g.
 * `/dashboard/ege_en/writing`. New exams = add to examCodeEnum + insert.
 */
export const exams = pgTable("exam", {
  code: examCodeEnum("code").primaryKey(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  locale: text("locale").notNull().default("ru"),
  isActive: boolean("is_active").notNull().default(true),
});

/**
 * One row per (exam, section_kind). Holds section-level configuration such
 * as total time limit, max score, number of tasks, etc. A "section" is the
 * official FIPI grouping — Listening, Reading, Grammar & Vocabulary, Writing,
 * Speaking.
 */
export const sections = pgTable("section", {
  id: uuid("id").defaultRandom().primaryKey(),
  examCode: examCodeEnum("exam_code")
    .notNull()
    .references(() => exams.code, { onDelete: "cascade" }),
  kind: sectionKindEnum("kind").notNull(),
  orderIdx: integer("order_idx").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  /** Seconds allowed when this section is taken under mock conditions. */
  timeLimitSeconds: integer("time_limit_seconds"),
  /** Maximum raw score for the whole section. */
  maxScore: integer("max_score").notNull(),
  /** Free-form per-section config, e.g. `{ listeningPlayCount: 2 }`. */
  config: jsonb("config"),
});

/**
 * One row per FIPI task number within a section, e.g. "Writing Task 37" for
 * EGE. Holds the rubric definition that both the auto-grader and the AI
 * tutor use.
 */
export const taskTemplates = pgTable("task_template", {
  id: uuid("id").defaultRandom().primaryKey(),
  sectionId: uuid("section_id")
    .notNull()
    .references(() => sections.id, { onDelete: "cascade" }),
  /** FIPI task number, e.g. 37, 38. Nullable for custom practice tasks. */
  taskNumber: integer("task_number"),
  /** Stable slug used in URLs / prompt routing. e.g. "ege_en.writing.t37". */
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  /**
   * Rubric as JSON, e.g. for Writing Task 37:
   *   { K1: { max: 2, label: "Решение коммуникативной задачи" }, ... }
   * or for MC: `{ correct: 1, incorrect: 0 }`.
   */
  rubric: jsonb("rubric").notNull(),
  maxScore: integer("max_score").notNull(),
  /** Per-item time limit in seconds (optional). */
  timeLimitSeconds: integer("time_limit_seconds"),
  /** Free-form config (word limits, question count, etc.). */
  config: jsonb("config"),
});

/**
 * One row per concrete exam item — the actual stimulus a student sees.
 * For Listening this is an audio file + transcript; for Reading an article;
 * for Writing a prompt with questions; for Speaking a picture / card.
 */
export const items = pgTable("item", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskTemplateId: uuid("task_template_id")
    .notNull()
    .references(() => taskTemplates.id, { onDelete: "cascade" }),
  source: taskSourceEnum("source").notNull(),
  /** Markdown stimulus shown to the student. */
  stimulusText: text("stimulus_text"),
  /** Audio URL for Listening items (Vercel Blob / R2 / FIPI CDN). */
  stimulusAudioUrl: text("stimulus_audio_url"),
  /** Auxiliary assets (images, charts, extra audio, transcripts). */
  assets: jsonb("assets"),
  /**
   * Grading key. For MC: `{ answers: ["B", "C", ...] }`. For AI-graded
   * tasks (Writing / Speaking) this is null — the AI tutor does the work.
   */
  correctAnswers: jsonb("correct_answers"),
  /** Topic tags, difficulty, source URL, etc. */
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * One attempt = one logical sitting. Can be a single practice task, a timed
 * section, or a full mock exam.
 */
export const attempts = pgTable("attempt", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  examCode: examCodeEnum("exam_code").notNull(),
  /** Set for `mock_section`; null for other modes. */
  sectionId: uuid("section_id").references(() => sections.id, {
    onDelete: "set null",
  }),
  /** Set for `practice`; null for mock modes. */
  taskTemplateId: uuid("task_template_id").references(() => taskTemplates.id, {
    onDelete: "set null",
  }),
  mode: attemptModeEnum("mode").notNull().default("practice"),
  status: attemptStatusEnum("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalScore: integer("total_score"),
  maxScore: integer("max_score"),
});

/**
 * One student response per item within an attempt.
 */
export const answers = pgTable("answer", {
  id: uuid("id").defaultRandom().primaryKey(),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => attempts.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  /** Raw response (JSON). Shape depends on item type. */
  rawAnswer: jsonb("raw_answer").notNull(),
  /** Result of auto-grading (null when AI-graded only). */
  autoScore: integer("auto_score"),
  /** AI tutor feedback (Markdown). */
  aiFeedback: text("ai_feedback"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Per-criterion breakdown of an answer's score (the thing that drives the
 * FIPI-style score card in the UI).
 */
export const rubricScores = pgTable("rubric_score", {
  id: uuid("id").defaultRandom().primaryKey(),
  answerId: uuid("answer_id")
    .notNull()
    .references(() => answers.id, { onDelete: "cascade" }),
  criterionCode: text("criterion_code").notNull(),
  criterionLabel: text("criterion_label"),
  score: integer("score").notNull(),
  maxScore: integer("max_score").notNull(),
  notes: text("notes"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;
export type NewEvaluation = typeof evaluations.$inferInsert;

export type Exam = typeof exams.$inferSelect;
export type NewExam = typeof exams.$inferInsert;
export type Section = typeof sections.$inferSelect;
export type NewSection = typeof sections.$inferInsert;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type NewTaskTemplate = typeof taskTemplates.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
export type RubricScore = typeof rubricScores.$inferSelect;
export type NewRubricScore = typeof rubricScores.$inferInsert;

export type ExamCode = (typeof examCodeEnum.enumValues)[number];
export type SectionKind = (typeof sectionKindEnum.enumValues)[number];
