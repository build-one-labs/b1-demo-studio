/**
 * Client logic of the Demo Factory Studio's main screen (sidebar + screen
 * container).
 *
 * The app opens on the overview: every demo as a film strip
 * (DemoFactoryHomeScreen). The sidebar has no notion of a default entry, so
 * the main screen launches it once it is mounted, exactly as a click on
 * "Übersicht" in the menu would.
 */
import { launchScreen, type ObjectInstance } from '@buildone/web-core';

export const HOME_SCREEN = 'DemoFactoryHomeScreen';

export async function onMounted(_eventSource: ObjectInstance): Promise<void> {
  await launchScreen(HOME_SCREEN);
}
