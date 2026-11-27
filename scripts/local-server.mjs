import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import mcp from '../mcp.cjs';
import { publicFiles } from './build-public.mjs';

const loopback = '127.0.0.1';
const media = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
};
const webFiles = new Map(['index.html', ...publicFiles].map(file => ['/' + file, file]));
webFiles.set('/', 'index.html');
const maxBody = 65536;
const idleTimeout = 60 * 60 * 1000;

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(body);
}

async function readMessage(request) {
  let length = 0;
  const parts = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBody) throw new Error('Request body is too large.');
    parts.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
}

export async function startLocalServer({ dist, workspace, port, version = '' }) {
  const token = randomBytes(32).toString('hex');
  const expectedAuthorization = Buffer.from('Bearer ' + token);
  const sessions = new Map();
  const authorized = header => {
    const bytes = Buffer.from(header ?? '');
    return bytes.length === expectedAuthorization.length && timingSafeEqual(bytes, expectedAuthorization);
  };

  async function handleMcp(request, response) {
    const sessionId = request.headers['mcp-session-id'];
    const session = sessions.get(sessionId);
    const now = Date.now();
    if (sessionId && (!session || now - session.usedAt > idleTimeout)) {
      sessions.delete(sessionId);
      return send(response, 404);
    }
    const protocol = request.headers['mcp-protocol-version'];
    if (protocol && (!session || protocol !== session.protocol)) return send(response, 400);
    if (request.method === 'DELETE' && session) {
      sessions.delete(sessionId);
      return send(response, 204);
    }
    if (request.method !== 'POST') return send(response, 405, undefined, { Allow: 'POST, DELETE' });

    const accept = (request.headers.accept ?? '').split(',').map(value => value.split(';')[0].trim());
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return send(response, 406);
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return send(response, 415);
    let message;
    try {
      message = await readMessage(request);
    } catch {
      return send(response, 400, undefined, { Connection: 'close' });
    }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
        (Object.hasOwn(message, 'id') && !['number', 'string'].includes(typeof message.id))) return send(response, 400);

    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (!session) {
      if (message.method !== 'initialize' || !Object.hasOwn(message, 'id')) return send(response, 400);
      for (const [id, entry] of sessions) if (now - entry.usedAt > idleTimeout) sessions.delete(id);
      if (sessions.size >= 32) return send(response, 503);
      const dispatch = mcp.createMcpSession(workspace);
      const result = dispatch(message);
      const newId = randomUUID();
      sessions.set(newId, { dispatch, usedAt: now, protocol: result.result.protocolVersion });
      return send(response, 200, JSON.stringify(result), { ...headers, 'MCP-Session-Id': newId });
    }
    session.usedAt = now;
    const result = session.dispatch(message);
    return result ? send(response, 200, JSON.stringify(result), headers) : send(response, 202);
  }

  let host;
  const http = createServer({ requestTimeout: 30_000 }, async (request, response) => {
    try {
      if (request.headers.host !== host ||
          (request.headers.origin && request.headers.origin !== 'http://' + host)) return send(response, 403);
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) return send(response, 400);
      const path = new URL(request.url, 'http://' + host).pathname;
      if (path === '/mcp' || path === '/status') {
        if (!authorized(request.headers.authorization)) return send(response, 401);
        if (path === '/mcp') return await handleMcp(request, response);
        if (request.method !== 'GET') return send(response, 405);
        return send(response, 200, JSON.stringify({ name: 'nazori-kun', version }), { 'Content-Type': 'application/json' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405);
      const file = webFiles.get(path);
      if (!file) return send(response, 404);
      const bytes = await readFile(join(dist, file));
      return send(response, 200, request.method === 'HEAD' ? undefined : bytes, {
        'Content-Type': media[extname(file)] ?? 'text/plain; charset=utf-8',
        'Content-Length': bytes.length,
      });
    } catch {
      return send(response, 500);
    }
  });
  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, loopback, () => {
      host = loopback + ':' + http.address().port;
      http.off('error', reject);
      resolve();
    });
  });
  return { http, token, url: 'http://' + host + '/' };
}
