import { customType, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Durable persistence for the demo factory's pipeline by-products.
 *
 * The demo definitions themselves live in clob-backed temporary data sources
 * (see `server-actions/demo-factory/`); these tables hold what used to exist
 * only on the container filesystem and therefore died with every redeploy:
 *
 * - the content-addressed narration cache, so unchanged voice-over text never
 *   pays ElevenLabs twice — not even across container generations, and takes
 *   keep the exact same audio instead of a re-synthesized near-identical one;
 * - each run's manifest, so a run's voice-over, cue timing and cut data stay
 *   reconstructible even when its media files are gone.
 *
 * Media (clips, MP4s) stays on the output volume on purpose: a video does not
 * belong in a database row, and a run whose files are lost is a run whose
 * video is lost — the manifest is what remains meaningful without them.
 */

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  }
});

export const demoNarrationCache = pgTable('demo_narration_cache', {
  /** sha256 over provider, text, voice, model and rate — the pipeline's own cache key. */
  cacheKey: varchar('cache_key', { length: 128 }).primaryKey().notNull(),
  provider: varchar({ length: 32 }).notNull(),
  voiceId: varchar('voice_id', { length: 128 }).notNull().default(''),
  modelId: varchar('model_id', { length: 128 }).notNull().default(''),
  languageCode: varchar('language_code', { length: 32 }).notNull().default(''),
  text: text().notNull(),
  durationMs: integer('duration_ms'),
  /** The pipeline's cache metadata (alignment, cues, captions) minus machine-local paths. */
  metadata: jsonb().notNull(),
  audio: bytea('audio').notNull(),
  audioExtension: varchar('audio_extension', { length: 16 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const demoRunManifests = pgTable('demo_run_manifests', {
  runId: varchar('run_id', { length: 160 }).primaryKey().notNull(),
  demoId: varchar('demo_id', { length: 128 }).notNull(),
  manifest: jsonb().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
