import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Single shared Postgres client.
 *
 * In dev we cache the connection on `globalThis` to survive HMR reloads.
 * In prod (Vercel / Edge-on-Node), a new client is created per cold start.
 *
 * If DATABASE_URL is unset, we still export `db` but lazily — any query
 * will throw a descriptive error, so the rest of the app (UI, auth)
 * keeps working while the database is being provisioned.
 */

const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
};

function getClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, or run `pnpm db:generate && pnpm db:migrate` after setting DATABASE_URL."
    );
  }
  if (!globalForDb.client) {
    globalForDb.client = postgres(url, {
      max: process.env.NODE_ENV === "production" ? 10 : 1,
      prepare: false,
    });
  }
  return globalForDb.client;
}

/**
 * Lazy Drizzle handle.
 *
 * Usage: `db().select().from(users)`.
 * The function form defers connection-string validation until first use,
 * so importing this module at build-time never throws.
 */
export function db() {
  return drizzle(getClient(), { schema });
}

export { schema };
