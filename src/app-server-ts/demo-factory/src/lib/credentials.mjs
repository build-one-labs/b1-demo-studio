/**
 * Where a take's credentials may go.
 *
 * Without a minted storage state a take authenticates with the user's API key
 * as a request header (see record.mjs). A context-wide header goes with every
 * request the page makes — to a font host, a CDN, any page an action
 * navigates to — so the key is attached here per request instead, and only
 * for the applications the demo names: its own base URL and every scene's.
 */
import {sceneBaseUrl} from '../schema.mjs';

/** The origins of the applications a demo films: the demo's own and every scene's. */
export const demoOrigins = (demo, env = process.env) =>
  new Set([{}, ...(demo.scenes ?? [])].map((scene) => new URL(sceneBaseUrl(demo, scene, env)).origin));

const originOf = (href) => {
  try {
    return new URL(href).origin;
  } catch {
    return null;
  }
};

/** Attach `x-api-key` to the requests of `context` that go to `origins`, and to nothing else. */
export const scopeApiKey = async (context, apiKey, origins) => {
  if (!apiKey) return context;
  await context.route('**/*', (route) => {
    const request = route.request();
    if (!origins.has(originOf(request.url()))) return route.continue();
    return route.continue({headers: {...request.headers(), 'x-api-key': apiKey}});
  });
  return context;
};

/** A new browser context for a take: the storage state if there is one, else the key, scoped to the demo's applications. */
export const newTakeContext = async (browser, {demo, authState, apiKey, ...options}) => {
  const context = await browser.newContext({...options, storageState: authState});
  if (!authState) await scopeApiKey(context, apiKey, demoOrigins(demo));
  return context;
};
