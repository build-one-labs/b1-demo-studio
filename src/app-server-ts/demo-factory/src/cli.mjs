#!/usr/bin/env node
import path from 'node:path';
import {loadDotEnv} from './lib/env.mjs';
import {createRun, loadDemo, rehomeManifest, loadLatestRun, readJson, sha256, writeJson} from './lib/files.mjs';
import {prepareNarration} from './lib/narration.mjs';
import {recordScenes} from './lib/record.mjs';
import {renderDemo} from './lib/render.mjs';

await loadDotEnv();

const [command = 'help', demoId = 'payment-infrastructure', ...flags] = process.argv.slice(2);
const voiceFlag = flags.find((flag) => flag.startsWith('--voice='));
const providerOverride = voiceFlag?.split('=')[1];
const scenesFlag = flags.find((flag) => flag.startsWith('--scenes='));
const sceneFilter = scenesFlag ? new Set(scenesFlag.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean)) : null;

const validate = async () => {
  const {demo, file} = await loadDemo(demoId);
  console.log(`OK: ${demo.id} with ${demo.scenes.length} scenes (${file})`);
};

const prepare = async () => {
  const {demo, file} = await loadDemo(demoId);
  const {runId, runDir} = await createRun(demo);
  const narration = await prepareNarration({demo, runDir, providerOverride});
  const manifest = {
    schemaVersion: 1,
    demoId: demo.id,
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
  const {runDir} = await loadLatestRun(demoId);
  const manifest = rehomeManifest(await readJson(path.join(runDir, 'run-manifest.json')), runDir);
  const result = await renderDemo({demo, manifest});
  console.log(`Rendered ${result.outputFile}`);
};

switch (command) {
  case 'validate': await validate(); break;
  case 'prepare': await prepare(); break;
  case 'record': await record(); break;
  case 'render': await render(); break;
  default:
    console.log('Usage: node src/cli.mjs <validate|prepare|record|render> <demo-id> [--voice=elevenlabs|silent] [--scenes=id-1,id-2]');
    process.exitCode = command === 'help' ? 0 : 1;
}
