/**
 * Client logic of the demo search screen of the native Demo Factory Studio.
 *
 * The list itself needs no code: the title link opens the maintenance screen
 * positioned to the demo, and New goes through the grid to the create dialog.
 * What is left are the two dialogs that are not about one record — and the
 * handlers of all three dialogs, re-exported below.
 *
 * Why the re-exports: a `#.handler(eventSource)` inside a modal resolves its
 * namespace against the screen the modal was launched from, not the dialog. A
 * dialog opened from here therefore looks for its handlers in this file. Each
 * handler reads the dialog's own form through the active screen, so it does
 * the right thing wherever it is resolved from.
 */
import { launchScreen, type ObjectInstance } from '@buildone/web-core';

import { screenOf, selectedDemo } from '../shared/demoFactoryStudio';

export { startConversation } from './DemoFactoryAgentScreen';
export { createDemo, onInitialize } from './DemoFactoryDemoCreate';
export { importDemo } from './DemoFactoryImportScreen';

export async function openImport(): Promise<void> {
  await launchScreen('DemoFactoryImportScreen');
}

export async function openAgent(eventSource: ObjectInstance): Promise<void> {
  const demo = selectedDemo(screenOf(eventSource));
  await launchScreen('DemoFactoryAgentScreen', {
    data: demo ? { demoId: demo.id, demoTitle: demo.title } : {}
  });
}
