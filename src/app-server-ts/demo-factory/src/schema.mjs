import {z} from 'zod';

const targetSchema = z.object({
  demoId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  css: z.string().optional(),
}).refine((target) => Object.values(target).some(Boolean), 'A target selector is required');

export const actionSchema = z.object({
  action: z.enum(['goto', 'click', 'dblclick', 'fill', 'type', 'press', 'hover', 'highlight', 'callout', 'waitFor', 'screenshot']),
  atCue: z.string().optional(),
  atMs: z.number().int().nonnegative().optional(),
  offsetMs: z.number().int().optional(),
  target: targetSchema.optional(),
  route: z.string().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** `type` only: milliseconds between keystrokes. */
  delayMs: z.number().int().nonnegative().optional(),
  /**
   * `waitFor` only: record the wait in real time, then compress it to
   * `targetMs` in the rendered video. Without `targetMs`, the compressed
   * length is the narration's own budget — the gap to the next cue-bound
   * action — so the footage after the wait lands back on its cue.
   */
  timelapse: z.union([z.literal(true), z.object({targetMs: z.number().int().positive().optional()})]).optional(),
  /**
   * `waitFor` only: the target must stay visible this long, continuously,
   * before the wait counts as met. For states that flicker — an agent's
   * status chip reads "Ready" between working steps — a plain visibility
   * wait fires on the flicker; this rides it out.
   */
  stableMs: z.number().int().positive().optional(),
  /**
   * `waitFor` only: a rescue click. While the wait's own target has not
   * appeared, this target is clicked whenever it is visible (at most every
   * `everyMs`, default 45s) — for live environments that fail transiently
   * and offer a Retry button.
   */
  retry: z.object({
    target: targetSchema,
    everyMs: z.number().int().positive().optional(),
  }).optional(),
  name: z.string().optional(),
}).refine((action) => (!action.timelapse && !action.stableMs && !action.retry) || action.action === 'waitFor', {message: 'timelapse, stableMs and retry are only valid on waitFor actions'})
  .refine((action) => action.action !== 'callout' || typeof action.value === 'string', {message: 'callout requires value (empty string clears the banner)'});

export const assertionSchema = z.union([
  z.object({visible: targetSchema}),
  z.object({textContains: z.object({target: targetSchema, value: z.string()})}),
]);

/**
 * A time range of the demo's source video (milliseconds). A scene with a clip
 * is cut out of the author's own screen recording instead of being filmed by
 * Playwright — see `src/lib/source-video.mjs`.
 */
const clipSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  /**
   * Where in the clip the voice-over starts (ms from startMs) — where the
   * author began speaking. Silence before it longer than a few seconds plays
   * fast-forwarded. Absent: the voice-over starts after holdBeforeMs.
   */
  voiceAtMs: z.number().int().nonnegative().optional(),
}).refine((clip) => clip.endMs > clip.startMs, {message: 'clip.endMs must be after clip.startMs'})
  .refine((clip) => clip.voiceAtMs === undefined || clip.voiceAtMs < clip.endMs - clip.startMs, {message: 'clip.voiceAtMs must lie inside the clip'});

/**
 * What a converted scene remembers of its conversion (`cli.mjs convert`): an
 * author reads it to see why a scene stayed a clip, or what to check.
 */
const conversionSchema = z.object({
  status: z.enum(['filmed', 'failed']),
  message: z.string().default(''),
  at: z.string().optional(),
  model: z.string().optional(),
});

const sceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  /**
   * The application this scene runs in, when it is not the demo's own
   * (settings.baseUrl) — a demo that starts in one app and shows the result in
   * another. An absolute URL; `route` is resolved against it.
   */
  baseUrl: z.string().url().optional(),
  /** Where the browser opens — required for a filmed scene; for a clip scene, where the recording shows. */
  route: z.string().startsWith('/').optional(),
  /** May be empty only in a clip scene: a stretch of the recording without voice-over. */
  narration: z.string(),
  clip: clipSchema.optional(),
  /**
   * How the scene becomes footage: `clip` cuts it out of the source video,
   * `film` has Playwright perform its actions. Absent: clip when the scene has
   * a clip, film otherwise. A converted scene keeps its clip as the fallback.
   */
  mode: z.enum(['clip', 'film']).optional(),
  conversion: conversionSchema.optional(),
  actions: z.array(actionSchema).default([]),
  assertions: z.array(assertionSchema).default([]),
});

/** Whether a scene is cut out of the source video rather than filmed. */
export const isClipScene = (scene) => (scene.mode ? scene.mode === 'clip' : Boolean(scene.clip));

/** The application a scene runs in: its own, else the demo's (an environment variable wins over the fallback). */
export const sceneBaseUrl = (demo, scene, env = process.env) =>
  scene.baseUrl || (demo.settings.baseUrl.env && env[demo.settings.baseUrl.env]) || demo.settings.baseUrl.fallback;

/**
 * The screen recording a video demo was made from. `video` is
 * `<upload-id>/<file>` under `<output>/uploads/`; the rest is what the analysis
 * measured, kept for the Studio and for re-analysis.
 */
const sourceSchema = z.object({
  video: z.string().regex(/^[a-z0-9][a-z0-9-]*\/[\w.-]+$/, 'source.video is <upload-id>/<file>'),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  language: z.string().optional(),
  analyzedAt: z.string().optional(),
});

/**
 * Actions run before any scene records, in a browser context that is never
 * filmed — resetting the environment, seeding state, dismissing first-run
 * dialogs. No narration, so `atCue` has nothing to bind to: actions run in
 * order, each as soon as the one before it finished.
 */
const setupSchema = z.object({
  route: z.string().startsWith('/'),
  actions: z.array(actionSchema).default([]),
  assertions: z.array(assertionSchema).default([]),
});

export const demoSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  description: z.string().default(''),
  settings: z.object({
    language: z.string().default('de'),
    viewport: z.object({width: z.number().int().positive(), height: z.number().int().positive()}),
    fps: z.number().int().min(24).max(60).default(30),
    baseUrl: z.object({env: z.string(), fallback: z.string().url()}),
    authStateEnv: z.string().default('B1_AUTH_STATE'),
    headlessEnv: z.string().default('DEMO_HEADLESS'),
    /**
     * Reset the blueprint repository of the demo's application (settings.baseUrl)
     * before every recording and conversion — the changesSearch screen's "Reset
     * repository": the take starts from the environment's delivered state.
     * Applications that only some scenes name are not reset.
     */
    resetRepository: z.boolean().default(false),
    /**
     * The demo user takes are signed in as — the id of a Studio demo user
     * (Settings → Demo users), whose API key the server hands to the job.
     * Absent: the host's own key.
     */
    demoUser: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    holdBeforeMs: z.number().int().nonnegative().default(500),
    holdAfterMs: z.number().int().nonnegative().default(1000),
    cursor: z.object({
      enabled: z.boolean().default(true),
      moveDurationMs: z.number().int().positive().default(650),
      clickLeadMs: z.number().int().nonnegative().default(110),
      clickEffectDurationMs: z.number().int().positive().default(520),
      sizePx: z.number().int().min(16).max(64).default(30),
    }).default({
      enabled: true,
      moveDurationMs: 650,
      clickLeadMs: 110,
      clickEffectDurationMs: 520,
      sizePx: 30,
    }),
    narration: z.object({
      provider: z.enum(['auto', 'elevenlabs', 'silent']).default('auto'),
      voiceIdEnv: z.string(),
      apiKeyEnv: z.string(),
      modelIdEnv: z.string(),
      defaultModelId: z.string(),
      languageCodeEnv: z.string(),
      defaultLanguageCode: z.string(),
      wordsPerMinute: z.number().positive().default(130),
      /**
       * Spoken-form replacements applied to the narration before cue parsing
       * and synthesis. The written text keeps the brand spelling; the voice
       * gets the pronounceable one — "Build.One" spoken as "Build One"
       * instead of a sentence break after "Build".
       */
      pronunciations: z.record(z.string()).default({}),
      /**
       * Split a scene's narration into chunks of at most this many characters
       * (at sentence boundaries) and synthesize them as stitched requests —
       * each conditioned on its neighbours' text and the previous requests'
       * ids. A cloned voice drifts over long single calls; short anchored
       * calls are ElevenLabs' own remedy. 0 disables chunking.
       */
      chunkChars: z.number().int().nonnegative().default(550),
      /**
       * ElevenLabs voice settings. Long single-call narrations drift with
       * cloned voices; raising stability (and dropping style) is the lever
       * that keeps a two-minute scene sounding like one person throughout.
       */
      voiceSettings: z.object({
        stability: z.number().min(0).max(1).default(0.62),
        similarityBoost: z.number().min(0).max(1).default(0.82),
        style: z.number().min(0).max(1).default(0.18),
        speakerBoost: z.boolean().default(true),
      }).default({stability: 0.62, similarityBoost: 0.82, style: 0.18, speakerBoost: true}),
    }),
    branding: z.object({
      productName: z.string(),
      accentColor: z.string(),
      backgroundColor: z.string(),
      textColor: z.string(),
      showCaptions: z.boolean().default(true),
      showSceneTitles: z.boolean().default(true),
    }),
  }),
  setup: setupSchema.optional(),
  source: sourceSchema.optional(),
  scenes: z.array(sceneSchema).min(1),
});
