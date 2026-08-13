-- PII redaction (0011).
-- Tables also materialize via drizzle-kit db:push from db/schema.ts; this file
-- is idempotent (IF NOT EXISTS) so either path works and it is safe to re-run.

CREATE TABLE IF NOT EXISTS "pii_entities" (
  "id" serial PRIMARY KEY,
  "value" text NOT NULL UNIQUE,
  "type" text NOT NULL,
  "tag" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'active',
  "source" text NOT NULL DEFAULT 'manual',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "pii_settings" (
  "id" serial PRIMARY KEY,
  "enabled" boolean NOT NULL DEFAULT false,
  "classifier_enabled" boolean NOT NULL DEFAULT false,
  "classifier_model" text NOT NULL DEFAULT 'onnx-community/distilbert-NER-ONNX',
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- One-time migration off the retired Ollama classifier default.
UPDATE "pii_settings"
SET "classifier_model" = 'onnx-community/distilbert-NER-ONNX'
WHERE "classifier_model" = 'llama3.2';

-- Redaction reads the full active set on every request (cached in-process);
-- partial index keeps that scan cheap once the dictionary grows.
CREATE INDEX IF NOT EXISTS "idx_pii_entities_active"
  ON "pii_entities" ("id")
  WHERE "status" = 'active';

-- Seed the singleton settings row so reads never have to handle absence.
INSERT INTO "pii_settings" ("enabled", "classifier_enabled")
SELECT false, false
WHERE NOT EXISTS (SELECT 1 FROM "pii_settings");
