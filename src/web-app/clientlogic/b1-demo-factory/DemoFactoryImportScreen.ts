/**
 * Client logic of the "Import demo" dialog: pasted demo.yaml text goes to
 * import-demo, which validates it exactly like a Studio edit — nothing lands
 * if the schema refuses it.
 */
import {
  closeScreen,
  displayError,
  displaySuccess,
  displayWarning,
  translate,
  type ObjectInstance
} from '@buildone/web-core';

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
    displayError(translate('b1App.messages.DemoFactoryImportScreen.formNotFound', 'The import form was not found.'));
    return;
  }
  const yaml = String(form.getValue('yaml') ?? '');
  const mode = String(form.getValue('mode') ?? 'fail');
  const newId = String(form.getValue('newId') ?? '').trim();
  if (!yaml.trim()) {
    displayWarning(translate('b1App.messages.DemoFactoryImportScreen.yamlMissing', 'Paste the demo.yaml text first.'));
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
    const scenes =
      result.scenes === 1
        ? translate('b1App.messages.DemoFactoryImportScreen.sceneCountOne', '1 scene')
        : translate('b1App.messages.DemoFactoryImportScreen.sceneCountMany', '{count} scenes', {
            count: result.scenes
          });
    displaySuccess(
      result.replaced
        ? translate(
            'b1App.messages.DemoFactoryImportScreen.importedReplaced',
            'Imported {demoId} ({scenes}, replaced).',
            { demoId: result.demoId, scenes }
          )
        : translate('b1App.messages.DemoFactoryImportScreen.imported', 'Imported {demoId} ({scenes}).', {
            demoId: result.demoId,
            scenes
          })
    );
  } catch (error) {
    displayError(errorMessage(error));
  }
}
