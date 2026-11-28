'use strict';
importScripts('engine.js', 'psd.js', 'raster-source.js');

const engine = self.KomaEngine;
const raster = self.NazoriRaster;
const limits = { edges: 1_500_000, regions: 150_000, layerBytes: 240 * 1024 * 1024 };

self.onmessage = async ({ data: { file, originalWidth, originalHeight, panel, roles, threshold, pen, strength, mode, type, paintingPreset } }) => {
  try {
    const { width, height } = await raster.inspectFile(file);
    if (!raster.canExportOriginal(width, height)) throw new Error('元寸保存は1,600万画素以下です。');
    const bitmap = await createImageBitmap(file);
    const surface = new OffscreenCanvas(originalWidth, originalHeight);
    const ctx = surface.getContext('2d', { willReadFrequently: true });
    try {
      if (bitmap.width !== originalWidth || bitmap.height !== originalHeight)
        throw new Error('原本の寸法が一致しません。画像を取り込み直してください。');
      ctx.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
    if (mode === 'source') {
      self.postMessage({ blob: await surface.convertToBlob({ type: 'image/png' }) });
      return;
    }

    const image = engine.inspectRaster(ctx.getImageData(0, 0, originalWidth, originalHeight).data,
      originalWidth, originalHeight, panel.palette);
    const edits = raster.scaleEdits(panel, image.width, image.height);
    const { contours, rebuilt } = engine.rebuildInk(image, threshold, limits.edges);
    const styled = engine.stylizeInk(rebuilt, pen, strength / 100);
    const shape = { width: image.width, height: image.height };
    let blob;
    if (type === 'json') {
      const inkContours = pen === 'original' ? contours : engine.traceInk(styled, 192, limits.edges);
      const data = { format: 'nazori-coordinates/1', units: 'px', origin: 'top-left', ...shape, pen, strength,
        inkContours: inkContours.map(({ points }) => ({ closed: true, points })),
        replayContours: [...contours].sort((a, b) => b.length - a.length)
          .map(({ points, length }) => ({ closed: true, length, points })),
        marks: edits.markers, sourceRoles: panel.sourceRoles, colorGroups: roles, separators: edits.barriers };
      blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    } else if (type === 'svg' && mode === 'ink') {
      const paths = pen === 'original' ? contours : engine.traceInk(styled, 192, limits.edges);
      blob = new Blob([engine.makeSvg(shape, paths, [])], { type: 'image/svg+xml' });
    } else {
      const layout = engine.segment(image, threshold, edits.barriers, limits.regions);
      const assignments = mode === 'ink' ? new Map() : engine.resolveColors(layout, edits.markers, panel.sourceRoles);
      const selected = mode === 'ink' ? [] : roles.map(role => ({ ...role, hex: role[mode] }));
      const colors = Object.fromEntries(selected.filter(role => !role.hidden).map(role => [role.id, role.hex]));
      if (type === 'svg') {
        const paths = pen === 'original' ? contours : engine.traceInk(styled, 192, limits.edges);
        const stack = engine.makeLayers(styled, layout, assignments, selected, limits.layerBytes);
        blob = new Blob([engine.makeSvg(shape, paths, stack, limits.edges)], { type: 'image/svg+xml' });
      } else if (type === 'psd') {
        const { stack, flat, activeLayer } = paintingPreset
          ? engine.makePaintingPsd(styled, layout, assignments, selected, paintingPreset, limits.layerBytes)
          : { stack: engine.makeLayers(styled, layout, assignments, selected, limits.layerBytes),
            flat: engine.paint(styled, layout, assignments, colors) };
        blob = new Blob(self.KomaPSD(shape, stack, flat, activeLayer), { type: 'image/vnd.adobe.photoshop' });
      } else {
        ctx.putImageData(new ImageData(engine.paint(styled, layout, assignments, colors), image.width, image.height), 0, 0);
        blob = await surface.convertToBlob({ type: 'image/png' });
      }
    }
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
