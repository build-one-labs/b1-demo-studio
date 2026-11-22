/**
 * Client logic of the New demo dialog (DemoFactoryDemoCreate), opened from the
 * search toolbar through the grid's addRecordContainer.
 *
 * A demo is created as one whole document through save-demo — the only write
 * path that runs the schema validation — either as a copy of the demo selected
 * in the search grid or from the blank starter document.
 */
import {
  closeScreen,
  displayError,
  displaySuccess,
  displayWarning,
  launchScreen,
  type ObjectInstance
} from '@buildone/web-core';

import {
  DEMO_ID_PATTERN,
  DSO,
  MAINTENANCE_SCREEN,
  assembleDocument,
  blankDocument,
  SEARCH_SCREEN,
  callStudio,
  formOf,
  dsoOf,
  errorMessage,
  openScreen,
  refreshDemos,
  screenOfObject,
  selectedDemo,
  type DemoRow,
  type SceneRow
} from '../shared/demoFactoryStudio';

const FORM = 'DemoFactoryDemoCreateForm';

/** Say which demo the new one starts from once the dialog is up. */
export function onInitialize(eventSource: ObjectInstance): void {
  const form = formOf(eventSource, FORM);
  const source = selectedDemo(openScreen(SEARCH_SCREEN));
  form?.setSystemValue('startFrom', source ? `${source.title} (${source.id})` : 'Blank demo');
}

export async function createDemo(eventSource: ObjectInstance): Promise<void> {
  const form = formOf(eventSource, FORM);
  const screen = screenOfObject(form);
  if (!screen || !form) {
    displayError('The new-demo form was not found.');
    return;
  }
  const id = String(form.getValue('id') ?? '').trim();
  const title = String(form.getValue('title') ?? '').trim() || id;
  if (!DEMO_ID_PATTERN.test(id)) {
    displayWarning('A demo id is lowercase letters, digits and hyphens.');
    return;
  }

  // Opened from the overview, the search list may not be open: then the ids
  // come from the data source, since save-demo would replace a demo of this id.
  const search = openScreen(SEARCH_SCREEN);
  const demoIds = search
    ? (dsoOf<DemoRow>(search, DSO.demo)?.records.value ?? []).map((row) => row.id)
    : await demoIdsInStore();
  if (demoIds.includes(id)) {
    displayWarning('A demo with this id already exists.');
    return;
  }

  // The scenes of the selected demo are not on the search screen; the copy
  // needs them, so they are read through the scene data source directly.
  const source = selectedDemo(search);
  const document = source
    ? {
        ...assembleDocument(source, await scenesOf(source.id)),
        id,
        title,
        description: `Created from ${source.id} in the Demo Factory Studio.`
      }
    : blankDocument(id, title);

  try {
    await callStudio('save-demo', { document });
    closeScreen(screen);
    await refreshDemos(search, id);
    displaySuccess(`Demo ${id} created.`);
    if (!search) await launchScreen(MAINTENANCE_SCREEN, { repositionTo: id });
  } catch (error) {
    displayError(errorMessage(error));
  }
}

/** Every demo id, straight from the demo data source. */
async function demoIdsInStore(): Promise<string[]> {
  const query = encodeURIComponent(JSON.stringify({ fieldlist: 'id', filters: { logic: 'and', filters: [] } }));
  const filter = encodeURIComponent(JSON.stringify({ top: -1 }));
  const response = await fetch(`/service/app/data/${DSO.demo}?queryInformation=${query}&filter=${filter}`);
  if (!response.ok) throw new Error(`Could not read the demos (${response.status})`);
  const body = (await response.json()) as { records?: DemoRow[] } | DemoRow[];
  return (Array.isArray(body) ? body : (body.records ?? [])).map((row) => row.id);
}

/**
 * The scene rows of one demo, straight from the scene data source.
 *
 * `filter` is not optional on a table-backed data source, and `top: -1` lifts
 * its default page of 100 rows.
 */
async function scenesOf(demoId: string): Promise<SceneRow[]> {
  const query = encodeURIComponent(
    JSON.stringify({
      fieldlist: '*',
      filters: { logic: 'and', filters: [{ field: 'demoId', operator: 'eq', value: demoId }] }
    })
  );
  const filter = encodeURIComponent(JSON.stringify({ top: -1, orderBy: 'sequence' }));
  const response = await fetch(`/service/app/data/${DSO.scene}?queryInformation=${query}&filter=${filter}`);
  if (!response.ok) throw new Error(`Could not read the scenes of ${demoId} (${response.status})`);
  const body = (await response.json()) as { records?: SceneRow[] } | SceneRow[];
  return Array.isArray(body) ? body : (body.records ?? []);
}
