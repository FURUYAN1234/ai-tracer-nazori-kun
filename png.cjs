'use strict';
const { inflateSync, deflateSync, crc32 } = require('node:zlib');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decode(bytes) {
  if (!bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR'
      || bytes.length < 33 || bytes.readUInt32BE(8) !== 13) throw new Error('8-bit PNGを選んでください。');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const type = bytes[25];
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(type);
  if (!width || !height || width > 1600 || height > 1600 || bytes[24] !== 8
      || !channels || bytes[26] || bytes[27] || bytes[28])
    throw new Error('PNGは非インターレースの8-bit、縦横1600px以下にしてください。');
  const data = [];
  let palette, transparency, ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) throw new Error('PNGが途中で切れています。');
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    const block = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length))
      throw new Error('PNGのチェックサムが一致しません。');
    if (name === 'IEND') { ended = true; break; }
    if (name === 'IDAT') data.push(block);
    if (name === 'PLTE') palette = block;
    if (name === 'tRNS') transparency = block;
    offset += length + 12;
  }
  if (!ended || (type === 3 && !palette)) throw new Error('PNGデータが不足しています。');
  const stride = width * channels;
  const expected = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error('PNGの画像サイズが一致しません。');
  const rgba = new Uint8ClampedArray(width * height * 4);
  let prior = new Uint8Array(stride);
  let row = new Uint8Array(stride);

  function paeth(left, above, corner) {
    const estimate = left + above - corner;
    const first = Math.abs(estimate - left), second = Math.abs(estimate - above), third = Math.abs(estimate - corner);
    if (first <= second && first <= third) return left;
    return second <= third ? above : corner;
  }

  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1);
    const filter = raw[offset];
    if (filter > 4) throw new Error('PNGの行フィルターが壊れています。');
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0;
      const above = prior[i];
      const corner = i >= channels ? prior[i - channels] : 0;
      let prediction = 0;
      switch (filter) {
        case 1: prediction = left; break;
        case 2: prediction = above; break;
        case 3: prediction = (left + above) >> 1; break;
        case 4: prediction = paeth(left, above, corner); break;
      }
      row[i] = raw[offset + 1 + i] + prediction;
    }
    for (let x = 0; x < width; x++) {
      const i = x * channels, k = (y * width + x) * 4;
      if (type === 3) {
        const color = row[i] * 3;
        if (color + 2 >= palette.length) throw new Error('PNGのパレット番号が不正です。');
        rgba[k] = palette[color]; rgba[k + 1] = palette[color + 1]; rgba[k + 2] = palette[color + 2];
        rgba[k + 3] = transparency?.[row[i]] ?? 255;
      } else if (type === 0 || type === 4) {
        rgba[k] = rgba[k + 1] = rgba[k + 2] = row[i];
        rgba[k + 3] = type === 4 ? row[i + 1] : transparency?.length === 2 && row[i] === transparency.readUInt16BE(0) ? 0 : 255;
      } else {
        rgba[k] = row[i]; rgba[k + 1] = row[i + 1]; rgba[k + 2] = row[i + 2];
        const transparent = transparency?.length === 6 && rgba[k] === transparency.readUInt16BE(0)
          && rgba[k + 1] === transparency.readUInt16BE(2) && rgba[k + 2] === transparency.readUInt16BE(4);
        rgba[k + 3] = type === 6 ? row[i + 3] : transparent ? 0 : 255;
      }
    }
    [prior, row] = [row, prior];
  }
  return { width, height, rgba };
}

function encode(width, height, pixels) {
  function chunk(name, payload) {
    const bytes = Buffer.alloc(12 + payload.length);
    bytes.writeUInt32BE(payload.length);
    bytes.write(name, 4, 'ascii');
    payload.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, 8 + payload.length)), 8 + payload.length);
    return bytes;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = 4 * width + 1;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { decode, encode };
