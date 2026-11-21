/**
 * Session-coordinate resolution for delivery files.
 *
 * The browser never sends a path. It sends the coordinates the delivery card
 * already carries — `sessionId`, the `deliverables/presented` event sequence,
 * and the file index — and this module turns them into a Host path exactly the
 * way `present.open` does:
 *
 * 1. read the addressed event from the Session log (an immutable record),
 * 2. require it to be a well-formed delivery declaration,
 * 3. resolve the relative path through the Session filesystem, which confines
 *    it to that Session's workspace and rejects missing files, directories, and
 *    final symbolic links,
 * 4. require the Host path to map back to this same process path, so a same-named
 *    file elsewhere cannot stand in for it.
 *
 * @module dsh-copy-file/presented
 */

import path from 'node:path';

/** A refusal that maps directly to an HTTP status. */
export class PresentedError extends Error {
  /**
   * @param {number} status - HTTP status to answer with.
   * @param {string} code - stable reason code for the browser.
   * @param {string} message - English diagnostic (never shown to end users).
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'PresentedError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate a delivery event payload.
 * @param {unknown} value - decoded event data.
 * @returns {boolean} whether it carries a turn, a call, and a file list.
 */
function isPresentedData(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { turn, callId, files } = value;
  return typeof turn === 'number'
    && Number.isSafeInteger(turn)
    && turn >= 1
    && typeof callId === 'string'
    && callId.length > 0
    && Array.isArray(files);
}

/**
 * Validate one file declaration.
 * @param {unknown} value - one entry of `files`.
 * @returns {boolean} whether it carries a non-empty path.
 */
function isPresentedFile(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { path: filePath, description } = value;
  return typeof filePath === 'string'
    && filePath.trim().length > 0
    && (description === undefined || typeof description === 'string');
}

/**
 * Parse one non-negative integer coordinate.
 * @param {string|null} value - raw query value.
 * @returns {number|undefined} the coordinate, or undefined when invalid.
 */
export function coordinate(value) {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Read the delivery event behind one card.
 * @param {object} ctx - host context with `sessionQuery`.
 * @param {string} sessionId - viewed Session.
 * @param {number} seq - delivery event sequence.
 * @param {AbortSignal} signal - request lifetime.
 * @returns {Promise<{session: {cwd?: string}, files: readonly unknown[]}>}
 */
async function readDelivery(ctx, sessionId, seq, signal) {
  const window = await ctx.sessionQuery.readEvent({ sessionId, seq, before: 0, after: 0 }, signal);
  const target = window?.target;
  if (target === undefined || target.type !== 'deliverables/presented' || !isPresentedData(target.data)) {
    throw new PresentedError(404, 'not-a-delivery', 'The addressed event is not a delivery declaration.');
  }
  return { session: window.session ?? {}, files: target.data.files };
}

/**
 * Resolve the delivered file(s) of one card to verified Host paths.
 * @param {object} ctx - host context (`sessionQuery`, `workspaceFiles`, `fs`, `sandboxPolicy`).
 * @param {{signal?: AbortSignal}} request - request lifetime.
 * @param {URLSearchParams} query - `sessionId`, `seq`, `index`, optional `scope=all`.
 * @returns {Promise<{files: {path: string, name: string, index: number}[], count: number, index: number}>}
 */
export async function resolvePresented(ctx, request, query) {
  const sessionId = query.get('sessionId');
  const seq = coordinate(query.get('seq'));
  const index = coordinate(query.get('index'));
  if (typeof sessionId !== 'string' || sessionId === '' || seq === undefined) {
    throw new PresentedError(400, 'bad-coordinates', 'sessionId and seq are required.');
  }
  const signal = request.signal ?? new AbortController().signal;
  const { session, files } = await readDelivery(ctx, sessionId, seq, signal);
  const all = query.get('scope') === 'all';
  if (!all && (index === undefined || index >= files.length)) {
    throw new PresentedError(404, 'no-such-file', 'The delivery has no file at that index.');
  }

  // A Session header records its working directory; the deployment workspace
  // root is the fallback the shipped route uses for a header without one.
  const workspaceRoot = session.cwd ?? ctx.sandboxPolicy.workspaceRoot;
  const wanted = all ? files.map((file, position) => ({ file, position })) : [{ file: files[index], position: index }];
  const resolved = [];
  for (const { file, position } of wanted) {
    if (!isPresentedFile(file)) throw new PresentedError(404, 'no-such-file', 'The delivery declares an invalid file.');
    let stat;
    try {
      stat = await ctx.workspaceFiles.stat({ sessionId, workspaceRoot }, file.path, signal);
    } catch (error) {
      throw new PresentedError(404, 'file-unavailable', `Session filesystem refused the path: ${String(error?.message ?? error)}`);
    }
    const hostPath = stat?.absolutePath;
    if (typeof hostPath !== 'string' || hostPath === '') {
      throw new PresentedError(404, 'file-unavailable', 'The Session filesystem returned no path.');
    }
    // Only a path this process can reach under the same spelling is eligible;
    // the round trip defeats a same-named file that the Host did not resolve.
    const mapped = ctx.fs.processPathFromHostPath(hostPath);
    if (mapped === undefined) throw new PresentedError(422, 'unmapped-path', 'The path has no Host mapping.');
    if (ctx.fs.processPath(await ctx.fs.resolve(mapped, { signal })) !== hostPath) {
      throw new PresentedError(422, 'unmapped-path', 'The path did not round-trip through the Host filesystem.');
    }
    resolved.push({ path: hostPath, name: path.basename(hostPath), index: position });
  }
  return { files: resolved, count: files.length, index: index ?? 0 };
}

/**
 * Resolve the *declared* path(s) of one card without touching the filesystem.
 *
 * This backs the text fallback: when the file has been deleted, renamed, or
 * moved, the clipboard write cannot succeed, but the path the Session recorded
 * is still exactly what the user needs to paste. Input is the same immutable
 * event plus the Session workspace root, so no path ever comes from the browser.
 *
 * @param {object} ctx - host context (`sessionQuery`, `sandboxPolicy`).
 * @param {{signal?: AbortSignal}} request - request lifetime.
 * @param {URLSearchParams} query - `sessionId`, `seq`, `index`, optional `scope=all`.
 * @returns {Promise<{paths: string[], count: number, index: number}>} declared paths.
 */
export async function resolveDeclaredPaths(ctx, request, query) {
  const sessionId = query.get('sessionId');
  const seq = coordinate(query.get('seq'));
  const index = coordinate(query.get('index'));
  if (typeof sessionId !== 'string' || sessionId === '' || seq === undefined) {
    throw new PresentedError(400, 'bad-coordinates', 'sessionId and seq are required.');
  }
  const signal = request.signal ?? new AbortController().signal;
  const { session, files } = await readDelivery(ctx, sessionId, seq, signal);
  const all = query.get('scope') === 'all';
  if (!all && (index === undefined || index >= files.length)) {
    throw new PresentedError(404, 'no-such-file', 'The delivery has no file at that index.');
  }
  const root = session.cwd ?? ctx.sandboxPolicy.workspaceRoot ?? '';
  const wanted = all ? files : [files[index]];
  const paths = wanted.map((file) => {
    if (!isPresentedFile(file)) throw new PresentedError(404, 'no-such-file', 'The delivery declares an invalid file.');
    // Normalized so a declared `..` segment cannot escape the workspace root.
    // This value is only ever returned as text, never opened.
    return path.resolve(root, file.path);
  });
  return { paths, count: files.length, index: index ?? 0 };
}
