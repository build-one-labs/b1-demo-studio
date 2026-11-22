/**
 * Cut an uploaded screen recording into scenes.
 *
 * Pure: it takes what the analysis measured — the video's length, the visual
 * cuts ffmpeg's scene filter found, the words the transcript timed — and
 * returns scene boundaries plus each scene's spoken text. Nothing here touches
 * a file or a process, so the decisions can be tested on their own.
 *
 * Where a good cut is, in order of strength:
 *
 * 1. a speech pause that contains a visual change — the presenter stopped
 *    talking and the screen changed (a navigation, a dialog opening);
 * 2. a long pause after a sentence end;
 * 3. a visual change between two words, even without a pause;
 * 4. any pause between words — the fallback that keeps a scene under the
 *    maximum length when nothing better is there.
 *
 * A cut never lands inside a word. Among the candidates a dynamic program
 * picks the set whose scenes come closest to the AUTHORING.md rule (15 to 45
 * seconds, one statement per scene) while collecting the strongest cuts.
 */

export const SEGMENT_DEFAULTS = Object.freeze({
  minMs: 12_000,
  targetMs: 25_000,
  maxMs: 45_000,
  /** A gap between two words at least this long is a pause. */
  minPauseMs: 450,
  /** A visual change within this distance of a word counts as inside it. */
  wordGuardMs: 120,
  /** Visual changes closer than this are one change (a page loading in steps). */
  cutMergeMs: 1_200,
});

const FILLERS = /^(äh+|ähm+|öh+m?|hm+|mhm|uh+|um+|uhm+|erm+|ehm+)[,.!?]*$/i;

/** Fold visual changes that belong together into the strongest one. */
export const mergeCuts = (cuts, mergeMs = SEGMENT_DEFAULTS.cutMergeMs) => {
  const sorted = [...cuts].filter((cut) => Number.isFinite(cut.atMs)).sort((a, b) => a.atMs - b.atMs);
  const merged = [];
  for (const cut of sorted) {
    const last = merged.at(-1);
    if (last && cut.atMs - last.lastMs <= mergeMs) {
      // The cut goes where the change was largest; the group keeps growing
      // while changes keep coming (a page that paints in several steps).
      if (cut.score > last.score) Object.assign(last, {atMs: cut.atMs, score: cut.score});
      last.lastMs = cut.atMs;
    } else {
      merged.push({atMs: cut.atMs, score: cut.score, lastMs: cut.atMs});
    }
  }
  return merged.map(({atMs, score}) => ({atMs, score}));
};

/** Every place a scene may start, each with how much it is worth. */
export const cutCandidates = ({durationMs, words = [], cuts = []}, options = {}) => {
  const opts = {...SEGMENT_DEFAULTS, ...options};
  const visual = mergeCuts(cuts, opts.cutMergeMs).filter((cut) => cut.atMs > 0 && cut.atMs < durationMs);
  const candidates = [];
  const inside = (atMs) => words.some((word) => atMs > word.startMs - opts.wordGuardMs && atMs < word.endMs + opts.wordGuardMs);

  // Speech pauses, including the silence before the first and after the last word.
  const gaps = [];
  for (let index = 0; index <= words.length; index += 1) {
    const fromMs = index === 0 ? 0 : words[index - 1].endMs;
    const toMs = index === words.length ? durationMs : words[index].startMs;
    if (toMs > fromMs) gaps.push({fromMs, toMs, previous: words[index - 1]});
  }

  const usedCuts = new Set();
  for (const gap of gaps) {
    if (gap.fromMs <= 0 || gap.toMs >= durationMs) continue;
    const lengthMs = gap.toMs - gap.fromMs;
    const inGap = visual.filter((cut) => cut.atMs >= gap.fromMs && cut.atMs <= gap.toMs);
    const sentenceEnd = gap.previous && /[.!?…:]["')\]]*$/.test(gap.previous.text);
    if (lengthMs < opts.minPauseMs && inGap.length === 0) {
      // Too short to be a pause — still a legal cut, just a weak one.
      candidates.push({atMs: Math.round(gap.fromMs + lengthMs / 2), score: sentenceEnd ? 0.15 : 0.02, reason: 'word-gap'});
      continue;
    }
    const strongest = inGap.reduce((best, cut) => (!best || cut.score > best.score ? cut : best), null);
    for (const cut of inGap) usedCuts.add(cut);
    const pauseScore = Math.min(1, lengthMs / 2_000);
    if (strongest) {
      // Start the new scene a moment before the screen changes, so the change
      // itself is the first thing the scene shows — but never before the last
      // word of the previous scene has ended.
      candidates.push({
        atMs: Math.round(Math.max(gap.fromMs + 60, strongest.atMs - 250)),
        score: pauseScore + (sentenceEnd ? 0.6 : 0) + 1.5 * Math.min(1, strongest.score * 2),
        reason: 'pause+visual',
      });
    } else {
      candidates.push({
        atMs: Math.round(gap.fromMs + Math.min(lengthMs / 2, 600)),
        score: pauseScore + (sentenceEnd ? 0.6 : 0),
        reason: 'pause',
      });
    }
  }

  // Visual changes outside every pause, and not inside a word.
  for (const cut of visual) {
    if (usedCuts.has(cut) || inside(cut.atMs)) continue;
    candidates.push({atMs: Math.round(Math.max(0, cut.atMs - 250)), score: (words.length ? 1.0 : 1.5) * Math.min(1, cut.score * 2), reason: 'visual'});
  }

  // Long stretches without any word or change still need somewhere to cut.
  const stepMs = 2_000;
  const known = [0, ...candidates.map((candidate) => candidate.atMs), durationMs].sort((a, b) => a - b);
  for (let index = 1; index < known.length; index += 1) {
    for (let atMs = known[index - 1] + stepMs; atMs < known[index] - stepMs / 2; atMs += stepMs) {
      if (!inside(atMs)) candidates.push({atMs, score: 0, reason: 'filler'});
    }
  }

  return candidates
    .filter((candidate) => candidate.atMs > 0 && candidate.atMs < durationMs)
    .sort((a, b) => a.atMs - b.atMs)
    .filter((candidate, index, all) => index === 0 || candidate.atMs - all[index - 1].atMs > 50);
};

/** What a scene of this length costs: nothing near the target, a lot outside min..max. */
const lengthCost = (lengthMs, opts) => {
  if (lengthMs < opts.minMs) return 40 + ((opts.minMs - lengthMs) / 1_000) * 4;
  if (lengthMs > opts.maxMs) return 40 + ((lengthMs - opts.maxMs) / 1_000) * 4;
  const deviation = (lengthMs - opts.targetMs) / opts.targetMs;
  return deviation * deviation * 1.2 + 0.35;
};

/**
 * The scene boundaries: `[{startMs, endMs, reason}]`, covering the whole video
 * without gap or overlap. A video shorter than about one and a half minimum
 * scenes stays one scene.
 */
export const segmentScenes = ({durationMs, words = [], cuts = []}, options = {}) => {
  const opts = {...SEGMENT_DEFAULTS, ...options};
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('The video has no duration');
  if (durationMs < opts.minMs * 1.5) return [{startMs: 0, endMs: Math.round(durationMs), reason: 'whole'}];

  const candidates = cutCandidates({durationMs, words, cuts}, opts);
  const points = [{atMs: 0, score: 0, reason: 'start'}, ...candidates, {atMs: durationMs, score: 0, reason: 'end'}];
  const best = new Array(points.length).fill(Infinity);
  const previous = new Array(points.length).fill(-1);
  best[0] = 0;
  const window = opts.maxMs * 2;
  for (let end = 1; end < points.length; end += 1) {
    const reward = end === points.length - 1 ? 0 : points[end].score;
    for (let start = end - 1; start >= 0; start -= 1) {
      const lengthMs = points[end].atMs - points[start].atMs;
      if (lengthMs > window) break;
      if (best[start] === Infinity) continue;
      const cost = best[start] + lengthCost(lengthMs, opts) - reward;
      if (cost < best[end]) {
        best[end] = cost;
        previous[end] = start;
      }
    }
  }

  const boundaries = [];
  for (let index = points.length - 1; index > 0; index = previous[index]) {
    if (previous[index] < 0) throw new Error('Could not segment the video');
    boundaries.unshift({startMs: Math.round(points[previous[index]].atMs), endMs: Math.round(points[index].atMs), reason: points[previous[index]].reason});
  }
  return boundaries;
};

/** Words as narration text: fillers gone, spacing and capitalization tidied. */
export const wordsToText = (words) => {
  const kept = [];
  let capitalizeNext = true;
  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    if (FILLERS.test(text)) {
      // "Ähm, in dieser Liste …" — the filler opened the sentence, so the word
      // after it opens it now and takes its capital.
      if (kept.length === 0 || /[.!?…]$/.test(kept.at(-1))) capitalizeNext = true;
      continue;
    }
    kept.push(capitalizeNext && /^\p{Ll}/u.test(text) ? text[0].toLocaleUpperCase() + text.slice(1) : text);
    capitalizeNext = false;
  }
  return kept.join(' ').replace(/\s+([,.!?;:…])/g, '$1').replace(/\s+/g, ' ').trim();
};

/** A short working title from the scene's first sentence; the author is expected to refine it. */
export const titleFromText = (text, index, language = 'de') => {
  const fallback = `${language.startsWith('de') ? 'Szene' : 'Scene'} ${index + 1}`;
  const sentence = (text.match(/^[^.!?…]+/) || [''])[0].trim();
  if (!sentence) return fallback;
  const words = sentence.split(/\s+/);
  const short = words.slice(0, 7).join(' ').replace(/[,;:–—-]+$/, '');
  return words.length > 7 ? `${short} …` : short;
};

/**
 * Scenes with their text: each word goes to the scene its midpoint falls in,
 * so a word at a boundary is spoken in exactly one scene.
 */
export const buildScenes = ({durationMs, words = [], cuts = [], language = 'de'}, options = {}) =>
  segmentScenes({durationMs, words, cuts}, options).map((boundary, index) => {
    const own = words.filter((word) => {
      const middle = (word.startMs + word.endMs) / 2;
      return middle >= boundary.startMs && middle < boundary.endMs;
    });
    const narration = wordsToText(own);
    return {
      id: `scene-${String(index + 1).padStart(2, '0')}`,
      title: titleFromText(narration, index, language),
      narration,
      clip: {
        startMs: boundary.startMs,
        endMs: boundary.endMs,
        // Where the author starts speaking, relative to the clip: the new
        // voice-over starts there too, and a long silent lead-in before it
        // plays fast-forwarded (see clipTiming).
        ...(own.length ? {voiceAtMs: Math.max(0, own[0].startMs - boundary.startMs)} : {}),
      },
      reason: boundary.reason,
    };
  });
