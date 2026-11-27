'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const E = require('./engine.js');
const PNG = require('./png.cjs');
const PSD = require('./psd.js');
const { version } = require('./package.json');

const versions = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const tool = {
  name: 'nazori_trace_png',
  title: 'Trace and color a local PNG',
  description: 'Rebuilds ink contours, recovers original flat colors, and creates PNG, PSD with separate ink and editable color layers, SVG and coordinate JSON in a new workspace subfolder.',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Relative path to an 8-bit non-interlaced PNG, at most 1600x1600.' },
      pen: { type: 'string', enum: ['g', 'fine', 'brush', 'original'], default: 'g' },
      strength: { type: 'integer', minimum: 0, maximum: 100, default: 100 },
      threshold: { type: 'integer', minimum: 32, maximum: 248, default: 180 },
    },
    required: ['input'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

function trace(workspace, { input, pen = 'g', strength = 100, threshold = 180, ...other }) {
  if (typeof input !== 'string' || !input || path.isAbsolute(input) || path.extname(input).toLowerCase() !== '.png'
      || !tool.inputSchema.properties.pen.enum.includes(pen) || !Number.isInteger(strength) || strength < 0 || strength > 100
      || !Number.isInteger(threshold) || threshold < 32 || threshold > 248 || Object.keys(other).length)
    throw new Error('Specify a relative PNG path and valid pen settings.');
  const candidate = path.resolve(workspace, input);
  function inside(target) {
    const relative = path.relative(workspace, target);
    return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
  }
  if (!inside(candidate)) throw new Error('The input must be inside the configured workspace.');
  const file = fs.realpathSync(candidate);
  if (!inside(file) || path.extname(file).toLowerCase() !== '.png') throw new Error('The PNG must resolve inside the workspace.');
  const descriptor = fs.openSync(file, 'r');
  let buffer;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 24 * 1024 * 1024) throw new Error('The PNG must be a file under 24 MB.');
    buffer = fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const { width, height, rgba } = PNG.decode(buffer);
  const image = E.inspectRaster(rgba, width, height);
  const layout = E.segment(image, threshold);
  const { contours, rebuilt } = E.rebuildInk(image, threshold);
  const outputInk = E.stylizeInk(rebuilt, pen, strength / 100);
  const sourceRoles = image.isColor ? image.palette.map(E.swatchHex).map(hex => hex === '#ffffff' ? null : hex) : [];
  const palette = Object.fromEntries(sourceRoles.filter(Boolean).map(hex => [hex, hex]));
  const assignment = E.resolveColors(layout, [], sourceRoles);
  const final = E.paint(outputInk, layout, assignment, palette);
  const layers = E.makeLayers(outputInk, layout, assignment,
    Object.keys(palette).filter(hex => hex !== '#ffffff').map(hex => ({ id: hex, name: '原稿色 ' + hex, hex })));
  const inkContours = pen === 'original' ? contours : E.traceInk(outputInk, 192);
  const svg = E.makeSvg(image, inkContours, layers);
  const folder = fs.mkdtempSync(path.join(workspace, 'nazori-'));
  const artifacts = [
    ['trace.png', PNG.encode(width, height, final)],
    ['trace.psd', Buffer.concat(PSD(image, layers, final))],
    ['trace.svg', svg],
    ['coordinates.json', JSON.stringify({ format: 'nazori-coordinates/1', width, height, units: 'px', origin: 'top-left',
      pen, strength, inkContours, replayContours: [...contours].sort((a, b) => b.length - a.length), sourceRoles, palette })],
  ];
  for (const [name, content] of artifacts) fs.writeFileSync(path.join(folder, name), content, { flag: 'wx' });
  return { width, height, source: image.isColor ? 'color' : 'monochrome', colorLayers: layers.length - 2,
    paths: artifacts.map(([name]) => path.relative(workspace, path.join(folder, name)).split(path.sep).join('/')) };
}

function createMcpSession(directory) {
  const workspace = fs.realpathSync(directory);
  if (!fs.statSync(workspace).isDirectory()) throw new Error('A workspace directory is required.');
  let phase = 'new';
  const response = data => ({ jsonrpc: '2.0', ...data });

  return message => {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
      return response({ id: message?.id ?? null, error: { code: -32600, message: 'Invalid request.' } });
    if (!Object.hasOwn(message, 'id')) {
      if (message.method === 'notifications/initialized' && phase === 'initializing') phase = 'ready';
      return;
    }
    const { id, method, params } = message;
    if (method === 'initialize' && phase === 'new') {
      phase = 'initializing';
      const protocolVersion = versions.has(params?.protocolVersion) ? params.protocolVersion : '2025-11-25';
      return response({ id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'nazori-kun', version } } });
    }
    if (method === 'ping') return response({ id, result: {} });
    if (phase !== 'ready') return response({ id, error: { code: -32002, message: 'Initialize the MCP session first.' } });
    if (method === 'tools/list') return response({ id, result: { tools: [tool] } });
    if (method === 'tools/call' && params?.name === tool.name) {
      try {
        const result = trace(workspace, params.arguments ?? {});
        return response({ id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } });
      } catch (error) {
        const message = error.code ? 'The PNG could not be opened or written inside the workspace.' : error.message;
        return response({ id, result: { isError: true, content: [{ type: 'text', text: message }] } });
      }
    }
    return response({ id, error: { code: method === 'tools/call' ? -32602 : -32601, message: 'Unknown method or tool.' } });
  };
}

module.exports = { createMcpSession };

if (require.main === module) {
  if (process.argv[2] !== '--workspace' || !process.argv[3]) {
    process.stderr.write('Usage: node mcp.cjs --workspace <input/output directory>\n');
    process.exit(2);
  }
  const dispatch = createMcpSession(process.argv[3]);
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  input.on('line', line => {
    let message;
    try {
      if (line.length > 65536) throw new Error('Request too large.');
      message = JSON.parse(line);
    } catch {
      message = undefined;
    }
    const result = message === undefined
      ? { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC frame.' } }
      : dispatch(message);
    if (result) process.stdout.write(JSON.stringify(result) + '\n');
  });
}
