const test = require('node:test');
const assert = require('node:assert/strict');
const Raster = require('./raster-source.js');

test('reads source dimensions and rejects oversized images before raster decoding', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000bb800000fa0', 'hex');
  const jpeg = Buffer.from('ffd8ffe000044a46ffc0000b080fa00bb801011100', 'hex');
  const webp = Buffer.from('524946461600000057454250565038580a00000000000000b70b009f0f00', 'hex');
  for (const [bytes, type] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
    assert.deepEqual(Raster.sourceSize(bytes, type), { width: 3000, height: 4000 });
  }
  assert.deepEqual(Raster.previewSize(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(Raster.previewSize(4200, 1800), { width: 1600, height: 686 });
  assert.deepEqual(Raster.previewSize(101, 704), { width: 101, height: 704 });
  assert.equal(Raster.canExportOriginal(3000, 4000), true);
  assert.equal(Raster.canExportOriginal(6000, 4000), false);
  assert.throws(() => Raster.checkInputSize(8000, 8000), /3,200万/);
});

test('original-size export projects edits in pixel-center coordinates', () => {
  const panel = { width: 1200, height: 1600, markers: [{ x: 600, y: 1200, role: 'blue' }],
    barriers: [[0, 0, 1199, 1599]] };
  const edits = Raster.scaleEdits(panel, 3000, 4000);
  assert.deepEqual(edits.markers, [{ x: 1501, y: 3001, role: 'blue' }]);
  assert.deepEqual(edits.barriers, [[0, 0, 2999, 3999]]);
});
const { segment, resolveColors, paint, traceInk, rebuildInk, inkTimeline, traceWeight, stylizeInk, inspectRaster, sampleColors, makeLayers } = require('./engine.js');

function drawing(rows) {
  return { width: rows[0].length, height: rows.length,
    ink: Uint8Array.from(rows.join(''), pixel => pixel === '#' ? 0 : 255) };
}

test('a local barrier closes an open region without drawing a visible line', () => {
  const img = drawing(['.......', '.#####.', '.#...#.', '.....#.', '.#...#.', '.#####.', '.......']);
  const open = segment(img, 180);
  const closed = segment(img, 180, [[1, 2, 1, 4]]);
  assert.equal(open.labels[0], open.labels[23]);
  assert.notEqual(closed.labels[0], closed.labels[23]);
  const colors = resolveColors(closed, [{ x: 3, y: 3, role: 'coat' }]);
  const out = paint(img, closed, colors, { coat: '#ce6853' });
  assert.deepEqual([...out.slice(4 * 24, 4 * 24 + 4)], [206, 104, 83, 255]);
  assert.equal(out[4 * 22 + 1], 255);
});

test('inking and region IDs stay stable while shared colors change across differently shaped panels', () => {
  for (const rows of [['.......', '.#####.', '.#...#.', '.#...#.', '.#####.', '.......'],
    ['.......', '...###.', '..#..#.', '..#..#.', '..####.', '.......']]) {
    const img = drawing(rows);
    const layout = segment(img, 180);
    const roles = resolveColors(layout, [{ x: 4, y: 2, role: 'jacket' }]);
    const a = paint(img, layout, roles, { jacket: '#e44228' });
    const b = paint(img, layout, roles, { jacket: '#254be4' });
    assert.deepEqual([...a.slice(4 * 18, 4 * 18 + 3)], [228, 66, 40]);
    assert.deepEqual([...b.slice(4 * 18, 4 * 18 + 3)], [37, 75, 228]);
    assert.equal(a[4 * 19], 0);
    assert.equal(b[4 * 19], 0);
    assert.equal(b[0], 255);
  }
});

test('old color markers update by position after splitting, with protected white as an explicit role', () => {
  const img = drawing(['........', '.######.', '.#....#.', '.#....#.', '.######.', '........']);
  const layout = segment(img, 180, [[4, 1, 4, 4]]);
  const markers = [{ x: 3, y: 2, role: 'coat' }, { x: 5, y: 2, role: 'white' }];
  const roles = resolveColors(layout, markers);
  assert.equal(roles.get(layout.labels[19]), 'coat');
  assert.equal(roles.get(layout.labels[21]), 'white');
  assert.equal(roles.size, 2);
});

test('highlighting marks edges of the selected regions without washing out other colors', () => {
  const img = drawing(['........', '........', '........']);
  const layout = { labels: Int32Array.from([1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2]),
    regions: [{ id: 1 }, { id: 2 }] };
  const roles = new Map([[1, 'selected'], [2, 'other']]);
  const palette = { selected: '#3a8d45', other: '#264bba' };
  const original = paint(img, layout, roles, palette);
  const highlighted = paint(img, layout, roles, palette, { highlight: 'selected' });
  const pixel = (data, index) => [...data.slice(index * 4, index * 4 + 4)];
  assert.deepEqual(pixel(highlighted, 11), [185, 32, 125, 255]);
  assert.deepEqual(pixel(highlighted, 10), pixel(original, 10));
  for (const index of [4, 5, 6, 7, 12, 13, 14, 15, 20, 21, 22, 23]) {
    assert.deepEqual(pixel(highlighted, index), pixel(original, index));
  }
});

test('an apparent narrow hole remains a selectable region and a blank sheet stays usable', () => {
  const img = drawing(['.....', '.###.', '.#.#.', '.###.', '.....']);
  assert.equal(segment(img, 180).regions.length, 2);
  const blank = drawing(['.....']);
  const layer = segment(blank, 180);
  assert.equal(layer.regions.length, 1);
  assert.equal(resolveColors(layer, [{ x: -1, y: 0, role: 'bad' }]).size, 0);
});

test('ink tracing preserves a hole and two diagonal ink shapes as independent closed boundaries', () => {
  const img = drawing(['.....', '.###.', '.#.#.', '.###.', '....#']);
  const traced = traceInk(img, 180);
  assert.equal(traced.length, 3);
  const areas = traced.map(({ points }) => points.reduce((sum, [x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length];
    return sum + (x * ny - nx * y) / 2;
  }, 0));
  assert.deepEqual(areas.sort((a, b) => a - b), [-1, 1, 9]);
  assert.equal(traced.reduce((sum, shape) => sum + shape.length, 0), 20);
  assert.deepEqual(rebuildInk(img, 180).rebuilt.ink, img.ink);
});

test('G-pen fades an exposed tip while leaving the thicker black core intact', () => {
  const img = drawing(['.........', '...###...', '...###...', '.######..', '...###...', '...###...', '.........']);
  const g = stylizeInk(img, 'g').ink;
  const fine = stylizeInk(img, 'fine').ink;
  const brush = stylizeInk(img, 'brush').ink;
  assert.ok(g[28] > g[31] + 30);
  assert.equal(g[31], 0);
  assert.equal(fine[20], 255);
  assert.ok(g[20] < fine[20]);
  assert.ok(brush[20] < g[20]);
  assert.equal(g[28 + 1] > g[31], true);
  assert.deepEqual(stylizeInk(img, 'original').ink, img.ink);
  assert.deepEqual(stylizeInk(img, 'g', 0).ink, img.ink);
  assert.ok(stylizeInk(img, 'g', .5).ink[28] < g[28]);
});

test('a dark saturated color is retained as fill and neutral black separates it from the background', () => {
  const rows = ['.......', '.#####.', '.#CCC#.', '.#CCC#.', '.#CCC#.', '.#####.', '.......'];
  const rgba = new Uint8ClampedArray(rows.join('').split('').flatMap(c =>
    c === 'C' ? [45, 35, 102, 255] : c === '#' ? [18, 18, 18, 255] : [255, 255, 255, 255]));
  const input = inspectRaster(rgba, 7, 7);
  assert.equal(input.isColor, true);
  const source = sampleColors(segment(input, 180), input.rgba);
  assert.deepEqual(source.map(region => region.hex).sort(), ['#2d2366', '#ffffff']);
  const bw = new Uint8ClampedArray(7 * 7 * 4).fill(255);
  assert.equal(inspectRaster(bw, 7, 7).isColor, false);
});

test('the ink comes in along the actual contour over time and reaches wide interiors', () => {
  const input = drawing(['.........', '.###..##.', '.###..##.', '.###.....', '.........']);
  const { contours, rebuilt } = rebuildInk(input, 180);
  const total = contours.reduce((sum, path) => sum + traceWeight(path.length), 0);
  const time = inkTimeline(rebuilt, contours, total);
  assert.equal(time[10], 0);
  assert.ok(time[20] > 0 && time[20] < .75);
  assert.ok(time[15] > .35 && time[15] < 1);
  assert.equal(time[0], Infinity);
});

test('a flat color boundary remains separated without being painted as black ink', () => {
  const rgba = new Uint8ClampedArray(12 * 12 * 4);
  for (let i = 0; i < 144; i++) {
    const x = i % 12, y = Math.floor(i / 12);
    rgba.set(x >= 4 && x < 8 && y >= 4 && y < 8 ? [246, 94, 65, 255] : [212, 178, 251, 255], i * 4);
  }
  const input = inspectRaster(rgba, 12, 12);
  assert.equal(traceInk(input, 180).length, 0);
  assert.deepEqual(sampleColors(segment(input, 180), rgba).map(item => item.hex).sort(), ['#d4b2fb', '#f65e41']);
});

test('independent color layers and transparent pen recompose the displayed image', () => {
  const img = drawing(['.......', '.#####.', '.#.#.#.', '.#####.', '.......']);
  const layout = segment(img, 180);
  const markers = [{ x: 2, y: 2, role: 'a' }, { x: 4, y: 2, role: 'b' }];
  const assignments = resolveColors(layout, markers);
  const roles = [{ id: 'a', hex: '#d65242', name: 'Rose' }, { id: 'b', hex: '#4f61c9', name: 'Blue' }];
  const layers = makeLayers(img, layout, assignments, roles);
  assert.deepEqual(layers.map(layer => layer.label), ['ペン', 'Rose', 'Blue', '用紙']);
  assert.equal(layers[0].pixels[4 * 16 + 3], 0);
  const composite = new Uint8ClampedArray(4 * img.ink.length);
  for (const layer of [...layers].reverse()) {
    for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
      const from = (y * layer.width + x) * 4;
      const to = ((y + layer.top) * img.width + x + layer.left) * 4;
      const alpha = layer.pixels[from + 3] / 255;
      for (let c = 0; c < 3; c++) composite[to + c] = layer.pixels[from + c] * alpha + composite[to + c] * (1 - alpha);
      composite[to + 3] = 255;
    }
  }
  assert.deepEqual(composite, paint(img, layout, assignments, Object.fromEntries(roles.map(role => [role.id, role.hex]))));
});

test('PSD stores layer records and their channel payloads bottom to top', () => {
  const encode = require('./psd.js');
  const frame = { width: 1, height: 1 };
  const layer = (name, red) => ({ ...frame, name, label: name, top: 0, left: 0,
    pixels: Uint8Array.of(red, 0, 0, 255) });
  const stack = [layer('Pen', 11), layer('Color', 77), layer('Paper', 255)];
  const psd = Buffer.concat(encode(frame, stack, stack[0].pixels));
  const count = psd.readInt16BE(42);
  const records = [];
  let offset = 44;
  for (let index = 0; index < count; index++) {
    const channels = psd.readUInt16BE(offset + 16);
    const lengths = Array.from({ length: channels }, (_, i) => psd.readUInt32BE(offset + 20 + 6 * i));
    const extra = offset + 18 + 6 * channels + 12;
    const name = extra + 12;
    records.push({ name: psd.toString('ascii', name + 1, name + 1 + psd[name]), lengths });
    offset = extra + 4 + psd.readUInt32BE(extra);
  }
  const layers = records.map(({ name, lengths }) => {
    const red = psd[offset + lengths[0] + 5];
    offset += lengths.reduce((sum, length) => sum + length, 0);
    return [name, red];
  });
  assert.deepEqual(layers, [['Paper', 255], ['Color', 77], ['Pen', 11]]);
  assert.deepEqual(stack.map(({ name }) => name), ['Pen', 'Color', 'Paper']);
});

test('source palette assigns a class to disjoint regions and stores a local edit only for the selected region', () => {
  const img = drawing(['.....', '..#..', '.....']);
  img.ink = Uint8Array.from('..#....#....#..', cell => cell === '#' ? 0 : 255);
  img.colorClasses = new Uint8Array(img.ink.length).fill(0);
  const layout = segment(img, 180);
  const left = layout.labels[0], right = layout.labels[4];
  assert.notEqual(left, right);
  const shared = resolveColors(layout, [], ['color']);
  assert.deepEqual([...shared.values()], ['color', 'color']);
  const erased = resolveColors(layout, [{ x: 0, y: 0, role: null }], ['color']);
  assert.equal(erased.get(left), undefined);
  assert.equal(erased.get(right), 'color');
});
