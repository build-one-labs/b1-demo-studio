import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {loadSelectedRun, writeJson} from '../src/lib/files.mjs';

test('explicit run selection ignores latest-run and rejects mismatches and traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'demo-runs-'));
  const previous = process.env.DEMO_OUTPUT_DIR;
  process.env.DEMO_OUTPUT_DIR = root;
  try {
    const demoId = 'demo';
    const runId = '2026-10-01T10-50-19-979Z--b9f42092';
    const runDir = path.join(root, demoId, runId);
    await writeJson(path.join(root, demoId, 'latest-run.json'), {runId: 'a-different-run'});
    await writeJson(path.join(runDir, 'run-manifest.json'), {demoId, runId, runDir, scenes: []});
    const selected = await loadSelectedRun(demoId, runId);
    assert.equal(selected.runDir, runDir);
    assert.equal(selected.manifest.runId, runId);
    await assert.rejects(loadSelectedRun(demoId, '../escape'), /Invalid/);
    await assert.rejects(loadSelectedRun('../escape', runId), /Invalid/);
    await writeJson(path.join(runDir, 'run-manifest.json'), {demoId: 'another-demo', runId, runDir, scenes: []});
    await assert.rejects(loadSelectedRun(demoId, runId), /does not belong/);
  } finally {
    if (previous === undefined) delete process.env.DEMO_OUTPUT_DIR;
    else process.env.DEMO_OUTPUT_DIR = previous;
    await rm(root, {recursive: true, force: true});
  }
});
