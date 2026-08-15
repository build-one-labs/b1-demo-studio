import assert from 'node:assert/strict';
import test from 'node:test';
import {mapCuesToAlignment, parseNarrationCues, syntheticAlignment} from '../src/lib/cues.mjs';

test('cue markers are removed and retain ordered offsets', () => {
  const parsed = parseNarrationCues('Hallo [cue:first] Welt. [cue:second] Weiter geht es.');
  assert.equal(parsed.text, 'Hallo Welt. Weiter geht es.');
  assert.ok(parsed.cues.first.characterOffset < parsed.cues.second.characterOffset);
  const alignment = syntheticAlignment(parsed.text, 120);
  const cues = mapCuesToAlignment(parsed.cues, parsed.text, alignment);
  assert.ok(cues.first >= 0);
  assert.ok(cues.second > cues.first);
});

