(function (root) {
  'use strict';

  function drawBarrier(labels, width, height, [x0, y0, x1, y1]) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      if (x0 >= 0 && y0 >= 0 && x0 < width && y0 < height) labels[y0 * width + x0] = -1;
      if (x0 === x1 && y0 === y1) return;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += stepX; }
      if (twice <= dx) { error += dx; y0 += stepY; }
    }
  }

  function segment({ width, height, ink, colorClasses, palette }, threshold, barriers = [], regionLimit = Infinity) {
    const labels = new Int32Array(ink.length);
    const queue = new Int32Array(ink.length);
    const regions = [];
    for (let i = 0; i < ink.length; i++) {
      if (ink[i] < threshold) labels[i] = -1;
    }
    for (const barrier of barriers) drawBarrier(labels, width, height, barrier);
    for (let index = 0; index < labels.length; index++) {
      if (labels[index] !== 0) continue;
      if (regions.length >= regionLimit) throw new Error('塗り分けが複雑なため、プレビュー寸法で保存してください。');
      const id = regions.length + 1;
      let size = 0;
      let touchesEdge = false;
      let next = 0;
      let xMin = width, xMax = 0, yMin = height, yMax = 0;
      const color = colorClasses?.[index];
      function enqueue(point) {
        if (labels[point] === 0 && colorClasses?.[point] === color) {
          labels[point] = id;
          queue[size++] = point;
        }
      }
      enqueue(index);
      while (next < size) {
        const p = queue[next++];
        const x = p % width;
        const y = Math.floor(p / width);
        xMin = Math.min(x, xMin); xMax = Math.max(x, xMax);
        yMin = Math.min(y, yMin); yMax = Math.max(y, yMax);
        if (x !== 0) enqueue(p - 1); else touchesEdge = true;
        if (x !== width - 1) enqueue(p + 1); else touchesEdge = true;
        if (p >= width) enqueue(p - width); else touchesEdge = true;
        if (p < labels.length - width) enqueue(p + width); else touchesEdge = true;
      }
      regions.push({ id, size, touchesEdge, xMin, xMax, yMin, yMax, colorClass: color, color: palette?.[color] });
    }
    return { width, height, labels, regions };
  }

  function regionAt({ width, height, labels }, x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return -1;
    return labels[y * width + x];
  }

  function resolveColors(layout, markers, sourceRoles = []) {
    const colors = new Map();
    if (sourceRoles.length) {
      for (const { id, colorClass } of layout.regions) {
        const role = sourceRoles[colorClass];
        if (role) colors.set(id, role);
      }
    }
    for (const { x, y, role } of markers) {
      const id = regionAt(layout, x, y);
      if (id > 0) {
        if (role === null) colors.delete(id);
        else colors.set(id, role);
      }
    }
    return colors;
  }

  function traceInk({ width, height, ink }, threshold, edgeLimit = Infinity) {
    const stride = width + 1;
    const edges = new Uint8Array(stride * (height + 1));
    const offsets = [1, stride, -1, -stride];
    let remaining = edgeLimit;
    // Follow clockwise boundaries of black pixels, retaining the opposite winding of holes.
    for (let i = 0; i < ink.length; i++) {
      if (ink[i] >= threshold) continue;
      const x = i % width;
      const corner = Math.floor(i / width) * stride + x;
      if (i < width || ink[i - width] >= threshold) { edges[corner] |= 1; remaining--; }
      if (x === width - 1 || ink[i + 1] >= threshold) { edges[corner + 1] |= 2; remaining--; }
      if (i >= ink.length - width || ink[i + width] >= threshold) { edges[corner + stride + 1] |= 4; remaining--; }
      if (x === 0 || ink[i - 1] >= threshold) { edges[corner + stride] |= 8; remaining--; }
      if (remaining < 0) throw new Error('輪郭が複雑なため、プレビュー寸法で保存してください。');
    }
    const contours = [];
    for (let start = 0; start < edges.length; start++) {
      while (edges[start]) {
        let direction = 31 - Math.clz32(edges[start] & -edges[start]);
        const points = [[start % stride, Math.floor(start / stride)]];
        let corner = start;
        let length = 0;
        while (true) {
          edges[corner] &= ~(1 << direction);
          corner += offsets[direction];
          length++;
          if (corner === start) break;
          // Favor a right turn at a diagonal contact so the shapes stay independent.
          const next = [1, 0, 3, 2].map(turn => (direction + turn) % 4)
            .find(candidate => (edges[corner] & (1 << candidate)) !== 0);
          if (next === undefined) throw new Error('Unclosed ink boundary');
          if (next !== direction) points.push([corner % stride, Math.floor(corner / stride)]);
          direction = next;
        }
        contours.push({ points, length });
      }
    }
    return contours;
  }

  function rebuildInk({ width, height, ink }, threshold, edgeLimit) {
    const contours = traceInk({ width, height, ink }, threshold, edgeLimit);
    const rebuilt = new Uint8Array(ink.length).fill(255);
    const crossings = Array.from({ length: height }, () => []);
    for (const { points } of contours) {
      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i];
        const [nx, ny] = points[(i + 1) % points.length];
        if (x !== nx) continue;
        for (let row = Math.min(y, ny); row < Math.max(y, ny); row++) crossings[row].push(x);
      }
    }
    for (let y = 0; y < height; y++) {
      crossings[y].sort((a, b) => a - b);
      for (let i = 0; i < crossings[y].length; i += 2) {
        rebuilt.fill(0, y * width + crossings[y][i], y * width + crossings[y][i + 1]);
      }
    }
    return { contours, rebuilt: { width, height, ink: rebuilt } };
  }

  function traceWeight(length) {
    return length ** .82 * (length <= 8 ? .17 : 1);
  }

  function inkCrossSection({ width, height, ink }, edgeX, edgeY, dx, dy) {
    const normalX = -dy, normalY = dx;
    const insideX = Math.floor(edgeX + normalX * .5);
    const insideY = Math.floor(edgeY + normalY * .5);
    function scan(x, y, stepX, stepY) {
      let count = 0;
      while (x >= 0 && x < width && y >= 0 && y < height && ink[y * width + x] < 224) {
        count++;
        x += stepX;
        y += stepY;
      }
      return count;
    }
    return scan(insideX, insideY, normalX, normalY)
      + scan(insideX - normalX, insideY - normalY, -normalX, -normalY);
  }

  function inkTimeline({ width, height, ink }, paths, total) {
    const time = new Float32Array(ink.length).fill(Infinity);
    const queue = new Int32Array(ink.length);
    let count = 0;
    let start = 0;
    function seed(x, y, fraction) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = y * width + x;
      if (ink[index] === 255 || time[index] !== Infinity) return;
      time[index] = fraction;
      queue[count++] = index;
    }
    for (const { points, length } of paths) {
      const window = traceWeight(length) / total;
      let traveled = 0;
      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i];
        const [nx, ny] = points[(i + 1) % points.length];
        const dx = Math.sign(nx - x), dy = Math.sign(ny - y);
        const span = Math.abs(nx - x) + Math.abs(ny - y);
        for (let step = 0; step < span; step++) {
          const tx = x + dx * step, ty = y + dy * step;
          const fraction = start + (traveled + step) / length * window;
          seed(tx, ty, fraction);
          seed(tx - 1, ty, fraction);
          seed(tx, ty - 1, fraction);
          seed(tx - 1, ty - 1, fraction);
        }
        traveled += span;
      }
      start += window;
    }
    // Wide ink fills inward from the boundary near the current stroke.
    for (let i = 0; i < count; i++) {
      const point = queue[i];
      const x = point % width, y = Math.floor(point / width);
      const delay = Math.min(1, time[point] + .002);
      seed(x - 1, y, delay);
      seed(x + 1, y, delay);
      seed(x, y - 1, delay);
      seed(x, y + 1, delay);
    }
    for (let i = 0; i < time.length; i++) if (ink[i] < 255 && time[i] === Infinity) time[i] = 1;
    return time;
  }

  function stylizeInk(image, style, strength = 1) {
    if (style === 'original') return image;
    if (style === 'g' && strength === 0) return image;
    const { width, height, ink } = image;
    const values = new Uint8Array(ink.length);
    const radius = Math.min(3, Math.max(1, Math.round(Math.max(width, height) / 570)));
    const stride = width + 1;
    const summed = new Float64Array(stride * (height + 1));
    for (let y = 1; y <= height; y++) {
      let row = 0;
      for (let x = 1; x <= width; x++) {
        row += 255 - ink[(y - 1) * width + x - 1];
        summed[y * stride + x] = summed[(y - 1) * stride + x] + row;
      }
    }
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const left = Math.max(0, x - radius);
        const right = Math.min(width, x + radius + 1);
        const support = (summed[bottom * stride + right] - summed[top * stride + right]
          - summed[bottom * stride + left] + summed[top * stride + left])
          / (255 * (right - left) * (bottom - top));
        const alpha = 1 - ink[i] / 255;
        let opacity;
        if (style === 'fine') {
          opacity = alpha * Math.min(1, .29 + support * 1.07);
        } else if (style === 'brush') {
          opacity = Math.min(1, alpha * (.88 + support * .45) + (1 - alpha) * Math.max(0, support - .08) * 1.9);
        } else {
          const pressure = .27 + .73 * Math.min(1, Math.max(0, support - .22) / .41);
          const shaped = alpha * pressure + (1 - alpha) * Math.min(.68, Math.max(0, support - .19) * 2.15);
          opacity = alpha + (shaped - alpha) * strength;
        }
        values[i] = Math.round(255 * (1 - opacity));
      }
    }
    return { ...image, ink: values };
  }

  function inspectRaster(rgba, width, height, sourcePalette) {
    const count = width * height;
    const ink = new Uint8Array(count);
    const luminance = new Uint8Array(count);
    const chroma = new Uint8Array(count);
    let chromatic = 0;
    for (let i = 0; i < count; i++) {
      const k = i * 4;
      const alpha = rgba[k + 3] / 255;
      const spread = Math.max(rgba[k], rgba[k + 1], rgba[k + 2]) - Math.min(rgba[k], rgba[k + 1], rgba[k + 2]);
      chroma[i] = Math.round(spread * alpha);
      if (chroma[i] >= 18) chromatic++;
      const luma = .2126 * rgba[k] + .7152 * rgba[k + 1] + .0722 * rgba[k + 2];
      luminance[i] = Math.round(255 + (luma - 255) * alpha);
    }
    const isColor = chromatic > Math.max(3, .004 * count);
    if (!isColor) ink.set(luminance);
    else {
      const radius = Math.max(1, Math.min(5, Math.round(Math.max(width, height) / 305)));
      for (let i = 0; i < count; i++) {
        const x = i % width, y = Math.floor(i / width);
        const lx = Math.min(radius, x), rx = Math.min(radius, width - 1 - x);
        const uy = Math.min(radius, y) * width, dy = Math.min(radius, height - 1 - y) * width;
        const surround = Math.max(
          Math.min(luminance[i - lx], luminance[i + rx]),
          Math.min(luminance[i - uy], luminance[i + dy]),
          Math.min(luminance[i - lx - uy], luminance[i + rx + dy]),
          Math.min(luminance[i + rx - uy], luminance[i - lx + dy]),
        );
        const light = luminance[i];
        const spread = chroma[i];
        const black = 2.1 * light + 4.2 * spread + 30;
        const ridge = 222 - Math.max(0, surround - light) * 2.7 + .9 * spread + Math.max(0, light - 112) * 1.8;
        ink[i] = Math.min(255, Math.max(0, Math.min(black, ridge)));
      }
    }
    const swatches = sourcePalette?.length ? classifySwatches(rgba, sourcePalette)
      : isColor ? detectSwatches(rgba, ink) : {};
    return { width, height, ink, isColor, rgba, ...swatches };
  }

  function detectSwatches(rgba, ink) {
    const histogram = new Map();
    const step = ink.length > 50000 ? 3 : 1;
    function key(r, g, b) {
      return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    }
    for (let i = 0; i < ink.length; i += step) {
      if (ink[i] < 155) continue;
      const k = i * 4;
      const alpha = rgba[k + 3] / 255;
      const r = Math.round(255 + (rgba[k] - 255) * alpha);
      const g = Math.round(255 + (rgba[k + 1] - 255) * alpha);
      const b = Math.round(255 + (rgba[k + 2] - 255) * alpha);
      const bin = key(r, g, b);
      const cell = histogram.get(bin) ?? [0, 0, 0, 0];
      cell[0] += r; cell[1] += g; cell[2] += b; cell[3]++;
      histogram.set(bin, cell);
    }
    const peaks = [...histogram.values()].sort((a, b) => b[3] - a[3]);
    const palette = [];
    for (const [rs, gs, bs, frequency] of peaks) {
      if (palette.length && frequency < Math.max(1, ink.length * .00009 / step)) break;
      const r = Math.round(rs / frequency), g = Math.round(gs / frequency), b = Math.round(bs / frequency);
      if (!palette.some(color => distance(r, g, b, color) < 25 ** 2)) palette.push([r, g, b]);
      if (palette.length >= 34) break;
    }
    if (!palette.length) palette.push([255, 255, 255]);
    return classifySwatches(rgba, palette);
  }

  function distance(r, g, b, color) {
    return (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
  }

  function classifySwatches(rgba, palette) {
    const lookup = new Uint8Array(32768).fill(255);
    const colorClasses = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < colorClasses.length; i++) {
      const k = i * 4;
      const a = rgba[k + 3] / 255;
      const r = Math.round(255 + (rgba[k] - 255) * a);
      const g = Math.round(255 + (rgba[k + 1] - 255) * a);
      const b = Math.round(255 + (rgba[k + 2] - 255) * a);
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if (lookup[bin] === 255) {
        let best = Infinity;
        for (let j = 0; j < palette.length; j++) {
          const d = distance((r & ~7) + 4, (g & ~7) + 4, (b & ~7) + 4, palette[j]);
          if (d < best) { best = d; lookup[bin] = j; }
        }
      }
      colorClasses[i] = lookup[bin];
    }
    return { colorClasses, palette };
  }

  function sampleColors(layout, rgba) {
    const sums = layout.regions.map(() => [0, 0, 0, 0, -1]);
    for (let i = 0; i < layout.labels.length; i++) {
      const id = layout.labels[i];
      if (id <= 0) continue;
      const sum = sums[id - 1];
      const k = i * 4;
      const alpha = rgba[k + 3] / 255;
      for (let c = 0; c < 3; c++) sum[c] += 255 + (rgba[k + c] - 255) * alpha;
      sum[3]++;
      if (sum[4] < 0) sum[4] = i;
    }
    return sums.map(([r, g, b, count, point], i) => ({
      hex: swatchHex(layout.regions[i].color ?? [r / count, g / count, b / count]),
      x: point % layout.width, y: Math.floor(point / layout.width), size: count,
    }));
  }

  function swatchHex(color) {
    return '#' + color.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');
  }

  function rgb(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function paintLabel(labels, width, index) {
    if (labels[index] >= 0) return labels[index];
    const x = index % width;
    if (x > 0 && labels[index - 1] > 0) return labels[index - 1];
    if (x + 1 < width && labels[index + 1] > 0) return labels[index + 1];
    if (index >= width && labels[index - width] > 0) return labels[index - width];
    if (index + width < labels.length && labels[index + width] > 0) return labels[index + width];
    return -1;
  }

  function paint({ width, height, ink }, { labels, regions }, colors, palette, options = {}) {
    const { uncolored = '#ffffff', highlight, light = 0 } = options;
    const paper = rgb(uncolored);
    const values = Array.from({ length: regions.length + 1 }, () => paper);
    const selected = highlight && new Uint8Array(values.length);
    const edge = Math.max(1, Math.round(Math.max(width, height) / 800));
    const outlineColor = [185, 32, 125];
    for (const [id, role] of colors) {
      if (Object.hasOwn(palette, role)) values[id] = rgb(palette[role]);
      if (selected && role === highlight) selected[id] = 1;
    }
    const out = new Uint8ClampedArray(4 * ink.length);
    for (let i = 0; i < ink.length; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      // Color under the antialiasing of the original ink, keeping its luminance.
      const id = ink[i] === 0 ? labels[i] : paintLabel(labels, width, i);
      const color = id > 0 ? values[id] : paper;
      const role = colors.get(id);
      const tone = role && color !== paper && role !== 'white' ? light * (0.55 - (x / width + y / height) / 2) : 0;
      const outline = selected?.[labels[i]] && (x < edge || x >= width - edge || y < edge || y >= height - edge
        || !selected[labels[i - edge]] || !selected[labels[i + edge]]
        || !selected[labels[i - edge * width]] || !selected[labels[i + edge * width]]);
      for (let channel = 0; channel < 3; channel++) {
        const shaded = tone >= 0 ? color[channel] + (255 - color[channel]) * tone : color[channel] * (1 + tone);
        out[4 * i + channel] = outline ? outlineColor[channel] : shaded * ink[i] / 255;
      }
      out[4 * i + 3] = 255;
    }
    return out;
  }

  function makeLayers(inkImage, layout, assignments, roles, byteLimit = Infinity) {
    const { width, height, ink } = inkImage;
    const pen = new Uint8ClampedArray(4 * ink.length);
    const paper = new Uint8ClampedArray(pen.length).fill(255);
    const selected = new Set(assignments.values());
    const swatches = roles.filter(role => selected.has(role.id)).map(role => ({
      role, rgb: rgb(role.hex), left: width, top: height, right: 0, bottom: 0,
    }));
    const indexByRole = new Map(swatches.map(({ role }, index) => [role.id, index]));
    const regionToSwatch = new Int32Array(layout.regions.length + 1).fill(-1);
    for (const [region, role] of assignments) regionToSwatch[region] = indexByRole.get(role) ?? -1;
    const swatchAt = new Int32Array(ink.length).fill(-1);
    for (let i = 0; i < ink.length; i++) {
      pen[i * 4 + 3] = 255 - ink[i];
      const label = paintLabel(layout.labels, width, i);
      const index = regionToSwatch[label];
      if (!(index >= 0)) continue;
      const s = swatches[index];
      const x = i % width, y = Math.floor(i / width);
      s.left = Math.min(s.left, x); s.top = Math.min(s.top, y);
      s.right = Math.max(s.right, x + 1); s.bottom = Math.max(s.bottom, y + 1);
      swatchAt[i] = index;
    }
    let bytes = pen.length + paper.length;
    for (const s of swatches) {
      s.width = s.right - s.left;
      s.height = s.bottom - s.top;
      bytes += 4 * s.width * s.height;
    }
    if (bytes > byteLimit) throw new Error('色レイヤーが大きいため、プレビュー寸法で保存してください。');
    for (const s of swatches) {
      s.pixels = new Uint8ClampedArray(4 * s.width * s.height);
    }
    for (let i = 0; i < swatchAt.length; i++) {
      const index = swatchAt[i];
      if (index < 0) continue;
      const s = swatches[index];
      const k = (Math.floor(i / width) - s.top) * s.width + (i % width - s.left);
      s.pixels[4 * k] = s.rgb[0]; s.pixels[4 * k + 1] = s.rgb[1];
      s.pixels[4 * k + 2] = s.rgb[2]; s.pixels[4 * k + 3] = 255;
    }
    return [
      { name: 'Pen', label: 'ペン', left: 0, top: 0, width, height, pixels: pen },
      ...swatches.map((s, i) => ({ name: 'Color ' + (i + 1), label: s.role.name,
        left: s.left, top: s.top, width: s.width, height: s.height, pixels: s.pixels, hidden: s.role.hidden, hex: s.role.hex })),
      { name: 'Paper', label: '用紙', left: 0, top: 0, width, height, pixels: paper },
    ];
  }

  function makeSvg({ width, height }, contours, layers, edgeLimit = Infinity) {
    function paths(shapes) {
      return shapes.map(({ points }) => 'M' + points.map(([x, y]) => x + ' ' + y).join('L') + 'Z').join('');
    }
    const parts = layers.filter(layer => layer.hex).map((layer, i) => {
      const ink = new Uint8Array(layer.width * layer.height);
      for (let j = 0; j < ink.length; j++) ink[j] = 255 - layer.pixels[j * 4 + 3];
      const boundaries = traceInk({ width: layer.width, height: layer.height, ink }, 128, edgeLimit);
      edgeLimit -= boundaries.reduce((total, contour) => total + contour.length, 0);
      const visibility = layer.hidden ? ' display="none"' : '';
      return '<path id="color-' + (i + 1) + '" fill="' + layer.hex + '" d="' + paths(boundaries)
        + '" transform="translate(' + layer.left + ' ' + layer.top + ')"' + visibility + '/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height
      + '" viewBox="0 0 ' + width + ' ' + height + '"><g id="colors" fill-rule="nonzero">' + parts.join('')
      + '</g><path id="pen" fill="black" fill-rule="nonzero" d="' + paths(contours) + '"/></svg>';
  }

  const engine = { segment, regionAt, resolveColors, paint, traceInk, rebuildInk, inkTimeline, traceWeight, inkCrossSection, stylizeInk,
    inspectRaster, sampleColors, swatchHex, makeLayers, makeSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  else root.KomaEngine = engine;
})(globalThis);
