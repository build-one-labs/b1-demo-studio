import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {timelapseBudgetMs} from '../src/lib/actions.mjs';
import {projectRoot, resolveCacheRoot} from '../src/lib/files.mjs';
import {applyPronunciations} from '../src/lib/narration.mjs';
import {demoSchema} from '../src/schema.mjs';

const minimalDemo = (actions) => ({
  schemaVersion: 1,
  id: 'timelapse-check',
  title: 'Timelapse check',
  settings: {
    language: 'en',
    viewport: {width: 1920, height: 1080},
    baseUrl: {env: 'B1_BASE_URL', fallback: 'http://localhost:8080/'},
    narration: {
      provider: 'auto',
      voiceIdEnv: 'ELEVENLABS_VOICE_ID',
      apiKeyEnv: 'ELEVENLABS_API_KEY',
      modelIdEnv: 'ELEVENLABS_MODEL_ID',
      defaultModelId: 'eleven_multilingual_v2',
      languageCodeEnv: 'ELEVENLABS_LANGUAGE_CODE',
      defaultLanguageCode: 'en',
    },
    branding: {
      productName: 'Build.One',
      accentColor: '#1266f1',
      backgroundColor: '#0b1020',
      textColor: '#f7f8ff',
    },
  },
  scenes: [
    {
      id: 'one',
      title: 'One',
      route: '/',
      narration: 'Waiting. [cue:wait-start] Still waiting. [cue:resume] Done.',
      actions,
      assertions: [],
    },
  ],
});

test('timelapse is accepted on waitFor and refused elsewhere', () => {
  const good = minimalDemo([
    {action: 'waitFor', atCue: 'wait-start', target: {css: '.row'}, timelapse: true},
  ]);
  assert.ok(demoSchema.safeParse(good).success);

  const bad = minimalDemo([
    {action: 'click', atCue: 'wait-start', target: {css: '.row'}, timelapse: true},
  ]);
  assert.equal(demoSchema.safeParse(bad).success, false);
});

test('type action with a keystroke delay validates', () => {
  const demo = minimalDemo([
    {action: 'type', atCue: 'wait-start', target: {css: 'textarea'}, value: 'hello', delayMs: 30},
  ]);
  assert.ok(demoSchema.safeParse(demo).success);
});

test('the budget of a timelapse wait is the gap to the next cue-bound action', () => {
  const cues = {'wait-start': 10_000, resume: 18_000};
  const actions = [
    {action: 'waitFor', atCue: 'wait-start', target: {css: '.spinner'}, timelapse: true},
    {action: 'highlight', atCue: 'resume', target: {css: '.result'}},
  ];
  assert.equal(timelapseBudgetMs(actions, 0, cues), 8000);
});

test('an explicit targetMs wins over the cue budget', () => {
  const cues = {'wait-start': 10_000, resume: 18_000};
  const actions = [
    {action: 'waitFor', atCue: 'wait-start', target: {css: '.spinner'}, timelapse: {targetMs: 4000}},
    {action: 'highlight', atCue: 'resume', target: {css: '.result'}},
  ];
  assert.equal(timelapseBudgetMs(actions, 0, cues), 4000);
});

test('stableMs and retry validate on waitFor and are refused elsewhere', () => {
  const good = minimalDemo([
    {
      action: 'waitFor',
      atCue: 'wait-start',
      target: {css: '.chip'},
      stableMs: 15_000,
      retry: {target: {text: 'Retry'}, everyMs: 45_000},
    },
  ]);
  assert.ok(demoSchema.safeParse(good).success);

  const bad = minimalDemo([
    {action: 'click', atCue: 'wait-start', target: {css: '.chip'}, retry: {target: {text: 'Retry'}}},
  ]);
  assert.equal(demoSchema.safeParse(bad).success, false);
});

test('a setup block validates and stays optional', () => {
  const withSetup = {
    ...minimalDemo([]),
    setup: {
      route: '/screens/changesSearch?app=b1',
      actions: [
        {action: 'click', target: {text: 'Reset Repository'}},
        {action: 'waitFor', target: {text: 'Repository reset'}, timeoutMs: 120_000},
      ],
    },
  };
  assert.ok(demoSchema.safeParse(withSetup).success);
  assert.ok(demoSchema.safeParse(minimalDemo([])).success);
});

test('pronunciations rewrite the spoken form everywhere, cues untouched', () => {
  const spoken = applyPronunciations(
    'This is Build.One. [cue:beat] Build.One again — governance in Build.One.',
    {'Build.One': 'Build One'},
  );
  assert.equal(spoken, 'This is Build One. [cue:beat] Build One again — governance in Build One.');
  assert.equal(applyPronunciations('unchanged text', {}), 'unchanged text');
});

test('narration settings default pronunciations and voice settings', () => {
  const parsed = demoSchema.parse(minimalDemo([]));
  assert.deepEqual(parsed.settings.narration.pronunciations, {});
  assert.deepEqual(parsed.settings.narration.voiceSettings, {
    stability: 0.62,
    similarityBoost: 0.82,
    style: 0.18,
    speakerBoost: true,
  });
});

test('the narration cache root honours DEMO_CACHE_DIR', () => {
  const previous = process.env.DEMO_CACHE_DIR;
  try {
    delete process.env.DEMO_CACHE_DIR;
    assert.equal(resolveCacheRoot(), path.join(projectRoot, '.cache'));
    process.env.DEMO_CACHE_DIR = '/data/demo-factory/cache';
    assert.equal(resolveCacheRoot(), '/data/demo-factory/cache');
  } finally {
    if (previous === undefined) delete process.env.DEMO_CACHE_DIR;
    else process.env.DEMO_CACHE_DIR = previous;
  }
});

test('a timelapse with nothing after it falls back to the default budget', () => {
  const cues = {'wait-start': 10_000};
  const actions = [{action: 'waitFor', atCue: 'wait-start', target: {css: '.spinner'}, timelapse: true}];
  assert.equal(timelapseBudgetMs(actions, 0, cues), 6000);
});
