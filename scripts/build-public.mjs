import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secureHtml, verifyBuiltSecurity } from './web-security.mjs';

export const project = fileURLToPath(new URL('../', import.meta.url));
export const publicFiles = [
  'app.js', 'engine.js', 'psd.js', 'raster-source.js', 'export-worker.js', 'style.css', 'LICENSE',
  'downloads/nazori-kun-manual.pdf',
  'examples/mono.png', 'examples/color.png',
  'examples/detailed-mono.png', 'examples/detailed-color.png',
];

export async function buildPublic(output = join(project, 'dist')) {
  const config = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  const source = await readFile(join(project, 'index.html'), 'utf8');
  const psd = await readFile(join(project, 'psd.js'));
  const psdVersion = createHash('sha256').update(psd).digest('hex').slice(0, 12);
  const html = secureHtml(source.replace('{{VERSION}}', config.version)
    .replace('src="psd.js"', `src="psd.js?v=${psdVersion}"`))
    .replace(/connect-src [^;]+/, "connect-src 'none'");
  verifyBuiltSecurity(html);
  const directories = new Set(publicFiles.map(dirname));
  await Promise.all([...directories].map(directory => mkdir(join(output, directory), { recursive: true })));
  await rm(join(output, 'monoline.js'), { force: true });
  await Promise.all([
    writeFile(join(output, 'index.html'), html),
    writeFile(join(output, '.nojekyll'), ''),
    ...publicFiles.map(file => copyFile(join(project, file), join(output, file))),
  ]);
  return html;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildPublic();
