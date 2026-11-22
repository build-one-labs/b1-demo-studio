import assert from 'node:assert/strict';
import test from 'node:test';
import {buildScenes, mergeCuts, segmentScenes, titleFromText, wordsToText} from '../src/lib/segment.mjs';

/** Words of a steady talker: `count` words of 300 ms with 100 ms gaps from `fromMs`. */
const speech = (fromMs, count, {sentenceEvery = 12, label = 'wort'} = {}) =>
  Array.from({length: count}, (_, index) => ({
    text: `${label}${index}${(index + 1) % sentenceEvery === 0 ? '.' : ''}`,
    startMs: fromMs + index * 400,
    endMs: fromMs + index * 400 + 300,
  }));

const covers = (scenes, durationMs) => {
  assert.equal(scenes[0].startMs, 0);
  assert.equal(scenes.at(-1).endMs, durationMs);
  for (let index = 1; index < scenes.length; index += 1) assert.equal(scenes[index].startMs, scenes[index - 1].endMs);
};

test('a short video stays one scene', () => {
  const scenes = segmentScenes({durationMs: 14_000, words: speech(500, 20), cuts: []});
  assert.deepEqual(scenes, [{startMs: 0, endMs: 14_000, reason: 'whole'}]);
});

test('cuts where a speech pause and a screen change coincide', () => {
  // 3 × ~20 s of talk, separated by 1.5 s pauses that each contain a navigation.
  const words = [...speech(0, 50), ...speech(21_500, 50, {label: 'b'}), ...speech(43_000, 50, {label: 'c'})];
  const durationMs = 63_500;
  const cuts = [{atMs: 20_600, score: 0.6}, {atMs: 42_200, score: 0.5}, {atMs: 30_000, score: 0.15}];
  const scenes = segmentScenes({durationMs, words, cuts});
  covers(scenes, durationMs);
  assert.equal(scenes.length, 3);
  assert.ok(Math.abs(scenes[1].startMs - 20_350) < 300, `second scene starts at ${scenes[1].startMs}`);
  assert.ok(Math.abs(scenes[2].startMs - 41_950) < 300, `third scene starts at ${scenes[2].startMs}`);
});

test('never cuts inside a word', () => {
  const words = speech(0, 300, {sentenceEvery: 1000}); // 120 s of talk, no pause, no sentence end
  const durationMs = 120_000;
  const cuts = [{atMs: 40_150, score: 0.9}]; // inside word 100 (40 000–40 300)
  const scenes = segmentScenes({durationMs, words, cuts});
  covers(scenes, durationMs);
  for (const scene of scenes.slice(1)) {
    assert.ok(!words.some((word) => scene.startMs > word.startMs && scene.startMs < word.endMs), `cut at ${scene.startMs} splits a word`);
  }
  for (const scene of scenes) assert.ok(scene.endMs - scene.startMs <= 45_000 + 1, 'scene longer than the maximum');
});

test('a silent recording is cut at its screen changes', () => {
  const durationMs = 90_000;
  const cuts = [{atMs: 31_000, score: 0.7}, {atMs: 58_000, score: 0.8}, {atMs: 58_400, score: 0.3}];
  const scenes = segmentScenes({durationMs, words: [], cuts});
  covers(scenes, durationMs);
  assert.deepEqual(scenes.map((scene) => scene.startMs), [0, 30_750, 57_750]);
});

test('a long silent recording without changes still respects the maximum', () => {
  const scenes = segmentScenes({durationMs: 200_000, words: [], cuts: []});
  covers(scenes, 200_000);
  for (const scene of scenes) {
    const length = scene.endMs - scene.startMs;
    assert.ok(length >= 12_000 && length <= 45_000, `scene of ${length} ms`);
  }
});

test('mergeCuts keeps the strongest change of a burst', () => {
  assert.deepEqual(mergeCuts([{atMs: 1000, score: 0.2}, {atMs: 1400, score: 0.7}, {atMs: 2000, score: 0.3}, {atMs: 9000, score: 0.4}]), [
    {atMs: 1400, score: 0.7},
    {atMs: 9000, score: 0.4},
  ]);
});

test('wordsToText drops fillers and tidies punctuation', () => {
  const words = ['ähm', 'hier', 'sehen', 'wir', ',', 'äh,', 'die', 'Liste', '.'].map((text) => ({text}));
  assert.equal(wordsToText(words), 'Hier sehen wir, die Liste.');
  const opener = ['Das', 'ist', 'Build.One.', 'Ähm,', 'in', 'dieser', 'Liste', 'stehen', 'Demos.'].map((text) => ({text}));
  assert.equal(wordsToText(opener), 'Das ist Build.One. In dieser Liste stehen Demos.');
});

test('titleFromText shortens the first sentence and falls back to a number', () => {
  assert.equal(titleFromText('Wir öffnen die Kundenliste. Dann filtern wir.', 0), 'Wir öffnen die Kundenliste');
  assert.equal(titleFromText('Jetzt legen wir einen neuen Auftrag für den Kunden an.', 1), 'Jetzt legen wir einen neuen Auftrag für …');
  assert.equal(titleFromText('', 2, 'de'), 'Szene 3');
  assert.equal(titleFromText('', 2, 'en'), 'Scene 3');
});

test('buildScenes assigns every word to exactly one scene', () => {
  const words = [...speech(0, 50), ...speech(21_500, 50, {label: 'b'})];
  const scenes = buildScenes({durationMs: 42_000, words, cuts: [{atMs: 20_800, score: 0.6}]});
  assert.equal(scenes.length, 2);
  const spoken = scenes.map((scene) => scene.narration.split(' ').length).reduce((a, b) => a + b, 0);
  assert.equal(spoken, words.length);
  assert.equal(scenes[0].id, 'scene-01');
  assert.equal(scenes[1].clip.startMs, scenes[0].clip.endMs);
  assert.equal(scenes[1].clip.endMs, 42_000);
  // The second scene's first word starts 21.5 s into the video.
  assert.equal(scenes[1].clip.voiceAtMs, 21_500 - scenes[1].clip.startMs);
});
