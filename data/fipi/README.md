# FIPI manifest format

This folder is the staging ground for **FIPI demo content** that grows
the question bank without touching code. Each `.json` file is a
*manifest*: a structured, validated description of items lifted from a
public FIPI demo variant (or from any other curated source).

## Why a manifest, not a full PDF parser?

FIPI publishes demo variants on
[fipi.ru](https://fipi.ru/ege/demoversii-specifikatsii-kodifikatory) as
PDFs. The formatting changes year to year, and heuristic PDF-to-JSON
extractors break silently when columns shift or the publisher tweaks
spacing. Rather than ship a brittle full-document extractor, this folder
provides:

- A validated JSON manifest format (`lib/fipi/manifest.ts`).
- An idempotent importer (`pnpm db:import:fipi`).
- A **partial** text → manifest parser for the most regular blocks:
  grammar `word_formation` and `transform` sections, where each item is
  a numbered sentence ending in an ALL-CAPS BASE word.

Reading and Listening sections are intentionally **not** parsed
automatically. Their structure (passages → questions → options → answer
key tables) varies enough between FIPI cycles that any heuristic would
silently mis-align rows. For those sections the operator hand-edits the
manifest from the PDF text directly.

## Workflow A — fully manual (any section)

1. Download a FIPI demo PDF from fipi.ru.
2. `pdftotext -layout demo.pdf demo.txt`.
3. Hand-edit a JSON manifest in this folder, item by item, against
   `demo.txt`. The schema (`FipiManifestSchema`) is strict — bad
   manifests fail import with a Zod error pointing to the field.
4. `pnpm db:import:fipi data/fipi/<file>.json --dry-run` to validate.
5. `pnpm db:import:fipi data/fipi/<file>.json` to seed.

## Workflow B — PDF text → scaffold (grammar only)

For grammar `word_formation` / `transform` blocks only — these are the
most predictable layout in FIPI demos.

1. `pdftotext -layout demo.pdf demo.txt`.
2. Snip the relevant grammar block out of `demo.txt` into its own
   `<file>.input.txt` (the parser treats the whole input as a single
   block, so it's safest to remove headers / page numbers / unrelated
   sections by hand first).
3. Run the parser:
   ```sh
   pnpm fipi:parse data/fipi/<file>.input.txt \
       --exam ege_en \
       --task word_formation \
       --source fipi_demo_2025 \
       --source-url https://fipi.ru/... \
       --out data/fipi/<file>.draft.json
   ```
4. The output JSON has every item populated except `answer.answer`,
   which is left as `""`. The operator must fill in:
   - `answer.answer` (required, e.g. `"POWERFUL"`),
   - optionally `answer.alternatives`, `answer.hint` / `answer.pos`,
   - `metadata.topic` and `metadata.difficulty`.
5. `pnpm db:import:fipi data/fipi/<file>.draft.json --dry-run`. If any
   row was left unedited, Zod refuses with
   `answer.answer: must contain at least 1 char(s)` pointing at it.
6. Once `--dry-run` is clean, re-run without it to seed.

The parser will skip lines that match the item shape but have no
underscore gap (e.g. page numbers / headers that happen to contain an
all-caps word) and report them as warnings on stderr.

## Manifest shape

```jsonc
{
  "version": 1,
  "examCode": "ege_en" | "oge_en",
  "source": "fipi_demo_2025",        // Free-form provenance label, persisted on each item.
  "sourceUrl": "https://fipi.ru/...",  // Optional URL of the source PDF.
  "sections": [
    {
      "section": "reading" | "listening" | "grammar",
      "taskTemplateCode": "ege_en.reading.mc_detail",  // Existing template code.
      "items": [
        // Reading items:
        {
          "passage": "...full reading passage as Markdown...",
          "question": "Why does Helena describe the start line as a deadline?",
          "answer": {
            "type": "reading_mc",
            "options": ["A...", "B...", "C...", "D..."],
            "answer": 0,                        // 0-based index of correct option.
            "evidence": "short quote from the passage"
          },
          "metadata": { "topic": "adventure", "difficulty": "medium" }
        },

        // Listening items:
        {
          "transcript": "...full audio transcript...",
          "question": "What does the speaker imply?",
          "voice": "f",
          "answer": {
            "type": "listening_mc",
            "options": ["A...", "B...", "C..."],
            "answer": 1,
            "evidence": "..."
          }
        },

        // Grammar items:
        {
          "stimulusText": "She ___ (sing) when the phone rang.",
          "answer": {
            "type": "transform" | "word_formation" | "lexical_mc",
            // ... per the per-type schema in lib/grammar/types.ts
          }
        }
      ]
    }
  ]
}
```

## Dedup keys

Re-running an import is safe; items are deduped before insert.

| Section   | Dedup key                                         |
|-----------|---------------------------------------------------|
| reading   | (template_id, stimulusText, metadata.passage)     |
| listening | (template_id, stimulusText, metadata.transcript)  |
| grammar   | (template_id, stimulusText)                       |

## Provenance

Imported items get:

- `items.source = "fipi_demo"`
- `items.metadata.fipi_source = <manifest.source>`
- `items.metadata.fipi_source_url = <manifest.sourceUrl>` (if provided)

So later we can filter / weight FIPI-provenance items differently from
user-authored or AI-generated content (PR #11).

## Examples

The two `*.example_*.json` files in this folder ship working manifests
with **synthetic FIPI-style content** (not verbatim from any real demo)
so you can run the importer end-to-end without copyright ambiguity.
Replace them — or add your own — to import real demo material.
