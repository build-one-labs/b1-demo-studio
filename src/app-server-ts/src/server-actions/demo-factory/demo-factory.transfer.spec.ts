import YAML from 'yaml';

import { assertOperator } from './demo-factory.lib';
import { DemoRow, SceneRow } from './demo-factory.rows';
import { DemoFactoryTransfer } from './demo-factory.transfer';

import type { DemoFactoryStore } from './demo-factory.store';

/**
 * An in-memory stand-in for the clob store: read and commit with the same
 * key-diff semantics, no materializer hooks. The transfer service's job under
 * test is the ordering and diffing of commits — the validation those commits
 * trigger in production belongs to the materializer and the CLI schema, which
 * have the whole pipeline as their test.
 */
class FakeStore {
  readonly tables = new Map<string, Map<string, Record<string, unknown>>>();

  readonly commits: { name: string; changes: Record<string, unknown[]> }[] = [];

  private keyOf(name: string, row: Record<string, unknown>): string {
    return String(name === 'DemoFactoryDemoDSO' ? row.id : row.id);
  }

  async read<T>(name: string): Promise<T[]> {
    return [...(this.tables.get(name)?.values() ?? [])] as T[];
  }

  async commit<T extends object>(
    name: string,
    changes: { createdRecords?: T[]; updatedRecords?: T[]; deletedRecords?: T[] }
  ): Promise<void> {
    const table = this.tables.get(name) ?? new Map<string, Record<string, unknown>>();
    this.tables.set(name, table);
    this.commits.push({
      name,
      changes: {
        created: [...(changes.createdRecords ?? [])],
        updated: [...(changes.updatedRecords ?? [])],
        deleted: [...(changes.deletedRecords ?? [])]
      }
    });
    for (const record of changes.createdRecords ?? []) {
      table.set(this.keyOf(name, record as Record<string, unknown>), record as Record<string, unknown>);
    }
    for (const record of changes.updatedRecords ?? []) {
      table.set(this.keyOf(name, record as Record<string, unknown>), record as Record<string, unknown>);
    }
    for (const record of changes.deletedRecords ?? []) {
      table.delete(this.keyOf(name, record as Record<string, unknown>));
    }
  }
}

const document = (id: string, sceneIds: string[]) => ({
  schemaVersion: 1,
  id,
  title: `Demo ${id}`,
  description: '',
  settings: { language: 'en' },
  scenes: sceneIds.map((sceneId) => ({
    id: sceneId,
    title: sceneId,
    route: '/',
    narration: 'Hello.',
    actions: [],
    assertions: []
  }))
});

const makeTransfer = () => {
  const store = new FakeStore();
  const transfer = new DemoFactoryTransfer(store as unknown as DemoFactoryStore);
  return { store, transfer };
};

describe('DemoFactoryTransfer', () => {
  it('imports a new demo: demo row first, then its scenes', async () => {
    const { store, transfer } = makeTransfer();
    const yaml = YAML.stringify(document('fresh', ['one', 'two']));

    const result = await transfer.importYaml(yaml);

    expect(result).toMatchObject({ demoId: 'fresh', scenes: 2, replaced: false });
    expect(store.commits[0].name).toBe('DemoFactoryDemoDSO');
    expect(store.commits[1].name).toBe('DemoFactorySceneDSO');
    const scenes = await store.read<SceneRow>('DemoFactorySceneDSO');
    expect(scenes.map((scene) => scene.sceneId).sort()).toEqual(['one', 'two']);
  });

  it('refuses a colliding import unless told otherwise', async () => {
    const { transfer } = makeTransfer();
    await transfer.importYaml(YAML.stringify(document('taken', ['one'])));

    await expect(transfer.importYaml(YAML.stringify(document('taken', ['one'])))).rejects.toThrow(/already exists/);
  });

  it('imports a copy under the requested id', async () => {
    const { store, transfer } = makeTransfer();
    await transfer.importYaml(YAML.stringify(document('original', ['one'])));

    const result = await transfer.importYaml(YAML.stringify(document('original', ['one'])), {
      mode: 'copy',
      newId: 'twin'
    });

    expect(result.demoId).toBe('twin');
    const demos = await store.read<DemoRow>('DemoFactoryDemoDSO');
    expect(demos.map((demo) => demo.id).sort()).toEqual(['original', 'twin']);
  });

  it('replacing a demo deletes the scenes the new document no longer has — after the new ones landed', async () => {
    const { store, transfer } = makeTransfer();
    await transfer.saveDocument(document('demo', ['keep', 'drop']));
    store.commits.length = 0;

    await transfer.saveDocument(document('demo', ['keep', 'added']));

    const scenes = await store.read<SceneRow>('DemoFactorySceneDSO');
    expect(scenes.map((scene) => scene.sceneId).sort()).toEqual(['added', 'keep']);
    const deleteCommit = store.commits.findIndex(
      (commit) => commit.name === 'DemoFactorySceneDSO' && (commit.changes.deleted as unknown[]).length > 0
    );
    const createCommit = store.commits.findIndex(
      (commit) => commit.name === 'DemoFactorySceneDSO' && (commit.changes.created as unknown[]).length > 0
    );
    expect(createCommit).toBeGreaterThanOrEqual(0);
    expect(deleteCommit).toBeGreaterThan(createCommit);
  });

  it('keeps a stored demo row identity on overwrite', async () => {
    const { store, transfer } = makeTransfer();
    await transfer.saveDocument(document('demo', ['one']));
    const stored = (await store.read<DemoRow>('DemoFactoryDemoDSO'))[0];
    stored.updatedAt = '2026-01-01T00:00:00.000Z';
    stored.sourceHash = 'sha256:something';

    await transfer.saveDocument({ ...document('demo', ['one']), title: 'New title' });

    const after = (await store.read<DemoRow>('DemoFactoryDemoDSO'))[0];
    expect(after.title).toBe('New title');
    expect(after.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(after.sourceHash).toBe('sha256:something');
  });

  it('rejects text that is not a demo document', async () => {
    const { transfer } = makeTransfer();
    await expect(transfer.importYaml('- just\n- a list\n')).rejects.toThrow(/YAML mapping/);
  });
});

describe('assertOperator', () => {
  it('is open when the allowlist is unset', () => {
    expect(() => assertOperator('anyone@example.com', {})).not.toThrow();
    expect(() => assertOperator(undefined, {})).not.toThrow();
  });

  it('admits listed accounts case-insensitively and refuses the rest', () => {
    const env = { DEMO_FACTORY_OPERATORS: 'Mike.Liewehr@build.one, second@build.one' };
    expect(() => assertOperator('mike.liewehr@BUILD.one', env)).not.toThrow();
    expect(() => assertOperator('intruder@example.com', env)).toThrow(/DEMO_FACTORY_OPERATORS/);
    expect(() => assertOperator(undefined, env)).toThrow(/DEMO_FACTORY_OPERATORS/);
  });
});
