# EGE English Tutor

AI tutor for the Russian Unified State Exam (EGE) in English. Strict
**FIPI 2024/25** scoring, Socratic feedback, dedicated modules for:

- **Writing / Task 37** — personal email (100–140 words, criteria К1–К3).
- **Writing / Task 38** — opinion essay on a chart/table (180–275 words, К1–К5).
- **Speaking simulator** — Tasks 1–4 of the oral part, with browser-based
  voice capture (Web Speech API).

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
    layout.tsx                    # Auth-gated dashboard shell
    page.tsx                      # Dashboard index
    writing/page.tsx              # Tasks 37 & 38 — split-screen
    speaking/page.tsx             # Speaking simulator
  sign-in/
    page.tsx                      # Suspense wrapper
    sign-in-form.tsx              # Credentials + GitHub buttons
  layout.tsx                      # Root layout + <SessionProvider>
  page.tsx                        # Landing
components/
  chat-box.tsx                    # Streaming chat UI (chat / feedback variants)
  score-card.tsx                  # FIPI scoring card
  ui/                             # Button, Card, Input, Textarea primitives
lib/
  prompts.ts                      # "Brain" system prompts (FIPI 2024/25)
  utils.ts                        # cn() helper
  db/
    schema.ts                     # Drizzle schema (Auth.js + domain tables)
    index.ts                      # Lazy postgres client
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
- Go to `/dashboard/writing` — pick Task 37 or 38, write, click **Evaluate**.
- Go to `/dashboard/speaking` — click **Start recording** (Chrome/Edge) or
  type a transcript directly, then **Evaluate**.

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

## Roadmap notes

- [ ] `/sign-up` route with Server Action that bcrypts the password.
- [ ] Persist chat turns to the `message` table (streaming `onFinish` hook).
- [ ] Store parsed FIPI scores into `evaluation` for a progress dashboard.
- [ ] Server-side Whisper fallback for browsers without the Web Speech API.
- [ ] Task 37/38 stimulus bank (emails, charts) rendered on the left pane.
