/**
 * What the native Demo Factory Studio screens share: the server actions of the
 * demo factory, the shape of a demo document, and the handful of lookups every
 * screen makes (the open demo, the open scene, a data source by name).
 *
 * The screens' own files under clientlogic/b1-demo-factory/ import from here;
 * this file is not a client logic module of its own (no blueprint names it).
 */
import {
  invokeServerTask,
  useScreenStore,
  type DataSource,
  type Form,
  type ObjectInstance,
  type Screen
} from '@buildone/web-core';

/** The demo factory's server actions — `@B1Service({ basePath: 'demo-factory' })`, class DemoFactoryStudio. */
export const SERVICE = 'demo-factory';
const CLASS = 'demo-factory-studio';

/** Screen and data-source names the studio screens agree on. */
export const SEARCH_SCREEN = 'DemoFactoryDemoSearch';
export const MAINTENANCE_SCREEN = 'DemoFactoryDemoMaintenance';
export const DSO = {
  demo: 'DemoFactoryDemoDSO',
  scene: 'DemoFactorySceneDSO',
  run: 'DemoFactoryRunDSO',
  runScene: 'DemoFactoryRunSceneDSO',
  setting: 'DemoFactorySettingDSO',
  stage: 'DemoFactoryStageDSO',
  host: 'DemoFactoryHostDSO',
  job: 'DemoFactoryJobDSO'
} as const;

/** The Demo Creator's b1_agent objectMasterGuid — see DemoCreatorAgent.json. */
export const DEMO_CREATOR_AGENT_GUID = '34e589aa-fd11-4aa9-b2cf-ed6ec90fe6a4';

export interface DemoRow {
  id: string;
  title: string;
  description: string;
  schemaVersion: number;
  settings: Record<string, unknown>;
  setup: Record<string, unknown> | null;
  sceneCount: number;
}

export interface SceneRow {
  id: string;
  demoId: string;
  sceneId: string;
  sequence: number;
  title: string;
  route: string;
  narration: string;
  actions: unknown[];
  assertions: unknown[];
}

export interface StageRow {
  id: string;
  label: string;
  allowed: boolean;
  blockedReason: string;
}

export interface Job {
  status: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled' | string;
  step: string | null;
  logs: { stream: 'stdout' | 'stderr'; text: string }[];
  exitCode: number | null;
  demoId: string | null;
}

/** A demo document as `demo-factory/src/schema.mjs` defines it — what save-demo takes. */
export interface DemoDocument {
  schemaVersion: number;
  id: string;
  title: string;
  description?: string;
  settings: Record<string, unknown>;
  setup?: Record<string, unknown>;
  scenes: { id: string; title: string; route: string; narration: string; actions: unknown[]; assertions: unknown[] }[];
}

/** Call one of the studio's server actions; the result is the action's return value. */
export function callStudio<T = unknown>(action: string, paramObj: Record<string, unknown> = {}): Promise<T> {
  return invokeServerTask({
    name: SERVICE,
    methodName: `${CLASS}/${action}`,
    methodType: 'serverAction',
    paramObj
  }) as Promise<T>;
}

/** A data source of a screen by its instance name. */
export function dsoOf<T = Record<string, unknown>>(
  screen: Screen | undefined,
  name: string
): DataSource<T> | undefined {
  return screen?.getObject<DataSource<T>>(name) ?? undefined;
}

/** An open screen by blueprint name — the dialogs refresh the search screen's list after they change a demo. */
export function openScreen(name: string): Screen | undefined {
  return useScreenStore().screenList.find((screen) => screen.blueprint?.name === name);
}

/**
 * A dialog's form, found from the event that fired inside it.
 *
 * Under a modal launch neither `b1.activeScreen` nor, at times,
 * `eventSource.screen` is the dialog — both can be the screen the dialog was
 * launched from. The form a button sits in is unambiguous, so that comes
 * first; the screen lookups are the fallback for events the screen itself
 * fires (its mounted hook), where the eventSource is the dialog.
 */
export function formOf(eventSource: ObjectInstance, name: string): Form | undefined {
  const parent = eventSource.getParentByType?.('form') as Form | null | undefined;
  if (parent) return parent;
  return (
    (eventSource.getObject?.<Form>(name) as Form | null | undefined) ??
    (eventSource.screen?.getObject<Form>(name) as Form | null | undefined) ??
    undefined
  );
}

/** The screen an object belongs to — for a dialog's form, the dialog. */
export const screenOfObject = (object: ObjectInstance | undefined): Screen | undefined => object?.screen ?? undefined;

export const selectedDemo = (screen: Screen | undefined): DemoRow | undefined =>
  dsoOf<DemoRow>(screen, DSO.demo)?.selectedRecord.value;

export const selectedScene = (screen: Screen | undefined): SceneRow | undefined =>
  dsoOf<SceneRow>(screen, DSO.scene)?.selectedRecord.value;

/** Reload the demo list (its Join cascades to the scenes) and put the cursor on one demo. */
export async function refreshDemos(screen: Screen | undefined, repositionTo?: string): Promise<void> {
  const demos = dsoOf<DemoRow>(screen, DSO.demo);
  if (!demos) return;
  await demos.fetchRecords();
  if (repositionTo) demos.repositionTo(repositionTo);
}

/** The screen an event came from — an action inside a toolbar, a button inside a form. */
export const screenOf = (eventSource: ObjectInstance): Screen | undefined => eventSource.screen ?? undefined;

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Reassemble the open demo and its scenes into one document — the shape save-demo validates. */
export function assembleDocument(demo: DemoRow, scenes: SceneRow[]): DemoDocument {
  return {
    schemaVersion: demo.schemaVersion,
    id: demo.id,
    title: demo.title,
    description: demo.description,
    settings: demo.settings,
    ...(demo.setup ? { setup: demo.setup } : {}),
    scenes: [...scenes]
      .filter((scene) => scene.demoId === demo.id)
      .sort((left, right) => left.sequence - right.sequence)
      .map((scene) => ({
        id: scene.sceneId,
        title: scene.title,
        route: scene.route,
        narration: scene.narration,
        actions: scene.actions ?? [],
        assertions: scene.assertions ?? []
      }))
  };
}

/** The starter document of a demo created from nothing — the same defaults the pipeline assumes. */
export function blankDocument(id: string, title: string): DemoDocument {
  return {
    schemaVersion: 1,
    id,
    title,
    description: '',
    settings: {
      language: 'en',
      viewport: { width: 1920, height: 1080 },
      fps: 30,
      baseUrl: { env: 'B1_BASE_URL', fallback: 'http://localhost:8080/' },
      authStateEnv: 'B1_AUTH_STATE',
      headlessEnv: 'DEMO_HEADLESS',
      holdBeforeMs: 700,
      holdAfterMs: 1400,
      cursor: { enabled: true, moveDurationMs: 700, clickLeadMs: 120, clickEffectDurationMs: 560, sizePx: 30 },
      narration: {
        provider: 'auto',
        voiceIdEnv: 'ELEVENLABS_VOICE_ID',
        apiKeyEnv: 'ELEVENLABS_API_KEY',
        modelIdEnv: 'ELEVENLABS_MODEL_ID',
        defaultModelId: 'eleven_multilingual_v2',
        languageCodeEnv: 'ELEVENLABS_LANGUAGE_CODE',
        defaultLanguageCode: 'en',
        wordsPerMinute: 132
      },
      branding: {
        productName: 'Build.One',
        accentColor: '#1266f1',
        backgroundColor: '#0b1020',
        textColor: '#f7f8ff',
        showCaptions: true,
        showSceneTitles: true
      }
    },
    scenes: [
      {
        id: 'opening',
        title: 'Opening scene',
        route: '/',
        narration: 'Describe what this scene shows.',
        actions: [],
        assertions: []
      }
    ]
  };
}

export const DEMO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
