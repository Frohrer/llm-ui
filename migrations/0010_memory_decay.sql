-- Memory decay / eviction (0010).
-- The strength + last_reinforced_at columns are created by drizzle-kit
-- (db:push) from db/schema.ts before this file runs. This file backfills
-- rows that predate the decay rework and swaps indexes. Safe to re-run.

-- One-time backfill: legacy rows have NULL last_reinforced_at. Seed the
-- reinforcement clock from updated_at (so long-untouched rows start
-- already-decayed) and strength from extractor confidence
-- (conf 70 -> 0.85, conf 100 -> 1.0). Idempotent: application code sets
-- last_reinforced_at on every new row, so this matches only legacy rows, once.
UPDATE "memories"
SET "last_reinforced_at" = "updated_at",
    "strength" = 0.5 + LEAST(GREATEST("confidence", 0), 100) / 200.0
WHERE "last_reinforced_at" IS NULL;

-- Nothing ranks on use_count anymore (it is telemetry only).
DROP INDEX IF EXISTS "idx_memories_user_pinned_use";

-- The always-on slice is now pinned-only.
CREATE INDEX IF NOT EXISTS "idx_memories_user_pinned_active"
	ON "memories" ("user_id")
	WHERE "pinned" AND "superseded_by" IS NULL;
