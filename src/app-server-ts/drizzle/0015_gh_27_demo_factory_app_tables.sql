-- GH-27: the Studio's records (demos, scenes, demo users, jobs, runs) move out of
-- the blueprint repository's clob payloads into app tables, so a redeploy keeps them.
-- https://github.com/build-one-labs/b1-demo-studio/issues/27
CREATE TABLE "demo_factory_captions" (
	"id" varchar(320) PRIMARY KEY NOT NULL,
	"run_id" varchar(160) NOT NULL,
	"demo_id" varchar(128) NOT NULL,
	"scene_id" varchar(128) NOT NULL,
	"index" integer NOT NULL,
	"start_ms" double precision NOT NULL,
	"end_ms" double precision NOT NULL,
	"text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_factory_demo_users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"app_url" text DEFAULT '' NOT NULL,
	"configured" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "demo_factory_demos" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup" jsonb,
	"source" jsonb,
	"scene_count" integer DEFAULT 0 NOT NULL,
	"invalid" boolean DEFAULT false NOT NULL,
	"invalid_reason" text DEFAULT '' NOT NULL,
	"source_hash" varchar(80) DEFAULT '' NOT NULL,
	"drifted_from_file" boolean DEFAULT false NOT NULL,
	"edited_at" text
);
--> statement-breakpoint
CREATE TABLE "demo_factory_jobs" (
	"id" varchar(160) PRIMARY KEY NOT NULL,
	"action" varchar(32),
	"demo_id" varchar(128),
	"status" varchar(32) NOT NULL,
	"step" text,
	"started_at" text,
	"finished_at" text,
	"exit_code" integer,
	"log_file" text
);
--> statement-breakpoint
CREATE TABLE "demo_factory_narration" (
	"id" varchar(300) PRIMARY KEY NOT NULL,
	"run_id" varchar(160) NOT NULL,
	"demo_id" varchar(128) NOT NULL,
	"scene_id" varchar(128) NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"provider" varchar(32) DEFAULT '' NOT NULL,
	"cache_key" varchar(128) DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"duration_ms" double precision,
	"cues" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audio_url" text DEFAULT '' NOT NULL,
	"alignment_url" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_factory_run_scenes" (
	"id" varchar(300) PRIMARY KEY NOT NULL,
	"run_id" varchar(160) NOT NULL,
	"demo_id" varchar(128) NOT NULL,
	"scene_id" varchar(128) NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"duration_ms" double precision,
	"has_clip" boolean DEFAULT false NOT NULL,
	"narration_duration_ms" double precision,
	"recorded_duration_ms" double precision,
	"narration_offset_ms" double precision,
	"clip_file" text DEFAULT '' NOT NULL,
	"cues" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_factory_runs" (
	"run_id" varchar(160) PRIMARY KEY NOT NULL,
	"demo_id" varchar(128) NOT NULL,
	"created_at" text NOT NULL,
	"provider" varchar(32),
	"scene_count" integer DEFAULT 0 NOT NULL,
	"recorded_scenes" integer DEFAULT 0 NOT NULL,
	"duration_ms" double precision,
	"has_video" boolean DEFAULT false NOT NULL,
	"demo_hash" varchar(80) DEFAULT '' NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"recorded_at" text,
	"video_url" text DEFAULT '' NOT NULL,
	"srt_url" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_factory_scenes" (
	"id" varchar(260) PRIMARY KEY NOT NULL,
	"demo_id" varchar(128) NOT NULL,
	"scene_id" varchar(128) NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"route" text DEFAULT '' NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"clip" jsonb,
	"mode" varchar(16) DEFAULT '' NOT NULL,
	"conversion" jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_factory_scenes" ADD CONSTRAINT "demo_factory_scenes_demo_fkey" FOREIGN KEY ("demo_id") REFERENCES "public"."demo_factory_demos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_factory_captions_run_idx" ON "demo_factory_captions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "demo_factory_narration_run_idx" ON "demo_factory_narration" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "demo_factory_run_scenes_run_idx" ON "demo_factory_run_scenes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "demo_factory_runs_demo_idx" ON "demo_factory_runs" USING btree ("demo_id");--> statement-breakpoint
CREATE INDEX "demo_factory_scenes_demo_idx" ON "demo_factory_scenes" USING btree ("demo_id");