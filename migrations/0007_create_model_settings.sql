CREATE TABLE IF NOT EXISTS "model_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text,
	"context_length" integer,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'static' NOT NULL,
	"owned_by" text,
	"sort_order" integer,
	"skip_system_prompt" boolean DEFAULT false NOT NULL,
	"parameters" jsonb,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
