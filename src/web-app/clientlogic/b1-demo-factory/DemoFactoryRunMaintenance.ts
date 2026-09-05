/**
 * Client logic of the run maintenance screen: a run is what the pipeline
 * produced, so there is nothing to edit — only its artefacts to open. The URLs
 * on the run row point at the demo factory's media routes.
 */
import { displayWarning, type ObjectInstance } from '@buildone/web-core';

import { DSO, dsoOf, screenOf } from '../shared/demoFactoryStudio';

interface RunRow {
  runId: string;
  hasVideo: boolean;
  videoUrl: string;
  srtUrl: string;
}

/** Open one of the run's artefacts — `videoUrl` or `srtUrl` — in a new tab. */
export function openArtefact(eventSource: ObjectInstance, field: 'videoUrl' | 'srtUrl'): void {
  const run = dsoOf<RunRow>(screenOf(eventSource), DSO.run)?.selectedRecord.value;
  const url = run?.[field];
  if (!url) {
    displayWarning(run ? 'This run has no rendered video yet.' : 'No run is open.');
    return;
  }
  window.open(url, '_blank', 'noopener');
}
