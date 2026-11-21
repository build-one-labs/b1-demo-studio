import assert from 'node:assert/strict';
import test from 'node:test';
import {demoSchema, isClipScene, sceneBaseUrl} from '../src/schema.mjs';
import {validateDemoSemantics} from '../src/lib/files.mjs';
import {keyframeTimes, timedTranscript, toDemoScene} from '../src/lib/convert.mjs';

const settings = {
  viewport: {width: 1920, height: 1080},
  baseUrl: {env: '', fallback: 'https://samples.demo.build.one/'},
  narration: {voiceIdEnv: 'V', apiKeyEnv: 'K', modelIdEnv: 'M', defaultModelId: 'm', languageCodeEnv: 'L', defaultLanguageCode: 'de'},
  branding: {productName: 'Build.One', accentColor: '#1266f1', backgroundColor: '#0b1020', textColor: '#fff'},
};
const demoWith = (scenes) => demoSchema.parse({
  schemaVersion: 1,
  id: 'converted',
  title: 'Converted',
  settings,
  source: {video: '20261121101500-abc123/source.mp4', durationMs: 60_000},
  scenes,
});
const clip = {startMs: 0, endMs: 20_000};

test('keyframes: the start, every screen change, the end — thinned when there are many', () => {
  assert.deepEqual(keyframeTimes({startMs: 10_000, endMs: 30_000}, [{atMs: 15_000}, {atMs: 15_200}, {atMs: 40_000}]), [10_600, 15_400, 29_600]);
  const many = Array.from({length: 30}, (_, index) => ({atMs: 1000 + index * 1500}));
  const times = keyframeTimes({startMs: 0, endMs: 50_000}, many);
  assert.equal(times.length, 8);
  assert.equal(times[0], 600);
  assert.equal(times.at(-1), 49_600);
});

test('the transcript is timed from the clip start and broken at pauses and sentence ends', () => {
  const words = [
    {text: 'Wir', startMs: 9000, endMs: 9200},
    {text: 'öffnen', startMs: 10_100, endMs: 10_400},
    {text: 'Rechnungen.', startMs: 10_500, endMs: 11_000},
    {text: 'Dann', startMs: 11_100, endMs: 11_300},
    {text: 'filtern', startMs: 13_000, endMs: 13_400},
  ];
  assert.equal(timedTranscript(words, {startMs: 10_000, endMs: 20_000}), '[0.1s] öffnen Rechnungen.\n[1.1s] Dann\n[3.0s] filtern');
});

test("Claude's nullable answer becomes schema actions with cues", () => {
  const scene = toDemoScene({
    narration: 'Wir öffnen [cue:open]die Rechnungen.',
    actions: [
      {action: 'click', cue: null, target: {role: 'button', name: 'Finance', label: null, text: null, css: null}, route: null, value: null, key: null, durationMs: null, timeoutMs: null},
      {action: 'click', cue: 'open', target: {role: null, name: null, label: null, text: 'Invoices', css: null}, route: null, value: null, key: null, durationMs: null, timeoutMs: null},
      {action: 'goto', cue: null, target: null, route: 'https://platform.demo.build.one/screens/ChangeRequests', value: null, key: null, durationMs: null, timeoutMs: 20_000},
    ],
    assertions: [{role: null, name: null, label: null, text: 'List of Invoices', css: null}],
    confidence: 'high',
    notes: '',
  });
  assert.deepEqual(scene.actions, [
    {action: 'click', target: {role: 'button', name: 'Finance'}},
    {action: 'click', atCue: 'open', target: {text: 'Invoices'}},
    {action: 'goto', route: 'https://platform.demo.build.one/screens/ChangeRequests', timeoutMs: 20_000},
  ]);
  assert.deepEqual(scene.assertions, [{visible: {text: 'List of Invoices'}}]);
  // …and validates as a filmed scene.
  validateDemoSemantics(demoWith([{id: 'a', title: 'A', route: '/', clip, mode: 'film', ...scene}]));
});

test('a scene is a clip by its mode, else by having a clip', () => {
  assert.equal(isClipScene({clip}), true);
  assert.equal(isClipScene({clip, mode: 'film'}), false);
  assert.equal(isClipScene({route: '/'}), false);
  assert.equal(isClipScene({clip, mode: 'clip'}), true);
});

test("a scene runs in its own application, else in the demo's", () => {
  const demo = {settings: {baseUrl: {env: 'B1_BASE_URL', fallback: 'https://samples.demo.build.one/'}}};
  assert.equal(sceneBaseUrl(demo, {}, {}), 'https://samples.demo.build.one/');
  assert.equal(sceneBaseUrl(demo, {}, {B1_BASE_URL: 'http://caddy:8080/'}), 'http://caddy:8080/');
  assert.equal(sceneBaseUrl(demo, {baseUrl: 'https://platform.demo.build.one/'}, {B1_BASE_URL: 'http://caddy:8080/'}), 'https://platform.demo.build.one/');
  // An empty variable name means the fallback always applies.
  assert.equal(sceneBaseUrl({settings}, {}, {'': 'x'}), 'https://samples.demo.build.one/');
});

test('a failed conversion keeps its draft actions on a clip scene; a filmed one needs a route and narration', () => {
  validateDemoSemantics(demoWith([{
    id: 'a', title: 'A', narration: '', clip, mode: 'clip',
    conversion: {status: 'failed', message: 'locator timed out'},
    actions: [{action: 'click', atCue: 'nowhere', target: {text: 'X'}}],
  }]));
  assert.throws(() => validateDemoSemantics(demoWith([{id: 'a', title: 'A', narration: 'Text.', clip, mode: 'film'}])), /route is required/);
  assert.throws(() => validateDemoSemantics(demoWith([{id: 'a', title: 'A', route: '/', narration: '', clip, mode: 'film'}])), /narration is required/);
  assert.throws(() => validateDemoSemantics(demoWith([{id: 'a', title: 'A', route: '/', narration: 'x', mode: 'clip'}])), /mode clip needs a clip/);
  assert.throws(() => demoWith([{id: 'a', title: 'A', baseUrl: 'not a url', route: '/', narration: 'x'}]), /url/i);
});
