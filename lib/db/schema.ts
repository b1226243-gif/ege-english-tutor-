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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;
export type NewEvaluation = typeof evaluations.$inferInsert;
