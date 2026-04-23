# EGE English Tutor

AI tutor for the Russian State Exams in English — **ЕГЭ** (11th grade) and
**ОГЭ** (9th grade), with IELTS / TOEFL / Cambridge planned. Strict
**FIPI 2024/25** scoring, Socratic feedback.

**Sections (current status):**

| Section       | ЕГЭ                                  | ОГЭ                                  | Status          |
| ------------- | ------------------------------------ | ------------------------------------ | --------------- |
| Writing       | Task 37 (email) + Task 38 (essay)    | Task 33 (email)                      | shipped (PR #2) |
| Speaking      | Tasks 1–4 — Web Speech capture       | Tasks 1–3 — Web Speech capture       | shipped (PR #2) |
| Grammar & Voc | Tasks 19–36                          | Tasks 18–32                          | planned (PR #3) |
| Reading       | Tasks 12–18                          | Tasks 12–17                          | planned (PR #4) |
| Listening     | Tasks 1–11                           | Tasks 1–11                           | planned (PR #5) |
| Mock Exam     | full timed run                       | full timed run                       | planned (PR #7) |

Routing: `/dashboard` → exam picker → `/dashboard/[examCode]` → section
picker → `/dashboard/[examCode]/[section]`.

## Architecture

| Layer       | Choice                                                    |
| ----------- | --------------------------------------------------------- |
| Framework   | **Next.js 16** (App Router, Turbopack, React 19)          |
| Styling     | **Tailwind CSS v4** + handwritten shadcn-style primitives |
| Auth        | **Auth.js (NextAuth v5 beta)** — Credentials + GitHub     |
| ORM         | **Drizzle** with `postgres` driver                        |
| Database    | **Neon Postgres** (any vanilla Postgres works)            |
| AI          | **Vercel AI SDK v6** — `@ai-sdk/openai` → **GPT-4o**      |
| Routing mw  | **`proxy.ts`** (Next.js 16 renamed `middleware.ts`)       |

### Repository layout

```
app/
  api/
    auth/[...nextauth]/route.ts   # Auth.js HTTP handlers
    chat/route.ts                 # Streaming chat endpoint (AI SDK)
  dashboard/
    layout.tsx                    # Auth-gated dashboard shell + top nav
    page.tsx                      # Exam picker (ЕГЭ / ОГЭ)
    [examCode]/
      page.tsx                    # Section picker per exam
      writing/                    # Writing workspace (Task 37/38 or 33)
      speaking/                   # Speaking workspace
      reading/page.tsx            # Stub (PR #4)
      listening/page.tsx          # Stub (PR #5)
      grammar/page.tsx            # Stub (PR #3)
      mock/page.tsx               # Stub (PR #7)
    writing/page.tsx              # Legacy redirect → /dashboard/ege_en/writing
    speaking/page.tsx             # Legacy redirect → /dashboard/ege_en/speaking
  sign-in/                        # Credentials + GitHub sign-in
  layout.tsx                      # Root layout + <SessionProvider>
  page.tsx                        # Landing
components/
  chat-box.tsx                    # Streaming chat UI + error banner
  score-card.tsx                  # FIPI scoring card
  section-stub.tsx                # Shared "coming soon" placeholder
  ui/                             # Button, Card, Input, Textarea primitives
lib/
  prompts.ts                      # "Brain" system prompts (FIPI 2024/25)
  exams.ts                        # Per-exam metadata, section list, writing tasks
  utils.ts                        # cn() helper
  db/
    schema.ts                     # Drizzle schema (Auth.js + Phase 1 + multi-exam)
    index.ts                      # Lazy postgres client
scripts/
  seed-exams.ts                   # Seeds `exam` + `section` rows (pnpm db:seed)
auth.config.ts                    # Edge-safe Auth.js config (used in proxy.ts)
auth.ts                           # Full Auth.js instance (Drizzle + bcrypt)
proxy.ts                          # Next 16 route proxy — gates /dashboard/*
drizzle.config.ts                 # drizzle-kit config
```

### Data flow for a student submission

1. User writes an essay in `/dashboard/writing` (client component).
2. `<ChatBox>` calls `POST /api/chat` with `{ messages, module: 'writing-38' }`.
3. `app/api/chat/route.ts` authenticates via `auth()`, selects the correct
   system prompt from `lib/prompts.ts`, and streams GPT-4o's response back
   using `streamText(...).toUIMessageStreamResponse()`.
4. `useChat` from `@ai-sdk/react` renders the streamed tokens in real time.

### The "Brain" (system prompts)

All tutor personality and scoring rules live in **`lib/prompts.ts`**. There are
four resolvable prompts: `base`, `writing-37`, `writing-38`, `speaking`.

Each is built on top of `BASE_SYSTEM_PROMPT`, which enforces:

1. Strict adherence to FIPI 2024/25 criteria.
2. Socratic method for error correction.
3. Professional, rigorous tone.
4. A standardised Markdown evaluation layout (overall impression → scoring
   table → Socratic questions → suggestions → next step).

## Getting started

### 1. Prerequisites

- Node.js **≥ 20.9** (Next.js 16 requirement).
- `pnpm` (repo is configured for pnpm).
- A Postgres database. Free Neon project works out of the box:
  https://console.neon.tech

### 2. Install

```bash
pnpm install
```

### 3. Configure environment

Copy `.env.example` → `.env.local` and fill in:

```bash
cp .env.example .env.local
```

| Variable                 | Purpose                                              | Required |
| ------------------------ | ---------------------------------------------------- | -------- |
| `AUTH_SECRET`            | Auth.js JWT signing. Run `openssl rand -base64 32`.  | ✅       |
| `DATABASE_URL`           | Postgres connection string (include `sslmode=require` for Neon). | ✅ |
| `OPENAI_API_KEY`         | OpenAI API key for GPT-4o.                           | ✅       |
| `OPENAI_MODEL`           | Override model (defaults to `gpt-4o`).               |          |
| `AUTH_GITHUB_ID`         | GitHub OAuth App client ID.                          |          |
| `AUTH_GITHUB_SECRET`     | GitHub OAuth App client secret.                      |          |

GitHub is optional — the sign-in page hides the "Continue with GitHub" button
automatically when the env vars are missing. Credentials sign-in always works.

### 4. Run migrations

Drizzle-Kit reads `DATABASE_URL` from `.env.local`.

```bash
# Generate SQL migration files from lib/db/schema.ts into ./drizzle
pnpm db:generate

# Apply them against DATABASE_URL
pnpm db:migrate
```

Alternative for rapid local iteration (no migration files, direct push):

```bash
pnpm db:push
```

### 4b. Seed exam catalogue

```bash
pnpm db:seed
```

Populates the `exam` and `section` tables with ЕГЭ + ОГЭ metadata (time
limits, max scores, task counts). Idempotent — safe to re-run whenever
`scripts/seed-exams.ts` changes.

Inspect the database visually:

```bash
pnpm db:studio
```

### 5. Start the dev server

```bash
pnpm dev
```

Open http://localhost:3000 and:

- Sign in at `/sign-in` (credentials — see *Creating a test user* below).
- Land on `/dashboard` → pick ЕГЭ or ОГЭ.
- Pick a section. Writing & Speaking are fully wired; Reading / Listening /
  Grammar / Mock show the roadmap stub (planned for PR #3–#7).
- In Writing: toggle between tasks (Task 37/38 for ЕГЭ, Task 33 for ОГЭ),
  type a draft, click **Оценить**.
- In Speaking: **Start recording** (Chrome/Edge) or paste a transcript, then
  **Оценить**.

### 6. Linting, typechecking, production build

```bash
pnpm lint        # ESLint (eslint-config-next)
pnpm typecheck   # tsc --noEmit
pnpm build       # next build (Turbopack)
```

## Creating a test user (credentials)

Auth.js with the Credentials provider reads `user.password_hash` (bcrypt) from
Postgres. The simplest way to create one for local testing:

```bash
# 1. Hash a password
node -e "import('bcryptjs').then(b => b.default.hash('password123', 12).then(console.log))"

# 2. Insert into Postgres (via drizzle-kit studio or psql)
psql "$DATABASE_URL" -c "INSERT INTO \"user\" (id, email, password_hash) VALUES (gen_random_uuid()::text, 'test@example.com', '<HASH_FROM_STEP_1>');"
```

Sign in at `/sign-in` with `test@example.com` + `password123`.

A future task: a `/sign-up` page that wraps this in a Server Action.

## Deployment

The app is Vercel-first: `vercel --prod` picks up `next.config.ts`,
`drizzle.config.ts`, and all env vars.

When deploying, run migrations once before the first traffic hits the server:

```bash
DATABASE_URL=… pnpm db:migrate
```

## Phase 2 multi-exam schema

Phase 2 (PR #2) added the following tables alongside the Phase 1
`chat` / `message` / `evaluation` tables (all preserved for backwards
compatibility):

| Table           | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `exam`          | One row per exam (ЕГЭ / ОГЭ today; IELTS/TOEFL reserved).  |
| `section`       | One row per (exam × section_kind) with time + score limits.|
| `task_template` | FIPI task definition (number, title, rubric JSON, config). |
| `item`          | Concrete stimulus (text + audio URL + correct answers).    |
| `attempt`       | A student sitting — practice / mock_section / mock_full.   |
| `answer`        | A single student response within an attempt.               |
| `rubric_score`  | Per-criterion scores (К1 / К2 / …) attached to an answer.  |

Audio for Listening items is planned to live in **Vercel Blob** (lands in
PR #5 along with the Listening UI).

## Roadmap notes

- [ ] `/sign-up` route with Server Action that bcrypts the password.
- [ ] Persist chat turns to the `message` table (streaming `onFinish` hook).
- [ ] Store parsed FIPI scores into `evaluation` for a progress dashboard.
- [ ] Server-side Whisper fallback for browsers without the Web Speech API.
- [ ] Task 37/38 stimulus bank (emails, charts) rendered on the left pane.
- [ ] FIPI demo parser → seed `task_template` + `item` from official PDFs.
- [ ] AI generators per section for infinite practice.
