<!--
  Demo Factory Studio — the native component behind DemoFactoryScreen.

  A port of the Demo Factory's original standalone Studio page onto a B1
  screen. The layout is the original one: storyboard on the left, preview and
  pipeline in the middle, scene inspector on the right, pipeline log underneath.

  What changed in the port, and why:

  - The Studio's own Node server is gone. What the screen shows — demos and
    their scenes, runs and their scenes, settings, the host's capabilities —
    comes from the data sources on DemoFactoryScreen, wired to this component
    with Data and Join links; the server keeps `demos/<id>/demo.yaml` in step
    with them. Only the job (start, poll, cancel) is still a server action.
  - Upstream streams job state over SSE. A B1 action is request/response, so
    this polls `job` while one is running — same object, one fewer transport.
  - The host advertises what it can do (the stage and host data sources). The
    app server image installs ffmpeg and a system Chromium, but a host without
    them disables Record and Render with the reason shown, rather than failing
    deep inside a spawned process.
-->
<template>
  <div class="dfs">
    <aside class="dfs-rail">
      <div class="dfs-brand">
        <span class="dfs-mark">B1</span><span>Demo Factory<br /><strong>Studio</strong></span>
      </div>
      <nav>
        <button
          v-for="item in views"
          :key="item.id"
          class="dfs-nav"
          :class="{ active: view === item.id }"
          @click="view = item.id"
        >
          <span>{{ item.icon }}</span
          >{{ item.label }}
        </button>
      </nav>
      <div class="dfs-host">
        <strong :title="stepBlockedReason('all')">{{ hostSummary }}</strong>
        <small
          >{{ capabilities.canRecord ? 'browser ok' : 'no browser' }} ·
          {{ capabilities.canRender ? 'ffmpeg ok' : 'no ffmpeg' }} ·
          {{ capabilities.canAuthenticate ? 'key ok' : 'no key' }}</small
        >
      </div>
    </aside>

    <section class="dfs-main">
      <header class="dfs-top">
        <label class="dfs-picker">
          <span>Demo</span>
          <select
            :value="demo?.id"
            :disabled="!demos.length"
            @change="openDemo(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="entry in demos" :key="entry.id" :value="entry.id">{{ entry.title }}</option>
          </select>
        </label>
        <button class="dfs-icon" title="Create demo" @click="newDemoOpen = true">＋</button>
        <span class="dfs-spacer" />
        <span class="dfs-badge" :class="validation">{{ validationLabel }}</span>
        <button class="dfs-btn" :disabled="!dirty || busy" @click="saveDemo">
          {{ dirty ? 'Save changes' : 'Saved' }}
        </button>
        <button
          class="dfs-btn primary"
          :disabled="!demo || busy || !stepAllowed('all')"
          :title="stepAllowed('all') ? 'Validate, sign in, prepare, record and render' : stepBlockedReason('all')"
          @click="runJob('all')"
        >
          ▶ Run full demo
        </button>
      </header>

      <div v-if="error" class="dfs-error">{{ error }}</div>

      <main v-if="view === 'demos'" class="dfs-grid">
        <aside class="dfs-panel dfs-scenes">
          <div class="dfs-panel-head">
            <span class="dfs-eyebrow">Storyboard</span
            ><button class="dfs-icon" title="Add scene" @click="addScene">＋</button>
          </div>
          <div class="dfs-scene-list">
            <button
              v-for="(sceneItem, index) in demo?.scenes || []"
              :key="sceneItem.id"
              class="dfs-scene"
              :class="{ active: index === sceneIndex }"
              @click="sceneIndex = index"
            >
              <span class="dfs-scene-no">{{ index + 1 }}</span>
              <span class="dfs-scene-copy">
                <strong>{{ sceneItem.title }}</strong>
                <small>{{ sceneItem.route }} · {{ formatDuration(sceneDuration(sceneItem, index)) }}</small>
              </span>
              <span class="dfs-scene-state">{{ sceneRecorded(sceneItem.id) ? '✓' : '○' }}</span>
            </button>
            <p v-if="!demo?.scenes?.length" class="dfs-help">No scenes yet.</p>
          </div>
          <div class="dfs-scene-actions">
            <button class="dfs-btn ghost" :disabled="!scene" @click="duplicateScene">Duplicate</button>
            <button class="dfs-btn ghost danger" :disabled="!scene" @click="deleteScene">Delete</button>
          </div>
        </aside>

        <section class="dfs-column">
          <section class="dfs-panel">
            <div class="dfs-preview-head">
              <div>
                <span class="dfs-eyebrow">Latest render</span>
                <h2>{{ demo?.title || 'Select a demo' }}</h2>
              </div>
              <div class="dfs-preview-actions">
                <select
                  v-if="runs.length"
                  :value="selectedRunId"
                  @change="selectRun(($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="run in runs" :key="run.runId" :value="run.runId">
                    {{ run.runId.slice(0, 19) }} · {{ run.recordedScenes }}/{{ run.sceneCount }}
                  </option>
                </select>
                <a v-if="srtUrl" class="dfs-btn ghost" :href="srtUrl" download>Download SRT</a>
              </div>
            </div>
            <div class="dfs-stage">
              <video v-if="videoUrl" :key="videoUrl" :src="videoUrl" controls playsinline />
              <div v-else class="dfs-empty">
                <div class="dfs-empty-icon">▶</div>
                <strong>No rendered video yet</strong>
                <span>Prepare, record and render the demo to create a preview.</span>
              </div>
            </div>
            <div class="dfs-pipeline">
              <button
                v-for="(step, index) in steps"
                :key="step.id"
                class="dfs-step"
                :class="{ running: job.status === 'running' && job.step === step.id, done: stepDone(step.id) }"
                :disabled="!demo || busy || !stepAllowed(step.id)"
                :title="stepAllowed(step.id) ? step.hint : stepBlockedReason(step.id)"
                @click="runJob(step.id)"
              >
                <span>{{ index + 1 }}</span
                >{{ step.label }}
              </button>
            </div>
          </section>

          <section class="dfs-panel">
            <div class="dfs-timeline-head">
              <div>
                <span class="dfs-eyebrow">Timeline</span><strong>{{ formatDuration(totalDuration) }}</strong>
              </div>
              <div class="dfs-legend">
                <span><i class="l-scene" /> Scene</span><span><i class="l-cue" /> Cue</span>
              </div>
            </div>
            <div class="dfs-track">
              <button
                v-for="(item, index) in timeline"
                :key="item.id"
                class="dfs-chip"
                :class="{ active: index === sceneIndex }"
                :style="{ flexGrow: item.durationMs }"
                @click="sceneIndex = index"
              >
                <strong>{{ index + 1 }}. {{ item.title }}</strong
                ><small>{{ formatDuration(item.durationMs) }}</small>
              </button>
              <p v-if="!timeline.length" class="dfs-help">Nothing to show yet.</p>
            </div>
            <div class="dfs-cues">
              <span class="dfs-track-label">Cues</span>
              <span v-for="cue in allCues" :key="cue" class="dfs-cue">{{ cue }}</span>
              <span v-if="!allCues.length" class="dfs-help">No cue markers.</span>
            </div>
          </section>

          <section class="dfs-panel dfs-log" :class="{ collapsed: logCollapsed }">
            <div class="dfs-log-head">
              <div>
                <span class="dfs-dot" :class="job.status" /><strong>Pipeline log</strong
                ><small>{{ jobSubtitle }}</small>
                <small v-if="job.logFile" class="dfs-log-file" :title="job.logFile">
                  full log: <code>{{ job.logFile }}</code>
                </small>
              </div>
              <div>
                <button class="dfs-btn ghost" :disabled="job.status !== 'running'" @click="cancelJob">Cancel</button>
                <button class="dfs-icon" @click="logCollapsed = !logCollapsed">{{ logCollapsed ? '⌄' : '⌃' }}</button>
              </div>
            </div>
            <pre v-show="!logCollapsed" ref="logRef">{{ logText }}</pre>
          </section>
        </section>

        <aside class="dfs-panel dfs-inspector">
          <div class="dfs-tabs">
            <button
              v-for="tab in tabs"
              :key="tab"
              class="dfs-tab"
              :class="{ active: inspectorTab === tab }"
              @click="inspectorTab = tab"
            >
              {{ tab }}
            </button>
          </div>

          <div v-if="inspectorTab === 'Scene'" class="dfs-fields">
            <label
              >Scene title<input :value="scene?.title" :disabled="!scene" @input="editScene('title', $event)"
            /></label>
            <label>Scene ID<input :value="scene?.id" readonly /></label>
            <label>Route<input :value="scene?.route" :disabled="!scene" @input="editScene('route', $event)" /></label>
            <label
              >Narration<textarea
                rows="10"
                :value="scene?.narration"
                :disabled="!scene"
                @input="editScene('narration', $event)"
              />
            </label>
            <p class="dfs-help">Cue markers use <code>[cue:cue-id]</code>. They are not spoken.</p>
            <div class="dfs-chips">
              <span v-for="cue in sceneCues" :key="cue" class="dfs-cue">{{ cue }}</span>
            </div>
          </div>

          <div v-else-if="inspectorTab === 'Voice-over'" class="dfs-fields">
            <label
              >Provider
              <select
                :value="demo?.settings?.narration?.provider"
                :disabled="!demo"
                @change="editSetting(['narration', 'provider'], $event)"
              >
                <option value="auto">Auto</option>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="silent">Silent preview</option>
              </select>
            </label>
            <label
              >Model<input
                :value="demo?.settings?.narration?.defaultModelId"
                :disabled="!demo"
                @input="editSetting(['narration', 'defaultModelId'], $event)"
            /></label>
            <label
              >Language<input
                :value="demo?.settings?.narration?.defaultLanguageCode"
                :disabled="!demo"
                @input="editSetting(['narration', 'defaultLanguageCode'], $event)"
            /></label>
            <label class="dfs-toggle"
              ><input
                type="checkbox"
                :checked="demo?.settings?.cursor?.enabled"
                :disabled="!demo"
                @change="editToggle(['cursor', 'enabled'], $event)"
              />
              Synthetic cursor</label
            >
            <label class="dfs-toggle"
              ><input
                type="checkbox"
                :checked="demo?.settings?.branding?.showCaptions"
                :disabled="!demo"
                @change="editToggle(['branding', 'showCaptions'], $event)"
              />
              Render captions</label
            >
            <p class="dfs-help">
              ElevenLabs keys live in the server process, never in the demo file. Without them the pipeline still runs
              and produces a silent, captioned video.
            </p>
          </div>

          <div v-else class="dfs-fields">
            <div class="dfs-json-head">
              <label>Actions (JSON)</label><span>{{ scene?.actions?.length || 0 }} actions</span>
            </div>
            <textarea
              class="dfs-code"
              rows="12"
              :value="actionsText"
              :disabled="!scene"
              @input="editJson('actions', $event)"
            />
            <div class="dfs-json-head">
              <label>Assertions (JSON)</label><span>{{ scene?.assertions?.length || 0 }} assertions</span>
            </div>
            <textarea
              class="dfs-code"
              rows="8"
              :value="assertionsText"
              :disabled="!scene"
              @input="editJson('assertions', $event)"
            />
            <p class="dfs-help" :class="{ 'dfs-bad': jsonError }">
              {{ jsonError || 'Prefer demoId targets; the demo is validated on save.' }}
            </p>
          </div>

          <section class="dfs-progress">
            <div class="dfs-progress-head">
              <strong>Pipeline progress</strong><span>{{ progressPercent }}%</span>
            </div>
            <ol>
              <li
                v-for="step in steps"
                :key="step.id"
                :class="{ active: job.step === step.id && job.status === 'running', done: stepDone(step.id) }"
              >
                <span>{{ step.label }}</span
                ><small>{{ step.hint }}</small>
              </li>
            </ol>
          </section>
        </aside>
      </main>

      <main v-else-if="view === 'runs'" class="dfs-single">
        <div class="dfs-panel">
          <div class="dfs-panel-head">
            <span class="dfs-eyebrow">Artifacts</span>
            <h2>Runs · {{ demo?.title }}</h2>
          </div>
          <table class="dfs-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Scenes</th>
                <th>Duration</th>
                <th>Video</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in runs" :key="run.runId">
                <td>
                  <code>{{ run.runId }}</code>
                </td>
                <td>{{ run.recordedScenes }} / {{ run.sceneCount }}</td>
                <td>{{ run.durationMs ? formatDuration(run.durationMs) : '—' }}</td>
                <td>{{ run.hasVideo ? '✓' : '—' }}</td>
              </tr>
              <tr v-if="!runs.length">
                <td colspan="4" class="dfs-help">No runs recorded for this demo.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>

      <main v-else class="dfs-single">
        <div class="dfs-panel">
          <div class="dfs-panel-head">
            <span class="dfs-eyebrow">Runtime configuration</span>
            <h2>Settings</h2>
          </div>
          <div class="dfs-fields dfs-settings">
            <label v-for="(setting, key) in settings" :key="key">
              {{ key }}
              <input
                v-if="!setting.secret"
                :value="settingDraft[key] ?? setting.value"
                :placeholder="key === 'B1_BASE_URL' ? 'http://localhost:8080/?app=sample-app' : ''"
                @input="settingDraft[key] = ($event.target as HTMLInputElement).value"
              />
              <input
                v-else
                type="password"
                :placeholder="setting.configured ? 'configured — leave blank to keep' : 'not configured'"
                @input="settingDraft[key] = ($event.target as HTMLInputElement).value"
              />
            </label>
          </div>
          <p class="dfs-help">
            Secrets stay in the server process. They are never written to a demo file or returned to this screen.
          </p>
          <button class="dfs-btn primary" @click="saveSettings">Save settings</button>
        </div>
      </main>
    </section>

    <div v-if="newDemoOpen" class="dfs-modal" @click.self="newDemoOpen = false">
      <form class="dfs-dialog" @submit.prevent="createDemo">
        <h2>New demo</h2>
        <label
          >Demo ID<input v-model="newDemo.id" pattern="[a-z0-9][a-z0-9-]*" placeholder="customer-onboarding" required
        /></label>
        <label>Title<input v-model="newDemo.title" placeholder="Customer Onboarding" required /></label>
        <label>Start from<input :value="demo?.title || '—'" readonly /></label>
        <p class="dfs-help">
          Settings and scene structure are copied from the open demo. Adapt narration, routes and actions before
          recording.
        </p>
        <div class="dfs-dialog-actions">
          <button type="button" class="dfs-btn ghost" @click="newDemoOpen = false">Cancel</button>
          <button type="submit" class="dfs-btn primary">Create demo</button>
        </div>
      </form>
    </div>

    <div v-if="toast" class="dfs-toast" :class="{ bad: toastBad }">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, unref, watch, type Ref } from 'vue';

/*
 * Data comes from the screen's data sources, not from server actions.
 *
 * DemoFactoryScreen carries ten `b1_data_source_temporary` instances beside
 * this component. Demos feed this component over a Data link and drive their
 * scenes and runs over Join links; runs drive their scenes, narration and
 * captions the same way. Selecting a demo or a run is therefore
 * `repositionTo()` on the parent data source — the framework refetches every
 * child, filtered server-side. Writes go through `commitChanges()`, and the
 * server's handlers keep `demos/<id>/demo.yaml` in step (and refuse a change
 * the pipeline would not validate — that refusal arrives as a toast from the
 * framework, and `commitChanges` returns undefined).
 *
 * The only server actions left are the ones that cannot be a data source:
 * starting, polling and cancelling a pipeline job.
 */

// ---- Row shapes (mirrors demo-factory.rows.ts on the server) ---------------

type DemoRow = {
  id: string;
  title: string;
  description: string;
  schemaVersion: number;
  settings: Record<string, any>;
  sceneCount: number;
  invalid: boolean;
  invalidReason: string;
  sourceHash: string;
  driftedFromFile: boolean;
  updatedAt: string | null;
};
type SceneRow = {
  id: string;
  demoId: string;
  sceneId: string;
  sequence: number;
  title: string;
  route: string;
  narration: string;
  actions: unknown[];
  assertions: unknown[];
};
type RunRow = {
  runId: string;
  demoId: string;
  createdAt: string;
  provider: string | null;
  sceneCount: number;
  recordedScenes: number;
  durationMs: number | null;
  hasVideo: boolean;
  videoUrl: string;
  srtUrl: string;
};
type RunSceneRow = {
  id: string;
  runId: string;
  sceneId: string;
  sequence: number;
  durationMs: number | null;
  hasClip: boolean;
};
type SettingRow = {
  key: string;
  label: string;
  value: string;
  configured: boolean;
  secret: boolean;
  source: string;
  sequence: number;
};
type StageRow = { id: string; label: string; hint: string; sequence: number; allowed: boolean; blockedReason: string };
type HostRow = {
  id: string;
  hasFactory: boolean;
  hasDependencies: boolean;
  canRecord: boolean;
  canRender: boolean;
  canAuthenticate: boolean;
};

// ---- The editor's own document shape ----------------------------------------

type Scene = {
  id: string;
  title: string;
  route: string;
  narration: string;
  actions?: unknown[];
  assertions?: unknown[];
};
type Demo = {
  id: string;
  title: string;
  description: string;
  schemaVersion: number;
  scenes: Scene[];
  settings: Record<string, any>;
};
type Job = {
  status: string;
  step: string | null;
  logs: { text: string; stream?: 'stdout' | 'stderr' }[];
  /** The server's full log for this job — this panel only shows a tail of it. */
  logFile?: string | null;
  exitCode: number | null;
  demoId: string | null;
};

// ---- Framework surface this component relies on ----------------------------

/**
 * The parts of a framework data source instance used here. Structural rather
 * than imported: the framework ships these types under its own path aliases,
 * and this component only needs the handful of members below.
 */
type MaybeRef<T> = T | Ref<T>;
type Dso<T> = {
  records: MaybeRef<T[]>;
  selectedRecord: MaybeRef<T | undefined | null>;
  fetchRecords(): Promise<void>;
  repositionTo(identifier: string | number): void;
  commitChanges(payload: {
    createdRecords?: T[];
    updatedRecords?: T[];
    deletedRecords?: T[];
  }): Promise<{ createdRecords: T[]; updatedRecords: T[]; deletedRecords: T[] } | undefined>;
};
type HostInstance = {
  parent: HostInstance | null;
  getObject<T = unknown>(name: string): T | null;
};

const props = defineProps<{ instance?: HostInstance }>();

const ACTIONS = '/service/app/server-actions/demo-factory/demo-factory-studio';

const views = [
  { id: 'demos', label: 'Demos', icon: '▣' },
  { id: 'runs', label: 'Runs', icon: '↗' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];
const tabs = ['Scene', 'Voice-over', 'Actions'];

// ---- Data sources -----------------------------------------------------------

/**
 * Data-source instances live beside this component on the screen; `getObject`
 * searches descendants, so they are resolved from the root of the tree — which
 * also keeps this working should the instances ever be nested under it.
 */
function resolveDso<T>(name: string): Dso<T> | null {
  let node = props.instance ?? null;
  while (node?.parent) node = node.parent;
  return (node?.getObject<Dso<T>>(name) as Dso<T> | null) ?? null;
}

const demoDso = ref<Dso<DemoRow> | null>(null);
const sceneDso = ref<Dso<SceneRow> | null>(null);
const runDso = ref<Dso<RunRow> | null>(null);
const runSceneDso = ref<Dso<RunSceneRow> | null>(null);
const settingDso = ref<Dso<SettingRow> | null>(null);
const stageDso = ref<Dso<StageRow> | null>(null);
const hostDso = ref<Dso<HostRow> | null>(null);

/**
 * A data source's rows or selection as a computed. `unref` because the
 * instance may hand these over as refs or already unwrapped, depending on how
 * the framework wrapped the tree — both are tracked either way.
 */
function rows<T>(dso: Ref<Dso<T> | null>) {
  return computed<T[]>(() => (dso.value ? (unref(dso.value.records) ?? []) : []));
}
function selected<T>(dso: Ref<Dso<T> | null>) {
  return computed<T | undefined>(() => (dso.value ? (unref(dso.value.selectedRecord) ?? undefined) : undefined));
}

const demoRows = rows(demoDso);
const currentDemoRow = selected(demoDso);
const sceneRows = computed(() =>
  rows(sceneDso)
    .value.filter((row) => row.demoId === currentDemoRow.value?.id)
    .sort((left, right) => left.sequence - right.sequence)
);
const runs = rows(runDso);
const currentRun = selected(runDso);
const runSceneRows = computed(() =>
  rows(runSceneDso)
    .value.filter((row) => row.runId === currentRun.value?.runId)
    .sort((left, right) => left.sequence - right.sequence)
);
const settingRows = computed(() => [...rows(settingDso).value].sort((left, right) => left.sequence - right.sequence));
const stageRows = computed(() => [...rows(stageDso).value].sort((left, right) => left.sequence - right.sequence));
const hostRow = computed(() => rows(hostDso).value[0]);

// ---- Screen state -----------------------------------------------------------

const view = ref('demos');
const inspectorTab = ref('Scene');
/** The document being edited — the selected demo row plus its scene rows, as one object. */
const demo = ref<Demo | null>(null);
const sceneIndex = ref(0);
const settingDraft = ref<Record<string, string>>({});
const job = ref<Job>({ status: 'idle', step: null, logs: [], exitCode: null, demoId: null });
const dirty = ref(false);
const validation = ref<'unknown' | 'valid' | 'invalid'>('unknown');
const jsonError = ref('');
const error = ref('');
const toast = ref('');
const toastBad = ref(false);
const logCollapsed = ref(false);
const newDemoOpen = ref(false);
const newDemo = reactive({ id: '', title: '' });
const logRef = ref<HTMLElement | null>(null);

let poll: ReturnType<typeof setInterval> | undefined;

// ---- Derived ---------------------------------------------------------------

const demos = computed(() => demoRows.value.map((row) => ({ id: row.id, title: row.title })));
const selectedRunId = computed(() => currentRun.value?.runId || '');
const scene = computed(() => demo.value?.scenes?.[sceneIndex.value] || null);
const busy = computed(() => job.value.status === 'running');
const videoUrl = computed(() => currentRun.value?.videoUrl || '');
const srtUrl = computed(() => currentRun.value?.srtUrl || '');
const logText = computed(() => job.value.logs.map((line) => line.text).join('\n') || 'Ready.');
const jobSubtitle = computed(() =>
  job.value.status === 'idle'
    ? 'No active job'
    : `${job.value.status}${job.value.exitCode == null ? '' : ` (exit ${job.value.exitCode})`}`
);
const validationLabel = computed(() =>
  validation.value === 'valid'
    ? '● Valid'
    : validation.value === 'invalid'
      ? '● Validation failed'
      : dirty.value
        ? '● Unsaved changes'
        : '● Not validated'
);
const actionsText = computed(() => JSON.stringify(scene.value?.actions ?? [], null, 2));
const assertionsText = computed(() => JSON.stringify(scene.value?.assertions ?? [], null, 2));
const sceneCues = computed(() => cuesIn(scene.value?.narration || ''));
const allCues = computed(() => [
  ...new Set((demo.value?.scenes || []).flatMap((item) => cuesIn(item.narration || '')))
]);
const timeline = computed(() =>
  (demo.value?.scenes || []).map((item, index) => ({
    id: item.id,
    title: item.title,
    durationMs: sceneDuration(item, index)
  }))
);
const totalDuration = computed(() => timeline.value.reduce((sum, item) => sum + item.durationMs, 0));

/** The four pipeline stages as buttons; `all` is the header's "Run full demo". */
const steps = computed(() => stageRows.value.filter((stage) => stage.id !== 'all'));
const progressPercent = computed(() => {
  if (job.value.status === 'complete') return 100;
  const index = steps.value.findIndex((step) => step.id === job.value.step);
  return index < 0 ? 0 : Math.round(((index + (job.value.status === 'running' ? 0.5 : 1)) / steps.value.length) * 100);
});

/** The Settings tab, keyed the way the template reads it. */
const settings = computed<Record<string, { value?: string; configured: boolean; secret: boolean }>>(() =>
  Object.fromEntries(
    settingRows.value.map((row) => [row.key, { value: row.value, configured: row.configured, secret: row.secret }])
  )
);

const capabilities = computed(() => ({
  hasFactory: hostRow.value?.hasFactory ?? false,
  hasDependencies: hostRow.value?.hasDependencies ?? false,
  canRecord: hostRow.value?.canRecord ?? false,
  canRender: hostRow.value?.canRender ?? false,
  canAuthenticate: hostRow.value?.canAuthenticate ?? false
}));

function cuesIn(text: string): string[] {
  return [...text.matchAll(/\[cue:([a-zA-Z0-9_-]+)\]/g)].map((match) => match[1] ?? '');
}

function formatDuration(milliseconds = 0): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A recorded duration when one exists, else the same words-per-minute estimate the pipeline uses. */
function sceneDuration(item: Scene, index: number): number {
  const recorded = runSceneRows.value[index]?.durationMs;
  if (recorded) return recorded;
  const words = (item.narration || '')
    .replace(/\[cue:[^\]]+\]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const wpm = demo.value?.settings?.narration?.wordsPerMinute || 130;
  const settings = demo.value?.settings || {};
  return Math.max(5000, (words / wpm) * 60_000 + (settings.holdAfterMs || 1000) + (settings.holdBeforeMs || 500));
}

const sceneRecorded = (id: string) => Boolean(runSceneRows.value.find((item) => item.sceneId === id)?.hasClip);
const stepDone = (id: string) =>
  job.value.status === 'complete' &&
  steps.value.findIndex((s) => s.id === job.value.step) >= steps.value.findIndex((s) => s.id === id);
// Why each stage cannot run here, straight from the server — the rule lives in
// demo-factory.lib.ts and this screen only renders its verdict. Blocked until
// that verdict arrives, so a stage is never offered on a guess.
const stepBlockedReason = (id: string) => {
  const stage = stageRows.value.find((row) => row.id === id);
  if (!stage) return 'Checking what this host can run…';
  return stage.allowed ? '' : stage.blockedReason || 'Not available on this host';
};
const stepAllowed = (id: string) => !stepBlockedReason(id);
// "Pipeline found" was true of a checkout whose node_modules had never been
// installed, which is the state every stage fails in.
const hostSummary = computed(() =>
  !capabilities.value.hasFactory
    ? 'No pipeline'
    : capabilities.value.hasDependencies
      ? 'Pipeline found'
      : 'Pipeline not installed'
);

// ---- The remaining server actions: the job -----------------------------------

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${ACTIONS}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.message || value?.error || `${response.status} ${response.statusText}`);
  return value as T;
}

function notify(message: string, bad = false) {
  toast.value = message;
  toastBad.value = bad;
  setTimeout(() => (toast.value = ''), 3600);
}

function markDirty() {
  dirty.value = true;
  validation.value = 'unknown';
}

// ---- Document <-> rows ------------------------------------------------------

/** The editor's document, assembled from the selected demo row and its scene rows. */
function assembleDemo(row: DemoRow, scenes: SceneRow[]): Demo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    schemaVersion: row.schemaVersion,
    settings: JSON.parse(JSON.stringify(row.settings ?? {})),
    scenes: scenes.map((item) => ({
      id: item.sceneId,
      title: item.title,
      route: item.route,
      narration: item.narration,
      actions: JSON.parse(JSON.stringify(item.actions ?? [])),
      assertions: JSON.parse(JSON.stringify(item.assertions ?? []))
    }))
  };
}

/** The scene rows a document describes — same keys and sequence rule as the server. */
function sceneRowsOf(document: Demo): SceneRow[] {
  return document.scenes.map((item, index) => ({
    id: `${document.id}:${item.id}`,
    demoId: document.id,
    sceneId: item.id,
    sequence: index + 1,
    title: item.title,
    route: item.route,
    narration: item.narration,
    actions: item.actions ?? [],
    assertions: item.assertions ?? []
  }));
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Rebuild the editor's document from the rows — when the selection changes,
 * and when the rows change underneath an editor that has nothing unsaved.
 * An edit in progress is never replaced by a refetch.
 */
function rebuildDraft(force = false) {
  const row = currentDemoRow.value;
  if (!row) {
    demo.value = null;
    return;
  }
  if (!force && dirty.value && demo.value?.id === row.id) return;
  demo.value = assembleDemo(row, sceneRows.value);
  if (sceneIndex.value >= demo.value.scenes.length) sceneIndex.value = 0;
  if (force || demo.value.id !== row.id) {
    dirty.value = false;
    validation.value = 'unknown';
  }
}

watch(
  () => currentDemoRow.value?.id,
  () => {
    sceneIndex.value = 0;
    dirty.value = false;
    validation.value = 'unknown';
    rebuildDraft(true);
  }
);
watch(sceneRows, () => rebuildDraft());
watch(
  () => currentDemoRow.value,
  () => rebuildDraft(),
  { deep: true }
);

// ---- Actions on the document ------------------------------------------------

function openDemo(demoId: string) {
  demoDso.value?.repositionTo(demoId);
}

function selectRun(runId: string) {
  runDso.value?.repositionTo(runId);
}

/**
 * Save: the scene rows first, then the demo row.
 *
 * Every write is validated by the server before it lands, and a refusal comes
 * back as a toast (and `undefined` here). Scenes go first because that is where
 * a demo usually breaks — a cue reference, an action target — so a bad scene
 * stops the save before the demo row is touched.
 */
async function saveDemo() {
  const document = demo.value;
  const row = currentDemoRow.value;
  if (!document || !row || !sceneDso.value || !demoDso.value) return;

  const wanted = sceneRowsOf(document);
  const existing = sceneRows.value;
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const wantedIds = new Set(wanted.map((item) => item.id));

  const sceneChanges = {
    createdRecords: wanted.filter((item) => !existingById.has(item.id)),
    updatedRecords: wanted.filter((item) => existingById.has(item.id) && !same(existingById.get(item.id), item)),
    deletedRecords: existing.filter((item) => !wantedIds.has(item.id))
  };
  const scenesChanged =
    sceneChanges.createdRecords.length + sceneChanges.updatedRecords.length + sceneChanges.deletedRecords.length > 0;

  if (scenesChanged && !(await sceneDso.value.commitChanges(sceneChanges))) {
    validation.value = 'invalid';
    return;
  }

  const demoChanged =
    row.title !== document.title || row.description !== document.description || !same(row.settings, document.settings);
  if (demoChanged) {
    const saved = await demoDso.value.commitChanges({
      updatedRecords: [
        { ...row, title: document.title, description: document.description, settings: document.settings }
      ]
    });
    if (!saved) {
      validation.value = 'invalid';
      return;
    }
  }

  dirty.value = false;
  validation.value = 'valid';
  // The server stamps the demo row after a scene change (scene count, source
  // hash); a refetch of the parent cascades to its children.
  await demoDso.value.fetchRecords();
}

async function runJob(action: string) {
  if (!demo.value) return;
  try {
    const scenes = action === 'record' && scene.value ? [scene.value.id] : [];
    await call('start-job', { action, demoId: demo.value.id, scenes });
    startPolling();
  } catch (jobError) {
    notify((jobError as Error).message, true);
  }
}

async function cancelJob() {
  await call('cancel-job').catch((cancelError) => notify((cancelError as Error).message, true));
}

function startPolling() {
  stopPolling();
  poll = setInterval(async () => {
    try {
      job.value = await call<Job>('job-status');
      if (job.value.status !== 'running') {
        stopPolling();
        if (job.value.status === 'complete') {
          validation.value = 'valid';
          // The server ingests the run's files into the run data sources as the
          // job ends; this picks them up.
          await runDso.value?.fetchRecords();
          notify('Job complete.');
        } else if (job.value.status === 'failed') {
          // The log panel is collapsible and the tail is long; carrying the last
          // stderr line into the toast is usually the whole diagnosis.
          const last = [...job.value.logs].reverse().find((line) => line.stream === 'stderr')?.text;
          notify(last ? `Job failed — ${last}` : 'Job failed — see the pipeline log.', true);
        }
      }
    } catch {
      stopPolling();
    }
  }, 1500);
}

function stopPolling() {
  if (poll) clearInterval(poll);
  poll = undefined;
}

function editScene(field: 'title' | 'route' | 'narration', event: Event) {
  if (!scene.value) return;
  scene.value[field] = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  markDirty();
}

function editSetting(pathParts: string[], event: Event) {
  if (!demo.value) return;
  const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
  let node: Record<string, any> = demo.value.settings;
  for (const key of pathParts.slice(0, -1)) node = node[key] ??= {};
  node[pathParts[pathParts.length - 1] ?? ''] = value;
  markDirty();
}

function editToggle(pathParts: string[], event: Event) {
  if (!demo.value) return;
  let node: Record<string, any> = demo.value.settings;
  for (const key of pathParts.slice(0, -1)) node = node[key] ??= {};
  node[pathParts[pathParts.length - 1] ?? ''] = (event.target as HTMLInputElement).checked;
  markDirty();
}

/** Parse as you type, but only commit valid JSON — the textarea keeps invalid text visible. */
function editJson(field: 'actions' | 'assertions', event: Event) {
  if (!scene.value) return;
  const text = (event.target as HTMLTextAreaElement).value;
  try {
    const parsed = JSON.parse(text || '[]');
    if (!Array.isArray(parsed)) throw new TypeError(`${field} must be an array`);
    scene.value[field] = parsed;
    jsonError.value = '';
    markDirty();
  } catch (parseError) {
    jsonError.value = (parseError as Error).message;
  }
}

function addScene() {
  if (!demo.value) return;
  const index = demo.value.scenes.length + 1;
  demo.value.scenes.push({
    id: `scene-${index}`,
    title: `Scene ${index}`,
    route: demo.value.scenes[0]?.route || '/',
    narration: 'Describe what this scene shows.',
    actions: [],
    assertions: []
  });
  sceneIndex.value = demo.value.scenes.length - 1;
  markDirty();
}

function duplicateScene() {
  if (!demo.value || !scene.value) return;
  const copy = JSON.parse(JSON.stringify(scene.value)) as Scene;
  copy.id = `${copy.id}-copy`;
  copy.title = `${copy.title} (copy)`;
  demo.value.scenes.splice(sceneIndex.value + 1, 0, copy);
  sceneIndex.value += 1;
  markDirty();
}

function deleteScene() {
  if (!demo.value || !scene.value) return;
  demo.value.scenes.splice(sceneIndex.value, 1);
  sceneIndex.value = Math.max(0, sceneIndex.value - 1);
  markDirty();
}

/**
 * Create a demo as a copy of the open one: its row first (a demo with no
 * scenes yet is not written to disk), then its scenes, which is the write that
 * validates and materializes the new file.
 */
async function createDemo() {
  const source = demo.value;
  const sourceRow = currentDemoRow.value;
  if (!source || !sourceRow || !demoDso.value || !sceneDso.value) return;
  const id = newDemo.id.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    notify('A demo id is lowercase letters, digits and hyphens.', true);
    return;
  }
  if (demoRows.value.some((row) => row.id === id)) {
    notify('A demo with this id already exists.', true);
    return;
  }

  const created = await demoDso.value.commitChanges({
    createdRecords: [
      {
        ...sourceRow,
        id,
        title: newDemo.title.trim() || id,
        description: `Created from ${source.id} in the Demo Factory Studio.`,
        settings: JSON.parse(JSON.stringify(source.settings)),
        sourceHash: '',
        driftedFromFile: false,
        updatedAt: null
      }
    ]
  });
  if (!created) return;

  const scenes = await sceneDso.value.commitChanges({
    createdRecords: sceneRowsOf({ ...source, id })
  });
  if (!scenes) {
    notify('The demo was created but its scenes were refused — see the message above.', true);
  }

  newDemoOpen.value = false;
  newDemo.id = '';
  newDemo.title = '';
  await demoDso.value.fetchRecords();
  demoDso.value.repositionTo(id);
  notify('Demo created.');
}

async function saveSettings() {
  if (!settingDso.value) return;
  const changed = settingRows.value
    .filter((row) => row.key in settingDraft.value)
    .map((row) => ({ ...row, value: settingDraft.value[row.key] ?? '' }));
  if (changed.length === 0) return;

  const saved = await settingDso.value.commitChanges({ updatedRecords: changed });
  if (!saved) return;
  settingDraft.value = {};
  // Several settings decide what this host can run — an API key, a browser
  // path, an ffmpeg path — so the stage verdicts are re-asked, not left stale.
  await Promise.all([settingDso.value.fetchRecords(), stageDso.value?.fetchRecords(), hostDso.value?.fetchRecords()]);
}

// Keep the log pinned to the newest line while a job streams into it.
watch(logText, () => {
  requestAnimationFrame(() => {
    if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
  });
});

onMounted(async () => {
  demoDso.value = resolveDso<DemoRow>('DemoFactoryDemoDSO');
  sceneDso.value = resolveDso<SceneRow>('DemoFactorySceneDSO');
  runDso.value = resolveDso<RunRow>('DemoFactoryRunDSO');
  runSceneDso.value = resolveDso<RunSceneRow>('DemoFactoryRunSceneDSO');
  settingDso.value = resolveDso<SettingRow>('DemoFactorySettingDSO');
  stageDso.value = resolveDso<StageRow>('DemoFactoryStageDSO');
  hostDso.value = resolveDso<HostRow>('DemoFactoryHostDSO');

  if (!demoDso.value || !sceneDso.value || !runDso.value) {
    error.value =
      'The Demo Factory data sources are not on this screen. DemoFactoryScreen needs the DemoFactory*DSO instances and their links.';
    return;
  }

  try {
    // `state` is also what makes sure the data sources match this host before
    // anything is shown — on a workspace whose server holds no key of its own,
    // this call is the first that can. Refetch afterwards so a demo it imported
    // is not missed by a fetch that raced it.
    const state = await call<{ job: Job }>('state');
    job.value = state.job;
    await demoDso.value.fetchRecords();
    if (job.value.status === 'running') startPolling();
  } catch (loadError) {
    error.value = `Could not reach the demo factory: ${(loadError as Error).message}`;
  }
  rebuildDraft(true);
});

onBeforeUnmount(stopPolling);
</script>

<style scoped>
.dfs {
  --line: color-mix(in srgb, currentColor 14%, transparent);
  --soft: color-mix(in srgb, currentColor 6%, transparent);
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 40rem;
  gap: 0;
  font-size: 0.9rem;
}

.dfs-rail {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 12rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid var(--line);
}
.dfs-brand {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.85rem;
  line-height: 1.2;
}
.dfs-mark {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: #1266f1;
  color: #fff;
  font-weight: 700;
}
.dfs-rail nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.dfs-nav {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.5rem 0.6rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dfs-nav:hover {
  background: var(--soft);
}
.dfs-nav.active {
  background: color-mix(in srgb, #1266f1 16%, transparent);
  font-weight: 600;
}
.dfs-host {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  opacity: 0.75;
}

.dfs-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.dfs-top {
  display: flex;
  gap: 0.6rem;
  align-items: end;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--line);
}
.dfs-picker {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;
}
.dfs-spacer {
  flex: 1;
}
.dfs-badge {
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  background: var(--soft);
  font-size: 0.75rem;
}
.dfs-badge.valid {
  background: color-mix(in srgb, #12b76a 20%, transparent);
}
.dfs-badge.invalid {
  background: color-mix(in srgb, #f04438 20%, transparent);
}

.dfs-error {
  margin: 0.75rem 1rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, #f04438 14%, transparent);
}

.dfs-grid {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr) 20rem;
  gap: 0.75rem;
  padding: 0.75rem;
  overflow: auto;
}
.dfs-single {
  padding: 0.75rem;
  overflow: auto;
}
.dfs-column {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}
.dfs-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 0.6rem;
}
.dfs-panel-head,
.dfs-preview-head,
.dfs-timeline-head,
.dfs-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.dfs-preview-actions {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.dfs-eyebrow {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.65;
}
.dfs-panel h2 {
  margin: 0;
  font-size: 1rem;
}

.dfs-scenes {
  max-height: 34rem;
}
.dfs-scene-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow: auto;
}
.dfs-scene {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.45rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.45rem;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dfs-scene:hover {
  background: var(--soft);
}
.dfs-scene.active {
  border-color: #1266f1;
  background: color-mix(in srgb, #1266f1 10%, transparent);
}
.dfs-scene-no {
  display: grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 0.35rem;
  background: var(--soft);
  font-size: 0.75rem;
}
.dfs-scene-copy {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.dfs-scene-copy small {
  opacity: 0.65;
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dfs-scene-actions {
  display: flex;
  gap: 0.4rem;
}

.dfs-stage {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 0.5rem;
  background: #0b1020;
  overflow: hidden;
}
.dfs-stage video {
  width: 100%;
  height: 100%;
}
.dfs-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  align-items: center;
  justify-content: center;
  color: #f7f8ff;
}
.dfs-empty-icon {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  background: rgb(255 255 255 / 12%);
}
.dfs-empty span {
  opacity: 0.7;
  font-size: 0.8rem;
}

.dfs-pipeline {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.dfs-step {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 0.45rem;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dfs-step span {
  display: grid;
  place-items: center;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  background: var(--soft);
  font-size: 0.7rem;
}
.dfs-step:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dfs-step.running {
  border-color: #1266f1;
  background: color-mix(in srgb, #1266f1 12%, transparent);
}
.dfs-step.done span {
  background: color-mix(in srgb, #12b76a 40%, transparent);
}

.dfs-track {
  display: flex;
  gap: 0.25rem;
}
.dfs-chip {
  display: flex;
  flex-direction: column;
  flex-basis: 0;
  min-width: 0;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 0.4rem;
  background: var(--soft);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dfs-chip.active {
  border-color: #1266f1;
}
.dfs-chip strong,
.dfs-chip small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dfs-chip small {
  opacity: 0.65;
}
.dfs-cues {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}
.dfs-track-label,
.dfs-legend {
  font-size: 0.72rem;
  opacity: 0.65;
}
.dfs-legend {
  display: flex;
  gap: 0.6rem;
}
.dfs-legend i {
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 0.2rem;
}
.l-scene {
  background: #1266f1;
}
.l-cue {
  background: #7a5af8;
}
.dfs-cue {
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, #7a5af8 18%, transparent);
  font-size: 0.72rem;
}

.dfs-log pre {
  max-height: 12rem;
  margin: 0;
  padding: 0.6rem;
  border-radius: 0.4rem;
  background: #0b1020;
  color: #d6e2ff;
  font-size: 0.75rem;
  overflow: auto;
}
.dfs-log.collapsed {
  gap: 0;
}
.dfs-log-head small {
  margin-left: 0.5rem;
  opacity: 0.65;
}
/* The path is long and only there to be copied, so it truncates rather than
   pushing the Cancel button off the panel. */
.dfs-log-file {
  display: inline-block;
  max-width: 28rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.dfs-dot {
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  margin-right: 0.4rem;
  border-radius: 999px;
  background: var(--line);
}
.dfs-dot.running {
  background: #1266f1;
}
.dfs-dot.complete {
  background: #12b76a;
}
.dfs-dot.failed,
.dfs-dot.cancelled {
  background: #f04438;
}

.dfs-tabs {
  display: flex;
  gap: 0.25rem;
}
.dfs-tab {
  flex: 1;
  padding: 0.4rem;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dfs-tab.active {
  border-color: #1266f1;
  font-weight: 600;
}
.dfs-fields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.dfs-fields label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  opacity: 0.85;
}
.dfs-fields input,
.dfs-fields select,
.dfs-fields textarea,
.dfs-picker select {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 0.4rem;
  background: transparent;
  color: inherit;
  font: inherit;
}
.dfs-toggle {
  flex-direction: row !important;
  align-items: center;
  gap: 0.5rem !important;
}
.dfs-code {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
}
.dfs-json-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  opacity: 0.8;
}
.dfs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.dfs-help {
  margin: 0;
  font-size: 0.75rem;
  opacity: 0.7;
}
.dfs-bad {
  color: #f04438;
  opacity: 1;
}

.dfs-progress {
  margin-top: auto;
  padding-top: 0.6rem;
  border-top: 1px solid var(--line);
}
.dfs-progress-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
}
.dfs-progress ol {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}
.dfs-progress li {
  display: flex;
  flex-direction: column;
  padding: 0.35rem 0.5rem;
  border-radius: 0.4rem;
  background: var(--soft);
  font-size: 0.75rem;
}
.dfs-progress li.active {
  background: color-mix(in srgb, #1266f1 16%, transparent);
}
.dfs-progress li.done {
  background: color-mix(in srgb, #12b76a 14%, transparent);
}
.dfs-progress small {
  opacity: 0.65;
}

.dfs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.dfs-table th,
.dfs-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
.dfs-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 0.6rem;
}

.dfs-btn {
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: 0.45rem;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
.dfs-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dfs-btn.primary {
  border-color: #1266f1;
  background: #1266f1;
  color: #fff;
}
.dfs-btn.ghost {
  border-color: transparent;
  background: var(--soft);
}
.dfs-btn.danger {
  color: #f04438;
}
.dfs-icon {
  width: 1.9rem;
  height: 1.9rem;
  border: 1px solid var(--line);
  border-radius: 0.45rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.dfs-modal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 45%);
  z-index: 50;
}
.dfs-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: min(28rem, 92vw);
  padding: 1.25rem;
  border-radius: 0.75rem;
  background: var(--p-content-background, #fff);
  color: inherit;
}
.dfs-dialog label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
}
.dfs-dialog input,
.dfs-dialog select {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 0.4rem;
  background: transparent;
  color: inherit;
  font: inherit;
}
.dfs-dialog-actions {
  display: flex;
  justify-content: end;
  gap: 0.5rem;
}

.dfs-toast {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  padding: 0.6rem 1rem;
  border-radius: 0.5rem;
  background: #0b1020;
  color: #fff;
  font-size: 0.82rem;
  z-index: 60;
}
.dfs-toast.bad {
  background: #b42318;
}
</style>
