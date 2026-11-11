#!/usr/bin/env node
// Fails on a native file in a web app build. The job installs for its runner's platform only, so
// a native file would be the runner's, and wrong in an image for Alpine or the other architecture.
// Nothing would fail until something loaded it. `.node` was the only form checked at first; a
// traced shared library or prebuilt executable breaks the same way, and need not have a telling
// name, so files are also recognised by their first bytes.
//
// A tag from before @nuxt/image was removed (B1-1493) still builds `sharp` into `.output`. Its
// image has always had that file, and whoever rebuilds the tag cannot change it, so that is a
// warning rather than a failure.
//
// `b1 update` owns the copy in an application repository. In Vanguard, the tests of migration
// B1-1501-publish-workflow-fixes run this and keep the copies alike.
/* global Buffer, console, process */
import fs from 'node:fs';
import path from 'node:path';

const NATIVE_NAME = /(\.node|\.so(\.\d+)*|\.dylib)$/;
const NATIVE_MAGIC = new Set(['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe']);

function hasNativeMagic(file) {
  const bytes = Buffer.alloc(4);
  const descriptor = fs.openSync(file, 'r');
  try {
    fs.readSync(descriptor, bytes, 0, 4, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return NATIVE_MAGIC.has(bytes.toString('hex'));
}

function findNativeFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findNativeFiles(file));
    else if (entry.isFile() && (NATIVE_NAME.test(entry.name) || hasNativeMagic(file))) found.push(file);
  }
  return found;
}

function predatesRemoval(manifest) {
  if (!fs.existsSync(manifest)) return false;
  const { dependencies = {}, devDependencies = {} } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return '@nuxt/image' in dependencies || '@nuxt/image' in devDependencies;
}

const directory = process.argv[2] ?? 'src/web-app/.output';
if (!fs.existsSync(directory)) {
  console.log(`::error::${directory} does not exist, so the build has not run.`);
  process.exit(1);
}
const native = findNativeFiles(directory);
if (native.length === 0) {
  console.log(`${directory} has no native files.`);
  process.exit(0);
}
console.log(native.join('\n'));
if (predatesRemoval(path.join(path.dirname(directory), 'package.json'))) {
  console.log(
    '::warning::This version depends on @nuxt/image, so its build has native files for this runner only, as it always had. Its resized images may not work.'
  );
  process.exit(0);
}
console.log(
  '::error::The web app build has native files, built for this runner only. If the image needs them, set current-platform-only to false in this job, and check they work on Alpine and arm64.'
);
process.exit(1);
