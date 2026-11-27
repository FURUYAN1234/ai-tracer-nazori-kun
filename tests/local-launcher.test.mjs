import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPublic } from '../scripts/build-public.mjs';

test('the source ZIP contains a double-click Windows launcher', async () => {
  const batch = await readFile(new URL('../start_nazori.bat', import.meta.url), 'utf8');
  assert.match(batch, /"%~dp0scripts\\launch-windows\.mjs" %\*/);
});

test('Windows local server serves the app and runs an authenticated, workspace-scoped MCP session', async () => {
  const { startLocalServer } = await import('../scripts/local-server.mjs');
  const scratch = await mkdtemp(join(tmpdir(), 'nazori-local-test-'));
  const dist = join(scratch, 'dist');
  await buildPublic(dist);
  await copyFile(new URL('../examples/mono.png', import.meta.url), join(scratch, 'input.png'));
  const server = await startLocalServer({ dist, workspace: scratch, port: 0 });
  try {
    const { url, token } = server;
    assert.match(await (await fetch(url)).text(), /AIトレーサー なぞり君/);
    assert.equal((await fetch(new URL('mcp.cjs', url))).status, 404);
    const endpoint = new URL('mcp', url);
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const post = (message, extraHeaders = {}) => fetch(endpoint, {
      method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    });
    const init = { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
    assert.equal((await post(init)).status, 401);
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await post(init, { ...auth, origin: 'https://example.test' })).status, 403);
    const ready = await post(init, auth);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).result.serverInfo.name, 'nazori-kun');
    const session = ready.headers.get('mcp-session-id');
    assert.ok(session);
    const connected = { ...auth, 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' };
    assert.equal((await post({ method: 'notifications/initialized' }, connected)).status, 202);
    const call = input => post({ id: 2, method: 'tools/call', params: { name: 'nazori_trace_png', arguments: { input } } }, connected);
    const rejected = await (await call('../outside.png')).json();
    assert.equal(rejected.result.isError, true);
    const worked = (await (await call('input.png')).json()).result.structuredContent;
    assert.equal(worked.paths.length, 4);
    await Promise.all(worked.paths.map(path => access(join(scratch, path))));
    assert.equal((await fetch(endpoint, { method: 'DELETE', headers: connected })).status, 204);
    assert.equal((await post({ id: 3, method: 'tools/list' }, connected)).status, 404);
  } finally {
    await new Promise(resolve => server.http.close(resolve));
    await rm(scratch, { recursive: true, force: true });
  }
});

test('the updater installs only matching official release files and retains a working version on failure', async () => {
  const { prepareInstallation, releaseFiles } = await import('../scripts/launch-windows.mjs');
  const source = new URL('../', import.meta.url);
  const home = await mkdtemp(join(tmpdir(), 'nazori-update-test-'));
  const seed = JSON.parse(await readFile(new URL('package.json', source), 'utf8')).version;
  const [major, minor, patch] = seed.split('.').map(Number);
  const newer = [major, minor, patch + 1].join('.');
  const commit = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const files = new Map(await Promise.all(releaseFiles.map(async path => [path, await readFile(new URL(path, source))])));
  files.set('package.json', Buffer.from(JSON.stringify({ version: newer })));
  files.set('new-runtime-module.js', Buffer.from('export const value = 1;\n'));
  const entries = [...files].map(([path, bytes]) => ({
    path, mode: '100644', type: 'blob', size: bytes.length,
    sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
  }));
  let corrupt = true;
  const options = {
    home, report() {},
    request: async url => {
      const path = new URL(url).pathname;
      if (path.endsWith('/releases/latest')) return Response.json({ tag_name: `v${newer}`, draft: false, prerelease: false });
      if (path.endsWith(`/commits/v${newer}`)) return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
      if (path.endsWith(`/git/trees/${tree}`)) return Response.json({ sha: tree, truncated: false, tree: entries });
      const file = path.split(`/${commit}/`)[1];
      assert.ok(files.has(file), url);
      const bytes = files.get(file);
      return new Response(corrupt && file === 'app.js' ? Buffer.alloc(bytes.length) : bytes);
    },
  };
  try {
    const initial = await prepareInstallation(options);
    assert.equal(initial.version, seed);
    assert.match(initial.warning, /integrity/i);
    corrupt = false;
    const updated = await prepareInstallation(options);
    assert.equal(updated.version, newer);
    await access(join(updated.root, 'new-runtime-module.js'));
    assert.match(await readFile(join(updated.root, 'dist', 'index.html'), 'utf8'), new RegExp(`v${newer}`));
    const offline = await prepareInstallation({ ...options, request: async () => { throw new Error('offline'); } });
    assert.equal(offline.version, newer);
    assert.match(offline.warning, /offline/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
