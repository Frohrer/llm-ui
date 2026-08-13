-- Persistent cross-conversation memory (hot tier).
-- The `memories` table itself is created by drizzle-kit (db:push) from
-- db/schema.ts. This file adds the indexes db:push cannot generate.
-- Safe to re-run.

-- Active-memory lookups: most queries filter by user and exclude superseded rows
CREATE INDEX IF NOT EXISTS "idx_memories_user_active"
	ON "memories" ("user_id")
	WHERE "superseded_by" IS NULL;

-- Used for ranking the always-on slice (pinned first, then heavily-used)
CREATE INDEX IF NOT EXISTS "idx_memories_user_pinned_use"
	ON "memories" ("user_id", "pinned" DESC, "use_count" DESC)
	WHERE "superseded_by" IS NULL;
