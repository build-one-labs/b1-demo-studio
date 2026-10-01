import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual client logic with awaited form commits and server calls.
const source = await readFile(new URL('../../../web-app/clientlogic/b1-demo-factory/DemoFactoryDemoMaintenance.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;

function studio({valid = true, saves = true, scene = {sceneId: 'scene', demoId: 'demo', title: 'Scene', sequence: 2}} = {}) {
  const calls = [];
  const form = {
    pending: true,
    validate: async () => valid,
    hasPendingChanges() {return this.pending;},
    async saveChanges() {
      await Promise.resolve();
      calls.push('saved');
      if (saves) this.pending = false;
    },
  };
  const run = {runId: 'older-run', demoId: 'demo', recordedAt: '2026-10-01'};
  const screen = {getObject: () => form};
  const api = {
    DSO: {stage: 'stage', run: 'run', demo: 'demo'},
    screenOf: () => screen,
    selectedDemo: () => ({id: 'demo', title: 'Demo'}),
    selectedScene: () => scene,
    dsoOf: (_screen, name) => ({records: {value: []}, selectedRecord: {value: name === 'run' ? run : null}, fetchRecords: async () => {}}),
    callStudio: async (action, args) => {
      calls.push({action, args});
      return {status: 'complete'};
    },
    errorMessage: (error) => error.message,
  };
  const notifications = {launchScreen: async (name, payload) => calls.push({name, payload}), displayWarning: () => {}, displayInfo: () => {}, displaySuccess: () => {}, displayError: (error) => {throw new Error(error);}};
  const agent = {createDemoConversation: async (prompt, context) => {calls.push({prompt, context}); return 'chat123';}};
  const exports = {};
  vm.runInNewContext(code, {exports, require: (name) => name === '@buildone/web-core' ? notifications : name === './DemoFactoryAgentScreen' ? agent : api, setTimeout: (callback) => callback()});
  return {exports, calls, run};
}

test('full demo waits for successful saves before starting', async () => {
  const {exports, calls} = studio();
  await exports.runStage({}, 'all');
  assert.equal(calls[0], 'saved');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), {action: 'start-job', args: {action: 'all', demoId: 'demo', scenes: []}});
});

test('invalid or unsaved forms prevent a pipeline start', async () => {
  for (const options of [{valid: false}, {saves: false}]) {
    const {exports, calls} = studio(options);
    await exports.runStage({}, 'all');
    assert.ok(!calls.some((call) => call.action === 'start-job'));
  }
});

test('selected-run render sends the selected id and refuses an unrecorded run', async () => {
  const {exports, calls, run} = studio();
  await exports.renderSelectedRun({});
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {action: 'start-job', args: {action: 'render', demoId: 'demo', runId: 'older-run'}});
  calls.length = 0;
  run.recordedAt = null;
  await exports.renderSelectedRun({});
  assert.equal(calls.length, 0);
});

test('recording all scenes ignores the current scene selection', async () => {
  const {exports, calls} = studio();
  await exports.runStage({}, 'record', true);
  const start = calls.find((call) => call.action === 'start-job');
  assert.equal(start.args.scenes.length, 0);
});

test('editing chat saves first and carries the current demo and selected scene', async () => {
  const {exports, calls} = studio();
  await exports.editWithAgent({});
  assert.equal(calls[0], 'saved');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].context)), {
    demoId: 'demo', demoTitle: 'Demo', sceneId: 'scene', sceneTitle: 'Scene', sceneSequence: 2
  });
  assert.equal(calls[2].name, 'agentChatScreen');
  assert.equal(calls[2].payload.repositionTo, 'chat123');
});

test('editing chat omits missing or foreign scenes and blocks unsuccessful saves', async () => {
  for (const scene of [null, {demoId: 'other', sceneId: 'wrong'}]) {
    const {exports, calls} = studio({scene});
    await exports.editWithAgent({});
    assert.equal(calls[1].context.sceneId, undefined);
  }
  for (const options of [{valid: false}, {saves: false}]) {
    const {exports, calls} = studio(options);
    await exports.editWithAgent({});
    assert.ok(!calls.some(call => call.context || call.name));
  }
});

test('conversation API receives environment, agent and explicit scene context', async () => {
  const agentSource = await readFile(new URL('../../../web-app/clientlogic/b1-demo-factory/DemoFactoryAgentScreen.ts', import.meta.url), 'utf8');
  const agentCode = ts.transpileModule(agentSource, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  let request;
  vm.runInNewContext(agentCode, {
    exports,
    window: {location: {origin: 'https://studio.example'}},
    require: name => name === '@buildone/web-core'
      ? {invokeServerTask: async value => {request = value; return {conversationId: 'ab-cd'};}}
      : {DEMO_CREATOR_AGENT_GUID: 'demo-agent'},
  });
  const id = await exports.createDemoConversation('Edit this scene', {demoId: 'demo', sceneId: 'scene', sceneSequence: 2});
  assert.equal(id, 'abcd');
  assert.equal(request.paramObj.environmentUrl, 'https://studio.example');
  assert.equal(request.paramObj.agentObjectMasterGuid, 'demo-agent');
  assert.equal(request.paramObj.prompt, 'Edit this scene');
  assert.match(request.paramObj.systemPromptSuffix, /"sceneId":"scene"/);
  assert.match(request.paramObj.systemPromptSuffix, /Read this demo's current definition/);
});
