import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

import {
  items,
  sections,
  taskTemplates,
} from "../lib/db/schema";

/**
 * Render an mp3 file for every seeded listening item that doesn't already
 * have one on disk, using OpenAI TTS.
 *
 * Looks up listening items from the DB, reads `assets.transcript` + the
 * optional `assets.voice` hint, and writes the mp3 to
 * `public/audio/listening/<slug>.mp3` — where `<slug>` is taken from the
 * filename in `stimulus_audio_url` (so the client finds it by the same
 * relative path the seed wrote).
 *
 * This script is idempotent: if the mp3 file already exists, it is skipped.
 *
 * Running this script requires `OPENAI_API_KEY` to be set and a positive
 * account balance (OpenAI TTS ~$15 per 1M characters, so the full 50-item
 * bank costs well under $1). If you don't have credits, skip this step —
 * the UI will fall back to browser speechSynthesis and practice will still
 * work.
 */

const PUBLIC_DIR = join(process.cwd(), "public", "audio", "listening");

type Voice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer";

const SUPPORTED_VOICES = new Set<Voice>([
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
]);

function toVoice(v: unknown): Voice {
  if (typeof v === "string" && SUPPORTED_VOICES.has(v as Voice)) {
    return v as Voice;
  }
  return "alloy";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slugFromUrl(url: string): string | null {
  const match = url.match(/\/audio\/listening\/([^/]+)\.mp3$/);
  return match ? match[1] : null;
}

async function renderOne(
  apiKey: string,
  model: string,
  voice: Voice,
  text: string,
): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(
      `OpenAI TTS failed: ${res.status} ${res.statusText} — ${err.slice(0, 200)}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      "OPENAI_API_KEY is not set. Skipping audio generation — the listening UI will fall back to browser speechSynthesis.",
    );
    process.exit(0);
  }
  const model = process.env.OPENAI_TTS_MODEL ?? "tts-1";

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const client = postgres(url, { prepare: false });
  const d = drizzle(client);

  await mkdir(PUBLIC_DIR, { recursive: true });

  let rendered = 0;
  let skipped = 0;

  try {
    const rows = await d
      .select({
        id: items.id,
        stimulusAudioUrl: items.stimulusAudioUrl,
        assets: items.assets,
      })
      .from(items)
      .innerJoin(taskTemplates, eq(items.taskTemplateId, taskTemplates.id))
      .innerJoin(sections, eq(taskTemplates.sectionId, sections.id))
      .where(and(eq(sections.kind, "listening")));

    for (const row of rows) {
      if (!row.stimulusAudioUrl) continue;
      const slug = slugFromUrl(row.stimulusAudioUrl);
      if (!slug) continue;

      const target = join(PUBLIC_DIR, `${slug}.mp3`);
      if (await exists(target)) {
        skipped += 1;
        continue;
      }

      const assets = (row.assets as { transcript?: unknown; voice?: unknown }) ?? {};
      const transcript = typeof assets.transcript === "string" ? assets.transcript : "";
      if (!transcript) {
        console.warn(`- skipping ${slug}: no transcript`);
        continue;
      }
      const voice = toVoice(assets.voice);

      process.stdout.write(`· ${slug} (${voice}) … `);
      const buf = await renderOne(apiKey, model, voice, transcript);
      await writeFile(target, buf);
      console.log(`${Math.round(buf.byteLength / 1024)} KB`);
      rendered += 1;
    }
  } finally {
    await client.end({ timeout: 5 });
  }

  console.log(`\nDone. Rendered ${rendered}, skipped ${skipped} (already present).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
