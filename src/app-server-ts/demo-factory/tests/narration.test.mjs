import assert from 'node:assert/strict';
import test from 'node:test';
import {mapCuesToAlignment} from '../src/lib/cues.mjs';
import {applyPronunciations, splitNarration} from '../src/lib/narration.mjs';

test('splitNarration cuts at sentence ends and concatenates back exactly', () => {
  const text = 'One sentence here. A second, slightly longer sentence follows! A third? And a trailing fragment';
  const chunks = splitNarration(text, 40);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks.slice(0, -1)) {
    assert.match(chunk.trimEnd(), /[.!?…]["')\]]*$/, `chunk does not end at a sentence: "${chunk}"`);
  }
});

test('splitNarration keeps an oversized single sentence whole and short text untouched', () => {
  const long = 'This single sentence is far longer than the limit allows but must not be cut in the middle of itself.';
  assert.deepEqual(splitNarration(long, 30), [long]);
  assert.deepEqual(splitNarration('Short.', 550), ['Short.']);
  assert.deepEqual(splitNarration('Anything at all', 0), ['Anything at all']);
});

test('cue mapping survives the edits ElevenLabs makes to the text', () => {
  // The real pattern from a take: a leading space is prepended and an em dash
  // becomes two hyphens — under proportional mapping every later cue smeared.
  const text = 'Hello world — and more words follow here.';
  const aligned = ' Hello world -- and more words follow here.';
  const perChar = 0.05;
  const alignment = {
    characters: [...aligned],
    character_start_times_seconds: [...aligned].map((_, index) => index * perChar),
    character_end_times_seconds: [...aligned].map((_, index) => (index + 1) * perChar),
  };
  const cues = {
    start: {characterOffset: 0},
    afterDash: {characterOffset: text.indexOf('and')},
    late: {characterOffset: text.indexOf('here')},
  };
  const mapped = mapCuesToAlignment(cues, text, alignment);
  // Exact expectation: each cue lands on the aligned index of its character.
  assert.equal(mapped.start, Math.round(aligned.indexOf('Hello') * perChar * 1000));
  assert.equal(mapped.afterDash, Math.round(aligned.indexOf('and') * perChar * 1000));
  assert.equal(mapped.late, Math.round(aligned.indexOf('here') * perChar * 1000));
});

test('pronunciations still rewrite before anything else', () => {
  assert.equal(applyPronunciations('Build.One rocks', {'Build.One': 'Build One'}), 'Build One rocks');
});
