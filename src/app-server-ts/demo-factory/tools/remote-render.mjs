/**
 * Render a recorded run on THIS machine, fetching everything it needs from a
 * remote Demo Factory host — the codespace, or a deployed stack.
 *
 * The render is by far the heaviest stage (a ten-minute 1080p video takes
 * ~100 minutes on a codespace and a fraction of that on a desktop), and it is
 * the one stage that needs nothing from the recording environment beyond the
 * run's files. This tool pulls the demo definition and the run's inputs
 * through the media routes, then runs the exact same render the studio host
 * would — the output MP4 and SRT land in this checkout's `output/` directory.
 *
 * Prerequisites on this machine: Node >= 20, this repository with a root
 * `yarn install` done, and ffmpeg + ffprobe on the PATH (or FFMPEG_PATH /
 * FFPROBE_PATH set). Remotion downloads its own headless Chrome on first use.
 *
 * Usage:
 *   node tools/remote-render.mjs --studio=<url> --demo=<id> [--run=<runId>]
 *
 * Auth against the studio host, one of:
 *   --api-key=<key>          sent as x-api-key (or env B1_USER_API_KEY)
 *   --session=<token>        the b1.session_token cookie of a signed-in browser
 *
 * Reaching a codespace from a desktop:
 *   gh codespace ports forward 8080:8080     # then --studio=http://localhost:8080
 * A deployed stack is just its https URL.
 */
import {mkdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadDotEnv} from '../src/lib/env.mjs';
import {loadDemo, readJson, rehomeManifest, resolveOutputRoot, writeJson} from '../src/lib/files.mjs';

await loadDotEnv();

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const studio = (flag('studio') || '').replace(/\/+$/, '');
const demoId = flag('demo') || '';
let runId = flag('run') || '';
const apiKey = flag('api-key') || process.env.B1_USER_API_KEY || '';
const session = flag('session') || '';

if (!studio || !demoId) {
  console.error('Usage: node tools/remote-render.mjs --studio=<url> --demo=<id> [--run=<runId>] [--api-key=…|--session=…]');
  process.exit(1);
}
if (!/^[\da-z][\da-z-]*$/.test(demoId)) throw new Error(`Invalid demo id: ${demoId}`);

const headers = {
  ...(apiKey ? {'x-api-key': apiKey} : {}),
  ...(session ? {cookie: `b1.session_token=${session}`} : {}),
};

const ACTIONS = `${studio}/service/app/server-actions/demo-factory/demo-factory-studio`;
const MEDIA = `${studio}/service/app/demo-factory/media`;

const action = async (name, body = {}) => {
  const response = await fetch(`${ACTIONS}/${name}`, {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
};

const download = async (remotePath, localFile) => {
  const response = await fetch(`${MEDIA}/${demoId}/${runId}/${remotePath}`, {headers});
  if (!response.ok) throw new Error(`Fetching ${remotePath} failed: ${response.status}`);
  await mkdir(path.dirname(localFile), {recursive: true});
  await writeFile(localFile, Buffer.from(await response.arrayBuffer()));
  return localFile;
};

const basename = (file) => String(file).split(/[/\\]/).pop();

// ---- 1. Which run, and what does it contain? --------------------------------

if (!runId) {
  ({runId} = await action('latest-run', {demoId}));
  console.log(`Latest run of ${demoId}: ${runId}`);
}

const manifestResponse = await fetch(`${MEDIA}/${demoId}/${runId}/run-manifest.json`, {headers});
if (!manifestResponse.ok) {
  throw new Error(`No run-manifest.json for ${demoId}/${runId} (${manifestResponse.status}) — has the run recorded?`);
}
const manifest = await manifestResponse.json();
if (!(manifest.scenes || []).every((scene) => scene.clipFile)) {
  throw new Error('The run has no recorded clips yet — record it before rendering remotely.');
}

// ---- 2. The demo definition, so branding and settings match the studio ------

const {yaml} = await action('export-demo', {demoId});
const demoFile = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '..', 'demos', demoId, 'demo.yaml');
await mkdir(path.dirname(demoFile), {recursive: true});
await writeFile(demoFile, yaml, 'utf8');
console.log(`Demo definition written to ${demoFile}`);

// ---- 3. Pull the run's inputs ----------------------------------------------

const runDir = path.join(resolveOutputRoot(), demoId, runId);
await mkdir(runDir, {recursive: true});

let fetched = 0;
for (const scene of manifest.scenes || []) {
  const files = [
    ['clips', basename(scene.clipFile)],
    ['narration', basename(scene.narrationFile)],
    ...(scene.alignmentFile ? [['narration', basename(scene.alignmentFile)]] : []),
  ];
  for (const [subdir, name] of files) {
    if (!name) continue;
    await download(`${subdir}/${name}`, path.join(runDir, subdir, name));
    fetched += 1;
    process.stdout.write(`\rFetched ${fetched} file(s)…`);
  }
}
console.log('');

await writeJson(path.join(runDir, 'run-manifest.json'), manifest);
await writeJson(path.join(resolveOutputRoot(), demoId, 'latest-run.json'), {runId, runDir});
console.log(`Run inputs staged in ${runDir}`);

// ---- 4. Render locally — the same code path as the studio host --------------

// A desktop usually has cores to spare; the codespace default of 1-2 would
// waste them. Anything the operator sets explicitly still wins.
if (!process.env.REMOTION_CONCURRENCY) {
  process.env.REMOTION_CONCURRENCY = String(Math.max(2, Math.min(16, Math.floor(os.cpus().length / 2))));
  console.log(`REMOTION_CONCURRENCY=${process.env.REMOTION_CONCURRENCY} (half the cores; set it yourself to override)`);
}

const {demo} = await loadDemo(demoId);
const localManifest = rehomeManifest(await readJson(path.join(runDir, 'run-manifest.json')), runDir);
const {renderDemo} = await import('../src/lib/render.mjs');
const result = await renderDemo({demo, manifest: localManifest});
console.log(`\nRendered: ${result.outputFile}`);
console.log(`Captions: ${result.srtFile}`);
console.log('The files stay on this machine — copy or share them from here.');
