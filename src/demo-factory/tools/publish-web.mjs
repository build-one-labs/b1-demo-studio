/**
 * Publish a rendered run into the B1 web app.
 *
 * The renderer leaves its browser-ready artefacts in two places: the composition
 * props in `output/<demo>/<runId>/render-result.json`, and the normalized clips
 * plus narration under `public/generated/<runId>/`. The web app's native
 * component (DemoFactoryRoot.client.vue) reads exactly those two things from
 * `/demo-factory`, so publishing is a copy — no re-render, no second source of
 * truth for the timing.
 *
 * Usage: node tools/publish-web.mjs [demoId]   (default: sales-tour-planning)
 */
import {cp, rm} from 'node:fs/promises';
import path from 'node:path';
import {ensureDir, loadLatestRun, projectRoot, readJson, writeJson} from '../src/lib/files.mjs';

const demoId = process.argv[2] || 'sales-tour-planning';
const webAppPublic = path.resolve(projectRoot, '..', 'web-app', 'public', 'demo-factory');

const {runId, runDir} = await loadLatestRun(demoId);
const renderResult = await readJson(path.join(runDir, 'render-result.json'));
const assetsDir = path.join(projectRoot, 'public', 'generated', runId);

await rm(webAppPublic, {recursive: true, force: true});
await ensureDir(webAppPublic);
await cp(assetsDir, path.join(webAppPublic, 'generated', runId), {recursive: true});
await writeJson(path.join(webAppPublic, 'render-result.json'), {inputProps: renderResult.inputProps, runId, demoId});

console.log(`Published ${demoId} run ${runId} to ${webAppPublic}`);
