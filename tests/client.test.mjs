/**
 * Load the browser half in Node with a stub module table and run its plugin
 * body. This catches syntax errors, missing locals, and a wrong slot list before
 * anything touches a real page.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');

/**
 * Minimal stand-in for the browser module table.
 * @returns {(name: string) => object} the require function.
 */
function moduleTable() {
  const react = {
    createElement: (type, props) => ({ type, props }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
  };
  const primitives = new Proxy(
    { writeClipboard: async () => true },
    { get: (target, key) => (key in target ? target[key] : () => null) },
  );
  const table = { react, '@deepseek-ai/dsh-client-ui-primitives': primitives };
  return (name) => {
    if (!(name in table)) throw new Error(`unexpected module request: ${name}`);
    return table[name];
  };
}

/**
 * Evaluate the bundle and return its module entry.
 * @returns {{id: string, factory: Function}} the registered entry.
 */
function loadEntry() {
  let entry;
  new Function('window', 'document', source)({ __ModuleLoader__: { load: (value) => { entry = value; } } }, undefined);
  assert.ok(entry, 'the bundle must call __ModuleLoader__.load');
  return entry;
}

/**
 * A context that records slot and locale registrations.
 * @returns {{ctx: object, slots: object[], locales: object[]}} recording context.
 */
function recordingContext() {
  const slots = [];
  const locales = [];
  const ctx = {
    effect: (run) => { const cleanup = run(); return typeof cleanup === 'function' ? cleanup : () => {}; },
    locale: {
      register: (namespace, dictionaries) => { locales.push({ namespace, dictionaries }); return () => {}; },
      bind: () => (name) => name,
    },
    slots: {
      inject: (_name, run) => run(),
      register: (spec) => { slots.push(spec); return () => {}; },
    },
  };
  return { ctx, slots, locales };
}

test('the bundle registers one module named after the package', () => {
  const entry = loadEntry();
  assert.equal(entry.id, 'dsh-copy-file');
  assert.equal(typeof entry.factory, 'function');
  const module = entry.factory(moduleTable());
  assert.equal(typeof module.apply, 'function');
  assert.deepEqual(module.inject, ['slots', 'locale']);
});

test('apply adds one occupant per delivery slot and never replaces a row', () => {
  const module = loadEntry().factory(moduleTable());
  const { ctx, slots } = recordingContext();
  module.apply(ctx, { presentation: 'icon' });

  assert.deepEqual(slots.map((spec) => spec.name), [
    'deliverables.file.actions',
    'deliverables.review.file.actions',
  ]);
  for (const spec of slots) {
    assert.equal(spec.id, 'copy-file', 'a distinct occupant id keeps the shipped action in place');
    assert.equal(spec.locale, 'copy-file');
    assert.deepEqual(spec.inject(), { presentation: 'icon' });
  }
});

test('the presentation comes from the row config and falls back to the chevron look', () => {
  const module = loadEntry().factory(moduleTable());
  const icon = recordingContext();
  module.apply(icon.ctx, { presentation: 'icon' });
  assert.deepEqual(icon.slots[0].inject(), { presentation: 'icon' });

  const fallback = recordingContext();
  module.apply(fallback.ctx, undefined);
  assert.deepEqual(fallback.slots[0].inject(), { presentation: 'menu' });
});

test('the dictionaries ship the copy keys under their own namespace', () => {
  const module = loadEntry().factory(moduleTable());
  const { ctx, locales } = recordingContext();
  module.apply(ctx, { presentation: 'icon' });

  assert.equal(locales.length, 1);
  const [{ namespace, dictionaries }] = locales;
  assert.equal(namespace, 'copy-file');
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort());
  for (const key of ['copy.button', 'copy.more', 'copy.file', 'copy.path', 'copy.all', 'copy.failed', 'copy.reason.file-missing']) {
    assert.ok(key in dictionaries.zh, `${key} must be translated`);
    assert.ok(key in dictionaries.en, `${key} must be translated`);
  }
});

test('the bundle no longer carries the upstream package', () => {
  assert.ok(source.includes('function useDeliveryCard'), 'sanity: the ported controller stays ours');
  assert.ok(!source.includes('dsh-client-ui-open-in-app'), 'the upstream module must not be vendored');
  assert.ok(!patch.includes('disabled: true'), 'the shipped ui-open-in-app row must stay enabled');
  assert.ok(patch.includes('presentation: menu'), 'the default presentation lives in the patch');
});
