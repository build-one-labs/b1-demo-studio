/**
 * Reset the blueprint repository of the application a demo films — the
 * "Reset repository" button of the changesSearch screen: every blueprint
 * change of that environment is dropped and the blueprints are re-imported
 * from disk, so the take starts from the environment's delivered state, not
 * from whatever an earlier take (or a customization) left behind.
 *
 * Rich text, user roles and other database data stay; only the repository
 * model is re-imported (`repository.modified-objects/reset-repository`).
 */
export const RESET_REPOSITORY_PATH = '/service/swat/server-actions/repository/modified-objects/reset-repository';

/** POST the reset with the take's credentials; resolves when the re-import finished. */
export const resetRepository = async ({browser, appUrl, authState, apiKey, timeoutMs = 600_000}) => {
  const context = await browser.newContext({
    storageState: authState,
    ...(apiKey && !authState ? {extraHTTPHeaders: {'x-api-key': apiKey}} : {}),
  });
  try {
    const url = new URL(RESET_REPOSITORY_PATH, appUrl).href;
    const response = await context.request.post(url, {data: {}, timeout: timeoutMs});
    if (!response.ok()) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resetting the repository of ${new URL(appUrl).origin} failed (HTTP ${response.status()}${detail ? `: ${detail}` : ''})`);
    }
  } finally {
    await context.close();
  }
};
