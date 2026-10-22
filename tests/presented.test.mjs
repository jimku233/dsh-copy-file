/**
 * Coordinate resolution tests. The resolver is the security boundary: every
 * browser request carries only `sessionId` + `seq` + `index`, and every refusal
 * must become the right status instead of a path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { coordinate, PresentedError, resolveDeclaredPaths, resolvePresented } from '../lib/presented.mjs';

/**
 * Build a stub host context.
 * @param {object} [options] - overrides.
 * @returns {object} the stub context.
 */
function host({
  files = [{ path: 'report.md' }, { path: '交付 文档（终稿）.md' }, { path: 'deep/notes.txt' }],
  eventType = 'deliverables/presented',
  cwd = 'D:\\ws',
  statThrows = false,
  unmapped = false,
  roundTripMismatch = false,
} = {}) {
  return {
    sandboxPolicy: { workspaceRoot: 'D:\\fallback' },
    sessionQuery: {
      readEvent: async () => ({
        session: { cwd },
        target: { type: eventType, data: { turn: 1, callId: 'call-1', files } },
      }),
    },
    workspaceFiles: {
      stat: async (_scope, relative) => {
        if (statThrows) throw new Error('workspace-file/not-found');
        return { absolutePath: `D:\\ws\\${relative.replaceAll('/', '\\')}` };
      },
    },
    fs: {
      processPathFromHostPath: (value) => (unmapped ? undefined : value),
      processPath: (value) => value,
      resolve: async (value) => (roundTripMismatch ? `${value}.other` : value),
    },
  };
}

/** @param {string} query - query string without the leading `?`. */
const params = (query) => new URLSearchParams(query);

test('resolves the addressed file to its verified host path', async () => {
  const target = await resolvePresented(host(), { signal: undefined }, params('sessionId=s1&seq=5&index=1'));
  assert.equal(target.count, 3);
  assert.equal(target.index, 1);
  assert.deepEqual(target.files, [{ path: 'D:\\ws\\交付 文档（终稿）.md', name: '交付 文档（终稿）.md', index: 1 }]);
});

test('scope=all resolves every file of the delivery', async () => {
  const target = await resolvePresented(host(), {}, params('sessionId=s1&seq=5&index=0&scope=all'));
  assert.equal(target.files.length, 3);
  assert.deepEqual(target.files.map((file) => file.index), [0, 1, 2]);
  assert.deepEqual(target.files.map((file) => file.name), ['report.md', '交付 文档（终稿）.md', 'notes.txt']);
});

test('falls back to the deployment workspace root when the header has no cwd', async () => {
  const ctx = host({ cwd: null });
  let seen;
  ctx.workspaceFiles.stat = async (scope, relative) => {
    seen = scope.workspaceRoot;
    return { absolutePath: `D:\\fallback\\${relative}` };
  };
  await resolvePresented(ctx, {}, params('sessionId=s1&seq=5&index=0'));
  assert.equal(seen, 'D:\\fallback');
});

test('rejects missing coordinates', async () => {
  await assert.rejects(
    resolvePresented(host(), {}, params('seq=5&index=0')),
    (error) => error instanceof PresentedError && error.status === 400 && error.code === 'bad-coordinates',
  );
});

test('rejects an event that is not a delivery', async () => {
  await assert.rejects(
    resolvePresented(host({ eventType: 'tools/result' }), {}, params('sessionId=s1&seq=5&index=0')),
    (error) => error.status === 404 && error.code === 'not-a-delivery',
  );
});

test('rejects an out-of-range file index', async () => {
  await assert.rejects(
    resolvePresented(host(), {}, params('sessionId=s1&seq=5&index=9')),
    (error) => error.status === 404 && error.code === 'no-such-file',
  );
});

test('reports a file the session filesystem refuses', async () => {
  await assert.rejects(
    resolvePresented(host({ statThrows: true }), {}, params('sessionId=s1&seq=5&index=0')),
    (error) => error.status === 404 && error.code === 'file-unavailable',
  );
});

test('rejects a path with no host mapping', async () => {
  await assert.rejects(
    resolvePresented(host({ unmapped: true }), {}, params('sessionId=s1&seq=5&index=0')),
    (error) => error.status === 422 && error.code === 'unmapped-path',
  );
});

test('rejects a path that does not round-trip', async () => {
  await assert.rejects(
    resolvePresented(host({ roundTripMismatch: true }), {}, params('sessionId=s1&seq=5&index=0')),
    (error) => error.status === 422 && error.code === 'unmapped-path',
  );
});

test('declared paths are normalized and never read', async () => {
  const ctx = host();
  ctx.sessionQuery.readEvent = async () => ({
    session: { cwd: 'D:\\ws\\sub' },
    target: { type: 'deliverables/presented', data: { turn: 1, callId: 'c', files: [{ path: '..\\secret.txt' }] } },
  });
  const declared = await resolveDeclaredPaths(ctx, {}, params('sessionId=s1&seq=7&index=0'));
  assert.deepEqual(declared.paths, ['D:\\ws\\secret.txt']);
  assert.ok(!declared.paths[0].includes('..'), 'no unresolved parent segments');
});

test('parses only non-negative integers', () => {
  assert.equal(coordinate('12'), 12);
  assert.equal(coordinate('0'), 0);
  assert.equal(coordinate('-1'), undefined);
  assert.equal(coordinate('1.5'), undefined);
  assert.equal(coordinate('abc'), undefined);
  assert.equal(coordinate(null), undefined);
});
