/**
 * Client logic of the Settings screen: the runtime settings grid commits on its
 * own; this file turns a pasted session token into the recorder's auth state
 * and re-asks the host what it can run afterwards.
 */
import { displayError, displaySuccess, displayWarning, type ObjectInstance } from '@buildone/web-core';

import { DSO, callStudio, dsoOf, errorMessage, formOf } from '../shared/demoFactoryStudio';

/** Turn a pasted b1.session_token cookie into the recorder's auth state, server-side. */
export async function mintAuthState(eventSource: ObjectInstance): Promise<void> {
  const form = formOf(eventSource, 'DemoFactoryAuthForm');
  const sessionToken = String(form?.getValue('sessionToken') ?? '').trim();
  if (!sessionToken) {
    displayWarning('Paste the session token first.');
    return;
  }
  try {
    const result = await callStudio<{ file: string; host: string }>('mint-auth-state', { sessionToken });
    form?.setSystemValue('sessionToken', '');
    // The auth state changes what this host can run, so the verdicts refresh.
    await refreshVerdicts(eventSource);
    displaySuccess(`Auth state minted for ${result.host}.`);
  } catch (error) {
    displayError(errorMessage(error));
  }
}

/**
 * Several settings decide what this host can run — an API key, a browser path,
 * an ffmpeg path — so after the grid commits a value the stage verdicts and the
 * host capabilities are re-asked rather than left stale.
 */
export async function refreshVerdicts(eventSource: ObjectInstance): Promise<void> {
  const screen = eventSource.screen;
  await Promise.all([
    dsoOf(screen, DSO.setting)?.fetchRecords(),
    dsoOf(screen, DSO.stage)?.fetchRecords(),
    dsoOf(screen, DSO.host)?.fetchRecords()
  ]);
}
