/**
 * Client logic of the demo maintenance screen of the native Demo Factory
 * Studio: export and delete of the open demo, the scene list's add and
 * duplicate, and the pipeline stages.
 *
 * Every action calls a server action of the demo factory
 * (`demo-factory/demo-factory-studio/*`) — the same actions the former Vue
 * component called by URL — or commits through the data sources the forms
 * already edit. Saving needs no code: the Save toolbar commits the forms.
 */
import {
  closeScreen,
  displayConfirmationModal,
  displayError,
  displayInfo,
  displaySuccess,
  displayWarning,
  type ObjectInstance
} from '@buildone/web-core';

import {
  DSO,
  SEARCH_SCREEN,
  callStudio,
  dsoOf,
  errorMessage,
  openScreen,
  refreshDemos,
  screenOf,
  selectedDemo,
  selectedScene,
  type Job,
  type SceneRow,
  type StageRow
} from '../shared/demoFactoryStudio';

/** How often the job is asked how it is doing while a stage runs. */
const JOB_POLL_MS = 1500;

// ---- Demo ---------------------------------------------------------------------

/** Export the open demo as demo.yaml — the backup and transfer format — as a download. */
export async function exportDemo(eventSource: ObjectInstance): Promise<void> {
  const demo = selectedDemo(screenOf(eventSource));
  if (!demo) return;
  try {
    const { yaml, filename } = await callStudio<{ yaml: string; filename: string }>('export-demo', { demoId: demo.id });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }));
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  } catch (error) {
    displayError(errorMessage(error));
  }
}

/**
 * Delete the open demo with its scenes and its directory, then close its
 * screen. Confirmed because it cannot be undone; it is also the way back from a
 * demo an interrupted import left unusable.
 */
export function deleteDemo(eventSource: ObjectInstance): void {
  const screen = screenOf(eventSource);
  const demo = selectedDemo(screen);
  if (!screen || !demo) return;
  displayConfirmationModal({
    header: 'Delete demo',
    message: `Delete "${demo.title}" with all its scenes? This cannot be undone.`,
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Keep it', outlined: true },
    accept: async () => {
      try {
        await callStudio('delete-demo', { demoId: demo.id });
        closeScreen(screen);
        await refreshDemos(openScreen(SEARCH_SCREEN));
        displaySuccess(`Deleted ${demo.id}.`);
      } catch (error) {
        displayError(errorMessage(error));
      }
    }
  });
}

// ---- Scenes -------------------------------------------------------------------

/** Append a scene with a fresh id after the last one; the server validates and materializes. */
export async function addScene(eventSource: ObjectInstance): Promise<void> {
  const screen = screenOf(eventSource);
  const demo = selectedDemo(screen);
  const scenes = dsoOf<SceneRow>(screen, DSO.scene);
  if (!demo || !scenes) return;
  const rows = scenes.records.value;
  const sceneId = freshSceneId(rows, 'scene');
  await commitScene(scenes, {
    id: `${demo.id}:${sceneId}`,
    demoId: demo.id,
    sceneId,
    sequence: rows.length + 1,
    title: 'New scene',
    route: '/',
    narration: 'Describe what this scene shows.',
    actions: [],
    assertions: []
  });
}

/** Copy the selected scene right after itself, shifting the ones behind it. */
export async function duplicateScene(eventSource: ObjectInstance): Promise<void> {
  const screen = screenOf(eventSource);
  const demo = selectedDemo(screen);
  const scene = selectedScene(screen);
  const scenes = dsoOf<SceneRow>(screen, DSO.scene);
  if (!demo || !scenes) return;
  if (!scene) {
    displayWarning('Select the scene to duplicate.');
    return;
  }
  const rows = scenes.records.value;
  const sceneId = freshSceneId(rows, `${scene.sceneId}-copy`);
  const shifted = rows
    .filter((row) => row.sequence > scene.sequence)
    .map((row) => ({ ...row, sequence: row.sequence + 1 }));
  const copy: SceneRow = {
    ...JSON.parse(JSON.stringify(scene)),
    id: `${demo.id}:${sceneId}`,
    sceneId,
    sequence: scene.sequence + 1,
    title: `${scene.title} (copy)`
  };
  await commitScene(scenes, copy, shifted);
}

async function commitScene(
  scenes: NonNullable<ReturnType<typeof dsoOf<SceneRow>>>,
  created: SceneRow,
  updated: SceneRow[] = []
): Promise<void> {
  try {
    const saved = await scenes.commitChanges({ createdRecords: [created], updatedRecords: updated });
    if (!saved) return;
    await scenes.fetchRecords();
    scenes.repositionTo(created.id);
  } catch (error) {
    displayError(errorMessage(error));
  }
}

/** `base`, or `base-2`, `base-3`, … — the first id no scene of the demo uses. */
function freshSceneId(rows: SceneRow[], base: string): string {
  const taken = new Set(rows.map((row) => row.sceneId));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ---- Pipeline -----------------------------------------------------------------

/**
 * Start a pipeline stage for the open demo. `record` films only the selected
 * scene when one is selected — a full take is what "Run full demo" is for.
 *
 * The host's verdict on each stage lives in DemoFactoryStageDSO; the rule is
 * server-side (demo-factory.lib.ts) and this only relays it, so a stage is
 * never started on a guess.
 */
export async function runStage(eventSource: ObjectInstance, stage: string): Promise<void> {
  const screen = screenOf(eventSource);
  const demo = selectedDemo(screen);
  if (!demo) return;
  const verdict = dsoOf<StageRow>(screen, DSO.stage)?.records.value.find((row) => row.id === stage);
  if (verdict && !verdict.allowed) {
    displayWarning(verdict.blockedReason || `${verdict.label} is not available on this host.`, { life: 6000 });
    return;
  }
  const scene = selectedScene(screen);
  const scenes = stage === 'record' && scene ? [scene.sceneId] : [];
  try {
    await callStudio('start-job', { action: stage, demoId: demo.id, scenes });
    displayInfo(`${verdict?.label ?? stage} started for ${demo.id}.`, { life: 2500 });
    await watchJob(eventSource);
  } catch (error) {
    displayError(errorMessage(error));
  }
}

export async function cancelJob(): Promise<void> {
  try {
    await callStudio('cancel-job');
    displayInfo('Cancelling the job…', { life: 2500 });
  } catch (error) {
    displayError(errorMessage(error));
  }
}

/**
 * Follow the running job until it ends and say how it went. The live log tail
 * is the log view's business; this only turns the outcome into a notification
 * and reloads what the job changed: the runs (a recording or render adds one)
 * and the demo row (validation stamps it).
 */
async function watchJob(eventSource: ObjectInstance): Promise<void> {
  const screen = screenOf(eventSource);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    let job: Job;
    try {
      job = await callStudio<Job>('job-status');
    } catch {
      return;
    }
    if (job.status === 'running') continue;

    await Promise.all([dsoOf(screen, DSO.run)?.fetchRecords(), dsoOf(screen, DSO.demo)?.fetchRecords()]);
    if (job.status === 'complete') {
      displaySuccess('Job complete.');
    } else if (job.status === 'failed') {
      // The tail is long and the log may be collapsed; the last stderr line is
      // usually the whole diagnosis.
      const last = [...job.logs].reverse().find((line) => line.stream === 'stderr')?.text;
      displayError(last ? `Job failed — ${last}` : 'Job failed — see the pipeline log.', { life: 8000 });
    } else {
      displayWarning(`Job ${job.status}.`);
    }
    return;
  }
}
