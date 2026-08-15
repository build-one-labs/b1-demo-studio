import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {projectRoot} from './files.mjs';

export const loadDotEnv = async () => {
  try {
    const text = await readFile(path.join(projectRoot, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      value = value.replace(/^(['"])(.*)\1$/, '$2');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

export const envBoolean = (name, fallback = true) => {
  const value = process.env[name];
  if (value == null) return fallback;
  return !['false', '0', 'no', 'off'].includes(value.toLowerCase());
};

/**
 * The environment-variable fragment naming one auth server, e.g.
 * `try-auth.test.build.one` → `TRY_AUTH_TEST_BUILD_ONE`.
 *
 * The same rule as the CLI's `scripts/utils/api-key.mjs` and the shell's
 * `b1_auth_host_slug`. Copied rather than imported: this project ships inside
 * the app server image, which contains no @buildone/swat-cli.
 */
export const authHostSlug = (url) => {
  if (typeof url !== 'string' || url === '') return null;
  const host = url.replace(/^[^:]+:\/\//, '').replace(/[/?].*$/, '').replace(/^.*@/, '').replace(/:\d+$/, '');
  if (host === '') return null;
  const slug = host.replace(/[.-]/g, '_').toUpperCase();
  return /^[\dA-Z_]+$/.test(slug) ? slug : null;
};

/**
 * This workspace's user API key, scoped name first.
 *
 * A key belongs to one auth server, so it is named for it —
 * `B1_USER_API_KEY__TRY_AUTH_TEST_BUILD_ONE`. The unqualified name is the
 * fallback, not the contract: it is what an operator types into the Studio's
 * Settings tab and what the app server hands the pipeline it spawns, and it is
 * no longer what a workspace or a Codespaces secret provides.
 *
 * @returns {{name: string, key: string}|null}
 */
export const resolveApiKey = (env = process.env, authUrl = env.AUTH_URL) => {
  const slug = authHostSlug(authUrl);
  const names = slug ? [`B1_USER_API_KEY__${slug}`, 'B1_USER_API_KEY'] : ['B1_USER_API_KEY'];
  for (const name of names) {
    if (env[name]) return {name, key: env[name]};
  }
  return null;
};

