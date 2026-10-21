/**
 * Regenerate `lib/client.js` from the installed upstream browser bundle.
 *
 * The delivery card's action menu has no menu-item extension slot, so the only
 * non-invasive way to put rows *inside* it is to mount the same browser surface
 * with a few additive hunks. This script is the reproducible part: it reads the
 * upstream `ui-open-in-app/lib/client.js` that DSH actually ships, asserts the
 * anchors it edits still exist exactly once, splices in `src/copy-ui.js`, and
 * writes the vendored bundle. `lib/client.js` is generated, never hand-edited.
 *
 * Usage:
 *   node scripts/vendor-client.mjs            # regenerate from the installed DSH
 *   node scripts/vendor-client.mjs --check    # verify lib/client.js is current
 *   node scripts/vendor-client.mjs --upstream <path/to/client.js>
 *
 * @module dsh-copy-file/scripts/vendor-client
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM_PACKAGE = '@deepseek-ai/dsh-client-ui-open-in-app';
const UPSTREAM_RELATIVE = path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-open-in-app', 'lib', 'client.js');
const SUPPORTED_VERSION = '0.2.0-rc.2';
const OUTPUT = path.join(ROOT, 'lib', 'client.js');
const FRAGMENT = path.join(ROOT, 'src', 'copy-ui.js');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const force = args.includes('--force');
const upstreamArg = args.indexOf('--upstream') === -1 ? undefined : args[args.indexOf('--upstream') + 1];

/**
 * Ask npm where global packages live.
 * @returns {string[]} candidate `node_modules` roots, best first.
 */
function globalRoots() {
  const roots = [];
  try {
    const out = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
    for (const line of out.split(/\r?\n/)) if (line.trim() !== '') roots.push(line.trim());
  } catch {
    /* npm may be absent; keep the static fallbacks */
  }
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  if (process.env.DSH_HOME) roots.push(path.join(process.env.DSH_HOME));
  return roots;
}

/**
 * Locate the upstream bundle.
 * @returns {{bundle: string, version: string}} absolute client.js path and the owning version.
 */
function findUpstream() {
  const candidates = [];
  if (upstreamArg !== undefined) candidates.push(path.resolve(upstreamArg));
  if (process.env.DSH_COPY_FILE_UPSTREAM) candidates.push(path.resolve(process.env.DSH_COPY_FILE_UPSTREAM));
  for (const root of globalRoots()) {
    candidates.push(path.join(root, '@deepseek-ai', 'dsh', UPSTREAM_RELATIVE));
    candidates.push(path.join(root, UPSTREAM_RELATIVE));
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const manifestPath = path.join(candidate, '..', '..', 'package.json');
    let version = 'unknown';
    try {
      version = JSON.parse(readFileSync(manifestPath, 'utf8')).version ?? 'unknown';
    } catch {
      /* keep unknown */
    }
    return { bundle: candidate, version };
  }
  throw new Error(
    `Could not find ${UPSTREAM_PACKAGE}/lib/client.js. Pass --upstream <path> or set DSH_COPY_FILE_UPSTREAM.\nTried:\n${candidates.join('\n')}`,
  );
}

/**
 * One exact-text edit. Every anchor must match exactly once, so an upstream
 * change fails loudly instead of producing a half-patched bundle.
 * @param {string} source - upstream bundle text.
 * @param {string} find - literal anchor.
 * @param {string} replace - replacement text (may contain the anchor).
 * @param {string} label - human name for diagnostics.
 * @returns {string} the edited text.
 */
function splice(source, find, replace, label) {
  const first = source.indexOf(find);
  if (first === -1) throw new Error(`Anchor not found: ${label}`);
  if (source.indexOf(find, first + 1) !== -1) throw new Error(`Anchor is not unique: ${label}`);
  return source.slice(0, first) + replace + source.slice(first + find.length);
}

/**
 * Replace a whole function body from its declaration to the next region marker.
 * @param {string} source - bundle text.
 * @param {string} declaration - function header.
 * @param {string} replacement - full replacement text.
 * @param {string} label - human name for diagnostics.
 * @returns {string} the edited text.
 */
function replaceFunction(source, declaration, replacement, label) {
  const start = source.indexOf(declaration);
  if (start === -1) throw new Error(`Function not found: ${label}`);
  const end = source.indexOf('\n\t\t}\n\t\t//#endregion', start);
  if (end === -1) throw new Error(`Function end not found: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end + '\n\t\t}'.length);
}

const ZERO_WIDTH = '\u200b'; // never used; keeps the file free of invisible edits

/**
 * Locale keys added to both dictionaries.
 * @param {string} indent - one entry's leading whitespace.
 * @returns {string} YAML-free JavaScript object members.
 */
function localeBlock(indent) {
  const zh = [
    ['copy.file', '复制文件'],
    ['copy.all', '复制全部 {count} 个文件'],
    ['copy.path', '复制文件路径'],
    ['copy.done', '已复制「{name}」，可直接粘贴'],
    ['copy.doneAll', '已复制 {count} 个文件'],
    ['copy.donePath', '已复制文件路径'],
    ['copy.degraded', '无法复制文件（{reason}），已改为复制路径'],
    ['copy.failed', '复制失败，请重试'],
    ['copy.reason.unknown', '未知原因'],
    ['copy.reason.empty', '没有可复制的文件'],
    ['copy.reason.too-many-files', '文件过多'],
    ['copy.reason.file-missing', '文件已不存在'],
    ['copy.reason.not-a-file', '目标不是文件'],
    ['copy.reason.clipboard-busy', '系统剪贴板被占用'],
    ['copy.reason.verify-failed', '系统未接受文件列表'],
    ['copy.reason.clipboard-error', '系统剪贴板调用失败'],
    ['copy.reason.timeout', '本地助手超时'],
    ['copy.reason.unsupported-platform', '当前系统暂不支持'],
    ['copy.reason.tool-missing', '缺少系统工具'],
    ['copy.reason.no-such-file', '会话中找不到该文件'],
    ['copy.reason.file-unavailable', '文件已不可用'],
    ['copy.reason.unmapped-path', '路径不属于本机可访问范围'],
    ['copy.reason.not-a-delivery', '不是交付文件'],
    ['copy.reason.bad-coordinates', '卡片坐标无效'],
    ['copy.reason.host-error', '本地宿主出错'],
    ['copy.dragHint', '拖到文件夹窗口才能复制；也可以选中后按 Ctrl+C'],
    ['copy.dragUnsupported', '此浏览器不支持把文件拖出，请用 Ctrl+C 或菜单里的「复制文件」'],
  ];
  return zh.map(([key, value]) => `${indent}"${key}": ${JSON.stringify(value)},`).join('\n');
}

/** English dictionary, key-identical. */
function localeBlockEn(indent) {
  const en = [
    ['copy.file', 'Copy file'],
    ['copy.all', 'Copy all {count} files'],
    ['copy.path', 'Copy file path'],
    ['copy.done', 'Copied "{name}" — ready to paste'],
    ['copy.doneAll', 'Copied {count} files'],
    ['copy.donePath', 'File path copied'],
    ['copy.degraded', 'Could not copy the file ({reason}); copied its path instead'],
    ['copy.failed', 'Copy failed. Try again.'],
    ['copy.reason.unknown', 'unknown reason'],
    ['copy.reason.empty', 'no files to copy'],
    ['copy.reason.too-many-files', 'too many files'],
    ['copy.reason.file-missing', 'file is gone'],
    ['copy.reason.not-a-file', 'not a regular file'],
    ['copy.reason.clipboard-busy', 'clipboard is busy'],
    ['copy.reason.verify-failed', 'the system rejected the file list'],
    ['copy.reason.clipboard-error', 'clipboard call failed'],
    ['copy.reason.timeout', 'helper timed out'],
    ['copy.reason.unsupported-platform', 'not supported on this system'],
    ['copy.reason.tool-missing', 'a system tool is missing'],
    ['copy.reason.no-such-file', 'not found in this Session'],
    ['copy.reason.file-unavailable', 'file is no longer available'],
    ['copy.reason.unmapped-path', 'path is outside the Host filesystem'],
    ['copy.reason.not-a-delivery', 'not a delivery declaration'],
    ['copy.reason.bad-coordinates', 'invalid card coordinates'],
    ['copy.reason.host-error', 'Host error'],
    ['copy.dragHint', 'Drop on a folder window to copy, or select the card and press Ctrl+C'],
    ['copy.dragUnsupported', 'This browser cannot drag files out; use Ctrl+C or the Copy file menu row'],
  ];
  return en.map(([key, value]) => `${indent}"${key}": ${JSON.stringify(value)},`).join('\n');
}

const FILE_ROUTE_ACTION = `\t\tfunction FileRouteAction(props) {
\t\t\tconst association = useFileApplications(props.actionUrl, queryRoute, props.available);
\t\t\tconst delivery = useDeliveryCard(props.actionUrl, props.available, props.t);
\t\t\tif (!props.available) return null;
\t\t\treturn (0, react_jsx_runtime.jsx)("div", {
\t\t\t\tref: delivery.anchorRef,
\t\t\t\tstyle: { display: "contents" },
\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(OpenTargetButton, {
\t\t\t\t\tkind: "file",
\t\t\t\t\tapplications: association.apps,
\t\t\t\t\tdefaultId: association.apps.find((app) => app.default)?.id,
\t\t\t\t\tfailed: association.failed,
\t\t\t\t\tloading: association.loading,
\t\t\t\t\tbusy: props.pending,
\t\t\t\t\trefresh: () => {
\t\t\t\t\t\tassociation.refresh?.();
\t\t\t\t\t\tvoid delivery.probe();
\t\t\t\t\t},
\t\t\t\t\tt: props.t,
\t\t\t\t\tcopy: delivery.controller,
\t\t\t\t\texecute: async (operation) => {
\t\t\t\t\t\treturn props.onAction(operation.kind === "reveal" ? "reveal" : "open", operation.kind === "application" ? operation.id : void 0);
\t\t\t\t\t}
\t\t\t\t}, props.actionUrl)
\t\t\t}, props.actionUrl);
\t\t}`;

/**
 * Build the vendored bundle text.
 * @param {string} upstream - upstream bundle text.
 * @returns {string} the vendored bundle.
 */
function build(upstream) {
  const fragment = readFileSync(FRAGMENT, 'utf8');
  let source = upstream;

  source = splice(source, 'id: "@deepseek-ai/dsh-client-ui-open-in-app",', 'id: "dsh-copy-file",', 'module id');

  // A separate locale namespace keeps a hot swap from double-registering the
  // shipped dictionary while the old row is being torn down.
  source = splice(source, 'const NS = "open-in-app";', 'const NS = "open-in-app-copy";', 'locale namespace');

  // Distinct occupant ids for the same slots, for the same reason.
  source = source.replaceAll('\t\t\t\tid: "open-in-app",', '\t\t\t\tid: "copy-file",');

  source = splice(
    source,
    '"path.revealError": "无法显示文件位置，请重试",',
    `"path.revealError": "无法显示文件位置，请重试",\n${localeBlock('\t\t\t')}`,
    'zh dictionary',
  );
  source = splice(
    source,
    '"path.revealError": "Could not show the file location. Try again.",',
    `"path.revealError": "Could not show the file location. Try again.",\n${localeBlockEn('\t\t\t')}`,
    'en dictionary',
  );

  // The gesture hook and the menu rows: only the delivery card passes `copy`.
  source = splice(
    source,
    'const { pending, toast, act } = useOpenTargetGesture(props.execute, t);',
    'const { pending, toast, act } = useOpenTargetGesture(props.execute, t);\n\t\t\tconst copy = useCopyGesture(props.copy, t);',
    'OpenTargetButton gesture hook',
  );
  source = splice(
    source,
    'items: [...applications.map((app) => ({',
    'items: [...copy.items, ...applications.map((app) => ({',
    'OpenTargetButton menu items',
  );
  source = splice(
    source,
    'run(id === "reveal" ? { kind: "reveal" } : {',
    'if (copy.onSelect(id)) return;\n\t\t\t\t\trun(id === "reveal" ? { kind: "reveal" } : {',
    'OpenTargetButton select handler',
  );
  source = splice(source, '}), toast] });', '}), toast, copy.toast] });', 'OpenTargetButton toast slot');

  source = replaceFunction(source, 'function FileRouteAction(props) {', FILE_ROUTE_ACTION, 'FileRouteAction');

  // The fragment runs inside this factory, right before the plugin body.
  source = splice(source, '\t\t//#region lib/types/client/index.js', `${fragment}\n\t\t//#region lib/types/client/index.js`, 'plugin body');

  return `// GENERATED by scripts/vendor-client.mjs — do not edit.
// Source: ${UPSTREAM_PACKAGE}@${SUPPORTED_VERSION} lib/client.js (MIT, see NOTICE).
// Additive hunks: menu rows, card interaction, locale keys. All original
// behavior is preserved; see src/copy-ui.js for the added code.
${source}`;
}

const { bundle, version } = findUpstream();
if (version !== SUPPORTED_VERSION && !force) {
  throw new Error(
    `Upstream ${UPSTREAM_PACKAGE}@${version} is not the supported ${SUPPORTED_VERSION}.\n` +
    'This skill pins one DSH release. Re-vendor deliberately after reviewing the new bundle, then bump SUPPORTED_VERSION.\n' +
    'Use --force to generate anyway.',
  );
}

const next = build(readFileSync(bundle, 'utf8'));
if (checkOnly) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (current !== next) {
    console.error('lib/client.js is stale. Run: node scripts/vendor-client.mjs');
    process.exit(1);
  }
  console.log('lib/client.js is current.');
  process.exit(0);
}

writeFileSync(OUTPUT, next, 'utf8');
console.log(`Vendored ${UPSTREAM_PACKAGE}@${version} -> ${path.relative(ROOT, OUTPUT)} (${next.length} bytes)`);
