import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {demoSchema} from '../schema.mjs';

export const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '..', '..');

export const ensureDir = async (directory) => {
  await mkdir(directory, {recursive: true});
  return directory;
};

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
export const writeJson = async (file, value) => {
  await ensureDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const loadDemo = async (demoId) => {
  const file = path.join(projectRoot, 'demos', demoId, 'demo.yaml');
  const document = YAML.parse(await readFile(file, 'utf8'));
  const demo = demoSchema.parse(document);
  validateDemoSemantics(demo);
  return {demo, file};
};

export const validateDemoSemantics = (demo) => {
  const sceneIds = new Set();
  for (const scene of demo.scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    const cueIds = new Set([...scene.narration.matchAll(/\[cue:([a-zA-Z0-9_-]+)\]/g)].map((match) => match[1]));
    for (const action of scene.actions) {
      if (action.atCue && !cueIds.has(action.atCue)) {
        throw new Error(`Scene ${scene.id}: action references unknown cue ${action.atCue}`);
      }
      if (!['goto'].includes(action.action) && !action.target && !['screenshot'].includes(action.action)) {
        throw new Error(`Scene ${scene.id}: action ${action.action} requires a target`);
      }
    }
  }
};

export const resolveOutputRoot = () => path.resolve(projectRoot, process.env.DEMO_OUTPUT_DIR || 'output');

export const createRun = async (demo) => {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}--${sha256(JSON.stringify(demo)).slice(0, 8)}`;
  const demoOutput = await ensureDir(path.join(resolveOutputRoot(), demo.id));
  const runDir = await ensureDir(path.join(demoOutput, runId));
  await writeJson(path.join(demoOutput, 'latest-run.json'), {runId, runDir});
  return {runId, runDir};
};

/**
 * The newest run for a demo.
 *
 * `runDir` is rebuilt from the output root rather than trusted from the file.
 * createRun writes an ABSOLUTE path, which is only valid for the machine that
 * wrote it — and the pipeline is now started from two places with different
 * mount points: a workspace shell (/workspaces/<repo>) and the app server
 * container (/workspace), which reach the same directory by different names.
 * The run id is the durable identity; the path around it is not.
 */
/**
 * Re-home every absolute path a manifest carries onto this machine's layout.
 *
 * prepare and record write absolute paths — runDir, each scene's clipFile and
 * narrationFile, and narration cached under .cache — all rooted at whatever the
 * repository was called on the machine that produced them. The same run is now
 * reachable under two names (a workspace shell sees /workspaces/<repo>, the app
 * server container sees /workspace), so those paths are rewritten against the
 * current project root instead of trusted. The run id is what identifies a run;
 * the prefix in front of it is an accident of where it was made.
 */
export const rehomeManifest = (manifest, runDir) => {
  const staleRunDir = manifest?.runDir;
  if (!staleRunDir || staleRunDir === runDir) return {...manifest, runDir};

  // runDir and staleRunDir end with the same output/<demo>/<run> tail, so the
  // difference between them is exactly the old project root.
  const tail = path.relative(projectRoot, runDir);
  const staleRoot = staleRunDir.slice(0, staleRunDir.length - tail.length);
  const rehome = (value) =>
    typeof value === 'string' && staleRoot && value.startsWith(staleRoot)
      ? path.join(projectRoot, value.slice(staleRoot.length))
      : value;

  return {
    ...manifest,
    runDir,
    scenes: (manifest.scenes || []).map((scene) =>
      Object.fromEntries(Object.entries(scene).map(([key, value]) => [key, rehome(value)]))
    ),
  };
};

export const loadLatestRun = async (demoId) => {
  const pointer = await readJson(path.join(resolveOutputRoot(), demoId, 'latest-run.json'));
  return {...pointer, runDir: path.join(resolveOutputRoot(), demoId, pointer.runId)};
};

