import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseGrammarText } from "../lib/fipi/parser";
import type { ParsableGrammarTask } from "../lib/fipi/parser";
import type { SupportedExamCode } from "../lib/exams";
import { SUPPORTED_EXAM_CODES } from "../lib/exams";

/**
 * CLI: `pnpm fipi:parse <input.txt> --exam <code> --task <task> \
 *        --source <label> [--source-url <url>] [--out <out.json>]`
 *
 * Reads `pdftotext -layout` output of a FIPI demo PDF and produces a
 * draft FIPI manifest JSON ready for the operator to fill in correct
 * word forms before running `pnpm db:import:fipi`.
 *
 * The output is intentionally NOT directly importable: every item has
 * `answer.answer = ""`, which fails the manifest's Zod schema (so a
 * forgetful operator gets a clear validation error pointing at the
 * unedited rows rather than silently seeding empty answer keys).
 *
 * Only grammar `word_formation` and `transform` blocks are parseable —
 * Reading and Listening sections vary too much across FIPI demos for a
 * heuristic extractor to be trustworthy.
 */
async function main() {
  const args = process.argv.slice(2);
  const opts: Partial<{
    exam: SupportedExamCode;
    task: ParsableGrammarTask;
    source: string;
    sourceUrl: string;
    out: string;
  }> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--exam") opts.exam = args[++i] as SupportedExamCode;
    else if (a === "--task") opts.task = args[++i] as ParsableGrammarTask;
    else if (a === "--source") opts.source = args[++i];
    else if (a === "--source-url") opts.sourceUrl = args[++i];
    else if (a === "--out") opts.out = args[++i];
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      usage();
      process.exit(2);
    } else positional.push(a);
  }
  if (positional.length !== 1) {
    usage();
    process.exit(2);
  }
  const inputPath = path.resolve(positional[0]);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(2);
  }
  if (
    !opts.exam ||
    !(SUPPORTED_EXAM_CODES as readonly string[]).includes(opts.exam)
  ) {
    console.error(
      `--exam is required and must be one of: ${SUPPORTED_EXAM_CODES.join(", ")}`,
    );
    process.exit(2);
  }
  if (!opts.task || (opts.task !== "word_formation" && opts.task !== "transform")) {
    console.error(`--task is required and must be one of: word_formation, transform`);
    process.exit(2);
  }
  if (!opts.source) {
    console.error(
      `--source is required (free-form provenance label, e.g. "fipi_demo_2025")`,
    );
    process.exit(2);
  }

  const text = fs.readFileSync(inputPath, "utf8");
  const result = parseGrammarText(text, {
    examCode: opts.exam,
    task: opts.task,
    source: opts.source,
    sourceUrl: opts.sourceUrl,
  });

  if (result.warnings.length > 0) {
    console.warn(`Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) {
      console.warn(`  ! ${w}`);
    }
  }

  const json = JSON.stringify(result.manifest, null, 2);
  if (opts.out) {
    const outPath = path.resolve(opts.out);
    fs.writeFileSync(outPath, json + "\n", "utf8");
    console.log(
      `\nWrote ${result.itemCount} grammar item${
        result.itemCount === 1 ? "" : "s"
      } to ${path.relative(process.cwd(), outPath)}.`,
    );
  } else {
    process.stdout.write(json + "\n");
  }

  if (result.itemCount > 0) {
    console.log(
      `\nNext steps:\n` +
        `  1. Open the JSON and fill in \`answer.answer\` (and ideally \`alternatives\`,\n` +
        `     \`hint\` for transform / \`pos\` for word_formation, plus \`metadata.topic\`\n` +
        `     and \`metadata.difficulty\`) for every item.\n` +
        `  2. Validate without writing to the DB:\n` +
        `       pnpm db:import:fipi <out.json> --dry-run\n` +
        `  3. Import:\n` +
        `       pnpm db:import:fipi <out.json>\n`,
    );
  }
}

function usage() {
  console.error(
    "Usage: pnpm fipi:parse <input.txt> --exam <ege_en|oge_en> --task <word_formation|transform> --source <label> [--source-url <url>] [--out <out.json>]",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
