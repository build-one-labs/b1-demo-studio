import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../data/repository/', import.meta.url));
const files = (await readdir(root, {recursive: true})).filter(file => file.endsWith('.json'));
const objects = await Promise.all(files.map(async file => ({file, ...JSON.parse(await readFile(path.join(root, file), 'utf8'))})));

test('blueprint imports cannot overwrite another object with the same master GUID', () => {
  const seen = new Map();
  for (const object of objects) {
    assert.ok(object.objectMasterGuid, `Missing master GUID: ${object.file}`);
    assert.ok(!seen.has(object.objectMasterGuid), `${object.file} shares its master GUID with ${seen.get(object.objectMasterGuid)}`);
    seen.set(object.objectMasterGuid, object.file);
  }
});

test('demo menu launch targets and the maintenance toolbar resolve uniquely after import', () => {
  const byName = name => objects.filter(object => object.objectName === name);
  const menu = byName('DemoFactoryMenu')[0];
  for (const item of menu.instances.filter(item => item.attributes.actionType === 'Launch')) {
    assert.equal(byName(item.attributes.actionParameter).length, 1, `Missing launch target ${item.attributes.actionParameter}`);
  }
  const toolbar = byName('DemoFactoryDemoMaintenanceToolbar')[0];
  const maintenance = byName('DemoFactoryDemoMaintenance')[0];
  assert.ok(maintenance.instances.some(instance => instance.objectMasterGuid === toolbar.objectMasterGuid));
  assert.equal(objects.filter(object => object.objectMasterGuid === toolbar.objectMasterGuid).length, 1);
});
