import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublic } from '../scripts/build-public.mjs';

test('the public build is versioned, cannot request remote data, and contains only web assets', async () => {
  const output = await mkdtemp(join(tmpdir(), 'nazori-test-'));
  try {
    const html = await buildPublic(output);
    assert.match(html, /v0\.1\.0/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /<script defer src="app\.js"><\/script>/);
    assert.deepEqual((await readdir(output)).sort(), [
      '.nojekyll', 'LICENSE', 'app.js', 'engine.js', 'examples', 'index.html', 'monoline.js', 'psd.js', 'style.css',
    ]);
    const image = await readFile(join(output, 'examples', 'detailed-color.png'));
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
  } finally {
    const real = await realpath(output);
    assert.equal(dirname(real).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
    assert.ok(basename(real).startsWith('nazori-test-'));
    await rm(real, { recursive: true, force: true });
  }
});
