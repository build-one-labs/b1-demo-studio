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
  action: z.enum(['goto', 'click', 'fill', 'press', 'hover', 'highlight', 'waitFor', 'screenshot']),
  atCue: z.string().optional(),
  atMs: z.number().int().nonnegative().optional(),
  offsetMs: z.number().int().optional(),
  target: targetSchema.optional(),
  route: z.string().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  name: z.string().optional(),
});

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
  scenes: z.array(sceneSchema).min(1),
});
