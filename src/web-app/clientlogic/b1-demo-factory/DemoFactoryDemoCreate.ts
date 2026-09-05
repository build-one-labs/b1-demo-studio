/**
 * Client logic of the New demo dialog (DemoFactoryDemoCreate), opened from the
 * search toolbar through the grid's addRecordContainer.
 *
 * A demo is created as one whole document through save-demo — the only write
 * path that runs the schema validation — either as a copy of the demo selected
 * in the search grid or from the blank starter document.
 */
import { closeScreen, displayError, displaySuccess, displayWarning, type ObjectInstance } from '@buildone/web-core';

import {
  DEMO_ID_PATTERN,
  DSO,
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

  const search = openScreen(SEARCH_SCREEN);
  const demoRows = dsoOf<DemoRow>(search, DSO.demo)?.records.value ?? [];
  if (demoRows.some((row) => row.id === id)) {
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
  } catch (error) {
    displayError(errorMessage(error));
  }
}

/** The scene rows of one demo, straight from the scene data source's clob endpoint. */
async function scenesOf(demoId: string): Promise<SceneRow[]> {
  const query = encodeURIComponent(
    JSON.stringify({
      fieldlist: '*',
      filters: { logic: 'and', filters: [{ field: 'demoId', operator: 'eq', value: demoId }] }
    })
  );
  const response = await fetch(`/service/app/data/clob/${DSO.scene}?queryInformation=${query}`);
  if (!response.ok) throw new Error(`Could not read the scenes of ${demoId} (${response.status})`);
  const body = (await response.json()) as { records?: SceneRow[] } | SceneRow[];
  return Array.isArray(body) ? body : (body.records ?? []);
}
