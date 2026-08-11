import {execFile} from 'node:child_process';
import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import YAML from 'yaml';
import {ensureDir, loadLatestRun, readJson, writeJson} from '../src/lib/files.mjs';
import {mediaDurationMs} from '../src/lib/media.mjs';

const execFileAsync = promisify(execFile);
const demoId = process.argv[2] || 'vibecode-sales-tour';
const configFile = path.resolve('demos', demoId, 'source-edit.yaml');
const config = YAML.parse(await readFile(configFile, 'utf8'));
const sourceVideo = path.resolve(process.env[config.sourceVideoEnv] || config.defaultSourceVideo);
await access(sourceVideo);

const {runDir} = await loadLatestRun(demoId);
const manifestFile = path.join(runDir, 'run-manifest.json');
const manifest = await readJson(manifestFile);
const clipsDir = await ensureDir(path.join(runDir, 'clips'));
const segmentById = new Map(config.scenes.map((scene) => [scene.id, scene]));
const pythonCommand = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'py' : 'python3');
const pythonPrefix = !process.env.PYTHON_PATH && process.platform === 'win32' ? ['-3'] : [];

const scenes = [];
for (const scene of manifest.scenes) {
  const segment = segmentById.get(scene.id);
  if (!segment) throw new Error(`No source segment configured for scene ${scene.id}`);
  const durationSeconds = Number(segment.end) - Number(segment.start);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Invalid source segment for scene ${scene.id}`);
  }
  const narrationOffsetMs = 900;
  const targetDurationSeconds = (narrationOffsetMs + scene.narrationDurationMs + 1600) / 1000;
  const presentationFactor = targetDurationSeconds / durationSeconds;

  const clipFile = path.join(clipsDir, `${scene.id}.mp4`);
  const importedClipFile = segment.textReplacement
    ? path.join(clipsDir, `${scene.id}.source.mp4`)
    : clipFile;
  await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-y', '-v', 'error',
    '-ss', String(segment.start),
    '-t', String(durationSeconds),
    '-i', sourceVideo,
    '-an',
    '-vf', `setpts=${presentationFactor.toFixed(8)}*PTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    importedClipFile,
  ], {maxBuffer: 4 * 1024 * 1024});

  if (segment.textReplacement) {
    const replacement = segment.textReplacement;
    const argumentsList = [
      ...pythonPrefix,
      path.resolve('tools', 'replace-chat-prompt.py'),
      '--input', importedClipFile,
      '--output', clipFile,
      '--selector', replacement.selector || 'widest',
      '--text', replacement.text,
    ];
    if (replacement.minY != null) argumentsList.push('--min-y', String(replacement.minY));
    if (replacement.maxY != null) argumentsList.push('--max-y', String(replacement.maxY));
    if (replacement.replaceInput) argumentsList.push('--replace-input');
    await execFileAsync(pythonCommand, argumentsList, {maxBuffer: 4 * 1024 * 1024});
  }

  const recordedDurationMs = await mediaDurationMs(clipFile);
  if (recordedDurationMs < narrationOffsetMs + scene.narrationDurationMs + 1200) {
    throw new Error(`Source segment ${scene.id} is shorter than its narration`);
  }
  scenes.push({...scene, clipFile, narrationOffsetMs, recordedDurationMs});
}

await writeJson(manifestFile, {
  ...manifest,
  sourceVideo,
  sourceEditFile: configFile,
  recordedAt: new Date().toISOString(),
  scenes,
});
console.log(`Imported ${scenes.length} source segments into ${runDir}`);
