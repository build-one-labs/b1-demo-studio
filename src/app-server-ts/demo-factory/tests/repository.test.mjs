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

test('both pipeline log instances use the built-in native component loader', async () => {
  const log = objects.find(object => object.objectName === 'DemoFactoryJobLog');
  assert.equal(log.objectTypeGuid, '217eaba6-7c1d-49f3-a755-e135d89c93ac');
  assert.equal(log.attributes.componentName, 'DemoFactoryPipelineLog');
  await readFile(new URL('../../../web-app/src/components/global/DemoFactoryPipelineLog.vue', import.meta.url));
  const maintenance = objects.find(object => object.objectName === 'DemoFactoryDemoMaintenance');
  const flatten = instances => instances.flatMap(instance => [instance, ...flatten(instance.instances ?? [])]);
  const instances = flatten(maintenance.instances).filter(instance => instance.objectMasterGuid === log.objectMasterGuid);
  assert.equal(instances.length, 2);
  assert.equal(instances.filter(instance => instance.attributes.htmlClass === 'demo-job-status').length, 1);
});
