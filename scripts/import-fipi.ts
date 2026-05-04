import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { importFipiManifest } from "../lib/fipi/importer";
import { FipiManifestSchema } from "../lib/fipi/manifest";

/**
 * CLI: `pnpm db:import:fipi <path-to-manifest.json> [--dry-run]`
 *
 * Reads a FIPI manifest JSON from disk, validates it against
 * `FipiManifestSchema`, and idempotently upserts the items into the
 * already-seeded task_templates. Re-running the same manifest is a
 * no-op (everything is dedup'd per-section).
 *
 * Use `--dry-run` to validate the manifest + report dedup counts
 * without writing anything to the DB.
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    console.error(
      "Usage: pnpm db:import:fipi <path-to-manifest.json> [--dry-run]",
    );
    process.exit(2);
  }

  const manifestPath = path.resolve(positional[0]);
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(manifestPath, "utf8");
  const json = JSON.parse(raw);
  const parsed = FipiManifestSchema.safeParse(json);
  if (!parsed.success) {
    console.error("Manifest failed validation:");
    console.error(JSON.stringify(parsed.error.flatten(), null, 2));
    process.exit(2);
  }
  const manifest = parsed.data;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Add it to .env.local before running this script.",
    );
    process.exit(2);
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    const summary = await importFipiManifest(db, manifest, { dryRun });
    console.log(
      `\n${dryRun ? "[DRY RUN] " : ""}FIPI import — exam ${summary.examCode} · source "${summary.source}"`,
    );
    for (const s of summary.sections) {
      console.log(
        `  ✓ ${s.section.padEnd(9)} · ${s.taskTemplateCode.padEnd(40)} · +${s.inserted} new, ${s.duplicates} dup, ${s.totalInBank} total`,
      );
    }
    console.log(
      `\n  Σ +${summary.totalInserted} new, ${summary.totalDuplicates} duplicates skipped.\n`,
    );
  } catch (err) {
    console.error("Import failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
