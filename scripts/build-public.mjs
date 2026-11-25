import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secureHtml, verifyBuiltSecurity } from './web-security.mjs';

export const project = fileURLToPath(new URL('../', import.meta.url));
export const publicFiles = [
  'app.js', 'engine.js', 'psd.js', 'monoline.js', 'style.css', 'LICENSE',
  'examples/mono.png', 'examples/color.png',
  'examples/detailed-mono.png', 'examples/detailed-color.png',
];

export async function buildPublic(output = join(project, 'dist')) {
  const config = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  const source = await readFile(join(project, 'index.html'), 'utf8');
  const html = secureHtml(source.replace('{{VERSION}}', config.version))
    .replace(/connect-src [^;]+/, "connect-src 'none'");
  verifyBuiltSecurity(html);
  await mkdir(join(output, 'examples'), { recursive: true });
  await Promise.all([
    writeFile(join(output, 'index.html'), html),
    writeFile(join(output, '.nojekyll'), ''),
    ...publicFiles.map(file => copyFile(join(project, file), join(output, file))),
  ]);
  return html;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildPublic();
