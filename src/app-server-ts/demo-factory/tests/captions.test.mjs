import assert from 'node:assert/strict';
import test from 'node:test';
import {alignmentToCaptions, captionsToSrt} from '../src/lib/captions.mjs';
import {syntheticAlignment} from '../src/lib/cues.mjs';

test('captions are generated from the narration alignment', () => {
  const text = 'Ein kurzer Satz. Danach folgt ein zweiter Satz.';
  const captions = alignmentToCaptions(text, syntheticAlignment(text, 130), 4);
  assert.ok(captions.length >= 2);
  const srt = captionsToSrt(captions);
  assert.match(srt, /00:00:00,000 -->/);
  assert.match(srt, /Ein kurzer Satz\./);
});

