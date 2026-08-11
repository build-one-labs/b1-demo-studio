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

