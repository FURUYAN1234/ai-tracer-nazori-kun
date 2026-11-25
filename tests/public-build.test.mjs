import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublic } from '../scripts/build-public.mjs';

test('the public build is versioned, cannot request remote data, and contains only web assets', async () => {
  const output = await mkdtemp(join(tmpdir(), 'nazori-test-'));
  try {
    await writeFile(join(output, 'monoline.js'), 'obsolete automatic color asset');
    const html = await buildPublic(output);
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(html.includes('v' + version));
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /<script defer src="app\.js"><\/script>/);
    const psdVersion = createHash('sha256').update(await readFile(join(output, 'psd.js'))).digest('hex').slice(0, 12);
    assert.ok(html.includes(`src="psd.js?v=${psdVersion}"`));
    assert.doesNotMatch(html, /id="auto-color"|src="monoline\.js"/);
    const appJs = await readFile(join(output, 'app.js'), 'utf8');
    assert.doesNotMatch(appJs, /auto-color|trainColorModel|suggestColors/);
    assert.match(html, /<dialog id="color-dialog" aria-labelledby="color-heading">/);
    assert.match(html, /id="color-cancel"[^>]*>キャンセル<\/button>/);
    assert.match(html, /type="submit">適用<\/button>/);
    const optionValues = id => [...html.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)<\\/select>'))[1]
      .matchAll(/<option value="([^"]+)"/g)].map(option => option[1]);
    assert.deepEqual(optionValues('export-type'), ['png', 'psd', 'svg', 'json']);
    assert.doesNotMatch(html, /id="png-content"|id="jump-export"|id="panel-strip"/);
    assert.doesNotMatch(html, /<select id="active-panel"/);
    assert.match(html, /<header class="topbar">[\s\S]*?class="brand"[\s\S]*?<button id="import"[^>]*>画像を取り込む<\/button>\s*<div class="toolbar">\s*<small id="project-saves"/);
    assert.match(html, /id="import-feedback"[^>]*>\s*<progress id="import-progress"/);
    assert.match(html, /data-view="result"[^>]*>元絵とトレス結果<\/button>/);
    assert.match(html, /<section id="export-page" aria-labelledby="export-heading" hidden>/);
    assert.match(html, /id="image-screen"[^>]*>画像一覧<\/button>/);
    assert.match(html, /id="export"[^>]*>保存<\/button>/);
    assert.match(html, /id="export-size"/);
    assert.match(html, /worker-src 'self'/);
    assert.deepEqual((await readdir(output)).sort(), [
      '.nojekyll', 'LICENSE', 'app.js', 'downloads', 'engine.js', 'examples', 'export-worker.js', 'index.html', 'psd.js', 'raster-source.js', 'style.css',
    ]);
    assert.match(html, /href="downloads\/nazori-kun-manual\.pdf"[^>]*>操作マニュアル/);
    const manual = await readFile(join(output, 'downloads', 'nazori-kun-manual.pdf'));
    assert.equal(manual.subarray(0, 5).toString(), '%PDF-');
    const image = await readFile(join(output, 'examples', 'detailed-color.png'));
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
  } finally {
    const real = await realpath(output);
    assert.equal(dirname(real).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
    assert.ok(basename(real).startsWith('nazori-test-'));
    await rm(real, { recursive: true, force: true });
  }
});
