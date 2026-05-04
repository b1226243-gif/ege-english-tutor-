# FIPI manifest format

This folder is the staging ground for **FIPI demo content** that grows
the question bank without touching code. Each `.json` file is a
*manifest*: a structured, validated description of items lifted from a
public FIPI demo variant (or from any other curated source).

## Why a manifest, not a PDF parser?

FIPI publishes demo variants on
[fipi.ru](https://fipi.ru/ege/demoversii-specifikatsii-kodifikatory) as
PDFs. The formatting changes year to year, and heuristic PDF-to-JSON
extractors break silently when columns shift or the publisher tweaks
spacing. Rather than ship an extractor that gives a false sense of
"automated" import, this PR sets up the **infrastructure** — an
explicit JSON shape + a validating, idempotent importer — and leaves the
PDF→JSON step as an editorial workflow.

## Workflow

1. Download a FIPI demo PDF from fipi.ru (or save its URL).
2. Convert to text:
   ```sh
   pdftotext -layout demo.pdf demo.txt
   ```
3. Open `demo.txt` next to a fresh JSON file in this folder.
4. Hand-edit the manifest item by item (passage, question, options,
   correct-answer index, evidence quote). The schema is enforced — bad
   manifests fail import with a Zod error pointing to the field.
5. Validate without writing to the DB:
   ```sh
   pnpm db:import:fipi data/fipi/ege_en.<your_manifest>.json --dry-run
   ```
6. Import:
   ```sh
   pnpm db:import:fipi data/fipi/ege_en.<your_manifest>.json
   ```
   The script reports `+N new, K dup, T total` per section. Re-running
   the same manifest is a no-op (everything is deduped).

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
