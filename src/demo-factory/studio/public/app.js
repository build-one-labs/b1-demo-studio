const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  demos: [],
  demo: null,
  demoMeta: null,
  selectedSceneIndex: 0,
  runs: [],
  selectedRunId: null,
  settings: {},
  job: {status: 'idle', logs: []},
  dirty: false,
  validation: 'unknown',
  lastTerminalJobId: null,
};

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {'content-type': 'application/json', ...(options.headers || {})},
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `${response.status} ${response.statusText}`);
  return value;
};

const toast = (message, error = false) => {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = 'toast'; }, 3600);
};

const selectedScene = () => state.demo?.scenes?.[state.selectedSceneIndex] || null;

const markDirty = () => {
  state.dirty = true;
  $('#save-button').disabled = false;
  $('#save-button').textContent = 'Save changes';
  state.validation = 'unknown';
  renderValidation();
};

const formatDuration = (milliseconds = 0) => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const estimateSceneMs = (scene) => {
  const text = (scene.narration || '').replace(/\[cue:[^\]]+\]/g, '');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wpm = state.demo?.settings?.narration?.wordsPerMinute || 130;
  return Math.max(5000, (words / wpm) * 60_000 + (state.demo?.settings?.holdAfterMs || 1000) + (state.demo?.settings?.holdBeforeMs || 500));
};

const sceneDuration = (scene, index) => {
  const run = state.runs.find((item) => item.runId === state.selectedRunId) || state.runs[0];
  return run?.scenes?.[index]?.durationMs || estimateSceneMs(scene);
};

const renderValidation = () => {
  const badge = $('#validation-badge');
  if (state.validation === 'valid') {
    badge.textContent = '● Valid';
    badge.className = 'validation-badge valid';
  } else if (state.validation === 'invalid') {
    badge.textContent = '● Validation failed';
    badge.className = 'validation-badge invalid';
  } else {
    badge.textContent = state.dirty ? '● Unsaved changes' : '● Not validated';
    badge.className = 'validation-badge';
  }
};

const renderDemoPicker = () => {
  const picker = $('#demo-picker');
  picker.innerHTML = state.demos.map((demo) => `<option value="${demo.id}">${escapeHtml(demo.title)}</option>`).join('');
  if (state.demo) picker.value = state.demo.id;
  $('#new-demo-template').innerHTML = state.demos.map((demo) => `<option value="${demo.id}">${escapeHtml(demo.title)}</option>`).join('');
  if (state.demo) $('#new-demo-template').value = state.demo.id;
};

const renderScenes = () => {
  const list = $('#scene-list');
  if (!state.demo) {
    list.innerHTML = '<div class="field-help">No demo selected.</div>';
    return;
  }
  const run = state.runs.find((item) => item.runId === state.selectedRunId) || state.runs[0];
  list.innerHTML = state.demo.scenes.map((scene, index) => {
    const hasClip = run?.scenes?.find((item) => item.id === scene.id)?.hasClip;
    return `<button class="scene-item ${index === state.selectedSceneIndex ? 'active' : ''}" data-scene-index="${index}">
      <span class="scene-number">${index + 1}</span>
      <span class="scene-copy"><strong>${escapeHtml(scene.title)}</strong><small>${escapeHtml(scene.route)} · ${formatDuration(sceneDuration(scene, index))}</small></span>
      <span class="scene-state">${hasClip ? '✓' : '○'}</span>
    </button>`;
  }).join('');
  $$('[data-scene-index]', list).forEach((button) => button.addEventListener('click', () => selectScene(Number(button.dataset.sceneIndex))));
};

const renderInspector = () => {
  const scene = selectedScene();
  const disabled = !scene;
  for (const id of ['scene-title', 'scene-route', 'scene-narration', 'scene-actions', 'scene-assertions']) $(`#${id}`).disabled = disabled;
  if (!scene) return;
  $('#scene-title').value = scene.title || '';
  $('#scene-id').value = scene.id || '';
  $('#scene-route').value = scene.route || '/';
  $('#scene-narration').value = scene.narration || '';
  $('#scene-actions').value = JSON.stringify(scene.actions || [], null, 2);
  $('#scene-assertions').value = JSON.stringify(scene.assertions || [], null, 2);
  $('#action-count').textContent = `${scene.actions?.length || 0} actions`;
  $('#assertion-count').textContent = `${scene.assertions?.length || 0} assertions`;
  const cues = [...(scene.narration || '').matchAll(/\[cue:([a-zA-Z0-9_-]+)\]/g)].map((match) => match[1]);
  $('#cue-summary').innerHTML = cues.length ? cues.map((cue) => `<span class="cue-chip">${escapeHtml(cue)}</span>`).join('') : '<span class="field-help">No cue markers in this scene.</span>';
  $('#voice-provider').value = state.demo.settings.narration.provider || 'auto';
  $('#voice-model').value = state.demo.settings.narration.defaultModelId || 'eleven_multilingual_v2';
  $('#voice-language').value = state.demo.settings.narration.defaultLanguageCode || 'de';
  $('#cursor-toggle').checked = state.demo.settings.cursor?.enabled !== false;
  $('#captions-toggle').checked = state.demo.settings.branding?.showCaptions !== false;
  $('#preview-title').textContent = scene.title;
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character]));

const commitJsonEditors = () => {
  const scene = selectedScene();
  if (!scene) return true;
  try {
    scene.actions = JSON.parse($('#scene-actions').value || '[]');
    scene.assertions = JSON.parse($('#scene-assertions').value || '[]');
    if (!Array.isArray(scene.actions) || !Array.isArray(scene.assertions)) throw new Error('Actions and assertions must be arrays');
    $('#scene-actions').style.borderColor = '';
    $('#scene-assertions').style.borderColor = '';
    return true;
  } catch (error) {
    toast(`Invalid JSON: ${error.message}`, true);
    return false;
  }
};

const selectScene = (index) => {
  if (!commitJsonEditors()) return;
  state.selectedSceneIndex = index;
  renderScenes();
  renderInspector();
  renderTimeline();
};

const renderRuns = () => {
  const picker = $('#run-picker');
  picker.innerHTML = state.runs.length
    ? state.runs.map((run) => `<option value="${run.runId}">${escapeHtml(run.runId.slice(0, 19).replace('T', ' '))} · ${run.provider || 'unknown'}</option>`).join('')
    : '<option value="">No runs yet</option>';
  if (!state.selectedRunId && state.runs[0]) state.selectedRunId = state.runs[0].runId;
  picker.value = state.selectedRunId || '';
  const run = state.runs.find((item) => item.runId === state.selectedRunId) || state.runs[0];
  const stage = $('#video-stage');
  const video = $('#video-preview');
  const srt = $('#download-srt');
  if (run?.videoUrl) {
    if (video.dataset.src !== run.videoUrl) {
      video.src = run.videoUrl;
      video.dataset.src = run.videoUrl;
      video.load();
    }
    stage.classList.add('has-video');
  } else {
    video.removeAttribute('src');
    video.dataset.src = '';
    stage.classList.remove('has-video');
  }
  if (run?.srtUrl) {
    srt.href = run.srtUrl;
    srt.classList.remove('disabled');
  } else {
    srt.href = '#';
    srt.classList.add('disabled');
  }
  $('#preview-kicker').textContent = run ? `Run ${run.runId.slice(0, 19).replace('T', ' ')}` : 'Latest render';
  $('#runs-list').innerHTML = state.runs.length ? state.runs.map((item) => `<div class="run-row">
    <div><strong>${escapeHtml(item.runId)}</strong><small>${item.sceneCount} scenes · ${item.provider || 'unknown provider'} · ${formatDuration(item.durationMs || 0)}</small></div>
    ${item.srtUrl ? `<a class="button ghost small" href="${item.srtUrl}" download>SRT</a>` : '<span></span>'}
    ${item.videoUrl ? `<button class="button secondary small" data-open-run="${item.runId}">Open</button>` : '<span class="field-help">Not rendered</span>'}
  </div>`).join('') : '<div class="field-help">No runs for this demo yet.</div>';
  $$('[data-open-run]').forEach((button) => button.addEventListener('click', () => {
    state.selectedRunId = button.dataset.openRun;
    renderRuns();
    $('#runs-dialog').close();
  }));
};

const renderTimeline = () => {
  if (!state.demo) return;
  const durations = state.demo.scenes.map(sceneDuration);
  const total = durations.reduce((sum, value) => sum + value, 0) || 1;
  $('#timeline-duration').textContent = formatDuration(total);
  $('.timeline-ruler').innerHTML = [0, .25, .5, .75, 1].map((ratio) => `<span>${formatDuration(total * ratio)}</span>`).join('');
  $('#timeline-scenes').innerHTML = state.demo.scenes.map((scene, index) => `<div class="timeline-clip ${index === state.selectedSceneIndex ? 'active' : ''}" style="flex:${Math.max(.6, durations[index] / total * state.demo.scenes.length)}" title="${escapeHtml(scene.title)}">
    <strong>${index + 1}. ${escapeHtml(scene.title)}</strong><small>${formatDuration(durations[index])}</small>
  </div>`).join('');
  let offset = 0;
  const markers = [];
  state.demo.scenes.forEach((scene, index) => {
    const cues = [...(scene.narration || '').matchAll(/\[cue:([a-zA-Z0-9_-]+)\]/g)];
    const length = Math.max(1, scene.narration.length);
    for (const cue of cues) {
      const position = offset + (cue.index / length) * durations[index];
      markers.push(`<span class="cue-marker" style="left:${(position / total) * 100}%" title="${escapeHtml(cue[1])}"></span>`);
    }
    offset += durations[index];
  });
  $('#timeline-cues').innerHTML = markers.join('');
};

const renderEnvironment = () => {
  const value = state.settings.B1_BASE_URL?.value || '';
  $('#environment-label').textContent = value ? new URL(value).hostname : 'Local Fixture';
  $('.preview-panel').classList.toggle('show-source-actions', Boolean(state.demoMeta?.hasSourceEdit));
};

const phaseState = () => {
  const phases = ['validate', 'prepare', 'record', 'render'];
  const result = Object.fromEntries(phases.map((phase) => [phase, 'pending']));
  const logs = (state.job.logs || []).map((entry) => entry.text).join('\n');
  if (state.job.action === 'all') {
    if (/OK:/.test(logs)) result.validate = 'complete';
    if (/Prepared /.test(logs)) result.prepare = 'complete';
    if (/Recorded /.test(logs)) result.record = 'complete';
    if (/Rendered /.test(logs)) result.render = 'complete';
    const next = phases.find((phase) => result[phase] === 'pending');
    if (state.job.status === 'running' && next) result[next] = 'active';
  } else if (state.job.step) {
    const index = phases.indexOf(state.job.step);
    if (index >= 0) {
      for (let cursor = 0; cursor < index; cursor += 1) result[phases[cursor]] = 'complete';
      result[state.job.step] = state.job.status === 'complete' ? 'complete' : state.job.status === 'failed' ? 'failed' : state.job.status === 'running' ? 'active' : 'pending';
    }
  }
  return result;
};

const renderJob = () => {
  const running = state.job.status === 'running';
  $('#job-indicator').className = `job-indicator ${state.job.status}`;
  $('#job-title').textContent = state.job.action ? `${state.job.action} · ${state.job.demoId}` : 'Pipeline log';
  $('#cancel-job-button').disabled = !running;
  $$('.pipeline-action, #run-all-button').forEach((button) => { button.disabled = running; });
  const lines = state.job.logs?.map((entry) => `${entry.stream === 'stderr' ? 'ERR ' : ''}${entry.text}`) || [];
  const log = $('#job-log');
  log.textContent = lines.length ? lines.join('\n') : 'Ready.';
  log.scrollTop = log.scrollHeight;

  const phases = phaseState();
  const values = Object.values(phases);
  const complete = values.filter((value) => value === 'complete').length;
  const percent = Math.round((complete / 4) * 100 + (values.includes('active') ? 12 : 0));
  $('#progress-percent').textContent = `${Math.min(100, percent)}%`;
  $('#progress-subtitle').textContent = running ? `${state.job.action} is running` : state.job.status === 'complete' ? 'Last job completed' : state.job.status === 'failed' ? 'Last job failed' : 'No active job';
  $$('#progress-steps li').forEach((item) => { item.className = phases[item.dataset.step] || ''; });

  if (state.job.status === 'complete' && /OK:/.test(lines.join('\n'))) state.validation = 'valid';
  if (state.job.status === 'failed' && state.job.step === 'validate') state.validation = 'invalid';
  renderValidation();

  if (['complete', 'failed'].includes(state.job.status) && state.job.id && state.lastTerminalJobId !== state.job.id) {
    state.lastTerminalJobId = state.job.id;
    toast(state.job.status === 'complete' ? 'Pipeline job completed.' : 'Pipeline job failed. Check the log.', state.job.status === 'failed');
    loadRuns().catch((error) => toast(error.message, true));
  }
};

const loadRuns = async () => {
  if (!state.demo) return;
  const value = await api(`/api/runs/${state.demo.id}`);
  state.runs = value.runs;
  if (!state.runs.some((run) => run.runId === state.selectedRunId)) state.selectedRunId = state.runs[0]?.runId || null;
  renderRuns();
  renderScenes();
  renderTimeline();
};

const loadDemo = async (demoId) => {
  if (state.dirty && !confirm('Discard unsaved changes and open another demo?')) {
    $('#demo-picker').value = state.demo.id;
    return;
  }
  const value = await api(`/api/demos/${demoId}`);
  state.demo = value.demo;
  state.demoMeta = value;
  state.selectedSceneIndex = 0;
  state.selectedRunId = null;
  state.dirty = false;
  state.validation = 'unknown';
  $('#save-button').disabled = true;
  $('#save-button').textContent = 'Save demo';
  renderDemoPicker();
  renderInspector();
  renderEnvironment();
  await loadRuns();
  renderValidation();
};

const saveDemo = async () => {
  if (!state.demo || !commitJsonEditors()) return false;
  try {
    const value = await api(`/api/demos/${state.demo.id}`, {method: 'PUT', body: JSON.stringify({demo: state.demo})});
    state.demo = value.demo;
    state.dirty = false;
    $('#save-button').disabled = true;
    $('#save-button').textContent = 'Saved';
    toast('Demo YAML saved and validated.');
    renderScenes();
    renderInspector();
    return true;
  } catch (error) {
    state.validation = 'invalid';
    renderValidation();
    toast(error.message, true);
    return false;
  }
};

const runJob = async (action, extra = {}) => {
  if (state.dirty && !(await saveDemo())) return;
  try {
    await api('/api/jobs', {method: 'POST', body: JSON.stringify({action, demoId: state.demo.id, ...extra})});
    $('#log-panel').classList.remove('collapsed');
    toast(`${action} started.`);
  } catch (error) {
    toast(error.message, true);
  }
};

const addScene = () => {
  if (!state.demo) return;
  const base = 'new-scene';
  let id = base;
  let counter = 2;
  while (state.demo.scenes.some((scene) => scene.id === id)) id = `${base}-${counter++}`;
  state.demo.scenes.push({id, title: 'New scene', route: '/', narration: 'Describe this scene. [cue:show-result] Show the visible result.', actions: [], assertions: []});
  state.selectedSceneIndex = state.demo.scenes.length - 1;
  markDirty();
  renderScenes();
  renderInspector();
  renderTimeline();
};

const duplicateScene = () => {
  const scene = selectedScene();
  if (!scene) return;
  let id = `${scene.id}-copy`;
  let counter = 2;
  while (state.demo.scenes.some((item) => item.id === id)) id = `${scene.id}-copy-${counter++}`;
  const clone = structuredClone(scene);
  clone.id = id;
  clone.title = `${scene.title} Copy`;
  state.demo.scenes.splice(state.selectedSceneIndex + 1, 0, clone);
  state.selectedSceneIndex += 1;
  markDirty();
  renderScenes();
  renderInspector();
  renderTimeline();
};

const deleteScene = () => {
  const scene = selectedScene();
  if (!scene || state.demo.scenes.length === 1) return toast('A demo must contain at least one scene.', true);
  if (!confirm(`Delete scene “${scene.title}”? Existing run artifacts are not deleted.`)) return;
  state.demo.scenes.splice(state.selectedSceneIndex, 1);
  state.selectedSceneIndex = Math.max(0, state.selectedSceneIndex - 1);
  markDirty();
  renderScenes();
  renderInspector();
  renderTimeline();
};

const openSettings = async (focusName) => {
  const value = await api('/api/settings');
  state.settings = value.settings;
  const form = $('#settings-form');
  for (const input of form.elements) {
    if (!input.name) continue;
    const setting = state.settings[input.name];
    input.value = setting?.secret ? '' : (setting?.value || input.value || '');
    if (setting?.secret && setting.configured) input.placeholder = 'Configured — leave blank to keep';
  }
  $('#settings-dialog').showModal();
  if (focusName) form.elements[focusName]?.focus();
};

const saveSettings = async (event) => {
  event.preventDefault();
  const form = $('#settings-form');
  const body = {};
  for (const input of form.elements) {
    if (!input.name) continue;
    if (input.name === 'ELEVENLABS_API_KEY' && !input.value) continue;
    body[input.name] = input.value;
  }
  try {
    const value = await api('/api/settings', {method: 'PUT', body: JSON.stringify(body)});
    state.settings = value.settings;
    $('#settings-dialog').close();
    renderEnvironment();
    toast('Runtime settings saved for this Studio session.');
  } catch (error) {
    toast(error.message, true);
  }
};

const bind = () => {
  $('#demo-picker').addEventListener('change', (event) => loadDemo(event.target.value).catch((error) => toast(error.message, true)));
  $('#run-picker').addEventListener('change', (event) => { state.selectedRunId = event.target.value; renderRuns(); renderTimeline(); });
  $('#save-button').addEventListener('click', saveDemo);
  $('#run-all-button').addEventListener('click', () => runJob('all'));
  $('#add-scene-button').addEventListener('click', addScene);
  $('#new-demo-button').addEventListener('click', () => $('#new-demo-dialog').showModal());
  $('#close-new-demo-button').addEventListener('click', () => $('#new-demo-dialog').close());
  $('#cancel-new-demo-button').addEventListener('click', () => $('#new-demo-dialog').close());
  $('#new-demo-form').addEventListener('submit', createDemo);
  $('#duplicate-scene-button').addEventListener('click', duplicateScene);
  $('#delete-scene-button').addEventListener('click', deleteScene);
  $$('.pipeline-action').forEach((button) => button.addEventListener('click', () => runJob(button.dataset.job, button.dataset.job === 'record' ? {scenes: [selectedScene().id]} : {})));
  $('#prepare-voice-button').addEventListener('click', async () => {
    const voiceId = $('#voice-id').value.trim();
    if (voiceId) await api('/api/settings', {method: 'PUT', body: JSON.stringify({ELEVENLABS_VOICE_ID: voiceId})});
    runJob('prepare', {voice: $('#voice-provider').value});
  });
  $('#cancel-job-button').addEventListener('click', () => api('/api/jobs/cancel', {method: 'POST'}).catch((error) => toast(error.message, true)));
  $('#toggle-log-button').addEventListener('click', () => $('#log-panel').classList.toggle('collapsed'));
  $('#environment-button').addEventListener('click', () => openSettings('B1_BASE_URL'));
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#close-settings-button').addEventListener('click', () => $('#settings-dialog').close());
  $('#cancel-settings-button').addEventListener('click', () => $('#settings-dialog').close());
  $('#close-runs-button').addEventListener('click', () => $('#runs-dialog').close());

  $$('.nav-item').forEach((button) => button.addEventListener('click', () => {
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
    if (button.dataset.view === 'settings') openSettings();
    if (button.dataset.view === 'media') openSettings('VIBECODE_SOURCE_VIDEO');
    if (button.dataset.view === 'runs') $('#runs-dialog').showModal();
  }));

  $$('.inspector-tab').forEach((button) => button.addEventListener('click', () => {
    $$('.inspector-tab').forEach((item) => item.classList.toggle('active', item === button));
    $$('.inspector-content').forEach((content) => content.classList.toggle('active', content.dataset.content === button.dataset.tab));
  }));

  $('#scene-title').addEventListener('input', (event) => { selectedScene().title = event.target.value; markDirty(); renderScenes(); $('#preview-title').textContent = event.target.value; });
  $('#scene-route').addEventListener('input', (event) => { selectedScene().route = event.target.value; markDirty(); renderScenes(); });
  $('#scene-narration').addEventListener('input', (event) => { selectedScene().narration = event.target.value; markDirty(); renderInspectorCueSummary(); renderTimeline(); });
  $('#scene-actions').addEventListener('input', () => { markDirty(); $('#scene-actions').style.borderColor = ''; });
  $('#scene-assertions').addEventListener('input', () => { markDirty(); $('#scene-assertions').style.borderColor = ''; });
  $('#voice-provider').addEventListener('change', (event) => { state.demo.settings.narration.provider = event.target.value; markDirty(); });
  $('#voice-model').addEventListener('input', (event) => { state.demo.settings.narration.defaultModelId = event.target.value; markDirty(); });
  $('#voice-language').addEventListener('input', (event) => { state.demo.settings.narration.defaultLanguageCode = event.target.value; markDirty(); });
  $('#cursor-toggle').addEventListener('change', (event) => { state.demo.settings.cursor.enabled = event.target.checked; markDirty(); });
  $('#captions-toggle').addEventListener('change', (event) => { state.demo.settings.branding.showCaptions = event.target.checked; markDirty(); });
};

const createDemo = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  try {
    const value = await api('/api/demos', {method: 'POST', body: JSON.stringify(body)});
    const refreshed = await api('/api/state');
    state.demos = refreshed.demos;
    $('#new-demo-dialog').close();
    form.reset();
    renderDemoPicker();
    await loadDemo(value.demo.id);
    toast('New demo created from template.');
  } catch (error) {
    toast(error.message, true);
  }
};

const renderInspectorCueSummary = () => {
  const cues = [...(selectedScene()?.narration || '').matchAll(/\[cue:([a-zA-Z0-9_-]+)\]/g)].map((match) => match[1]);
  $('#cue-summary').innerHTML = cues.length ? cues.map((cue) => `<span class="cue-chip">${escapeHtml(cue)}</span>`).join('') : '<span class="field-help">No cue markers in this scene.</span>';
};

const initialize = async () => {
  bind();
  const value = await api('/api/state');
  state.demos = value.demos;
  state.settings = value.settings;
  state.job = value.job;
  renderDemoPicker();
  renderJob();
  const initial = state.demos.find((demo) => demo.id === 'vibecode-sales-tour') || state.demos[0];
  if (initial) await loadDemo(initial.id);
  const events = new EventSource('/api/events');
  events.onmessage = (event) => { state.job = JSON.parse(event.data); renderJob(); };
  events.onerror = () => { $('#server-status').textContent = 'Reconnecting…'; };
  events.onopen = () => { $('#server-status').textContent = 'Connected'; };
  for (let index = 0; index < 70; index += 1) $('#waveform').insertAdjacentHTML('beforeend', '');
};

initialize().catch((error) => {
  $('#server-status').textContent = 'Connection failed';
  toast(error.message, true);
  console.error(error);
});
