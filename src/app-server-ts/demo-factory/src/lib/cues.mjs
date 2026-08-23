export const parseNarrationCues = (source) => {
  const rawCues = {};
  let rawText = '';
  let cursor = 0;
  const regex = /\[cue:([a-zA-Z0-9_-]+)\]/g;
  for (const match of source.matchAll(regex)) {
    rawText += source.slice(cursor, match.index);
    rawCues[match[1]] = rawText.length;
    cursor = match.index + match[0].length;
  }
  rawText += source.slice(cursor);
  const cleanText = rawText.replace(/\s+/g, ' ').trim();
  const cues = Object.fromEntries(Object.entries(rawCues).map(([name, rawOffset]) => {
    const normalizedPrefix = rawText.slice(0, rawOffset).replace(/\s+/g, ' ').trim();
    return [name, {characterOffset: normalizedPrefix.length}];
  }));
  return {text: cleanText, cues};
};

/**
 * Map each text index to its alignment index by actually walking both
 * character sequences, instead of assuming they line up proportionally.
 *
 * ElevenLabs' normalized alignment is the text plus small edits — a leading
 * space, an em dash spelled as `--`, a number written out — and under the old
 * proportional guess every such edit smeared every later cue. The walk
 * tolerates insertions and expansions: when the next text character is not at
 * the cursor, it looks a bounded window ahead; when nothing matches (the
 * middle of an expansion), the cue snaps to the expansion's start, which is
 * where the word is spoken anyway.
 */
const LOOKAHEAD = 24;

export const mapCuesToAlignment = (cues, text, alignment) => {
  const characters = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  if (characters.length === 0) return Object.fromEntries(Object.keys(cues).map((name) => [name, 0]));

  const textToAligned = new Array(text.length + 1);
  let aligned = 0;
  for (let index = 0; index < text.length; index += 1) {
    textToAligned[index] = Math.min(aligned, characters.length - 1);
    const wanted = text[index];
    let found = -1;
    for (let probe = aligned; probe < Math.min(characters.length, aligned + LOOKAHEAD); probe += 1) {
      if (characters[probe] === wanted) {
        found = probe;
        break;
      }
    }
    if (found >= 0) {
      textToAligned[index] = found;
      aligned = found + 1;
    }
    // Not found within the window: an expanded character ("—" as "--") or a
    // dropped one. The cursor stays put; the index keeps pointing at the
    // expansion, and the walk re-synchronizes on the next literal match.
  }
  textToAligned[text.length] = characters.length - 1;

  return Object.fromEntries(Object.entries(cues).map(([name, cue]) => {
    const offset = Math.min(text.length, Math.max(0, cue.characterOffset));
    const alignedIndex = Math.min(starts.length - 1, textToAligned[offset] ?? 0);
    return [name, Math.round((starts[alignedIndex] || 0) * 1000)];
  }));
};

export const syntheticAlignment = (text, wordsPerMinute) => {
  const wordCount = Math.max(1, text.trim().split(/\s+/).length);
  const durationSeconds = Math.max(2.5, (wordCount / wordsPerMinute) * 60 + 0.6);
  const perCharacter = durationSeconds / Math.max(1, text.length);
  return {
    characters: [...text],
    character_start_times_seconds: [...text].map((_, index) => index * perCharacter),
    character_end_times_seconds: [...text].map((_, index) => (index + 1) * perCharacter),
  };
};

export const alignmentDurationMs = (alignment) => {
  const ends = alignment.character_end_times_seconds || [];
  return Math.ceil((ends.at(-1) || 0) * 1000);
};
