#!/usr/bin/env node
import path from 'node:path';
import {loadDotEnv} from './lib/env.mjs';
import {createRun, loadDemo, rehomeManifest, loadLatestRun, loadSelectedRun, readJson, sha256, writeJson} from './lib/files.mjs';
import {prepareNarration} from './lib/narration.mjs';
import {recordScenes} from './lib/record.mjs';
import {renderDemo} from './lib/render.mjs';
import {analyzeUpload} from './lib/source-video.mjs';
import {convertDemo} from './lib/convert.mjs';
import {inspectPage} from './lib/inspect.mjs';
import {readFile} from 'node:fs/promises';

await loadDotEnv();

const [command = 'help', demoId = 'payment-infrastructure', ...flags] = process.argv.slice(2);
const voiceFlag = flags.find((flag) => flag.startsWith('--voice='));
const providerOverride = voiceFlag?.split('=')[1];
const runId = flags.find((flag) => flag.startsWith('--run='))?.slice('--run='.length);
const scenesFlag = flags.find((flag) => flag.startsWith('--scenes='));
const flagValue = (name) => flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
const sceneFilter = scenesFlag ? new Set(scenesFlag.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean)) : null;

const validate = async () => {
  const {demo, file} = await loadDemo(demoId);
  console.log(`OK: ${demo.id} with ${demo.scenes.length} scenes (${file})`);
};

/**
 * Turn an uploaded screen recording into a demo document (`<upload>/demo.json`).
 * The document is not saved here: the app server saves it through its one
 * validated write path, so a demo never lands half-made.
 */
const analyze = async () => {
  const uploadId = flagValue('upload');
  if (!uploadId) throw new Error('analyze needs --upload=<upload-id>');
  const document = await analyzeUpload({uploadId, demoId, title: flagValue('title'), language: flagValue('language')});
  console.log(`Analyzed upload ${uploadId}: ${document.scenes.length} scenes for demo ${demoId}`);
};

/**
 * Turn the clip scenes of a video demo into filmed scenes (see convert.mjs).
 * Like analyze, the result (`<upload>/converted.json`) is saved by the app
 * server, not here.
 */
const convert = async () => {
  const {demo} = await loadDemo(demoId);
  const {file, filmed, total} = await convertDemo({demo, sceneFilter});
  console.log(`Conversion of ${demoId}: ${filmed} of ${total} scene(s) filmed — ${file}`);
};

/**
 * The live look (see inspect.mjs): `--request=<file>` holds what to open and
 * play, `--out=<dir>` receives result.json and page.jpg. Exits 0 whether the
 * draft passed or not — the result says which; only a broken request fails.
 */
const inspect = async () => {
  const requestFile = flagValue('request');
  const outDir = flagValue('out');
  if (!requestFile || !outDir) throw new Error('inspect needs --request=<file> and --out=<dir>');
  const {demo} = await loadDemo(demoId);
  await inspectPage({demo, request: JSON.parse(await readFile(requestFile, 'utf8')), outDir});
};

const prepare = async () => {
  const {demo, file} = await loadDemo(demoId);
  const {runId, runDir} = await createRun(demo);
  const narration = await prepareNarration({demo, runDir, providerOverride});
  const manifest = {
    schemaVersion: 1,
    demoId: demo.id,
    demoTitle: demo.title,
    demoFile: file,
    demoHash: `sha256:${sha256(JSON.stringify(demo))}`,
    runId,
    runDir,
    createdAt: new Date().toISOString(),
    narrationProvider: narration.provider,
    settings: demo.settings,
    scenes: narration.scenes,
  };
  await writeJson(path.join(runDir, 'run-manifest.json'), manifest);
  console.log(`Prepared ${demo.id} (${narration.provider}) in ${runDir}`);
};

const record = async () => {
  const {demo} = await loadDemo(demoId);
  const {runDir} = await loadLatestRun(demoId);
  const manifestFile = path.join(runDir, 'run-manifest.json');
  const manifest = rehomeManifest(await readJson(manifestFile), runDir);
  const recorded = await recordScenes({demo, manifest, sceneFilter});
  await writeJson(manifestFile, recorded);
  console.log(`Recorded ${recorded.scenes.length} scenes in ${runDir}`);
};

const render = async () => {
  const {demo} = await loadDemo(demoId);
  if (runId) {
    const {manifest} = await loadSelectedRun(demoId, runId);
    const result = await renderDemo({demo: {...demo, title: manifest.demoTitle || demo.title, settings: manifest.settings}, manifest});
    console.log(`Rendered ${result.outputFile}`);
    return;
  }
  const {runDir} = await loadLatestRun(demoId);
  const manifest = rehomeManifest(await readJson(path.join(runDir, 'run-manifest.json')), runDir);
  const result = await renderDemo({demo, manifest});
  console.log(`Rendered ${result.outputFile}`);
};

switch (command) {
  case 'validate': await validate(); break;
  case 'analyze': await analyze(); break;
  case 'convert': await convert(); break;
  case 'inspect': await inspect(); break;
  case 'prepare': await prepare(); break;
  case 'record': await record(); break;
  case 'render': await render(); break;
  default:
    console.log('Usage: node src/cli.mjs <validate|analyze|convert|inspect|prepare|record|render> <demo-id> [--voice=elevenlabs|silent] [--scenes=id-1,id-2 (record, convert)] [--run=run-id (render)] [--request=file --out=dir (inspect)] [--upload=upload-id --title=… --language=de (analyze)]');
    process.exitCode = command === 'help' ? 0 : 1;
}
