import {copyFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {captionsToSrt} from './captions.mjs';
import {ensureDir, projectRoot, writeJson} from './files.mjs';
import {normalizeVideo} from './media.mjs';

const toPublicAsset = (absoluteFile, publicDirectory) => path.relative(path.join(projectRoot, 'public'), absoluteFile).split(path.sep).join('/');

export const renderDemo = async ({demo, manifest}) => {
  if (!manifest.scenes.every((scene) => scene.clipFile)) throw new Error('Run manifest has no recorded clips. Run record first.');
  const publicRunDir = path.join(projectRoot, 'public', 'generated', manifest.runId);
  const normalizedDir = path.join(manifest.runDir, 'normalized');
  await rm(publicRunDir, {recursive: true, force: true});
  await ensureDir(publicRunDir);
  await ensureDir(normalizedDir);

  const scenes = [];
  let videoOffsetMs = 0;
  const combinedCaptions = [];
  for (const scene of manifest.scenes) {
    const normalized = await normalizeVideo(scene.clipFile, path.join(normalizedDir, `${scene.id}.mp4`));
    const clipTarget = path.join(publicRunDir, `${scene.id}.mp4`);
    const narrationExtension = path.extname(scene.narrationFile);
    const narrationTarget = path.join(publicRunDir, `${scene.id}${narrationExtension}`);
    await copyFile(normalized.file, clipTarget);
    await copyFile(scene.narrationFile, narrationTarget);
    scenes.push({
      id: scene.id,
      title: scene.title,
      clipAsset: toPublicAsset(clipTarget, publicRunDir),
      narrationAsset: toPublicAsset(narrationTarget, publicRunDir),
      narrationOffsetMs: scene.narrationOffsetMs,
      recordedDurationMs: normalized.durationMs,
      captions: scene.captions,
    });
    for (const caption of scene.captions) {
      combinedCaptions.push({...caption, startMs: caption.startMs + videoOffsetMs + scene.narrationOffsetMs, endMs: caption.endMs + videoOffsetMs + scene.narrationOffsetMs});
    }
    videoOffsetMs += normalized.durationMs;
  }

  const inputProps = {title: demo.title, fps: demo.settings.fps, branding: demo.settings.branding, scenes};
  const entryPoint = path.join(projectRoot, 'src', 'remotion', 'index.ts');
  const serveUrl = await bundle({entryPoint, webpackOverride: (config) => config});
  // Same idea as PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH in record.mjs: a slim
  // container ships one Chromium and both browser users are pointed at it,
  // rather than each downloading its own at run time.
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
  const composition = await selectComposition({serveUrl, id: 'B1Demo', inputProps, browserExecutable});
  const outputFile = path.join(manifest.runDir, `${demo.id}.mp4`);
  const configuredConcurrency = process.env.REMOTION_CONCURRENCY;
  const concurrency = configuredConcurrency && /^\d+$/.test(configuredConcurrency) ? Number(configuredConcurrency) : (configuredConcurrency || 2);
  // Unbounded, the compositor's OffthreadVideo frame cache grows with the
  // number of source clips until the kernel kills it — on an 8-16 GB workspace
  // that reliably ends a 1080p multi-scene render as "Compositor exited with
  // signal SIGTERM" partway through. Cap it (in MB) to trade a little frame
  // re-extraction for a render that finishes.
  const configuredCacheMb = process.env.REMOTION_OFFTHREADVIDEO_CACHE_MB;
  const offthreadVideoCacheSizeInBytes = configuredCacheMb && /^\d+$/.test(configuredCacheMb)
    ? Number(configuredCacheMb) * 1024 * 1024
    : undefined;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    audioCodec: 'aac',
    outputLocation: outputFile,
    inputProps,
    overwrite: true,
    crf: 20,
    concurrency,
    ...(browserExecutable ? {browserExecutable} : {}),
    ...(offthreadVideoCacheSizeInBytes ? {offthreadVideoCacheSizeInBytes} : {}),
  });

  const srtFile = path.join(manifest.runDir, `${demo.id}.srt`);
  await writeFile(srtFile, `${captionsToSrt(combinedCaptions)}\n`, 'utf8');
  const renderResult = {outputFile, srtFile, totalDurationMs: videoOffsetMs, inputProps};
  await writeJson(path.join(manifest.runDir, 'render-result.json'), renderResult);
  return renderResult;
};
