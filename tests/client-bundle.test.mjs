/**
 * Load the generated browser bundle in Node with a stub module table and run
 * its plugin body. This catches syntax errors, missing locals, and a broken
 * slot registration list before anything touches a real page.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/**
 * Minimal stand-in for the browser module table.
 * @returns {(name: string) => object} the require function.
 */
function moduleTable() {
  const react = {
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol('Fragment') };
  const store = { createSnapshotStore: (initial) => ({ getSnapshot: () => initial ?? null, set: () => {}, subscribe: () => () => {} }) };
  const primitives = new Proxy(
    { writeClipboard: async () => true },
    { get: (target, key) => (key in target ? target[key] : () => null) },
  );
  const table = {
    react,
    'react/jsx-runtime': jsxRuntime,
    '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  };
  return (name) => {
    if (!(name in table)) throw new Error(`unexpected module request: ${name}`);
    return table[name];
  };
}

test('the generated bundle registers one module and exports the plugin body', () => {
  let entry;
  const fakeWindow = { __ModuleLoader__: { load: (value) => { entry = value; } } };
  new Function('window', 'document', source)(fakeWindow, undefined);
  assert.equal(entry.id, 'dsh-copy-file');
  assert.equal(typeof entry.factory, 'function');
  const module = entry.factory(moduleTable());
  assert.equal(typeof module.apply, 'function');
  assert.ok(Array.isArray(module.inject));
});

test('the plugin body registers the six shipped slots plus the copy menu path', () => {
  let entry;
  new Function('window', 'document', source)({ __ModuleLoader__: { load: (value) => { entry = value; } } }, undefined);
  const module = entry.factory(moduleTable());
  const slots = [];
  const locales = [];
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return { ok: false, status: 404, json: async () => ({}) };
  };
  globalThis.location = { href: 'http://127.0.0.1:3080/' };
  const anyFn = new Proxy(function () { return anyFn; }, { get: () => anyFn, apply: () => anyFn });
  const ctx = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'slots') {
        return {
          inject: (_name, run) => run(),
          register: (spec) => { slots.push(spec.name); return () => {}; },
        };
      }
      if (key === 'locale') {
        return {
          register: (namespace, dictionaries) => { locales.push({ namespace, keys: Object.keys(dictionaries.zh) }); return () => {}; },
          bind: () => (name) => name,
        };
      }
      if (key === 'effect') return (run) => { run(); return () => {}; };
      if (key === 'remote') return { session: {} };
      if (key === 'sessions') return { get: () => undefined, subscribe: () => () => {} };
      return anyFn;
    },
  });
  module.apply(ctx);

  assert.deepEqual([...slots].sort(), [
    'conversation.session.header.utilities',
    'deliverables.file.actions',
    'deliverables.review.file.actions',
    'sidebar.right.tab.document.actions',
    'sidebar.right.tab.document.unpreviewable',
    'sidebar.right.tab.files.actions',
  ]);
  assert.equal(locales[0].namespace, 'open-in-app-copy');
  assert.ok(locales[0].keys.includes('copy.file'));
  assert.ok(locales[0].keys.includes('copy.reason.file-missing'));
  assert.ok(locales[0].keys.includes('path.reveal'), 'shipped keys must survive');
});
