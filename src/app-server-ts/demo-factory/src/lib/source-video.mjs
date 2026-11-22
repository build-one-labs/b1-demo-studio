import {execFile, spawn} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {readJson, resolveOutputRoot, writeJson} from './files.mjs';
import {seconds, step, warn} from './log.mjs';
import {buildScenes} from './segment.mjs';

/**
 * Demos from a screen recording the author made themselves.
 *
 * The author records a B1 app in their own tool (OBS, QuickTime, Loom, the
 * browser's own recorder) and talks while they click. The Studio uploads the
 * file into `<output>/uploads/<upload-id>/`, and `cli.mjs analyze` turns it
 * into an ordinary demo document whose scenes carry a `clip` — a time range
 * of that file — instead of a route and browser actions:
 *
 * - ffprobe measures it, ffmpeg's scene filter finds where the screen changes;
 * - ElevenLabs Speech-to-Text transcribes the author's voice with word
 *   timings (skipped when the file has no audio or no key is configured);
 * - `segment.mjs` cuts at the pauses and screen changes and gives every scene
 *   the words spoken in it as its narration.
 *
 * From there the demo is edited like any other: the narration text is the
 * script, prepare re-voices it with the configured voice, record cuts each
 * scene's range out of the upload (retimed to the new narration, see
 * cutSourceClip), and render composes the result exactly as for a Playwright
 * take.
 */

const execFileAsync = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = () => process.env.FFPROBE_PATH || 'ffprobe';

export const UPLOAD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.m4v'];

/** Where uploads live: beside the runs, so a deployment keeps them on the same volume. */
export const resolveUploadsRoot = () => path.join(resolveOutputRoot(), 'uploads');

/** An upload's directory, refusing ids that could leave the uploads root. */
export const uploadDir = (uploadId) => {
  if (!UPLOAD_ID_PATTERN.test(uploadId || '')) throw new Error(`Invalid upload id: ${uploadId}`);
  return path.join(resolveUploadsRoot(), uploadId);
};

/**
 * The file a demo's `source.video` names, resolved inside the uploads root.
 * The value is `<upload-id>/<file>`, relative on purpose: the same document
 * must resolve on a workspace and inside the app server's container.
 */
export const resolveSourceVideo = (source) => {
  const root = resolveUploadsRoot();
  const file = path.resolve(root, source.video);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`source.video escapes the uploads directory: ${source.video}`);
  return file;
};

/** The single video file of an upload directory. */
export const findUploadedVideo = async (uploadId) => {
  const directory = uploadDir(uploadId);
  const meta = await readJson(path.join(directory, 'upload.json')).catch(() => null);
  if (meta?.file) return path.join(directory, path.basename(meta.file));
  throw new Error(`Upload ${uploadId} has no video (upload.json missing) in ${directory}`);
};

export const probeVideo = async (file) => {
  const {stdout} = await execFileAsync(ffprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {maxBuffer: 8 * 1024 * 1024});
  const info = JSON.parse(stdout);
  const video = (info.streams || []).find((stream) => stream.codec_type === 'video');
  if (!video) throw new Error(`${path.basename(file)} has no video stream`);
  const duration = Number(info.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine the duration of ${path.basename(file)}`);
  // Phone and some screen recorders store the picture rotated and say so in
  // a side-data tag; the visible size is then the swapped one.
  const rotation = Math.abs(Number(video.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation || video.tags?.rotate || 0));
  const swapped = rotation === 90 || rotation === 270;
  return {
    durationMs: Math.round(duration * 1000),
    width: swapped ? video.height : video.width,
    height: swapped ? video.width : video.height,
    hasAudio: (info.streams || []).some((stream) => stream.codec_type === 'audio'),
  };
};

/**
 * Where the picture changes, from ffmpeg's scene score.
 *
 * Sampled at 5 fps on a 480 px copy: a screen recording changes in steps
 * (a navigation, a dialog), not in motion, and that is plenty to find them —
 * at a fraction of the cost of scoring every full-size frame. The cursor and
 * typing score far below the threshold.
 */
export const detectVisualCuts = (file, {threshold = 0.08} = {}) => new Promise((resolve, reject) => {
  const child = spawn(ffmpeg(), [
    '-hide_banner', '-nostats', '-i', file, '-an', '-sn',
    '-vf', `fps=5,scale=480:-2,select='gt(scene,${threshold})',metadata=print:file=-`,
    '-f', 'null', '-',
  ], {stdio: ['ignore', 'pipe', 'pipe']});
  const cuts = [];
  let pending = null;
  let buffer = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const time = /pts_time:([\d.]+)/.exec(line);
      if (time) pending = Math.round(Number(time[1]) * 1000);
      const score = /lavfi\.scene_score=([\d.]+)/.exec(line);
      if (score && pending !== null) {
        cuts.push({atMs: pending, score: Number(score[1])});
        pending = null;
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve(cuts) : reject(new Error(`ffmpeg scene detection exited with ${code}: ${stderr.trim().split('\n').at(-1)}`)));
});

/** The voice track as small mono MP3 — what speech-to-text needs, at a fraction of the upload. */
export const extractSpeechAudio = async (file, target) => {
  await execFileAsync(ffmpeg(), ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', target], {maxBuffer: 4 * 1024 * 1024});
  return target;
};

/**
 * ElevenLabs Speech-to-Text with word timings.
 *
 * The same account and key as the voice-over. Returns only spoken words —
 * `spacing` and `audio_event` entries carry no text the narration should keep.
 */
export const transcribe = async ({audioFile, apiKey, modelId, languageCode}) => {
  const form = new FormData();
  form.append('model_id', modelId);
  form.append('file', new Blob([await readFile(audioFile)], {type: 'audio/mpeg'}), path.basename(audioFile));
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('diarize', 'false');
  if (languageCode) form.append('language_code', languageCode);
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {'xi-api-key': apiKey},
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs Speech-to-Text returned ${response.status}: ${body.slice(0, 500)}`);
  }
  const payload = await response.json();
  const words = (payload.words || [])
    .filter((word) => (word.type ?? 'word') === 'word' && String(word.text || '').trim())
    .map((word) => ({text: String(word.text).trim(), startMs: Math.round(word.start * 1000), endMs: Math.round(word.end * 1000)}));
  return {languageCode: payload.language_code || languageCode || '', text: payload.text || '', words};
};

/** The narration settings of a new video demo — the same defaults as the Studio's blank demo. */
const videoDemoSettings = ({language}) => ({
  language,
  viewport: {width: 1920, height: 1080},
  fps: 30,
  // The demo environment by default, whatever this host's B1_BASE_URL says
  // (an empty variable name): a recording is made of a deployed app.
  baseUrl: {env: '', fallback: 'https://samples.demo.build.one/'},
  authStateEnv: 'B1_AUTH_STATE',
  headlessEnv: 'DEMO_HEADLESS',
  holdBeforeMs: 400,
  holdAfterMs: 900,
  cursor: {enabled: false, moveDurationMs: 700, clickLeadMs: 120, clickEffectDurationMs: 560, sizePx: 30},
  narration: {
    provider: 'auto',
    voiceIdEnv: 'ELEVENLABS_VOICE_ID',
    apiKeyEnv: 'ELEVENLABS_API_KEY',
    modelIdEnv: 'ELEVENLABS_MODEL_ID',
    defaultModelId: 'eleven_multilingual_v2',
    languageCodeEnv: 'ELEVENLABS_LANGUAGE_CODE',
    defaultLanguageCode: language,
    wordsPerMinute: 132,
  },
  branding: {
    productName: 'Build.One',
    accentColor: '#1266f1',
    backgroundColor: '#0b1020',
    textColor: '#f7f8ff',
    showCaptions: true,
    showSceneTitles: true,
  },
});

/** ISO 639-3 (what Scribe reports) to the two letters the rest of the factory uses. */
const LANGUAGE_CODES = {deu: 'de', eng: 'en', fra: 'fr', spa: 'es', ita: 'it', nld: 'nl', pol: 'pl', por: 'pt'};
const shortLanguage = (code) => {
  const value = String(code || '').toLowerCase();
  return LANGUAGE_CODES[value] || (value.length === 2 ? value : '');
};

/**
 * Analyze an upload and write the demo document it becomes.
 *
 * Every expensive intermediate is kept in the upload directory — the
 * transcript above all, which is paid for — so re-running the analysis (with
 * other segmentation settings, or after a failed save) costs only ffmpeg time.
 * Returns the document and writes it to `<upload>/demo.json`, where the app
 * server picks it up and saves it through its one validated write path.
 */
export const analyzeUpload = async ({uploadId, demoId, title, language: requestedLanguage}) => {
  const directory = uploadDir(uploadId);
  const file = await findUploadedVideo(uploadId);
  const {size} = await stat(file);
  step(`Analyzing ${path.basename(file)} (${(size / 1024 / 1024).toFixed(1)} MB) for demo ${demoId}`);

  const probe = await probeVideo(file);
  step(`Video: ${probe.width}×${probe.height}, ${seconds(probe.durationMs)}, ${probe.hasAudio ? 'with' : 'without'} audio`);

  const cutsFile = path.join(directory, 'cuts.json');
  let cuts = await readJson(cutsFile).catch(() => null);
  if (!cuts) {
    step('Detecting screen changes');
    cuts = await detectVisualCuts(file);
    await writeJson(cutsFile, cuts);
  }
  step(`${cuts.length} screen changes found`);

  let transcript = {languageCode: '', text: '', words: []};
  const transcriptFile = path.join(directory, 'transcript.json');
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!probe.hasAudio) {
    warn('The video has no audio track — scenes are cut at screen changes only, narration stays empty');
  } else {
    const cached = await readJson(transcriptFile).catch(() => null);
    if (cached) {
      transcript = cached;
      step(`Transcript: cached, ${transcript.words.length} words`);
    } else if (!apiKey) {
      warn('No ELEVENLABS_API_KEY — the speech is not transcribed; scenes are cut at screen changes only');
    } else {
      const audioFile = await extractSpeechAudio(file, path.join(directory, 'speech.mp3'));
      const modelId = process.env.ELEVENLABS_STT_MODEL_ID || 'scribe_v1';
      step(`Transcribing the voice track with ElevenLabs (${modelId})`);
      transcript = await transcribe({audioFile, apiKey, modelId, languageCode: requestedLanguage || undefined});
      await writeJson(transcriptFile, transcript);
      step(`Transcript: ${transcript.words.length} words, language ${transcript.languageCode || 'unknown'}`);
    }
  }

  const language = shortLanguage(requestedLanguage) || shortLanguage(transcript.languageCode) || 'de';
  const scenes = buildScenes({durationMs: probe.durationMs, words: transcript.words, cuts, language});
  step(`Cut into ${scenes.length} scene${scenes.length === 1 ? '' : 's'}: ${scenes.map((scene) => seconds(scene.clip.endMs - scene.clip.startMs)).join(', ')}`);

  const document = {
    schemaVersion: 1,
    id: demoId,
    title: title || demoId,
    description: `${language === 'de' ? 'Aus der Bildschirmaufnahme' : 'From the screen recording'} ${path.basename(file)}.`,
    settings: videoDemoSettings({language}),
    source: {
      video: `${uploadId}/${path.basename(file)}`,
      durationMs: probe.durationMs,
      width: probe.width,
      height: probe.height,
      language,
      analyzedAt: new Date().toISOString(),
    },
    scenes: scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      narration: scene.narration,
      clip: scene.clip,
      actions: [],
      assertions: [],
    })),
  };
  await writeJson(path.join(directory, 'analysis.json'), {probe, language, scenes, cutCount: cuts.length, wordCount: transcript.words.length});
  await writeJson(path.join(directory, 'demo.json'), document);
  step(`Demo document written to ${path.join(directory, 'demo.json')}`);
  return document;
};

/**
 * How a scene's footage plays so that the new voice-over fits it.
 *
 * The author spoke while clicking, so the picture already follows the words;
 * the re-voiced text is the same text in another voice, usually a little
 * faster or slower. So the footage from where the author started speaking
 * (`voiceAtMs`) to the end of the clip plays uniformly faster or slower until
 * it matches the new narration, which keeps every click where its sentence
 * is. Bounded both ways: beyond 2.5× a screen recording is unreadable (the
 * scene then runs on silently), and below 0.8× it looks like slow motion —
 * the remainder is a held last frame.
 *
 * Silence before the voice is dead time in a screen recording — a page
 * loading, the author finding the next button. Longer than LEAD_TIMELAPSE_MS,
 * it becomes a timelapse (the composition plays it fast, with its ▶▶ badge),
 * and the voice-over starts where the compressed lead-in ends — exactly where
 * the author's own voice started.
 *
 * All output values are clip-relative milliseconds of the cut clip (after the
 * uniform speed change) — what the run manifest and the composition expect.
 */
export const MAX_SPEEDUP = 2.5;
export const MIN_SPEED = 0.8;
export const LEAD_TIMELAPSE_MS = 3_000;

export const clipTiming = ({sourceMs, narrationMs, holdBeforeMs, holdAfterMs, voiceAtMs = 0}) => {
  if (!narrationMs) return {speed: 1, playMs: sourceMs, freezeMs: 0, narrationOffsetMs: 0, timelapse: null};
  const leadSourceMs = Math.max(0, Math.min(voiceAtMs || 0, sourceMs - 1_000));
  const speed = Math.min(MAX_SPEEDUP, Math.max(MIN_SPEED, (sourceMs - leadSourceMs) / (narrationMs + holdAfterMs)));
  const playMs = Math.round(sourceMs / speed);
  const leadMs = Math.round(leadSourceMs / speed);
  let timelapse = null;
  let narrationOffsetMs = Math.max(holdBeforeMs, leadMs);
  if (leadSourceMs > LEAD_TIMELAPSE_MS) {
    // A quarter of its length, within bounds: long enough to see what
    // happened, short enough not to wait for it.
    const targetMs = Math.round(Math.min(3_000, Math.max(holdBeforeMs, 1_200, leadSourceMs / 4)));
    if (targetMs < leadMs) {
      timelapse = {fromMs: 0, toMs: leadMs, targetMs};
      narrationOffsetMs = targetMs;
    }
  }
  // What the scene needs on screen, in the clip's own time: the lead-in as it
  // plays (uncompressed here — the composition compresses it), the voice-over,
  // and the hold after it. Anything the footage lacks is a held last frame.
  const lead = timelapse ? leadMs : narrationOffsetMs;
  const freezeMs = Math.max(0, lead + narrationMs + holdAfterMs - playMs);
  return {speed, playMs, freezeMs, narrationOffsetMs, timelapse};
};

/** Cut one scene's range out of the upload, retimed, at the composition's 1920×1080. */
export const cutSourceClip = async ({source, startMs, endMs, timing, target, backgroundColor = '#0b1020', fps = 30}) => {
  const pad = /^#[0-9a-f]{6}$/i.test(backgroundColor) ? `0x${backgroundColor.slice(1)}` : 'black';
  const filters = [
    `setpts=PTS/${timing.speed.toFixed(6)}`,
    `fps=${fps}`,
    'scale=1920:1080:force_original_aspect_ratio=decrease',
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${pad}`,
    'setsar=1',
    ...(timing.freezeMs > 0 ? [`tpad=stop_mode=clone:stop_duration=${(timing.freezeMs / 1000).toFixed(3)}`] : []),
  ];
  await execFileAsync(ffmpeg(), [
    '-y', '-v', 'error',
    '-ss', (startMs / 1000).toFixed(3),
    '-t', ((endMs - startMs) / 1000).toFixed(3),
    '-i', source,
    '-an', '-sn',
    '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    target,
  ], {maxBuffer: 4 * 1024 * 1024});
  return target;
};
