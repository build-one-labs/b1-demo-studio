import {copyFile, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {alignmentToCaptions, captionsToSrt} from './captions.mjs';
import {alignmentDurationMs, mapCuesToAlignment, parseNarrationCues, syntheticAlignment} from './cues.mjs';
import {ensureDir, readJson, resolveCacheRoot, sha256, writeJson} from './files.mjs';
import {seconds, step} from './log.mjs';
import {writeSilentWav} from './wav.mjs';

const selectProvider = (demo, override) => {
  if (override) return override;
  const configured = demo.settings.narration.provider;
  if (configured !== 'auto') return configured;
  const apiKey = process.env[demo.settings.narration.apiKeyEnv];
  const voiceId = process.env[demo.settings.narration.voiceIdEnv];
  return apiKey && voiceId ? 'elevenlabs' : 'silent';
};

const callElevenLabs = async ({text, apiKey, voiceId, modelId, languageCode, voiceSettings}) => {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'xi-api-key': apiKey},
    body: JSON.stringify({
      text,
      model_id: modelId,
      language_code: languageCode,
      seed: 424242,
      apply_text_normalization: 'auto',
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
  return response.json();
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
  const cacheKey = sha256(JSON.stringify({provider, text, modelId, languageCode, voiceId, wordsPerMinute: narration.wordsPerMinute, voiceSettings: narration.voiceSettings}));
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
  if (provider === 'elevenlabs') {
    const apiKey = process.env[narration.apiKeyEnv];
    if (!apiKey || !voiceId || voiceId === 'silent-preview') {
      throw new Error(`ElevenLabs mode requires ${narration.apiKeyEnv} and ${narration.voiceIdEnv}`);
    }
    step(`Narration for ${scene.id}: calling ElevenLabs (${modelId}, voice ${voiceId})`);
    const result = await callElevenLabs({text, apiKey, voiceId, modelId, languageCode, voiceSettings: narration.voiceSettings});
    alignment = result.normalized_alignment || result.alignment;
    if (!alignment) throw new Error('ElevenLabs response did not include alignment timestamps');
    audioFile = path.join(cacheDirectory, `${cacheKey}.mp3`);
    await writeFile(audioFile, Buffer.from(result.audio_base64, 'base64'));
  } else {
    alignment = syntheticAlignment(text, narration.wordsPerMinute);
    audioFile = path.join(cacheDirectory, `${cacheKey}.wav`);
    await writeSilentWav(audioFile, alignmentDurationMs(alignment));
  }

  const metadata = {
    provider,
    cacheKey,
    text,
    audioFile,
    alignment,
    durationMs: alignmentDurationMs(alignment),
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

