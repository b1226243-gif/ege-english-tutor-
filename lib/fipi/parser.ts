/**
 * Heuristic FIPI demo-text → manifest scaffold parser.
 *
 * Scope: ONLY grammar `word_formation` and `transform` blocks. These have
 * the most regular structure across FIPI demo PDFs (one numbered item per
 * sentence, with the BASE word in capital letters at the end of the line).
 * Reading and Listening sections are intentionally NOT parsed — their
 * formatting changes between FIPI demo cycles and a heuristic extractor
 * would silently mis-align passages with questions, producing graded
 * items the operator cannot trust.
 *
 * Workflow (operator-facing):
 *   1.  pdftotext -layout demo.pdf demo.txt
 *   2.  pnpm fipi:parse demo.txt --exam ege_en --task word_formation \
 *           --source fipi_demo_2025 --out data/fipi/<file>.json
 *   3.  Open the generated JSON and fill in every "TODO_FILL_ME"
 *       (the parser cannot infer the correct word form).
 *   4.  pnpm db:import:fipi data/fipi/<file>.json [--dry-run]
 *
 * The output is *always* a draft. The parser fills in everything it can
 * extract verbatim (stimulus_text, BASE word) and leaves a clearly
 * marked "TODO_FILL_ME" wherever pedagogical judgement is required (the
 * answer form, alternatives, hint, topic). Importing a manifest with
 * "TODO_FILL_ME" left in answer fields will fail Zod validation, so the
 * operator cannot accidentally seed half-baked items.
 */

import type {
  FipiGrammarItem,
  FipiManifest,
  FipiSectionEntry,
} from "./manifest";
import { FIPI_MANIFEST_VERSION } from "./manifest";
import type { SupportedExamCode } from "@/lib/exams";

type GrammarSection = Extract<FipiSectionEntry, { section: "grammar" }>;

export type ParsableGrammarTask = "word_formation" | "transform";

export type ParseGrammarOptions = {
  examCode: SupportedExamCode;
  task: ParsableGrammarTask;
  source: string;
  sourceUrl?: string;
};

export type ParseGrammarResult = {
  manifest: FipiManifest;
  warnings: string[];
  itemCount: number;
};

/**
 * Match a numbered grammar item with a BASE word in caps at end of line.
 *
 * Examples it recognises (extracted from `pdftotext -layout` output of
 * the public 2024/25 FIPI demo PDFs):
 *
 *   "26. The latest model is more ____________ than the previous one. POWER"
 *   "26  The latest model is more ____________ than the previous one. (POWER)"
 *   "19) Yesterday Mike ____________ to school by bus. (GO)"
 *
 * The BASE word must be ALL CAPS, optionally wrapped in parentheses, and
 * it must be the last token on the line. Numbers are 2-3 digit FIPI task
 * indices. Underscores in the gap can vary in length.
 */
const ITEM_LINE = new RegExp(
  String.raw`^\s*(\d{1,3})[.)]?\s+(.+?)\s+\(?([A-Z][A-Z\-/]{1,20})\)?\s*$`,
);

/**
 * A "BASE" we should never accept as the source word (false positives
 * from headers, bookmarks, page numbers etc. that would otherwise match
 * the regex).
 */
const FALSE_POSITIVE_BASES = new Set<string>([
  "EGE",
  "OGE",
  "FIPI",
  "RU",
  "EN",
  "USA",
  "UK",
  "I",
  "II",
  "III",
  "IV",
  "V",
]);

/**
 * Parse `pdftotext -layout` output of a FIPI demo and return a manifest
 * scaffold. Each extracted line becomes one grammar item with `answer`
 * fields stubbed as "TODO_FILL_ME"; the operator must fill them in
 * before `pnpm db:import:fipi` will accept the manifest (the importer
 * runs Zod validation and our `GrammarAnswerSchema` rejects the stubs).
 */
export function parseGrammarText(
  text: string,
  opts: ParseGrammarOptions,
): ParseGrammarResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  const items: ScaffoldItem[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\s+/g, " ").trim();
    if (!line) continue;
    const match = ITEM_LINE.exec(line);
    if (!match) continue;
    const [, taskNum, bodyRaw, baseRaw] = match;
    const base = baseRaw.toUpperCase();
    if (FALSE_POSITIVE_BASES.has(base)) continue;
    const body = bodyRaw.trim();

    // Cheap sanity guard: a real grammar item must include a gap marker
    // (___ of any length) — pdftotext sometimes emits page numbers like
    // "26  Variant A1  POWER" that match the regex but have no gap.
    if (!/_{2,}/.test(body)) {
      warnings.push(
        `Line "${line}" matched item shape but has no underscore gap; skipped.`,
      );
      continue;
    }

    items.push({
      taskNum,
      stimulusText: `${body} (${base})`,
      base,
    });
  }

  if (items.length === 0) {
    warnings.push(
      "No grammar items recognised. Check that the input is `pdftotext -layout` output and the section contains numbered sentences with a BASE word in caps at end of line.",
    );
  }

  const manifest: FipiManifest = {
    version: FIPI_MANIFEST_VERSION,
    examCode: opts.examCode,
    source: opts.source,
    ...(opts.sourceUrl ? { sourceUrl: opts.sourceUrl } : {}),
    sections: [
      buildScaffoldSection(items, opts.examCode, opts.task),
    ],
  };

  return { manifest, warnings, itemCount: items.length };
}

type ScaffoldItem = {
  taskNum: string;
  stimulusText: string;
  base: string;
};

function buildScaffoldSection(
  items: ScaffoldItem[],
  examCode: SupportedExamCode,
  task: ParsableGrammarTask,
): GrammarSection {
  const taskTemplateCode = `${examCode}.grammar.${task}`;
  // The `answer` field is left empty deliberately: `GrammarAnswerSchema`
  // requires `answer: z.string().min(1)`, so importing this scaffold
  // before the operator fills in real word forms will fail Zod
  // validation with a clear "answer: must contain at least 1 char(s)"
  // error pointing at the offending item. That is the only safety
  // net stopping half-baked manifests from being seeded.
  const grammarItems: FipiGrammarItem[] = items.map((it) => ({
    stimulusText: it.stimulusText,
    answer:
      task === "word_formation"
        ? {
            type: "word_formation",
            base: it.base,
            answer: "",
            alternatives: [],
          }
        : {
            type: "transform",
            base: it.base,
            answer: "",
            alternatives: [],
          },
    metadata: {
      fipi_task_number: Number(it.taskNum),
      // Tagging is editorial, not extractive — leave both empty so the
      // operator notices and fills them in during the same pass.
      topic: "",
      difficulty: "",
      _review:
        "Fill in answer.answer (and optionally alternatives, hint, pos) before importing.",
    },
  }));
  return {
    section: "grammar",
    taskTemplateCode,
    items: grammarItems,
  };
}
