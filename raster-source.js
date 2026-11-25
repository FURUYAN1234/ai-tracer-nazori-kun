(function (root) {
  'use strict';
  const previewEdge = 1600;
  const inputPixels = 32_000_000;
  const originalPixels = 16_000_000;
  const originalEdge = 8192;
  const fileLimit = 24 * 1024 * 1024;

  function sourceSize(bytes, type) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
    const size = bytes.length;
    if (type === 'image/png' && size >= 24 && view.getUint32(0) === 0x89504e47
        && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(8) === 13 && ascii(12, 4) === 'IHDR') {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (type === 'image/jpeg' && size >= 4 && view.getUint16(0) === 0xffd8) {
      let offset = 2;
      while (offset + 4 <= size && bytes[offset++] === 0xff) {
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9 || offset + 2 > size) break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > size) break;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
          return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
        }
        offset += length;
      }
    }
    if (type === 'image/webp' && size >= 25 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const chunk = ascii(12, 4);
      if (chunk === 'VP8X' && size >= 30) {
        const u24 = i => bytes[i] + (bytes[i + 1] << 8) + (bytes[i + 2] << 16);
        return { width: 1 + u24(24), height: 1 + u24(27) };
      }
      if (chunk === 'VP8L' && bytes[20] === 0x2f) {
        const bits = view.getUint32(21, true);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
      }
      if (chunk === 'VP8 ' && size >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
    }
    throw new Error('画像の寸法を読み取れませんでした。');
  }

  function checkInputSize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw new Error('画像の寸法を読み取れませんでした。');
    if (width * height > inputPixels || Math.max(width, height) > originalEdge)
      throw new Error('画像は3,200万画素以下、各辺8,192px以下にしてください。');
  }

  async function inspectFile(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('PNG、JPEG、WebPを読み込めます。');
    if (file.size > fileLimit) throw new Error('画像は1枚あたり24 MBまでです。');
    const header = file.type === 'image/jpeg' ? file : file.slice(0, 30);
    const size = sourceSize(new Uint8Array(await header.arrayBuffer()), file.type);
    checkInputSize(size.width, size.height);
    return size;
  }

  function previewSize(width, height) {
    const scale = Math.min(1, previewEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function canExportOriginal(width, height) {
    return width * height <= originalPixels && Math.max(width, height) <= originalEdge;
  }

  function scaleEdits(panel, width, height) {
    const x = n => Math.floor((n + 0.5) * width / panel.width);
    const y = n => Math.floor((n + 0.5) * height / panel.height);
    const bx = n => panel.width === 1 ? x(n) : Math.round(n * (width - 1) / (panel.width - 1));
    const by = n => panel.height === 1 ? y(n) : Math.round(n * (height - 1) / (panel.height - 1));
    return {
      markers: panel.markers.map(mark => ({ ...mark, x: x(mark.x), y: y(mark.y) })),
      barriers: panel.barriers.map(([x0, y0, x1, y1]) => [bx(x0), by(y0), bx(x1), by(y1)]),
    };
  }

  const source = { fileLimit, originalPixels, inspectFile, sourceSize, checkInputSize, previewSize, canExportOriginal, scaleEdits };
  if (typeof module !== 'undefined' && module.exports) module.exports = source;
  else root.NazoriRaster = source;
})(globalThis);
