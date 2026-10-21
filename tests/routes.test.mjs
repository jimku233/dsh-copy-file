import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../lib/index.js';

function host({ statThrows = false } = {}) {
  const routes = new Map();
  const ctx = {
    connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {}; } } },
    sandboxPolicy: { workspaceRoot: 'D:\\ws' },
    sessionQuery: {
      readEvent: async () => ({ session: { cwd: 'D:\\ws' }, target: { type: 'deliverables/presented', data: { turn: 1, callId: 'c', files: [{ path: 'report.md' }] } } }),
    },
    workspaceFiles: {
      stat: async () => { if (statThrows) throw new Error('workspace-file/not-found'); return { absolutePath: 'D:\\ws\\report.md' }; },
    },
    fs: { processPathFromHostPath: (v) => v, processPath: (v) => v, resolve: async (v) => v },
  };
  apply(ctx);
  return routes;
}

test('registers the four authenticated routes', () => {
  const routes = host();
  assert.deepEqual([...routes.keys()].sort(), ['/api/copy.file', '/api/copy.path', '/api/copy.probe', '/api/copy.raw']);
  assert.deepEqual(routes.get('/api/copy.file').methods, ['POST']);
});

test('copy.path answers the declared path even when the file is gone', async () => {
  const routes = host({ statThrows: true });
  const response = await routes.get('/api/copy.path').fetch(new Request('http://host/api/copy.path?sessionId=s1&seq=7&index=0'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, path: 'D:\\ws\\report.md' });
});

test('copy.file reports the clipboard-facing reason when the file is gone', async () => {
  const routes = host({ statThrows: true });
  const response = await routes.get('/api/copy.file').fetch(new Request('http://host/api/copy.file?sessionId=s1&seq=7&index=0', { method: 'POST' }));
  // A refused file is a 404 that still carries the reason the browser degrades on.
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'file-unavailable');
});

test('probe reports the declared file count without reading content', async () => {
  const routes = host();
  const response = await routes.get('/api/copy.probe').fetch(new Request('http://host/api/copy.probe?sessionId=s1&seq=7&index=0'));
  assert.equal((await response.json()).count, 1);
});

test('bad coordinates are refused before any resolution', async () => {
  const routes = host();
  const response = await routes.get('/api/copy.file').fetch(new Request('http://host/api/copy.file?seq=7', { method: 'POST' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'bad-coordinates');
});

