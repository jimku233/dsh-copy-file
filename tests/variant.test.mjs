/**
 * The two packages must stay the same code with one constant flipped.
 *
 * A browser bundle cannot import across packages, so `icon/lib/` is a copy. If
 * it drifts, users of one variant silently get different behaviour from the
 * other — this test is the guard.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { FILES, variantOf } from '../scripts/variant.mjs';

/**
 * Read one file from a package's `lib/`.
 * @param {string} dir - `lib` or `icon/lib`.
 * @param {string} name - file name.
 * @returns {string} contents.
 */
function read(dir, name) {
  return readFileSync(new URL(`../${dir}/${name}`, import.meta.url), 'utf8');
}

test('icon/lib is the root lib with the look flipped', () => {
  for (const name of FILES) {
    assert.equal(read('icon/lib', name), variantOf(name, read('lib', name)), `icon/lib/${name} is stale`);
  }
});

test('the two packages differ in exactly two places', () => {
  const root = read('lib', 'client.js');
  const icon = read('icon/lib', 'client.js');
  assert.ok(root.includes("const DEFAULT_PRESENTATION = 'menu';"));
  assert.ok(icon.includes("const DEFAULT_PRESENTATION = 'icon';"));
  assert.ok(root.includes("  id: 'dsh-copy-file',"));
  assert.ok(icon.includes("  id: 'dsh-copy-file-icon',"));
  assert.equal(
    root.replace("const DEFAULT_PRESENTATION = 'menu';", "const DEFAULT_PRESENTATION = 'icon';")
      .replace("  id: 'dsh-copy-file',", "  id: 'dsh-copy-file-icon',"),
    icon,
  );
});

test('each package declares its own identity', () => {
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const icon = JSON.parse(readFileSync(new URL('../icon/package.json', import.meta.url), 'utf8'));
  assert.equal(root.name, 'dsh-copy-file');
  assert.equal(icon.name, 'dsh-copy-file-icon');
  assert.equal(root.version, icon.version, 'the two packages version together');
  assert.equal(root.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(icon.dsh.bundle.patch, './cordis.patch.yml');
  const rootPatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const iconPatch = readFileSync(new URL('../icon/cordis.patch.yml', import.meta.url), 'utf8');
  assert.ok(rootPatch.includes('name: dsh-copy-file'));
  assert.ok(!rootPatch.includes('dsh-copy-file-icon'));
  assert.ok(iconPatch.includes('name: dsh-copy-file-icon'));
  assert.ok(iconPatch.includes('presentation: icon'));
});
