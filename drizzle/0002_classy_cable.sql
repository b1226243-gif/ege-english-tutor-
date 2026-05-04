ALTER TABLE "attempt" ADD COLUMN "plan" jsonb;--> statement-breakpoint
-- Pre-clean: any pre-existing duplicate answers for the same (attempt_id, item_id)
-- would block the unique constraint. Keep the most-recent row per pair so the
-- student's latest choice wins (matches the upsert semantics in saveMockAnswer).
DELETE FROM "answer" a
USING "answer" b
WHERE a."attempt_id" = b."attempt_id"
  AND a."item_id" = b."item_id"
  AND (
    a."created_at" < b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" < b."id")
  );--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_attempt_item_unique" UNIQUE("attempt_id","item_id");
