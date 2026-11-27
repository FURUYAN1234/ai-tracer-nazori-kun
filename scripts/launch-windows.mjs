import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { project, publicFiles } from './build-public.mjs';

const repository = 'FURUYAN1234/ai-tracer-nazori-kun';
const api = 'https://api.github.com/repos/' + repository;
const raw = 'https://raw.githubusercontent.com/' + repository;
const stableVersion = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/;
const gitId = /^[a-f0-9]{40}$/;
const maxFile = 32 * 1024 * 1024;
const reserved = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;
export const releaseFiles = [
  'start_nazori.bat', 'package.json', 'index.html', 'mcp.cjs', 'png.cjs',
  'scripts/launch-windows.mjs', 'scripts/local-server.mjs', 'scripts/build-public.mjs', 'scripts/web-security.mjs',
  ...publicFiles,
];

function compareVersion(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
}

async function versionOf(root) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!stableVersion.test(version)) throw new Error('The application version is invalid.');
  return version;
}

async function readInstallation(root, version) {
  try {
    if (!(await lstat(root)).isDirectory() || await versionOf(root) !== version) return null;
    if ((await readFile(join(root, '.ready'), 'utf8')).trim() !== version) return null;
    await Promise.all(['dist/index.html', 'scripts/local-server.mjs', 'mcp.cjs'].map(file => access(join(root, file))));
    return { root, version };
  } catch {
    return null;
  }
}

async function installVersion(versions, version, populate) {
  const destination = join(versions, version);
  const existing = await readInstallation(destination, version);
  if (existing) return existing;
  const stage = await mkdtemp(join(versions, '.install-'));
  try {
    await populate(stage);
    if (await versionOf(stage) !== version) throw new Error('The release version does not match its tag.');
    const { buildPublic } = await import(pathToFileURL(join(stage, 'scripts/build-public.mjs')));
    await buildPublic(join(stage, 'dist'));
    await writeFile(join(stage, '.ready'), version + '\n', { flag: 'wx' });
    try {
      await rename(stage, destination);
    } catch (error) {
      const winner = await readInstallation(destination, version);
      if (winner) return winner;
      throw error;
    }
    return { root: destination, version };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function getResponse(request, url, json = true) {
  const response = await request(url, {
    redirect: 'error',
    headers: json ? { Accept: 'application/vnd.github+json' } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
  return response;
}

async function installGitHubRelease(versions, version, request) {
  const tag = 'v' + version;
  const commit = await (await getResponse(request, `${api}/commits/${tag}`)).json();
  const treeId = commit.commit?.tree?.sha;
  if (!gitId.test(commit.sha) || !gitId.test(treeId)) throw new Error('GitHub did not resolve the release tag.');
  const tree = await (await getResponse(request, `${api}/git/trees/${treeId}?recursive=1`)).json();
  if (tree.sha !== treeId || tree.truncated || !Array.isArray(tree.tree)) throw new Error('The release file list is incomplete.');
  const entries = tree.tree.filter(file => file.type !== 'tree');
  const paths = new Set();
  let total = 0;
  for (const entry of entries) {
    const parts = entry.path?.split('/');
    if (!parts?.length || parts.some(part => !part || /[ .]$/.test(part) ||
        /[\\<>:"|?*\x00-\x1f]/.test(part) || /^\.git$/i.test(part) || reserved.test(part)) ||
        entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) ||
        !gitId.test(entry.sha) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maxFile)
      throw new Error('The release contains an invalid Windows file entry.');
    const key = entry.path.toLowerCase();
    if (paths.has(key)) throw new Error('The release has duplicate Windows paths.');
    paths.add(key);
    total += entry.size;
  }
  if (entries.length > 512 || total > 128 * 1024 * 1024 || releaseFiles.some(file => !paths.has(file.toLowerCase())))
    throw new Error('The release exceeds download limits or is missing startup files.');
  return installVersion(versions, version, async stage => {
    const save = async entry => {
      const file = entry.path;
      const encoded = file.split('/').map(encodeURIComponent).join('/');
      const response = await getResponse(request, `${raw}/${commit.sha}/${encoded}`, false);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > entry.size) throw new Error('Release integrity check failed: ' + file);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (size !== entry.size || hash !== entry.sha) throw new Error('Release integrity check failed: ' + file);
      const target = join(stage, file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    };
    for (let i = 0; i < entries.length; i += 6) {
      const results = await Promise.allSettled(entries.slice(i, i + 6).map(save));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
  });
}

export async function prepareInstallation({ home, offline = false, request = fetch, report = console.error }) {
  const versions = join(home, 'versions');
  await mkdir(versions, { recursive: true });
  const seed = await versionOf(project);
  const candidates = await readdir(versions, { withFileTypes: true });
  let installed;
  for (const candidate of candidates.filter(entry => entry.isDirectory() && stableVersion.test(entry.name))
    .map(entry => entry.name).sort((a, b) => compareVersion(b, a))) {
    if (compareVersion(candidate, seed) < 0) break;
    installed = await readInstallation(join(versions, candidate), candidate);
    if (installed) break;
  }
  installed ??= await installVersion(versions, seed, async stage => {
    for (const file of releaseFiles) {
      const target = join(stage, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(project, file), target);
    }
  });
  if (offline) return installed;
  const deadline = AbortSignal.timeout(45_000);
  const boundedRequest = (url, options) => request(url, { ...options, signal: AbortSignal.any([options.signal, deadline]) });
  try {
    const release = await (await getResponse(boundedRequest, api + '/releases/latest')).json();
    const version = release.tag_name?.slice(1);
    if (release.draft !== false || release.prerelease !== false || release.tag_name !== 'v' + version || !stableVersion.test(version))
      throw new Error('GitHub did not return a stable Nazori-kun release.');
    if (compareVersion(version, installed.version) <= 0) return installed;
    report(`Downloading Nazori-kun v${version} from GitHub...`);
    return await installGitHubRelease(versions, version, boundedRequest);
  } catch (error) {
    const warning = 'Update skipped. Using v' + installed.version + '. ' + error.message;
    report(warning);
    return { ...installed, warning };
  }
}

function openBrowser(url) {
  const viewer = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', windowsHide: true });
  viewer.on('error', () => console.error('Open this address in your browser: ' + url));
  viewer.unref();
}

async function readRunning(connection, url, workspace) {
  try {
    const saved = JSON.parse(await readFile(connection, 'utf8'));
    if (saved.url !== url || saved.workspace !== workspace || !/^[a-f0-9]{64}$/.test(saved.token)) return null;
    const response = await fetch(new URL('/status', url), {
      headers: { authorization: 'Bearer ' + saved.token }, redirect: 'error', signal: AbortSignal.timeout(1000),
    });
    const status = response.ok ? await response.json() : null;
    return status?.name === 'nazori-kun' ? status.version : null;
  } catch {
    return null;
  }
}

async function main(args) {
  const values = parseArgs({ args, options: {
    mcp: { type: 'boolean' }, 'no-browser': { type: 'boolean' }, offline: { type: 'boolean' },
    port: { type: 'string', default: '8000' }, workspace: { type: 'string' }, help: { type: 'boolean' },
  } }).values;
  if (values.help) {
    console.log('start_nazori.bat [--offline] [--no-browser] [--port 8000] [--workspace <absolute path>] [--mcp]');
    return;
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 15)) throw new Error('Node.js 22.15 or later is required.');
  if (!process.env.LOCALAPPDATA || !isAbsolute(process.env.LOCALAPPDATA))
    throw new Error('Windows LOCALAPPDATA is unavailable.');
  if (!/^\d{1,5}$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)
    throw new Error('Choose a port between 1 and 65535.');
  if (values.workspace && !isAbsolute(values.workspace)) throw new Error('Use an absolute MCP workspace path.');
  const home = join(process.env.LOCALAPPDATA, 'NazoriKun');
  const workspace = resolve(values.workspace ?? join(home, 'workspace'));
  await mkdir(workspace, { recursive: true });
  const port = Number(values.port);
  const url = `http://127.0.0.1:${port}/`;
  const connection = join(home, `connection-${port}.json`);

  if (!values.mcp) {
    const running = await readRunning(connection, url, workspace);
    if (running) {
      console.log(`Nazori-kun v${running} is already running at ${url}`);
      if (!values['no-browser']) openBrowser(url);
      return;
    }
  }
  const installed = await prepareInstallation({ home, offline: values.offline });
  if (values.mcp) {
    const child = spawn(process.execPath, [join(installed.root, 'mcp.cjs'), '--workspace', workspace], { stdio: 'inherit' });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
    return;
  }

  const { startLocalServer } = await import(pathToFileURL(join(installed.root, 'scripts/local-server.mjs')));
  let local;
  try {
    local = await startLocalServer({ dist: join(installed.root, 'dist'), workspace, port, version: installed.version });
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${port} is in use. Choose a different --port or close the earlier session.`);
    throw error;
  }
  const temp = join(home, '.connection-' + randomUUID() + '.json');
  try {
    await writeFile(temp, JSON.stringify({ url, mcpUrl: url + 'mcp', workspace, token: local.token }, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    await rename(temp, connection);
  } catch (error) {
    local.http.close();
    await unlink(temp).catch(() => {});
    throw error;
  }
  const stop = () => local.http.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`Nazori-kun v${installed.version}: ${url}\nMCP: ${url}mcp\nMCP connection file: ${connection}\nMCP workspace: ${workspace}\nPress Ctrl+C to stop.`);
  if (!values['no-browser']) openBrowser(url);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
