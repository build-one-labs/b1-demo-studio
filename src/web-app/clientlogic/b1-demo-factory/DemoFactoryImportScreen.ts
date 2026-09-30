/**
 * Client logic of the "Import demo" dialog: pasted demo.yaml text goes to
 * import-demo, which validates it exactly like a Studio edit — nothing lands
 * if the schema refuses it.
 */
import { closeScreen, displayError, displaySuccess, displayWarning, type ObjectInstance } from '@buildone/web-core';

import {
  SEARCH_SCREEN,
  callStudio,
  formOf,
  errorMessage,
  openScreen,
  refreshDemos,
  screenOfObject
} from '../shared/demoFactoryStudio';

export async function importDemo(eventSource: ObjectInstance): Promise<void> {
  const form = formOf(eventSource, 'DemoFactoryImportForm');
  const screen = screenOfObject(form);
  if (!screen || !form) {
    displayError('The import form was not found.');
    return;
  }
  const yaml = String(form.getValue('yaml') ?? '');
  const mode = String(form.getValue('mode') ?? 'fail');
  const newId = String(form.getValue('newId') ?? '').trim();
  if (!yaml.trim()) {
    displayWarning('Paste the demo.yaml text first.');
    return;
  }
  try {
    const result = await callStudio<{ demoId: string; scenes: number; replaced: boolean }>('import-demo', {
      yaml,
      mode,
      ...(mode === 'copy' && newId ? { newId } : {})
    });
    closeScreen(screen);
    await refreshDemos(openScreen(SEARCH_SCREEN), result.demoId);
    displaySuccess(
      `Imported ${result.demoId} (${result.scenes} scene${result.scenes === 1 ? '' : 's'}${result.replaced ? ', replaced' : ''}).`
    );
  } catch (error) {
    displayError(errorMessage(error));
  }
}
