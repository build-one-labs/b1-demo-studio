import {access, rm} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {envBoolean, resolveApiKey} from './env.mjs';
import {ensureDir} from './files.mjs';
import {seconds, step, warn} from './log.mjs';
import {executeAssertions, executeSceneActions, installDemoCursor, primeDemoCursor, resolveDemoUrl} from './actions.mjs';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const existingFile = async (candidate) => {
  if (!candidate) return undefined;
  // The path is a default at least as often as it is a choice — run-demo.mjs
  // sets B1_AUTH_STATE on every run, whether or not a state was ever minted
  // there — so a missing file means "no stored session", not a broken setting.
  // Letting access() throw here made the API-key fallback below unreachable in
  // exactly the workspaces it was written for: no handoff branch, no minted
  // state, and the run died before it could try the header.
  return access(candidate).then(
    () => candidate,
    () => undefined,
  );
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
  // Scoped name first: a key belongs to one auth server and is named for it,
  // and the unqualified variable no longer exists in a workspace.
  const apiKey = resolveApiKey()?.key;
  const clipsDir = await ensureDir(path.join(manifest.runDir, 'clips'));
  // Alpine and other slim images cannot run Playwright's own download, so a
  // container may ship a system Chromium instead. Same shape as FFMPEG_PATH in
  // media.mjs: point at the binary and the pipeline uses it, leave it unset and
  // Playwright resolves its managed browser as before.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({headless: envBoolean(demo.settings.headlessEnv, true), executablePath});
  const recordedScenes = [];
  // How the take was authenticated is the first thing to check when a scene
  // records the sign-in screen instead of the app, so it is on the record.
  step(`Recording ${demo.id} against ${baseUrl} (${authState ? `storage state ${authState}` : apiKey ? 'x-api-key header' : 'no credentials'})`);

  try {
    // The setup block: same actions as a scene, no camera. It runs before a
    // full take so the environment starts from a known state (a repository
    // reset, seed data, a dismissed dialog). A partial re-record skips it —
    // whoever re-records one scene wants the state the other scenes left.
    if (demo.setup && !sceneFilter) {
      const context = await browser.newContext({
        viewport: demo.settings.viewport,
        storageState: authState,
        ...(apiKey && !authState ? {extraHTTPHeaders: {'x-api-key': apiKey}} : {}),
      });
      const page = await context.newPage();
      try {
        const url = resolveDemoUrl(demo.setup.route, baseUrl);
        step(`Setup: opening ${url}`);
        await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
        await page.locator('[data-demo-id="app-ready"]').waitFor({state: 'visible', timeout: 15_000}).catch(() => {});
        await executeSceneActions({
          page,
          scene: {actions: demo.setup.actions, cues: {}},
          baseUrl,
          narrationStartTime: Date.now(),
          cursor: {enabled: false},
        });
        await executeAssertions({page, assertions: demo.setup.assertions});
        step('Setup: done');
      } catch (error) {
        throw new Error(`Setup failed: ${error.message}`, {cause: error});
      } finally {
        await context.close().catch(() => {});
      }
    }

    for (const [index, preparedScene] of manifest.scenes.entries()) {
      const position = `${index + 1}/${manifest.scenes.length}`;
      if (sceneFilter && !sceneFilter.has(preparedScene.id)) {
        if (!preparedScene.clipFile) throw new Error(`Scene ${preparedScene.id} has no existing clip and cannot be skipped`);
        step(`Scene ${position}: ${preparedScene.id} — not selected, keeping the existing clip`);
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
        step(`Scene ${position}: ${sourceScene.id} — opening ${url}`);
        await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
        // The framework's shell row is the fallback ready signal: a deployed
        // app without the demo-ready plugin has no app-ready marker, and
        // waiting the full timeout for it put 15 silent seconds of title card
        // at the head of every scene.
        await page.locator('[data-demo-id="app-ready"], .b1-shell-row').first().waitFor({state: 'visible', timeout: 15_000}).catch(() => {});
        const scene = {...sourceScene, cues: preparedScene.cues};
        await installDemoCursor(page, demo.settings.cursor);
        await primeDemoCursor({page, scene, cursor: demo.settings.cursor});
        await sleep(demo.settings.holdBeforeMs);
        const narrationStartTime = Date.now();
        const {timelapses} = await executeSceneActions({page, scene, baseUrl, narrationStartTime, cursor: demo.settings.cursor});
        await executeAssertions({page, assertions: sourceScene.assertions});
        // A live wait can outrun the narration; the scene still deserves its
        // stillness after the last action, not a cut mid-motion.
        const desiredEndAt = Math.max(narrationStartTime + preparedScene.narrationDurationMs, Date.now()) + demo.settings.holdAfterMs;
        if (Date.now() < desiredEndAt) await sleep(desiredEndAt - Date.now());

        const clipFile = path.join(clipsDir, `${sourceScene.id}.webm`);
        const narrationOffsetMs = narrationStartTime - recordingStartedAt;
        const recordedDurationMs = Date.now() - recordingStartedAt;
        await context.close();
        await video.saveAs(clipFile);
        const originalVideoFile = await video.path();
        if (path.resolve(originalVideoFile) !== path.resolve(clipFile)) await rm(originalVideoFile, {force: true});
        // Timelapses leave executeSceneActions relative to the narration start;
        // the composition seeks the clip, so they are stored clip-relative.
        const clipTimelapses = timelapses.map((segment) => ({...segment, fromMs: segment.fromMs + narrationOffsetMs, toMs: segment.toMs + narrationOffsetMs}));
        if (clipTimelapses.length) step(`Scene ${position}: ${sourceScene.id} — ${clipTimelapses.map((s) => `${seconds(s.toMs - s.fromMs)} wait compressed to ${seconds(s.targetMs)}`).join(', ')}`);
        step(`Scene ${position}: ${sourceScene.id} — recorded ${seconds(recordedDurationMs)} to ${clipFile}`);
        recordedScenes.push({...preparedScene, clipFile, narrationOffsetMs, recordedDurationMs, timelapses: clipTimelapses});
      } catch (error) {
        const failureShot = path.join(clipsDir, `${sourceScene.id}.failure.png`);
        warn(`Scene ${position}: ${sourceScene.id} failed after ${seconds(Date.now() - recordingStartedAt)} — screenshot at ${failureShot}`);
        await page.screenshot({path: failureShot, fullPage: false}).catch(() => {});
        await context.close().catch(() => {});
        throw new Error(`Scene ${sourceScene.id} failed: ${error.message}`, {cause: error});
      }
    }
  } finally {
    await browser.close();
  }

  return {...manifest, baseUrl, scenes: recordedScenes, recordedAt: new Date().toISOString()};
};
