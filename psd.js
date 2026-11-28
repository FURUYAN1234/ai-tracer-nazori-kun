(function (root) {
  'use strict';
  function encode({ width, height }, stack, flat, activeLayer) {
    const chunks = [];
    function fields(...values) {
      const bytes = new Uint8Array(values.reduce((sum, [, size]) => sum + size, 0));
      const view = new DataView(bytes.buffer);
      let offset = 0;
      for (const [value, size] of values) {
        if (typeof value === 'string') {
          for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
        } else if (size === 1) view.setUint8(offset, value);
        else if (size === 2) view.setInt16(offset, value);
        else view.setUint32(offset, value);
        offset += size;
      }
      return bytes;
    }
    const u16 = value => fields([value, 2]);
    const u32 = value => fields([value, 4]);

    function record(layer, channels, id) {
      const { name, label, top, left, width, height, hidden, divider, locked } = layer;
      const nameSize = Math.ceil((name.length + 1) / 4) * 4;
      const pascal = fields([name.length, 1], [name, nameSize - 1]);
      const unicodeBlock = fields(['8BIMluni', 8], [4 + label.length * 2, 4],
        [label.length, 4], ...label.split('').map(character => [character.charCodeAt(0), 2]));
      const blocks = [unicodeBlock];
      if (id) blocks.push(fields(['8BIMlyid', 8], [4, 4], [id, 4]));
      if (divider) blocks.push(fields(['8BIMlsct', 8], [4, 4], [divider, 4]));
      if (locked) blocks.push(fields(['8BIMlspf', 8], [4, 4], [0x80000007, 4]));
      const extraSize = 8 + pascal.byteLength + blocks.reduce((length, block) => length + block.byteLength, 0);
      return [
        fields([top, 4], [left, 4], [top + height, 4], [left + width, 4], [4, 2],
          ...[-1, 0, 1, 2].flatMap((id, index) => [[id, 2], [channels[index].size, 4]]),
          ['8BIMnorm', 8], [255, 1], [0, 1], [hidden ? 2 : 0, 1], [0, 1],
          [extraSize, 4], [0, 4], [0, 4]),
        pascal, ...blocks,
      ];
    }

    function plane(rgba, channel) {
      const count = rgba.length / 4;
      const data = new Uint8Array(count);
      for (let i = 0; i < count; i++) data[i] = rgba[i * 4 + channel];
      return data;
    }

    function packedChannel(layer, channel) {
      const { width, height, pixels } = layer;
      if (!width || !height) return { size: 2, data: u16(0) };
      const lengths = new Uint8Array(height * 2);
      const lengthsView = new DataView(lengths.buffer);
      const rows = [];
      const buffer = new Uint8Array(width * 2);
      let size = lengths.length + 2;
      for (let row = 0; row < height; row++) {
        const base = (row * width) * 4 + channel;
        const read = x => pixels[base + x * 4];
        let x = 0, offset = 0;
        while (x < width) {
          let run = 1;
          while (run < 128 && x + run < width && read(x + run) === read(x)) run++;
          if (run >= 3) {
            buffer[offset++] = 257 - run;
            buffer[offset++] = read(x);
            x += run;
            continue;
          }
          const literal = x++;
          while (x < width && x - literal < 128
              && !(x + 2 < width && read(x) === read(x + 1) && read(x) === read(x + 2))) x++;
          buffer[offset++] = x - literal - 1;
          for (let i = literal; i < x; i++) buffer[offset++] = read(i);
        }
        lengthsView.setUint16(row * 2, offset);
        rows.push(buffer.slice(0, offset));
        size += offset;
      }
      const data = new Uint8Array(size);
      new DataView(data.buffer).setUint16(0, 1);
      data.set(lengths, 2);
      let offset = lengths.length + 2;
      for (const row of rows) {
        data.set(row, offset);
        offset += row.length;
      }
      return { size, data };
    }

    const records = [];
    const imageData = [];
    // Photoshop reads PSD layers from bottom to top. The editor stack is top to bottom.
    for (let index = stack.length - 1; index >= 0; index--) {
      const layer = stack[index];
      const channels = [3, 0, 1, 2].map(channel => packedChannel(layer, channel));
      records.push(...record(layer, channels, activeLayer === undefined ? 0 : stack.length - index));
      imageData.push(...channels.map(channel => channel.data));
    }
    const layers = [u16(stack.length), ...records, ...imageData];
    const length = layers.reduce((sum, bytes) => sum + bytes.length, 0);
    if (length % 2) layers.push(new Uint8Array(1));
    const padded = length + length % 2;
    const resources = [];
    if (activeLayer !== undefined) {
      const target = stack.length - 1 - activeLayer;
      resources.push(fields(['8BIM', 4], [1024, 2], [0, 2], [2, 4], [target, 2]));
      resources.push(fields(['8BIM', 4], [1069, 2], [0, 2], [6, 4], [1, 2], [target + 1, 4]));
    }
    chunks.push(fields(['8BPS', 4], [1, 2], [0, 2], [0, 4], [3, 2],
      [height, 4], [width, 4], [8, 2], [3, 2], [0, 4],
      [resources.reduce((length, resource) => length + resource.byteLength, 0), 4]), ...resources);
    chunks.push(u32(padded + 8), u32(padded), ...layers, u32(0),
      u16(0), plane(flat, 0), plane(flat, 1), plane(flat, 2));
    return chunks;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = encode;
  else root.KomaPSD = encode;
})(globalThis);
