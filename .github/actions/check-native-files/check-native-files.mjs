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
// A symlink to a file is followed, since a link to a native file is as wrong in the image as the
// file, and `cafebabe` counts only with a Mach-O fat header behind it: a Java class file starts
// with the same four bytes (B1-1614).
//
// `b1 update` owns the copy in an application repository. In Vanguard, the tests of migration
// B1-1501-publish-workflow-fixes run this and keep the copies alike.
/* global Buffer, console, process */
import fs from 'node:fs';
import path from 'node:path';

const NATIVE_NAME = /(\.node|\.so(\.\d+)*|\.dylib)$/;
const NATIVE_MAGIC = new Set(['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe']);
// A Mach-O fat binary (`cafebabf` is the 64-bit form) and a Java class file share their first four
// bytes. Bytes 4–7 tell them apart: a fat header's architecture count is small, a class file's
// version is at least 45 (major 45 is Java 1.0, minor 0).
const FAT_MAGIC = new Set(['cafebabe', 'cafebabf']);
const MAX_FAT_ARCHS = 30;

function hasNativeMagic(file) {
  const bytes = Buffer.alloc(8);
  const descriptor = fs.openSync(file, 'r');
  let read;
  try {
    read = fs.readSync(descriptor, bytes, 0, 8, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const magic = bytes.subarray(0, 4).toString('hex');
  if (NATIVE_MAGIC.has(magic)) return true;
  if (!FAT_MAGIC.has(magic) || read < 8) return false;
  const archs = bytes.readUInt32BE(4);
  return archs > 0 && archs <= MAX_FAT_ARCHS;
}

// `entry.isFile()` is false for a symlink, so a link to a file is judged by its name and its
// target's bytes. A link whose target is missing is judged by its name alone. A link to a directory
// is not walked: one inside the output is walked as itself, and one outside it brings nothing into
// the image, which copies the link and not the tree behind it. So no loop is possible either.
function findNativeFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    let stats = entry;
    if (entry.isSymbolicLink()) {
      try {
        stats = fs.statSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ELOOP') throw error;
        if (NATIVE_NAME.test(entry.name)) found.push(file);
        continue;
      }
    }
    if (stats.isDirectory() && !entry.isSymbolicLink()) found.push(...findNativeFiles(file));
    else if (stats.isFile() && (NATIVE_NAME.test(entry.name) || hasNativeMagic(file))) found.push(file);
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
let native;
try {
  native = findNativeFiles(directory);
} catch (error) {
  // A file the check cannot read is one it cannot vouch for.
  console.log(`::error::Could not check ${error.path ?? directory} for native files: ${error.code ?? error.message}.`);
  process.exit(1);
}
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
