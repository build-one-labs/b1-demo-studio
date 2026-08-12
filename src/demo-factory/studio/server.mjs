import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {access, mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {demoSchema} from '../src/schema.mjs';
import {projectRoot, readJson, resolveOutputRoot, validateDemoSemantics} from '../src/lib/files.mjs';
import {ALLOWED_ENV_KEYS, assertSafeId, buildJobCommand, publicSettings, safeChildPath} from './lib.mjs';

const studioRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(studioRoot, 'public');
const demosRoot = path.join(projectRoot, 'demos');
const port = Number(process.env.STUDIO_PORT || 4310);
const host = process.env.STUDIO_HOST || '127.0.0.1';
const runtimeEnv = Object.fromEntries(ALLOWED_ENV_KEYS.map((key) => [key, process.env[key] || '']));
const sseClients = new Set();
let fixtureProcess;
let activeChild;
let job = {
  id: null,
  action: null,
  demoId: null,
  status: 'idle',
  step: null,
  logs: [],
  startedAt: null,
  finishedAt: null,
  exitCode: null,
};

const json = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body)});
  response.end(body);
};

const errorResponse = (response, status, error) => json(response, status, {error: error.message || String(error)});

const readBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};

const exists = async (file) => access(file).then(() => true).catch(() => false);

const contentType = (file) => ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}[path.extname(file).toLowerCase()] || 'application/octet-stream');

const serveFile = async (request, response, file, allowedRoot) => {
  const resolved = safeChildPath(allowedRoot, path.relative(allowedRoot, file));
  const info = await stat(resolved);
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return response.writeHead(416).end();
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return response.writeHead(416, {'content-range': `bytes */${info.size}`}).end();
    response.writeHead(206, {
      'content-type': contentType(resolved),
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${info.size}`,
      'accept-ranges': 'bytes',
    });
    createReadStream(resolved, {start, end}).pipe(response);
    return;
  }
  response.writeHead(200, {'content-type': contentType(resolved), 'content-length': info.size, 'accept-ranges': 'bytes'});
  createReadStream(resolved).pipe(response);
};

const broadcast = () => {
  const payload = `data: ${JSON.stringify(job)}\n\n`;
  for (const client of sseClients) client.write(payload);
};

const appendLog = (line, stream = 'stdout') => {
  const text = String(line).replace(/\r/g, '').trimEnd();
  if (!text) return;
  for (const entry of text.split('\n')) job.logs.push({at: new Date().toISOString(), stream, text: entry});
  job.logs = job.logs.slice(-600);
  broadcast();
};

const listDemos = async () => {
  const entries = await readdir(demosRoot, {withFileTypes: true});
  const demos = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(demosRoot, entry.name, 'demo.yaml');
    if (!(await exists(file))) continue;
    try {
      const document = YAML.parse(await readFile(file, 'utf8'));
      demos.push({id: document.id, title: document.title, description: document.description, sceneCount: document.scenes?.length || 0});
    } catch (error) {
      demos.push({id: entry.name, title: entry.name, description: error.message, sceneCount: 0, invalid: true});
    }
  }
  return demos.sort((left, right) => left.title.localeCompare(right.title));
};

const loadDemoDocument = async (demoId) => {
  assertSafeId(demoId, 'demo id');
  const file = safeChildPath(demosRoot, demoId, 'demo.yaml');
  const raw = await readFile(file, 'utf8');
  return {demo: YAML.parse(raw), raw, file, hasSourceEdit: await exists(path.join(path.dirname(file), 'source-edit.yaml'))};
};

const saveDemoDocument = async (demoId, document) => {
  assertSafeId(demoId, 'demo id');
  const demo = demoSchema.parse(document);
  validateDemoSemantics(demo);
  if (demo.id !== demoId) throw new Error('Demo id cannot be changed from this editor');
  const file = safeChildPath(demosRoot, demoId, 'demo.yaml');
  await writeFile(file, YAML.stringify(demo, {lineWidth: 0}), 'utf8');
  return demo;
};

const createDemoDocument = async ({id, title, sourceId}) => {
  assertSafeId(id, 'demo id');
  assertSafeId(sourceId, 'source demo id');
  const targetDirectory = safeChildPath(demosRoot, id);
  if (await exists(targetDirectory)) throw new Error('A demo with this id already exists');
  const {demo: source} = await loadDemoDocument(sourceId);
  const demo = structuredClone(source);
  demo.id = id;
  demo.title = String(title || '').trim() || id;
  demo.description = `Created from ${sourceId} in B1 Demo Factory Studio.`;
  const validated = demoSchema.parse(demo);
  validateDemoSemantics(validated);
  await mkdir(targetDirectory, {recursive: false});
  await writeFile(path.join(targetDirectory, 'demo.yaml'), YAML.stringify(validated, {lineWidth: 0}), 'utf8');
  return validated;
};

const loadRuns = async (demoId) => {
  assertSafeId(demoId, 'demo id');
  const root = safeChildPath(resolveOutputRoot(), demoId);
  if (!(await exists(root))) return [];
  const entries = await readdir(root, {withFileTypes: true});
  const runs = [];
  for (const entry of entries.filter((value) => value.isDirectory()).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 30)) {
    const runDir = safeChildPath(root, entry.name);
    const manifestFile = path.join(runDir, 'run-manifest.json');
    const resultFile = path.join(runDir, 'render-result.json');
    const manifest = await readJson(manifestFile).catch(() => null);
    const result = await readJson(resultFile).catch(() => null);
    const videoName = `${demoId}.mp4`;
    const srtName = `${demoId}.srt`;
    const videoFile = path.join(runDir, videoName);
    const srtFile = path.join(runDir, srtName);
    runs.push({
      runId: entry.name,
      createdAt: manifest?.createdAt || entry.name.split('--')[0],
      provider: manifest?.narrationProvider || null,
      sceneCount: manifest?.scenes?.length || 0,
      recordedScenes: manifest?.scenes?.filter((scene) => scene.clipFile).length || 0,
      durationMs: result?.totalDurationMs || null,
      videoUrl: await exists(videoFile) ? `/api/media/${encodeURIComponent(demoId)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(videoName)}` : null,
      srtUrl: await exists(srtFile) ? `/api/media/${encodeURIComponent(demoId)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(srtName)}` : null,
      scenes: (manifest?.scenes || []).map((scene) => ({
        id: scene.id,
        title: scene.title,
        durationMs: scene.recordedDurationMs || scene.narrationDurationMs,
        hasClip: Boolean(scene.clipFile),
        failureUrl: `/api/media/${encodeURIComponent(demoId)}/${encodeURIComponent(entry.name)}/clips/${encodeURIComponent(scene.id)}.failure.png`,
      })),
    });
  }
  return runs;
};

const fixtureIsReady = async () => {
  try {
    const response = await fetch('http://127.0.0.1:4173/health');
    return response.ok;
  } catch {
    return false;
  }
};

const ensureFixture = async () => {
  const baseUrl = runtimeEnv.B1_BASE_URL || process.env.B1_BASE_URL || '';
  if (baseUrl && !/127\.0\.0\.1:4173|localhost:4173/.test(baseUrl)) return null;
  if (await fixtureIsReady()) return null;
  fixtureProcess = spawn(process.execPath, ['fixture/server.mjs'], {cwd: projectRoot, env: {...process.env, PORT: '4173'}, stdio: ['ignore', 'pipe', 'pipe']});
  fixtureProcess.stdout.on('data', (data) => appendLog(data, 'fixture'));
  fixtureProcess.stderr.on('data', (data) => appendLog(data, 'fixture'));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await fixtureIsReady()) return fixtureProcess;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Local fixture did not become ready');
};

const stopFixture = () => {
  fixtureProcess?.kill();
  fixtureProcess = undefined;
};

const startJob = async ({action, demoId, scenes, voice}) => {
  if (job.status === 'running') throw new Error('Another job is already running');
  const command = buildJobCommand({action, demoId, scenes, voice});
  job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    demoId,
    status: 'running',
    step: command.step,
    logs: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
  };
  broadcast();

  try {
    if (command.needsFixture) await ensureFixture();
    const env = {...process.env, ...Object.fromEntries(Object.entries(runtimeEnv).filter(([, value]) => value !== ''))};
    activeChild = spawn(process.execPath, [command.script, ...command.args], {cwd: projectRoot, env, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    activeChild.stdout.on('data', (data) => appendLog(data, 'stdout'));
    activeChild.stderr.on('data', (data) => appendLog(data, 'stderr'));
    activeChild.once('error', (error) => appendLog(error.stack || error.message, 'stderr'));
    const exitCode = await new Promise((resolve) => activeChild.once('exit', resolve));
    job.status = exitCode === 0 ? 'complete' : 'failed';
    job.exitCode = exitCode;
  } catch (error) {
    appendLog(error.stack || error.message, 'stderr');
    job.status = 'failed';
    job.exitCode = -1;
  } finally {
    job.finishedAt = new Date().toISOString();
    activeChild = undefined;
    stopFixture();
    broadcast();
  }
};

const handleApi = async (request, response, url) => {
  if (request.method === 'GET' && url.pathname === '/api/state') {
    return json(response, 200, {demos: await listDemos(), settings: publicSettings(runtimeEnv), job});
  }
  if (request.method === 'GET' && url.pathname === '/api/settings') {
    return json(response, 200, {settings: publicSettings(runtimeEnv)});
  }
  if (request.method === 'PUT' && url.pathname === '/api/settings') {
    const body = await readBody(request);
    for (const key of ALLOWED_ENV_KEYS) {
      if (Object.hasOwn(body, key)) {
        runtimeEnv[key] = String(body[key] || '').trim();
        if (runtimeEnv[key]) process.env[key] = runtimeEnv[key];
        else delete process.env[key];
      }
    }
    return json(response, 200, {settings: publicSettings(runtimeEnv)});
  }
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'});
    response.write(`data: ${JSON.stringify(job)}\n\n`);
    sseClients.add(response);
    request.on('close', () => sseClients.delete(response));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/jobs') {
    const body = await readBody(request);
    await loadDemoDocument(body.demoId);
    buildJobCommand(body);
    void startJob(body);
    return json(response, 202, {accepted: true, jobId: job.id});
  }
  if (request.method === 'POST' && url.pathname === '/api/jobs/cancel') {
    if (job.status !== 'running' || !activeChild) throw new Error('No running job');
    appendLog('Cancellation requested by user', 'studio');
    activeChild.kill();
    return json(response, 202, {accepted: true});
  }

  const demoMatch = /^\/api\/demos\/([a-z0-9-]+)$/.exec(url.pathname);
  if (request.method === 'POST' && url.pathname === '/api/demos') {
    const body = await readBody(request);
    return json(response, 201, {demo: await createDemoDocument(body)});
  }
  if (demoMatch && request.method === 'GET') {
    const {demo, hasSourceEdit} = await loadDemoDocument(demoMatch[1]);
    return json(response, 200, {demo, hasSourceEdit});
  }
  if (demoMatch && request.method === 'PUT') {
    const body = await readBody(request);
    return json(response, 200, {demo: await saveDemoDocument(demoMatch[1], body.demo)});
  }

  const runsMatch = /^\/api\/runs\/([a-z0-9-]+)$/.exec(url.pathname);
  if (runsMatch && request.method === 'GET') return json(response, 200, {runs: await loadRuns(runsMatch[1])});

  const mediaMatch = /^\/api\/media\/([a-z0-9-]+)\/([a-zA-Z0-9._-]+)\/(.+)$/.exec(url.pathname);
  if (mediaMatch && request.method === 'GET') {
    const [, demoId, runId, remainder] = mediaMatch;
    assertSafeId(demoId, 'demo id');
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error('Invalid run id');
    const segments = remainder.split('/').map(decodeURIComponent);
    if (segments.some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment))) throw new Error('Invalid media path');
    const runRoot = safeChildPath(resolveOutputRoot(), demoId, runId);
    const file = safeChildPath(runRoot, ...segments);
    if (!(await exists(file))) return errorResponse(response, 404, new Error('Media file not found'));
    return serveFile(request, response, file, runRoot);
  }

  return false;
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(request, response, url);
      if (handled === false && !response.writableEnded) errorResponse(response, 404, new Error('API route not found'));
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!/^[a-zA-Z0-9._/-]+$/.test(relative)) throw new Error('Invalid static path');
    const file = safeChildPath(publicRoot, relative);
    if (!(await exists(file))) return errorResponse(response, 404, new Error('File not found'));
    return serveFile(request, response, file, publicRoot);
  } catch (error) {
    if (!response.writableEnded) errorResponse(response, error.name === 'ZodError' ? 400 : 500, error);
  }
});

server.listen(port, host, () => {
  console.log(`B1 Demo Factory Studio: http://${host}:${port}`);
});

const shutdown = () => {
  activeChild?.kill();
  stopFixture();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
