import {execFile} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {captionsToSrt} from '../src/lib/captions.mjs';
import {ensureDir, loadLatestRun, readJson, writeJson} from '../src/lib/files.mjs';

const execFileAsync = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const demoId = process.argv[2] || 'vibecode-sales-tour';
const {runDir} = await loadLatestRun(demoId);
const manifest = await readJson(path.join(runDir, 'run-manifest.json'));
if (!manifest.scenes.every((scene) => scene.clipFile && scene.narrationFile)) {
  throw new Error('Run manifest requires imported clips and narration files');
}

const muxedDir = await ensureDir(path.join(runDir, 'muxed'));
const muxedFiles = [];
const combinedCaptions = [];
let videoOffsetMs = 0;

for (const scene of manifest.scenes) {
  const muxedFile = path.join(muxedDir, `${scene.id}.mp4`);
  const durationSeconds = (scene.recordedDurationMs / 1000).toFixed(3);
  await execFileAsync(ffmpeg, [
    '-y', '-v', 'error',
    '-i', scene.clipFile,
    '-i', scene.narrationFile,
    '-filter_complex', `[1:a]adelay=${scene.narrationOffsetMs}:all=1,apad=whole_dur=${durationSeconds}[voice]`,
    '-map', '0:v:0', '-map', '[voice]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', durationSeconds,
    '-movflags', '+faststart',
    muxedFile,
  ], {maxBuffer: 4 * 1024 * 1024});
  muxedFiles.push(muxedFile);
  for (const caption of scene.captions) {
    combinedCaptions.push({
      ...caption,
      startMs: caption.startMs + videoOffsetMs + scene.narrationOffsetMs,
      endMs: caption.endMs + videoOffsetMs + scene.narrationOffsetMs,
    });
  }
  videoOffsetMs += scene.recordedDurationMs;
}

const concatFile = path.join(muxedDir, 'concat.txt');
await writeFile(concatFile, `${muxedFiles.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n')}\n`, 'utf8');
const outputFile = path.join(runDir, `${demoId}.mp4`);
await execFileAsync(ffmpeg, [
  '-y', '-v', 'error',
  '-f', 'concat', '-safe', '0', '-i', concatFile,
  '-c', 'copy', '-movflags', '+faststart',
  outputFile,
], {maxBuffer: 4 * 1024 * 1024});

const srtFile = path.join(runDir, `${demoId}.srt`);
await writeFile(srtFile, `${captionsToSrt(combinedCaptions)}\n`, 'utf8');
await writeJson(path.join(runDir, 'render-result.json'), {
  renderer: 'ffmpeg-source-mux',
  outputFile,
  srtFile,
  totalDurationMs: videoOffsetMs,
});
console.log(`Rendered ${outputFile}`);
