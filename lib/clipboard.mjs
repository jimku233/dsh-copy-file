/**
 * File-clipboard writer.
 *
 * The browser Clipboard API cannot put a *file list* on the OS clipboard
 * (there is no CF_HDROP / `text/uri-list`-of-files write path reachable from
 * page script), so this module performs the write in the Host process instead:
 *
 * - Windows: one short-lived `powershell.exe -STA` child that calls
 *   `System.Windows.Forms.Clipboard.SetFileDropList`, then reads the list back
 *   and compares it, so "ok" means the shell really holds those paths.
 * - macOS: `osascript` + `NSPasteboard` (best effort, not verified).
 * - Linux: `wl-copy` or `xclip` with `text/uri-list` (best effort, not verified).
 *
 * Paths never travel through a command line: they are handed to the child as a
 * UTF-8 JSON file and the child's output is ASCII only, which keeps Chinese
 * names, spaces, quotes, and very long paths intact on every Windows code page.
 *
 * @module dsh-copy-file/clipboard
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Default budget for one clipboard write. */
const TIMEOUT_MS = 8_000;
/** Upper bound on files in one clipboard write (`present` allows 8 by default). */
const MAX_FILES = 32;

/**
 * Reasons reported to the caller. The browser maps these to localized copy, so
 * this list is part of the public wire contract.
 */
export const COPY_REASONS = Object.freeze([
  'empty',
  'too-many-files',
  'file-missing',
  'not-a-file',
  'clipboard-busy',
  'verify-failed',
  'clipboard-error',
  'timeout',
  'unsupported-platform',
  'tool-missing',
]);

/**
 * The Windows child. Reads the payload path, verifies each file exists, writes
 * the file-drop list on an STA thread, reads it back, and prints one ASCII JSON
 * line. Exit codes distinguish the failure branches for the Node side.
 *
 * Kept as a string so installation never has to ship a second file next to the
 * package and so the exact script that ran is visible here.
 */
const POWERSHELL_SCRIPT = `param([string]$Payload)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $text = [System.IO.File]::ReadAllText($Payload, $utf8)
  $parsed = $text | ConvertFrom-Json
  $items = @($parsed | ForEach-Object { $_ })
  if ($items.Count -eq 0) { '{"ok":false,"reason":"empty"}'; exit 2 }
  foreach ($item in $items) {
    if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { '{"ok":false,"reason":"file-missing"}'; exit 3 }
  }
  $collection = New-Object System.Collections.Specialized.StringCollection
  foreach ($item in $items) { [void]$collection.Add([System.IO.Path]::GetFullPath($item)) }
  try {
    [System.Windows.Forms.Clipboard]::SetFileDropList($collection)
  } catch {
    '{"ok":false,"reason":"clipboard-busy"}'; exit 4
  }
  $back = [System.Windows.Forms.Clipboard]::GetFileDropList()
  if ($back.Count -ne $items.Count) { '{"ok":false,"reason":"verify-failed"}'; exit 5 }
  '{"ok":true,"count":' + $items.Count + '}'
  exit 0
} catch {
  '{"ok":false,"reason":"clipboard-error"}'
  exit 6
}
`;

/**
 * Run one child process and collect its output without a shell.
 * @param {string} file - executable path.
 * @param {string[]} args - argument vector.
 * @param {number} timeoutMs - kill budget.
 * @returns {Promise<{ code: number|string, stdout: string, stderr: string, timedOut: boolean }>}
 */
function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : (typeof error.code === 'number' ? error.code : error.code ?? 'unknown'),
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: timedOut || error?.killed === true,
        });
      },
    );
    child.on('error', () => {});
    child.on('exit', () => {});
    // `execFile` resolves once, but a killed child reports through the callback;
    // record the timeout so the caller can distinguish it from a plain failure.
    setTimeout(() => { timedOut = true; }, timeoutMs - 1).unref();
  });
}

/** @returns {string} the Windows PowerShell 5.1 executable to run. */
function windowsPowerShell() {
  if (process.env.DSH_COPY_FILE_POWERSHELL) return process.env.DSH_COPY_FILE_POWERSHELL;
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Read the last JSON object printed by a child.
 * @param {string} stdout - captured standard output.
 * @returns {{ok: boolean, count?: number, reason?: string}|null}
 */
function parseResult(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Put files on the Windows clipboard through `SetFileDropList`.
 * @param {string[]} paths - absolute file paths that already exist.
 * @param {number} timeoutMs - child budget.
 * @returns {Promise<{ok: boolean, count?: number, reason?: string, detail?: string}>}
 */
async function copyWindows(paths, timeoutMs) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-copy-file-'));
  try {
    const payload = path.join(dir, 'paths.json');
    const script = path.join(dir, 'set-file-drop.ps1');
    await writeFile(payload, JSON.stringify(paths), 'utf8');
    await writeFile(script, POWERSHELL_SCRIPT, 'utf8');
    const result = await run(
      windowsPowerShell(),
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', payload],
      timeoutMs,
    );
    const parsed = parseResult(result.stdout);
    if (parsed !== null) return parsed;
    if (result.code === 'ENOENT') return { ok: false, reason: 'tool-missing', detail: 'powershell.exe' };
    if (result.timedOut) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'clipboard-error', detail: result.stderr.trim().slice(0, 300) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Write the file list with AppleScript's `POSIX file` values.
 * @param {string[]} paths - absolute file paths.
 * @param {number} timeoutMs - child budget.
 * @returns {Promise<{ok: boolean, count?: number, reason?: string, detail?: string}>}
 */
async function copyDarwin(paths, timeoutMs) {
  const quoted = paths.map((file) => `POSIX file ${JSON.stringify(file)}`).join(', ');
  const script = paths.length === 1
    ? `set the clipboard to (${quoted})`
    : `set the clipboard to {${quoted}}`;
  const result = await run('osascript', ['-e', script], timeoutMs);
  if (result.code === 0) return { ok: true, count: paths.length };
  if (result.code === 'ENOENT') return { ok: false, reason: 'tool-missing', detail: 'osascript' };
  if (result.timedOut) return { ok: false, reason: 'timeout' };
  return { ok: false, reason: 'clipboard-error', detail: result.stderr.trim().slice(0, 300) };
}

/**
 * Write `text/uri-list` through wl-copy (Wayland) or xclip (X11).
 * @param {string[]} paths - absolute file paths.
 * @param {number} timeoutMs - child budget.
 * @returns {Promise<{ok: boolean, count?: number, reason?: string, detail?: string}>}
 */
async function copyLinux(paths, timeoutMs) {
  const payload = `${paths.map((file) => `file://${file}`).join('\r\n')}\r\n`;
  const wayland = (process.env.WAYLAND_DISPLAY ?? '') !== '';
  const [command, args] = wayland
    ? ['wl-copy', ['--type', 'text/uri-list']]
    : ['xclip', ['-selection', 'clipboard', '-t', 'text/uri-list', '-i']];
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, reason: 'timeout' }); }, timeoutMs);
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, reason: error.code === 'ENOENT' ? 'tool-missing' : 'clipboard-error', detail: command });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0 ? { ok: true, count: paths.length } : { ok: false, reason: 'clipboard-error', detail: stderr.slice(0, 300) });
    });
    child.stdin.end(payload);
  });
}

/**
 * Put files on the system clipboard.
 * @param {readonly string[]} inputPaths - absolute file paths.
 * @param {{platform?: NodeJS.Platform, timeoutMs?: number}} [options] - test seams.
 * @returns {Promise<{ok: boolean, count?: number, reason?: string, detail?: string, path?: string}>}
 */
export async function copyFiles(inputPaths, options = {}) {
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const paths = [...new Set(inputPaths.map((value) => String(value)))];
  if (paths.length === 0) return { ok: false, reason: 'empty' };
  if (paths.length > MAX_FILES) return { ok: false, reason: 'too-many-files' };
  for (const file of paths) {
    try {
      const info = await stat(file);
      if (!info.isFile()) return { ok: false, reason: 'not-a-file', path: file };
    } catch {
      return { ok: false, reason: 'file-missing', path: file };
    }
  }
  if (platform === 'win32') return copyWindows(paths, timeoutMs);
  if (platform === 'darwin') return copyDarwin(paths, timeoutMs);
  if (platform === 'linux') return copyLinux(paths, timeoutMs);
  return { ok: false, reason: 'unsupported-platform' };
}

/**
 * Run one PowerShell fragment that writes its result to a UTF-8 file, then read
 * that file. The console code page would mangle non-ASCII paths, so the child
 * never prints path text at all.
 * @param {string} body - PowerShell statements; `$out` holds the output path.
 * @param {number} timeoutMs - child budget.
 * @returns {Promise<string[]>} one entry per written line.
 */
async function readLinesThroughFile(body, timeoutMs) {
  if (process.platform !== 'win32') return [];
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-copy-file-read-'));
  const out = path.join(dir, 'out.txt');
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Windows.Forms',
    `$out = ${JSON.stringify(out)}`,
    body,
    '[System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding($false)))',
  ].join('; ');
  try {
    const result = await run(
      windowsPowerShell(),
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      timeoutMs,
    );
    if (result.code !== 0) return [];
    const text = await readFile(out, 'utf8');
    const lineFeed = String.fromCharCode(10);
    const carriageReturn = String.fromCharCode(13);
    return text
      .split(lineFeed)
      .map((line) => line.replaceAll(carriageReturn, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Read the clipboard's file list back. Windows only; used by tests and by the
 * `verify` script to prove a real file list (CF_HDROP) is present.
 * @param {number} [timeoutMs] - child budget.
 * @returns {Promise<string[]>} absolute paths currently on the clipboard.
 */
export async function readClipboardFiles(timeoutMs = TIMEOUT_MS) {
  return readLinesThroughFile('$lines = @([System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [string]$_ })', timeoutMs);
}

/**
 * Report which clipboard formats the shell currently holds. Tests use this to
 * prove `FileDrop` is present (a text copy would not list it).
 * @param {number} [timeoutMs] - child budget.
 * @returns {Promise<string[]>} format names, e.g. `['FileDrop','FileNameW']`.
 */
export async function readClipboardFormats(timeoutMs = TIMEOUT_MS) {
  return readLinesThroughFile('$data = [System.Windows.Forms.Clipboard]::GetDataObject(); $lines = @($data.GetFormats() | Where-Object { $_ } | ForEach-Object { [string]$_ })', timeoutMs);
}
