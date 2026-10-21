/**
 * Real-clipboard tests for the file writer. These touch the machine clipboard
 * on purpose: the whole point is proving the shell holds a CF_HDROP file list
 * (not text), so they read it back through the same platform API.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { copyFiles, readClipboardFiles, readClipboardFormats } from '../lib/clipboard.mjs';

const windowsOnly = process.platform !== 'win32';

/**
 * Whether this process may spawn the clipboard child at all. A confined sandbox
 * blocks piped child processes with EPERM, which is an environment limit rather
 * than a defect, so the suite reports skipped instead of failed there.
 * @returns {boolean} true when a child process cannot be started.
 */
const spawnBlocked = (() => {
  if (windowsOnly) return false;
  try {
    // Same piped stdio the clipboard writer uses: a confined sandbox denies the
    // pipe itself, so probing with `stdio: 'ignore'` would wrongly succeed.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8' });
    return false;
  } catch (error) {
    return error?.code === 'EPERM' || /spawn/i.test(String(error?.message ?? ''));
  }
})();

const skip = windowsOnly ? 'windows only' : spawnBlocked ? 'this sandbox blocks child processes' : false;

/**
 * Build a scratch directory with awkward names.
 * @returns {Promise<{ root: string, files: string[] }>}
 */
async function scratch() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-copy-file-test-'));
  const files = [
    path.join(root, 'plain-name.txt'),
    path.join(root, '中文 名称（带空格）02.md'),
    path.join(root, "single ' quote & ampersand.txt"),
  ];
  for (const file of files) await writeFile(file, `content of ${path.basename(file)}\n`, 'utf8');
  return { root, files };
}

test('copies several files as a real file list (CF_HDROP)', { skip }, async () => {
  const { root, files } = await scratch();
  try {
    const result = await copyFiles(files);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.count, files.length);

    const formats = await readClipboardFormats();
    assert.ok(formats.includes('FileDrop'), `missing FileDrop in ${formats.join(',')}`);

    const back = await readClipboardFiles();
    assert.deepEqual(back.map((value) => value.toLowerCase()).sort(), files.map((value) => value.toLowerCase()).sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps a single Chinese file name intact', { skip }, async () => {
  const { root, files } = await scratch();
  try {
    const single = files[1];
    assert.ok(single !== undefined);
    const result = await copyFiles([single]);
    assert.equal(result.ok, true, JSON.stringify(result));
    const back = await readClipboardFiles();
    assert.equal(back.length, 1);
    assert.equal(path.basename(back[0]).normalize('NFC'), path.basename(single).normalize('NFC'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handles a path close to the legacy 260-character limit', { skip }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-copy-file-long-'));
  try {
    let dir = root;
    let index = 0;
    while (dir.length < 205) {
      index += 1;
      dir = path.join(dir, `segment-${String(index).padStart(2, '0')}-${'x'.repeat(8)}`);
      await mkdir(dir, { recursive: true });
    }
    const file = path.join(dir, `${'长'.repeat(6)}.md`);
    await writeFile(file, 'long path payload\n', 'utf8');
    assert.ok(file.length > 220, `expected a long path, got ${file.length}`);

    const result = await copyFiles([file]);
    assert.equal(result.ok, true, JSON.stringify(result));
    const back = await readClipboardFiles();
    assert.equal(back.length, 1);
    assert.equal(back[0].toLowerCase(), file.toLowerCase());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports a missing file without touching the clipboard', { skip }, async () => {
  const result = await copyFiles([path.join(tmpdir(), 'dsh-copy-file-definitely-missing', 'nope.txt')]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'file-missing');
});

test('reports a directory as not-a-file', { skip }, async () => {
  const result = await copyFiles([tmpdir()]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-a-file');
});

test('reports an empty list', async () => {
  const result = await copyFiles([]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty');
});
