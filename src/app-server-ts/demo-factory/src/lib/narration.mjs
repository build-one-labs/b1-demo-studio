import {copyFile, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {alignmentToCaptions, captionsToSrt} from './captions.mjs';
import {alignmentDurationMs, mapCuesToAlignment, parseNarrationCues, syntheticAlignment} from './cues.mjs';
import {ensureDir, readJson, resolveCacheRoot, sha256, writeJson} from './files.mjs';
import {seconds, step, warn} from './log.mjs';
import {mediaDurationMs} from './media.mjs';
import {writeSilentWav} from './wav.mjs';

const selectProvider = (demo, override) => {
  if (override) return override;
  const configured = demo.settings.narration.provider;
  if (configured !== 'auto') return configured;
  const apiKey = process.env[demo.settings.narration.apiKeyEnv];
  const voiceId = process.env[demo.settings.narration.voiceIdEnv];
  return apiKey && voiceId ? 'elevenlabs' : 'silent';
};

const callElevenLabs = async ({text, apiKey, voiceId, modelId, languageCode, voiceSettings, previousText, nextText, previousRequestIds}) => {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'xi-api-key': apiKey},
    body: JSON.stringify({
      text,
      model_id: modelId,
      language_code: languageCode,
      seed: 424242,
      apply_text_normalization: 'auto',
      ...(previousText ? {previous_text: previousText} : {}),
      ...(nextText ? {next_text: nextText} : {}),
      ...(previousRequestIds?.length ? {previous_request_ids: previousRequestIds.slice(-3)} : {}),
      voice_settings: {
        stability: voiceSettings.stability,
        similarity_boost: voiceSettings.similarityBoost,
        style: voiceSettings.style,
        use_speaker_boost: voiceSettings.speakerBoost,
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs returned ${response.status}: ${body.slice(0, 500)}`);
  }
  return {payload: await response.json(), requestId: response.headers.get('request-id') || ''};
};

/**
 * Split narration into chunks of at most `maxChars`, cut at sentence ends.
 * The chunks concatenate back to exactly the input — whitespace after a
 * sentence stays with the chunk that ends there — so character offsets into
 * the full text stay meaningful across the merged alignment.
 */
export const splitNarration = (text, maxChars) => {
  if (!maxChars || text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?…]*[.!?…]+[\s"')\]]*|[^.!?…]+$/g) || [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += sentence;
    // A single sentence longer than the limit stays whole — cutting inside a
    // sentence would cost more voice quality than a long chunk does.
  }
  if (current) chunks.push(current);
  return chunks;
};

/**
 * Synthesize long narration as stitched chunks and merge the results.
 *
 * A cloned voice drifts over a long single call — audibly "switching" voices
 * mid-scene. Short calls re-anchor the clone; `previous_text`/`next_text`
 * keep the prosody continuous and `previous_request_ids` is ElevenLabs'
 * request stitching, which conditions each chunk on the audio of the ones
 * before it. Timing: each chunk's true audio length is measured with ffprobe
 * (the alignment's last timestamp misses trailing silence), and the merged
 * alignment shifts every chunk by the audio that precedes it — so cue mapping
 * and captions work exactly as they do for a single call.
 */
const synthesizeChunked = async ({chunks, cacheDirectory, cacheKey, callArgs}) => {
  const audioBuffers = [];
  const characters = [];
  const starts = [];
  const ends = [];
  const requestIds = [];
  let offsetSeconds = 0;
  let totalMs = 0;

  for (const [index, chunk] of chunks.entries()) {
    step(`  chunk ${index + 1}/${chunks.length} (${chunk.length} chars${requestIds.length ? ', stitched' : ''})`);
    const {payload, requestId} = await callElevenLabs({
      ...callArgs,
      text: chunk,
      previousText: index > 0 ? chunks.slice(0, index).join('').slice(-500) : undefined,
      nextText: index < chunks.length - 1 ? chunks.slice(index + 1).join('').slice(0, 500) : undefined,
      previousRequestIds: requestIds,
    });
    if (requestId) requestIds.push(requestId);
    else if (index === 0) warn('ElevenLabs returned no request-id header — chunks will rely on text conditioning only');

    const alignment = payload.normalized_alignment || payload.alignment;
    if (!alignment) throw new Error('ElevenLabs response did not include alignment timestamps');
    const audio = Buffer.from(payload.audio_base64, 'base64');
    audioBuffers.push(audio);

    // The chunk's real length, so the next chunk's timestamps start where
    // this chunk's audio actually ends — not where its last word does.
    const partFile = path.join(cacheDirectory, `${cacheKey}.part${index}.mp3`);
    await writeFile(partFile, audio);
    let chunkMs;
    try {
      chunkMs = await mediaDurationMs(partFile, {trimMs: 0});
    } catch {
      chunkMs = alignmentDurationMs(alignment);
    } finally {
      await rm(partFile, {force: true});
    }

    characters.push(...(alignment.characters || []));
    starts.push(...(alignment.character_start_times_seconds || []).map((time) => time + offsetSeconds));
    ends.push(...(alignment.character_end_times_seconds || []).map((time) => time + offsetSeconds));
    offsetSeconds += chunkMs / 1000;
    totalMs += chunkMs;
  }

  return {
    audio: Buffer.concat(audioBuffers),
    alignment: {characters, character_start_times_seconds: starts, character_end_times_seconds: ends},
    durationMs: Math.ceil(totalMs),
  };
};

/**
 * The narration in its spoken form.
 *
 * Replacements happen before cue parsing, so cue character offsets are
 * computed on the text the voice actually reads — "Build.One" written stays
 * the brand, "Build One" spoken loses the sentence break the dot caused.
 */
export const applyPronunciations = (narrationText, pronunciations = {}) =>
  Object.entries(pronunciations).reduce((text, [written, spoken]) => text.split(written).join(spoken), narrationText);

const buildNarration = async ({demo, scene, provider, cacheDirectory}) => {
  const narration = demo.settings.narration;
  const {text, cues: cueOffsets} = parseNarrationCues(applyPronunciations(scene.narration, narration.pronunciations));
  const modelId = process.env[narration.modelIdEnv] || narration.defaultModelId;
  const languageCode = process.env[narration.languageCodeEnv] || narration.defaultLanguageCode;
  const voiceId = process.env[narration.voiceIdEnv] || 'silent-preview';
  // voiceSettings are part of the key: changing stability or style changes the
  // audio, and a cache that ignored that would keep serving the old take.
  const cacheKey = sha256(JSON.stringify({provider, text, modelId, languageCode, voiceId, wordsPerMinute: narration.wordsPerMinute, voiceSettings: narration.voiceSettings, chunkChars: narration.chunkChars}));
  const metadataFile = path.join(cacheDirectory, `${cacheKey}.json`);

  try {
    const metadata = await readJson(metadataFile);
    await readFile(metadata.audioFile);
    step(`Narration for ${scene.id}: cache hit ${cacheKey.slice(0, 8)}`);
    return metadata;
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  }

  let alignment;
  let audioFile;
  let durationMs;
  if (provider === 'elevenlabs') {
    const apiKey = process.env[narration.apiKeyEnv];
    if (!apiKey || !voiceId || voiceId === 'silent-preview') {
      throw new Error(`ElevenLabs mode requires ${narration.apiKeyEnv} and ${narration.voiceIdEnv}`);
    }
    const callArgs = {apiKey, voiceId, modelId, languageCode, voiceSettings: narration.voiceSettings};
    const chunks = splitNarration(text, narration.chunkChars);
    audioFile = path.join(cacheDirectory, `${cacheKey}.mp3`);

    if (chunks.length > 1) {
      step(`Narration for ${scene.id}: calling ElevenLabs (${modelId}, voice ${voiceId}, ${chunks.length} stitched chunks)`);
      const merged = await synthesizeChunked({chunks, cacheDirectory, cacheKey, callArgs});
      alignment = merged.alignment;
      durationMs = merged.durationMs;
      await writeFile(audioFile, merged.audio);
    } else {
      step(`Narration for ${scene.id}: calling ElevenLabs (${modelId}, voice ${voiceId})`);
      const {payload} = await callElevenLabs({...callArgs, text});
      alignment = payload.normalized_alignment || payload.alignment;
      if (!alignment) throw new Error('ElevenLabs response did not include alignment timestamps');
      durationMs = alignmentDurationMs(alignment);
      await writeFile(audioFile, Buffer.from(payload.audio_base64, 'base64'));
    }
  } else {
    alignment = syntheticAlignment(text, narration.wordsPerMinute);
    durationMs = alignmentDurationMs(alignment);
    audioFile = path.join(cacheDirectory, `${cacheKey}.wav`);
    await writeSilentWav(audioFile, durationMs);
  }

  const metadata = {
    provider,
    cacheKey,
    text,
    audioFile,
    alignment,
    durationMs,
    cues: mapCuesToAlignment(cueOffsets, text, alignment),
    captions: alignmentToCaptions(text, alignment),
  };
  await writeJson(metadataFile, metadata);
  return metadata;
};

export const prepareNarration = async ({demo, runDir, providerOverride}) => {
  const provider = selectProvider(demo, providerOverride);
  const narrationDir = await ensureDir(path.join(runDir, 'narration'));
  const captionsDir = await ensureDir(path.join(runDir, 'captions'));
  const cacheDirectory = await ensureDir(path.join(resolveCacheRoot(), 'narration'));
  const scenes = [];

  step(`Preparing narration for ${demo.id} with provider ${provider}`);
  for (const [index, scene] of demo.scenes.entries()) {
    const metadata = await buildNarration({demo, scene, provider, cacheDirectory});
    step(`Scene ${index + 1}/${demo.scenes.length}: ${scene.id} — ${seconds(metadata.durationMs)} of narration, ${Object.keys(metadata.cues).length} cues`);
    const extension = path.extname(metadata.audioFile);
    const outputAudio = path.join(narrationDir, `${scene.id}${extension}`);
    await copyFile(metadata.audioFile, outputAudio);
    const outputAlignment = path.join(narrationDir, `${scene.id}.alignment.json`);
    await writeJson(outputAlignment, metadata);
    const outputSrt = path.join(captionsDir, `${scene.id}.srt`);
    await writeFile(outputSrt, `${captionsToSrt(metadata.captions)}\n`, 'utf8');
    scenes.push({
      id: scene.id,
      title: scene.title,
      route: scene.route,
      actions: scene.actions,
      assertions: scene.assertions,
      narration: metadata.text,
      narrationProvider: provider,
      narrationFile: outputAudio,
      alignmentFile: outputAlignment,
      captionsFile: outputSrt,
      narrationDurationMs: metadata.durationMs,
      cues: metadata.cues,
      captions: metadata.captions,
    });
  }

  return {provider, scenes};
};

