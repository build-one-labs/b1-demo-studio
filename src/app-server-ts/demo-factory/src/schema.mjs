import {z} from 'zod';

const targetSchema = z.object({
  demoId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  css: z.string().optional(),
}).refine((target) => Object.values(target).some(Boolean), 'A target selector is required');

const actionSchema = z.object({
  action: z.enum(['goto', 'click', 'dblclick', 'fill', 'type', 'press', 'hover', 'highlight', 'waitFor', 'screenshot']),
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
}).refine((action) => (!action.timelapse && !action.stableMs && !action.retry) || action.action === 'waitFor', {message: 'timelapse, stableMs and retry are only valid on waitFor actions'});

const assertionSchema = z.union([
  z.object({visible: targetSchema}),
  z.object({textContains: z.object({target: targetSchema, value: z.string()})}),
]);

const sceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  route: z.string().startsWith('/'),
  narration: z.string().min(1),
  actions: z.array(actionSchema).default([]),
  assertions: z.array(assertionSchema).default([]),
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
  scenes: z.array(sceneSchema).min(1),
});
