#!/usr/bin/env node
// Keeps a repository's layout deliberate (B1-1535, B1-1545).
//
// Shipped to every Build.One repository by a CLI migration and run by
// .github/workflows/repo-layout.yml on each pull request (Vanguard runs it from
// build.yml). `b1 check-layout` runs it locally. The configuration is
// .github/repo-layout.json; why each rule exists is in
// node_modules/@buildone/swat-cli/knowledge/architecture_info/repository-layout.md.
//
// Every rule is about what is *committed*: untracked and ignored folders
// (node_modules, .b1/env, ...) never count.
//
//   1. Top-level entries. Every entry at the repository root, and directly
//      under `src/` and `docs/` whenever the repository has them, is listed
//      with what it is for. Anything else fails, so adding a folder is a
//      reviewed one-line change. Dropping a level's list does not switch the
//      level off: every entry under it then fails.
//   2. No force-added ignored files. A tracked file that matches one of the
//      repository's .gitignore rules got in with `git add -f`, unless
//      `ignoredFiles` lists it.
//   3. Size. No committed file over `maxFileBytes` unless `largeFiles` lists
//      it (or `unlimitedFiles`, for files that grow on their own, like a
//      lockfile), and no data file (.json, .jsonl, .csv, ...) under docs/
//      unless `docsDataFiles` lists it. Sizes are git's (the blob committed or
//      staged), so a Git LFS file is its pointer everywhere, as in CI.
//
// A listed exception that no longer applies fails too, so the lists stay true.
//
// Node built-ins only, and nothing newer than Node 18: the action runs on
// whatever Node the runner has, before any install.

/* global console, process */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG = '.github/repo-layout.json';
export const LEVELS = ['src', 'docs'];
export const DATA_EXTENSIONS = /\.(json|jsonl|ndjson|csv|tsv)$/i;
export const DEFAULT_MAX = 1048576;

// `*` matches within one path segment; everything else is literal.
export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function matcher(patterns) {
  const compiled = Object.keys(patterns ?? {}).map((p) => [p, globToRegExp(p)]);
  return {
    find: (path) => compiled.find(([, re]) => re.test(path))?.[0],
    matching: (pattern, paths) => {
      const re = globToRegExp(pattern);
      return paths.filter((path) => re.test(path));
    }
  };
}

const has = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
const formatSize = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;

/**
 * Pure check over a file list, so the tests need no repository.
 * @param {object} input
 * @param {string[]} input.files   tracked paths, repository-relative, `/`-separated
 * @param {string[]} input.ignored tracked paths that match a .gitignore rule
 * @param {(path: string) => number} input.sizeOf
 * @param {object} input.layout    the parsed configuration
 * @returns {string[]} one message per problem; empty when the layout is clean
 */
export function checkLayout({ files, ignored, sizeOf, layout }) {
  const problems = [];

  // 1. Top-level entries: the root, and each level the repository has or the
  // configuration lists.
  const levels = LEVELS.filter((level) => has(layout, level) || files.some((f) => f.startsWith(`${level}/`)));
  const seen = { root: new Set(), ...Object.fromEntries(levels.map((l) => [l, new Set()])) };
  for (const file of files) {
    const [first, second] = file.split('/');
    seen.root.add(first);
    if (levels.includes(first) && second !== undefined) seen[first].add(second);
  }
  for (const [key, entries] of Object.entries(seen)) {
    const allowed = layout[key] ?? {};
    const prefix = key === 'root' ? '' : `${key}/`;
    const where = key === 'root' ? 'the repository root' : `${key}/`;
    for (const entry of [...entries].sort()) {
      // `has`, not `in`: `constructor` or `toString` must not count as listed.
      if (!has(allowed, entry))
        problems.push(
          `New entry in ${where}: ${prefix}${entry}. ` +
            `Move it into an existing folder, or add it to "${key}" in ${CONFIG} with what it is for.`
        );
    }
    for (const entry of Object.keys(allowed).sort()) {
      if (!entries.has(entry))
        problems.push(
          `${CONFIG} lists ${prefix}${entry} under "${key}", but it is not in the repository. Remove the entry.`
        );
    }
  }

  // 2. Force-added ignored files.
  const ignoredOk = matcher(layout.ignoredFiles);
  for (const file of [...ignored].sort())
    if (!ignoredOk.find(file))
      problems.push(
        `${file} is committed but matches a .gitignore rule (it was added with \`git add -f\`). ` +
          `Remove it from git, change the ignore rule, or add it to "ignoredFiles" in ${CONFIG} with why.`
      );

  // 3. Size and data files.
  const large = matcher(layout.largeFiles);
  const unlimited = matcher(layout.unlimitedFiles);
  const docsData = matcher(layout.docsDataFiles);
  const max = layout.maxFileBytes ?? DEFAULT_MAX;
  for (const file of files) {
    const size = sizeOf(file);
    if (size > max && !large.find(file) && !unlimited.find(file))
      problems.push(
        `${file} is ${formatSize(size)}, over the ${formatSize(max)} limit. Keep large data out of git ` +
          `(a CI artifact, the ticket), or add it to "largeFiles" in ${CONFIG} with why it must be committed.`
      );
    if (file.startsWith('docs/') && DATA_EXTENSIONS.test(file) && !docsData.find(file))
      problems.push(
        `${file} is a data file under docs/. Raw data, such as experiment results, stays out of the repository; ` +
          `add it to "docsDataFiles" in ${CONFIG} only if something runs from it.`
      );
  }

  // Exceptions that no longer apply.
  for (const pattern of Object.keys(layout.largeFiles ?? {})) {
    const matched = large.matching(pattern, files);
    if (matched.length === 0)
      problems.push(`${CONFIG} lists ${pattern} under "largeFiles", but nothing matches it. Remove the entry.`);
    else if (!matched.some((file) => sizeOf(file) > max))
      problems.push(
        `${CONFIG} lists ${pattern} under "largeFiles", but nothing it matches is over the ${formatSize(max)} limit any more. Remove the entry.`
      );
  }
  for (const [key, list, pool] of [
    ['unlimitedFiles', unlimited, files],
    ['docsDataFiles', docsData, files],
    ['ignoredFiles', ignoredOk, ignored]
  ])
    for (const pattern of Object.keys(layout[key] ?? {}))
      if (list.matching(pattern, pool).length === 0)
        problems.push(`${CONFIG} lists ${pattern} under "${key}", but nothing matches it. Remove the entry.`);

  return problems;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * What checkLayout needs, read from a repository: the committed (and staged)
 * files with git's sizes for them, and the ones that match a .gitignore rule.
 * With `untracked`, also the untracked files `git add -A` would commit, sized
 * on disk — what the migration that writes the first configuration needs,
 * since the update it runs in has not committed its own new files yet. Those
 * are also returned as `untracked`, so the caller can tell them apart.
 */
export function readRepository(root, { untracked = false } = {}) {
  const sizes = new Map();
  const staged = git(root, ['ls-files', '-z', '--stage'])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return [line.slice(tab + 1), line.slice(0, tab).split(' ')[1]];
    })
    .filter(([, object]) => object && !/^0+$/.test(object));
  if (staged.length) {
    const reported = execFileSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
      cwd: root,
      input: `${staged.map(([, object]) => object).join('\n')}\n`,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
      .trim()
      .split('\n');
    staged.forEach(([file], i) => sizes.set(file, Number(reported[i]) || 0));
  }
  const fresh = [];
  if (untracked)
    for (const f of git(root, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter(Boolean))
      try {
        sizes.set(f, statSync(join(root, f)).size);
        fresh.push(f);
      } catch {
        // Gone between listing and reading.
      }
  // The repository's own .gitignore files only: --exclude-standard would also
  // apply .git/info/exclude and a developer's global excludes file, so a
  // personal rule would fail the check locally and nowhere else.
  const ignored = git(root, ['ls-files', '-z', '-ci', '--exclude-per-directory=.gitignore'])
    .split('\0')
    .filter((f) => f && sizes.has(f));
  return { files: [...sizes.keys()], ignored, untracked: fresh, sizeOf: (f) => sizes.get(f) ?? 0 };
}

export function main(root = process.cwd()) {
  try {
    root = git(root, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    console.error('Repository layout: not inside a git repository.');
    return 1;
  }
  let layout;
  try {
    layout = JSON.parse(readFileSync(join(root, CONFIG), 'utf8'));
  } catch (error) {
    console.error(`Repository layout: cannot read ${CONFIG} (${error.code ?? error.message}).`);
    console.error('The B1 update that installs this check writes it; see repository-layout.md in the CLI knowledge.');
    return 1;
  }
  const repository = readRepository(root);
  const problems = checkLayout({ ...repository, layout });
  if (problems.length === 0) {
    console.log(`Repository layout: OK (${repository.files.length} tracked files).`);
    return 0;
  }
  console.error(`Repository layout: ${problems.length} problem(s).\n`);
  for (const p of problems) console.error(`- ${p}`);
  console.error(
    '\nWhy this check exists: node_modules/@buildone/swat-cli/knowledge/architecture_info/repository-layout.md'
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
