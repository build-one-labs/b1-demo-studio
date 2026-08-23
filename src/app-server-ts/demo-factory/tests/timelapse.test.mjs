import assert from 'node:assert/strict';
import test from 'node:test';
import {timelapseBudgetMs} from '../src/lib/actions.mjs';
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

test('a timelapse with nothing after it falls back to the default budget', () => {
  const cues = {'wait-start': 10_000};
  const actions = [{action: 'waitFor', atCue: 'wait-start', target: {css: '.spinner'}, timelapse: true}];
  assert.equal(timelapseBudgetMs(actions, 0, cues), 6000);
});
