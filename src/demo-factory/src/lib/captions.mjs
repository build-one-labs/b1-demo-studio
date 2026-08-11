export const alignmentToCaptions = (text, alignment, maxWords = 7) => {
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const ratio = starts.length > 1 ? (starts.length - 1) / Math.max(1, text.length - 1) : 1;
  const words = [...text.matchAll(/\S+/g)].map((match) => {
    const startIndex = Math.min(starts.length - 1, Math.round(match.index * ratio));
    const endCharacter = match.index + match[0].length - 1;
    const endIndex = Math.min(ends.length - 1, Math.round(endCharacter * ratio));
    return {
      text: match[0],
      startMs: Math.round((starts[startIndex] || 0) * 1000),
      endMs: Math.round((ends[endIndex] || starts[startIndex] || 0) * 1000),
    };
  });

  const captions = [];
  let group = [];
  for (const word of words) {
    group.push(word);
    if (group.length >= maxWords || /[.!?]$/.test(word.text)) {
      captions.push({
        text: group.map((item) => item.text).join(' '),
        startMs: group[0].startMs,
        endMs: group.at(-1).endMs,
      });
      group = [];
    }
  }
  if (group.length) {
    captions.push({text: group.map((item) => item.text).join(' '), startMs: group[0].startMs, endMs: group.at(-1).endMs});
  }
  return captions;
};

const srtTime = (milliseconds) => {
  const ms = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const remainder = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
};

export const captionsToSrt = (captions, offsetMs = 0) => captions.map((caption, index) => [
  index + 1,
  `${srtTime(caption.startMs + offsetMs)} --> ${srtTime(caption.endMs + offsetMs)}`,
  caption.text,
  '',
].join('\n')).join('\n');

