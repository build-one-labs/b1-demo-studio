import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {demoSchema} from '../src/schema.mjs';
import {validateDemoSemantics} from '../src/lib/files.mjs';
import {clipTiming, MAX_SPEEDUP, resolveSourceVideo, resolveUploadsRoot, uploadDir} from '../src/lib/source-video.mjs';

const settings = {
  viewport: {width: 1920, height: 1080},
  baseUrl: {env: 'B1_BASE_URL', fallback: 'http://localhost:8080/'},
  narration: {voiceIdEnv: 'V', apiKeyEnv: 'K', modelIdEnv: 'M', defaultModelId: 'm', languageCodeEnv: 'L', defaultLanguageCode: 'de'},
  branding: {productName: 'Build.One', accentColor: '#1266f1', backgroundColor: '#0b1020', textColor: '#fff'},
};
/** `source: null` builds the demo without one. */
const videoDemo = (scenes, source = {video: '20261121101500-abc123/source.mp4', durationMs: 60_000}) =>
  demoSchema.parse({schemaVersion: 1, id: 'crm-tour', title: 'CRM Tour', settings, ...(source ? {source} : {}), scenes});

test('a video demo validates without routes, and with an unspoken scene', () => {
  const demo = videoDemo([
    {id: 'scene-01', title: 'Liste', narration: 'Wir öffnen die Liste.', clip: {startMs: 0, endMs: 30_000}},
    {id: 'scene-02', title: 'Szene 2', narration: '', clip: {startMs: 30_000, endMs: 60_000}},
  ]);
  assert.doesNotThrow(() => validateDemoSemantics(demo));
});

test('a clip needs the source video; actions on it are an inert draft', () => {
  const clip = {id: 'scene-01', title: 'Liste', narration: 'Text.', clip: {startMs: 0, endMs: 1000}};
  assert.throws(() => validateDemoSemantics(videoDemo([clip], null)), /source video/);
  // A conversion that could not prove its script leaves it on the clip scene.
  assert.doesNotThrow(() => validateDemoSemantics(videoDemo([{...clip, actions: [{action: 'click', target: {text: 'OK'}}]}])));
  assert.throws(() => videoDemo([{...clip, clip: {startMs: 5000, endMs: 1000}}]), /after clip.startMs/);
});

test('a filmed scene still needs its route and its narration', () => {
  assert.throws(() => validateDemoSemantics(videoDemo([{id: 'a', title: 'A', narration: 'Text.'}])), /route is required/);
  assert.throws(() => validateDemoSemantics(videoDemo([{id: 'a', title: 'A', route: '/', narration: ' '}])), /narration is required/);
});

test('source.video must stay inside the uploads directory', () => {
  assert.throws(() => videoDemo([{id: 'a', title: 'A', narration: '', clip: {startMs: 0, endMs: 1}}], {video: '../../etc/passwd'}), /upload-id/);
  assert.equal(resolveSourceVideo({video: 'abc/source.mp4'}), path.join(resolveUploadsRoot(), 'abc', 'source.mp4'));
  assert.throws(() => uploadDir('../x'), /Invalid upload id/);
});

test('clipTiming fits the footage to the new voice-over', () => {
  const holds = {holdBeforeMs: 400, holdAfterMs: 1000};
  // Same length: real time, voice after the hold.
  assert.deepEqual(clipTiming({sourceMs: 21_000, narrationMs: 20_000, ...holds}), {speed: 1, playMs: 21_000, freezeMs: 400, narrationOffsetMs: 400, timelapse: null});
  // The new voice is faster: the footage plays faster with it.
  const faster = clipTiming({sourceMs: 30_000, narrationMs: 19_000, ...holds});
  assert.equal(faster.speed, 1.5);
  assert.equal(faster.playMs, 20_000);
  // Far too long for its text: capped at MAX_SPEEDUP, the rest runs silent.
  assert.equal(clipTiming({sourceMs: 60_000, narrationMs: 3_000, ...holds}).speed, MAX_SPEEDUP);
  // The new voice needs longer: slowed to 0.8×, then the last frame holds.
  const slower = clipTiming({sourceMs: 8_000, narrationMs: 18_600, ...holds});
  assert.equal(slower.speed, 0.8);
  assert.equal(slower.playMs + slower.freezeMs, 20_000);
  // No voice-over: the footage plays as recorded.
  assert.deepEqual(clipTiming({sourceMs: 12_345, narrationMs: 0, ...holds}), {speed: 1, playMs: 12_345, freezeMs: 0, narrationOffsetMs: 0, timelapse: null});
});

test('a long silent lead-in is fast-forwarded and the voice starts where the author spoke', () => {
  // 10 s of a page loading, then 13 s of talk re-voiced in 12 s.
  const timing = clipTiming({sourceMs: 23_000, narrationMs: 12_000, holdBeforeMs: 400, holdAfterMs: 1000, voiceAtMs: 10_000});
  assert.equal(timing.speed, 1);
  assert.deepEqual(timing.timelapse, {fromMs: 0, toMs: 10_000, targetMs: 2_500});
  assert.equal(timing.narrationOffsetMs, 2_500);
  assert.equal(timing.freezeMs, 0);
  // A short lead-in plays as it is; the voice still waits for it.
  const short = clipTiming({sourceMs: 15_000, narrationMs: 11_000, holdBeforeMs: 400, holdAfterMs: 1000, voiceAtMs: 2_000});
  assert.equal(short.timelapse, null);
  assert.ok(short.narrationOffsetMs >= 1_500 && short.narrationOffsetMs <= 2_000);
});
