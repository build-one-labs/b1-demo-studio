import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { DemoFactoryMaterializer, INTERNAL_WRITE } from './demo-factory.materializer';
import { DemoRow, demoToRows, DSO, SceneRow } from './demo-factory.rows';

import type { DemoFactoryStore } from './demo-factory.store';
import type { ClsService } from 'nestjs-cls';

/**
 * The after-batch hooks run inside the data service's write transaction, and
 * the store reads on a connection of its own — so while they run, the store
 * still shows the rows as they were before the batch. These tests pin that the
 * hooks build the file and the demo row from the batch they are handed, not
 * from a read-back that cannot see it yet.
 */

/** A store frozen at the pre-batch state, recording what is committed and whether as an internal write. */
const frozenStore = (demo: DemoRow, scenes: SceneRow[], cls: ClsService) => {
  const commits: { name: string; updated: Record<string, unknown>[]; internal: boolean }[] = [];
  const store = {
    read: async (name: string) => (name === DSO.demo ? [demo] : name === DSO.scene ? scenes : []),
    commit: async (name: string, changes: { updatedRecords?: Record<string, unknown>[] }) => {
      commits.push({ name, updated: changes.updatedRecords ?? [], internal: cls.get(INTERNAL_WRITE) === true });
    }
  };
  return { store: store as unknown as DemoFactoryStore, commits };
};

/** A continuation-local store that is always active, as it is during a request. */
const activeCls = (): ClsService => {
  const values = new Map<string, unknown>();
  return {
    isActive: () => true,
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
    run: (work: () => unknown) => work()
  } as unknown as ClsService;
};

const rows = demoToRows({
  schemaVersion: 1,
  id: 'demo',
  title: 'Demo',
  settings: { language: 'en' },
  scenes: ['one', 'two'].map((id) => ({ id, title: id, route: '/', narration: 'Hello.' }))
});

describe('DemoFactoryMaterializer after a scene batch', () => {
  let root: string;
  let materializer: DemoFactoryMaterializer;
  let commits: ReturnType<typeof frozenStore>['commits'];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'demo-factory-materializer-'));
    const cls = activeCls();
    const frozen = frozenStore(rows.demo, rows.scenes, cls);
    commits = frozen.commits;
    materializer = new DemoFactoryMaterializer(frozen.store, cls);
    // Never the repository's own demos/, and never the CLI: the schema is not under test here.
    Object.assign(materializer as unknown as Record<string, unknown>, {
      demosRoot: root,
      runValidate: async () => ({ code: 0, output: '' })
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const written = async () =>
    YAML.parse(await readFile(path.join(root, 'demo', 'demo.yaml'), 'utf8')) as {
      scenes: { id: string; title: string }[];
    };

  const demoCommit = () => {
    const commit = commits.find((candidate) => candidate.name === DSO.demo);
    if (!commit) throw new Error('The demo row was not written');
    return { row: commit.updated[0] as unknown as DemoRow, internal: commit.internal };
  };

  it('writes an updated scene the store does not show yet', async () => {
    await materializer.onAfterUpdate([{ ...rows.scenes[0], title: 'Renamed' }]);

    expect((await written()).scenes.map((scene) => scene.title)).toEqual(['Renamed', 'two']);
    const { row, internal } = demoCommit();
    expect(row.sceneCount).toBe(2);
    expect(row.editedAt).toEqual(expect.any(String));
    expect(row.sourceHash).toMatch(/^sha256:/);
    // Through the demo hook it would materialize again, from the pre-batch rows.
    expect(internal).toBe(true);
  });

  it('counts a created scene the store does not show yet', async () => {
    const created: SceneRow = { ...rows.scenes[1], id: 'demo:three', sceneId: 'three', title: 'three', sequence: 3 };
    await materializer.onAfterCreate([created]);

    expect((await written()).scenes.map((scene) => scene.id)).toEqual(['one', 'two', 'three']);
    expect(demoCommit().row.sceneCount).toBe(3);
  });

  it('leaves out a deleted scene the store still shows', async () => {
    await materializer.onAfterDelete([rows.scenes[0]]);

    expect((await written()).scenes.map((scene) => scene.id)).toEqual(['two']);
    expect(demoCommit().row.sceneCount).toBe(1);
  });

  it('ignores the undefined a delete reports for a row that was already gone', async () => {
    await materializer.onAfterDelete([undefined as unknown as SceneRow]);

    expect(commits).toEqual([]);
  });
});
