import {
  boolean,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar
} from 'drizzle-orm/pg-core';

/**
 * Durable persistence for the demo factory's pipeline by-products.
 *
 * The first two tables below hold what used to exist only on the container
 * filesystem and therefore died with every redeploy:
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

/*
 * The Studio's own records.
 *
 * These used to be clob payloads of `b1_data_source_temporary` objects — rows
 * inside the blueprint repository. That made them repository content: exported
 * to git with every blueprint change, and overwritten from the repository's
 * `clob.json` by the data import every deployed app server runs at start, so a
 * redeploy threw away every demo, scene and demo user created in the Studio.
 * In the app database they are data like any other, and a deployment's
 * migrations leave them alone.
 *
 * Property names are the row field names of `demo-factory.rows.ts`, because the
 * embedded data sources map columns to fields by property key and the screens
 * bind to those fields. Values the pipeline writes as ISO strings (and run ids
 * that start with one) stay text: they round-trip unchanged, which the
 * reconciles compare on, and a run id's timestamp part is not a valid date.
 * Durations from a run are double precision: a recording's are fractional.
 *
 * Nested parts of a document (settings, actions, clip, cues) are jsonb: the zod
 * schema in `demo-factory/src/schema.mjs` decides what they may hold, not this
 * table.
 */

export const demoFactoryDemos = pgTable('demo_factory_demos', {
  id: varchar({ length: 128 }).primaryKey().notNull(),
  title: text().notNull().default(''),
  description: text().notNull().default(''),
  schemaVersion: integer('schema_version').notNull().default(1),
  settings: jsonb().notNull().default({}),
  setup: jsonb(),
  source: jsonb(),
  sceneCount: integer('scene_count').notNull().default(0),
  invalid: boolean().notNull().default(false),
  invalidReason: text('invalid_reason').notNull().default(''),
  /** Hash of the `demo.yaml` the row was last seeded from or materialized to. */
  sourceHash: varchar('source_hash', { length: 80 }).notNull().default(''),
  driftedFromFile: boolean('drifted_from_file').notNull().default(false),
  /**
   * When the row was last edited in the Studio; null for a row only ever
   * imported from its file. Deliberately not `updatedAt`: the data service
   * bumps a column of that name on every update, the seed's own included, and
   * this one must stay null until a person edits the demo.
   */
  editedAt: text('edited_at'),
  /**
   * E-mail of the user who created the demo — set on creation (a new demo, a
   * YAML import, a video import), never changed by a later write. Empty for a
   * demo imported from the repository's own files, which no user created.
   */
  owner: text().notNull().default('')
});

export const demoFactoryScenes = pgTable(
  'demo_factory_scenes',
  {
    /** `<demoId>:<sceneId>` — a scene id is unique only within its demo. */
    id: varchar({ length: 260 }).primaryKey().notNull(),
    demoId: varchar('demo_id', { length: 128 }).notNull(),
    sceneId: varchar('scene_id', { length: 128 }).notNull(),
    sequence: integer().notNull().default(0),
    title: text().notNull().default(''),
    baseUrl: text('base_url').notNull().default(''),
    route: text().notNull().default(''),
    narration: text().notNull().default(''),
    clip: jsonb(),
    mode: varchar({ length: 16 }).notNull().default(''),
    conversion: jsonb(),
    actions: jsonb().notNull().default([]),
    assertions: jsonb().notNull().default([])
  },
  (table) => [
    foreignKey({
      columns: [table.demoId],
      foreignColumns: [demoFactoryDemos.id],
      name: 'demo_factory_scenes_demo_fkey'
    }).onDelete('cascade'),
    index('demo_factory_scenes_demo_idx').on(table.demoId)
  ]
);

export const demoFactoryDemoUsers = pgTable('demo_factory_demo_users', {
  id: varchar({ length: 64 }).primaryKey().notNull(),
  label: text().notNull().default(''),
  appUrl: text('app_url').notNull().default(''),
  /** Filled from the secret store on every read; never true in the table. */
  configured: boolean().notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
});

export const demoFactoryJobs = pgTable('demo_factory_jobs', {
  id: varchar({ length: 160 }).primaryKey().notNull(),
  action: varchar({ length: 32 }),
  demoId: varchar('demo_id', { length: 128 }),
  status: varchar({ length: 32 }).notNull(),
  step: text(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  exitCode: integer('exit_code'),
  logFile: text('log_file')
});

/*
 * Runs and what belongs to them are a projection of the output volume: the run
 * ingest rebuilds them from the run directories on every start and after every
 * job, so a row exists exactly while its directory does. No foreign keys — a
 * run directory may outlive its demo's row.
 */

export const demoFactoryRuns = pgTable(
  'demo_factory_runs',
  {
    runId: varchar('run_id', { length: 160 }).primaryKey().notNull(),
    demoId: varchar('demo_id', { length: 128 }).notNull(),
    createdAt: text('created_at').notNull(),
    provider: varchar({ length: 32 }),
    sceneCount: integer('scene_count').notNull().default(0),
    recordedScenes: integer('recorded_scenes').notNull().default(0),
    durationMs: doublePrecision('duration_ms'),
    hasVideo: boolean('has_video').notNull().default(false),
    demoHash: varchar('demo_hash', { length: 80 }).notNull().default(''),
    baseUrl: text('base_url').notNull().default(''),
    recordedAt: text('recorded_at'),
    videoUrl: text('video_url').notNull().default(''),
    srtUrl: text('srt_url').notNull().default('')
  },
  (table) => [index('demo_factory_runs_demo_idx').on(table.demoId)]
);

export const demoFactoryRunScenes = pgTable(
  'demo_factory_run_scenes',
  {
    id: varchar({ length: 300 }).primaryKey().notNull(),
    runId: varchar('run_id', { length: 160 }).notNull(),
    demoId: varchar('demo_id', { length: 128 }).notNull(),
    sceneId: varchar('scene_id', { length: 128 }).notNull(),
    sequence: integer().notNull().default(0),
    title: text().notNull().default(''),
    durationMs: doublePrecision('duration_ms'),
    hasClip: boolean('has_clip').notNull().default(false),
    narrationDurationMs: doublePrecision('narration_duration_ms'),
    recordedDurationMs: doublePrecision('recorded_duration_ms'),
    narrationOffsetMs: doublePrecision('narration_offset_ms'),
    clipFile: text('clip_file').notNull().default(''),
    cues: jsonb().notNull().default({})
  },
  (table) => [index('demo_factory_run_scenes_run_idx').on(table.runId)]
);

export const demoFactoryNarration = pgTable(
  'demo_factory_narration',
  {
    id: varchar({ length: 300 }).primaryKey().notNull(),
    runId: varchar('run_id', { length: 160 }).notNull(),
    demoId: varchar('demo_id', { length: 128 }).notNull(),
    sceneId: varchar('scene_id', { length: 128 }).notNull(),
    sequence: integer().notNull().default(0),
    provider: varchar({ length: 32 }).notNull().default(''),
    cacheKey: varchar('cache_key', { length: 128 }).notNull().default(''),
    text: text().notNull().default(''),
    durationMs: doublePrecision('duration_ms'),
    cues: jsonb().notNull().default({}),
    audioUrl: text('audio_url').notNull().default(''),
    alignmentUrl: text('alignment_url').notNull().default('')
  },
  (table) => [index('demo_factory_narration_run_idx').on(table.runId)]
);

export const demoFactoryCaptions = pgTable(
  'demo_factory_captions',
  {
    id: varchar({ length: 320 }).primaryKey().notNull(),
    runId: varchar('run_id', { length: 160 }).notNull(),
    demoId: varchar('demo_id', { length: 128 }).notNull(),
    sceneId: varchar('scene_id', { length: 128 }).notNull(),
    index: integer().notNull(),
    startMs: doublePrecision('start_ms').notNull(),
    endMs: doublePrecision('end_ms').notNull(),
    text: text().notNull().default('')
  },
  (table) => [index('demo_factory_captions_run_idx').on(table.runId)]
);
