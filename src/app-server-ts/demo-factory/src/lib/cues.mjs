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

export const mapCuesToAlignment = (cues, text, alignment) => {
  const characters = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ratio = characters.length > 1 ? (characters.length - 1) / Math.max(1, text.length - 1) : 1;
  return Object.fromEntries(Object.entries(cues).map(([name, cue]) => {
    const alignedIndex = Math.min(starts.length - 1, Math.max(0, Math.round(cue.characterOffset * ratio)));
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
