CREATE TABLE "demo_narration_cache" (
	"cache_key" varchar(128) PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"voice_id" varchar(128) DEFAULT '' NOT NULL,
	"model_id" varchar(128) DEFAULT '' NOT NULL,
	"language_code" varchar(32) DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"duration_ms" integer,
	"metadata" jsonb NOT NULL,
	"audio" "bytea" NOT NULL,
	"audio_extension" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_run_manifests" (
	"run_id" varchar(160) PRIMARY KEY NOT NULL,
	"demo_id" varchar(128) NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
