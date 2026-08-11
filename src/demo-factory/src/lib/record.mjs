import {access, rm} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {envBoolean} from './env.mjs';
import {ensureDir} from './files.mjs';
import {executeAssertions, executeSceneActions, installDemoCursor, primeDemoCursor, resolveDemoUrl} from './actions.mjs';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const existingFile = async (candidate) => {
  if (!candidate) return undefined;
  await access(candidate);
  return candidate;
};

export const recordScenes = async ({demo, manifest, sceneFilter = null}) => {
  const baseUrl = process.env[demo.settings.baseUrl.env] || demo.settings.baseUrl.fallback;
  const authState = await existingFile(process.env[demo.settings.authStateEnv]);
  // Second way to authenticate a take, for workspaces whose auth server has no
  // x-api-key handoff branch (so `auth:workspace` cannot mint a storage state)
  // and no display (so the headed `auth:b1` capture cannot run either). The
  // app server's guard accepts `x-api-key` on any request and resolves it to
  // the owning user, and Playwright applies context headers to navigation and
  // XHR alike — so the whole recorded session is authenticated. Ignored when
  // unset, and a storage state still wins where one exists.
  const apiKey = process.env.B1_USER_API_KEY;
  const clipsDir = await ensureDir(path.join(manifest.runDir, 'clips'));
  // Alpine and other slim images cannot run Playwright's own download, so a
  // container may ship a system Chromium instead. Same shape as FFMPEG_PATH in
  // media.mjs: point at the binary and the pipeline uses it, leave it unset and
  // Playwright resolves its managed browser as before.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({headless: envBoolean(demo.settings.headlessEnv, true), executablePath});
  const recordedScenes = [];

  try {
    for (const preparedScene of manifest.scenes) {
      if (sceneFilter && !sceneFilter.has(preparedScene.id)) {
        if (!preparedScene.clipFile) throw new Error(`Scene ${preparedScene.id} has no existing clip and cannot be skipped`);
        recordedScenes.push(preparedScene);
        continue;
      }
      const sourceScene = demo.scenes.find((scene) => scene.id === preparedScene.id);
      const context = await browser.newContext({
        viewport: demo.settings.viewport,
        screen: demo.settings.viewport,
        deviceScaleFactor: 1,
        colorScheme: 'light',
        locale: demo.settings.language === 'de' ? 'de-DE' : demo.settings.language,
        storageState: authState,
        ...(apiKey && !authState ? {extraHTTPHeaders: {'x-api-key': apiKey}} : {}),
        recordVideo: {dir: clipsDir, size: demo.settings.viewport},
      });
      const page = await context.newPage();
      const recordingStartedAt = Date.now();
      const video = page.video();

      try {
        const url = resolveDemoUrl(sourceScene.route, baseUrl);
        await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
        await page.locator('[data-demo-id="app-ready"]').waitFor({state: 'visible', timeout: 15_000}).catch(() => {});
        const scene = {...sourceScene, cues: preparedScene.cues};
        await installDemoCursor(page, demo.settings.cursor);
        await primeDemoCursor({page, scene, cursor: demo.settings.cursor});
        await sleep(demo.settings.holdBeforeMs);
        const narrationStartTime = Date.now();
        await executeSceneActions({page, scene, baseUrl, narrationStartTime, cursor: demo.settings.cursor});
        await executeAssertions({page, assertions: sourceScene.assertions});
        const desiredEndAt = narrationStartTime + preparedScene.narrationDurationMs + demo.settings.holdAfterMs;
        if (Date.now() < desiredEndAt) await sleep(desiredEndAt - Date.now());

        const clipFile = path.join(clipsDir, `${sourceScene.id}.webm`);
        const narrationOffsetMs = narrationStartTime - recordingStartedAt;
        const recordedDurationMs = Date.now() - recordingStartedAt;
        await context.close();
        await video.saveAs(clipFile);
        const originalVideoFile = await video.path();
        if (path.resolve(originalVideoFile) !== path.resolve(clipFile)) await rm(originalVideoFile, {force: true});
        recordedScenes.push({...preparedScene, clipFile, narrationOffsetMs, recordedDurationMs});
      } catch (error) {
        await page.screenshot({path: path.join(clipsDir, `${sourceScene.id}.failure.png`), fullPage: false}).catch(() => {});
        await context.close().catch(() => {});
        throw new Error(`Scene ${sourceScene.id} failed: ${error.message}`, {cause: error});
      }
    }
  } finally {
    await browser.close();
  }

  return {...manifest, baseUrl, scenes: recordedScenes, recordedAt: new Date().toISOString()};
};
