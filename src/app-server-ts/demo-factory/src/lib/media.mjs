import {execFile} from 'node:child_process';
import {access, stat} from 'node:fs/promises';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

export const mediaDurationMs = async (file) => {
  const {stdout} = await execFileAsync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine media duration for ${file}`);
  return Math.max(1, Math.floor(duration * 1000) - 40);
};

export const normalizeVideo = async (source, target) => {
  let current = false;
  try {
    await access(target);
    const [sourceStat, targetStat] = await Promise.all([stat(source), stat(target)]);
    current = targetStat.mtimeMs >= sourceStat.mtimeMs;
  } catch {}
  if (!current) {
    await execFileAsync(ffmpeg, [
      '-y', '-v', 'error', '-i', source,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target,
    ], {maxBuffer: 4 * 1024 * 1024});
  }
  return {file: target, durationMs: await mediaDurationMs(target)};
};

