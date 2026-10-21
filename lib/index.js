/**
 * dsh-copy-file, Host half.
 *
 * Four authenticated routes under Connection's trust fence. All of them take
 * Session coordinates — never a path — and resolve the delivered file through
 * the Session log and the Session filesystem first:
 *
 * - `POST api/copy.file`  put the file(s) on the OS clipboard (CF_HDROP)
 * - `GET  api/copy.path`  answer the verified absolute path (the browser copies
 *                         it as text when a file copy is impossible)
 * - `GET  api/copy.probe` answer `{count,index,name}` so the card can label
 *                         "copy all N files" without reading any content
 * - `GET  api/copy.raw`   stream one file (used only by the drag-out
 *                         `DownloadURL` payload; Web drag cannot carry a local
 *                         file, so the drop target receives a copy)
 *
 * @module dsh-copy-file
 */

import { createReadStream } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { copyFiles } from './clipboard.mjs';
import { PresentedError, resolveDeclaredPaths, resolvePresented } from './presented.mjs';

/** Cordis plugin name. */
export const name = 'copy-file';

/** Services needed to authenticate a request, resolve a delivery, and write the clipboard. */
export const inject = ['connection', 'sessionQuery', 'workspaceFiles', 'fs', 'sandboxPolicy'];

/** Wire paths. Document-relative form is the same string without the leading slash. */
const COPY_FILE_PATH = '/api/copy.file';
const COPY_PATH_PATH = '/api/copy.path';
const COPY_PROBE_PATH = '/api/copy.probe';
const COPY_RAW_PATH = '/api/copy.raw';

/**
 * Answer one JSON body.
 * @param {number} status - HTTP status.
 * @param {unknown} body - serializable payload.
 * @returns {Response} the response.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Turn a refusal or an unexpected failure into a JSON answer.
 * @param {unknown} error - thrown value.
 * @returns {Response} the response.
 */
function failure(error) {
  if (error instanceof PresentedError) return json(error.status, { ok: false, reason: error.code });
  return json(500, { ok: false, reason: 'host-error' });
}

/**
 * `POST api/copy.file`: place the delivered file(s) on the system clipboard.
 * @param {object} ctx - host context.
 * @param {Request} request - authenticated request.
 * @returns {Promise<Response>} `{ok,count}` or `{ok:false,reason}`.
 */
async function copyFileRoute(ctx, request) {
  try {
    const target = await resolvePresented(ctx, request, new URL(request.url).searchParams);
    const result = await copyFiles(target.files.map((file) => file.path));
    return json(200, result.ok
      ? { ok: true, count: result.count ?? target.files.length }
      : { ok: false, reason: result.reason ?? 'clipboard-error' });
  } catch (error) {
    return failure(error);
  }
}

/**
 * `GET api/copy.path`: answer the verified absolute path(s) for the text fallback.
 * @param {object} ctx - host context.
 * @param {Request} request - authenticated request.
 * @returns {Promise<Response>} `{ok:true,path}` or `{ok:true,paths}`.
 */
async function copyPathRoute(ctx, request) {
  try {
    const query = new URL(request.url).searchParams;
    // Declared paths only: this route must keep working after the file itself
    // is gone, because "copy the path" is the documented fallback.
    const target = await resolveDeclaredPaths(ctx, request, query);
    if (query.get('scope') === 'all') return json(200, { ok: true, paths: target.paths });
    return json(200, { ok: true, path: target.paths[0] });
  } catch (error) {
    return failure(error);
  }
}

/**
 * `GET api/copy.probe`: answer how many files the delivery declares.
 * @param {object} ctx - host context.
 * @param {Request} request - authenticated request.
 * @returns {Promise<Response>} `{ok:true,count,index,name}`.
 */
async function probeRoute(ctx, request) {
  try {
    const target = await resolvePresented(ctx, request, new URL(request.url).searchParams);
    return json(200, { ok: true, count: target.count, index: target.index, name: target.files[0]?.name ?? '' });
  } catch (error) {
    return failure(error);
  }
}

/**
 * `GET api/copy.raw`: stream one verified file for a drag-out `DownloadURL`.
 * @param {object} ctx - host context.
 * @param {Request} request - authenticated request.
 * @returns {Promise<Response>} the file body.
 */
async function rawRoute(ctx, request) {
  try {
    const query = new URL(request.url).searchParams;
    const target = await resolvePresented(ctx, request, query);
    const file = target.files[0];
    const info = await statFile(file.path);
    if (!info.isFile()) throw new PresentedError(404, 'file-unavailable', 'Not a regular file.');
    const asciiName = file.name.replace(/[^\x20-\x7e]/g, '_').replaceAll('"', '');
    return new Response(Readable.toWeb(createReadStream(file.path)), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(info.size),
        'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", '%27')}`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Register the four routes on the composition's authenticated fetch surface.
 * @param {object} ctx - host context.
 */
function registerRoutes(ctx) {
  const routes = [
    [COPY_FILE_PATH, ['POST'], copyFileRoute],
    [COPY_PATH_PATH, ['GET'], copyPathRoute],
    [COPY_PROBE_PATH, ['GET'], probeRoute],
    [COPY_RAW_PATH, ['GET'], rawRoute],
  ];
  for (const [path, methods, handler] of routes) {
    ctx.connection.fetch.register({
      path,
      methods,
      requestBody: 'buffered',
      fetch: (request) => handler(ctx, request),
    });
  }
}

/**
 * Plugin body.
 * @param {object} ctx - host context.
 */
export function apply(ctx) {
  registerRoutes(ctx);
}

