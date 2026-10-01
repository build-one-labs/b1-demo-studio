import assert from 'node:assert/strict';
import test from 'node:test';
import {mapCuesToAlignment} from '../src/lib/cues.mjs';
import {applyPronunciations, splitNarration, splitNarrationForModel, callElevenLabs} from '../src/lib/narration.mjs';

test('v4 dialogue requests preserve timestamps and adapt settings and continuity', async (t) => {
  const payload = {audio_base64: 'YWJj', alignment: {
    characters: ['H'], character_start_times_seconds: [0], character_end_times_seconds: [0.1],
  }};
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({url, body: JSON.parse(options.body)});
    return new Response(JSON.stringify(payload), {headers: {'request-id': 'take-1'}});
  });
  const args = {text: 'Hello.', apiKey: 'test-key', voiceId: 'voice/id', languageCode: 'en',
    voiceSettings: {stability: 0.9, similarityBoost: 0.88, style: 0, speakerBoost: true},
    previousText: 'p'.repeat(150), nextText: 'n'.repeat(150), previousRequestIds: ['1', '2', '3', '4']};
  assert.deepEqual(await callElevenLabs({...args, modelId: 'eleven_v4'}), {payload, requestId: 'take-1'});
  assert.equal(requests[0].url, 'https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps?output_format=mp3_44100_128');
  assert.deepEqual(requests[0].body, {
    inputs: [{text: 'Hello.', voice_id: 'voice/id'}], model_id: 'eleven_v4', language_code: 'en',
    seed: 424242, apply_text_normalization: 'auto',
    future_text: 'n'.repeat(100), previous_request_ids: ['2', '3', '4'],
    settings: {stability: 0.9, similarity: 0.88},
  });
  await callElevenLabs({...args, modelId: 'eleven_multilingual_v2'});
  assert.match(requests[1].url, /text-to-speech\/voice%2Fid\/with-timestamps/);
  assert.equal(requests[1].body.text, 'Hello.');
  assert.equal(requests[1].body.next_text.length, 150);
  assert.deepEqual(requests[1].body.voice_settings, {
    stability: 0.9, similarity_boost: 0.88, style: 0, use_speaker_boost: true,
  });
  assert.equal(requests[1].body.inputs, undefined);
  await callElevenLabs({...args, modelId: 'eleven_v4', previousRequestIds: []});
  assert.equal(requests[2].body.previous_text, 'p'.repeat(100));
  assert.equal(requests[2].body.previous_request_ids, undefined);
  await callElevenLabs({...args, modelId: 'eleven_v4', previousRequestIds: undefined});
  assert.equal(requests[3].body.previous_text, 'p'.repeat(100));
  assert.equal(requests[3].body.previous_request_ids, undefined);
});

test('v4 caps requests even with chunking disabled or oversized sentences', () => {
  const text = 'A'.repeat(4500) + '. Next sentence.';
  for (const chunkChars of [0, 550, 9000]) {
    const chunks = splitNarrationForModel(text, chunkChars, 'eleven_v4');
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every((chunk) => chunk.length <= 2000));
  }
  assert.deepEqual(splitNarrationForModel(text, 0, 'eleven_multilingual_v2'), [text]);
});

test('dialogue errors surface without a silent fallback', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('model unavailable', {status: 400}));
  await assert.rejects(callElevenLabs({text: 'Hello', apiKey: 'key', voiceId: 'voice',
    modelId: 'eleven_v4', voiceSettings: {stability: 0.5}}), /ElevenLabs returned 400: model unavailable/);
});

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
