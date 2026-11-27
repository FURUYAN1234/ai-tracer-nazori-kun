# AI Tracer Nazori-kun v0.1.6 Technical Report

November 25, 2026 · FURU

## Abstract

Nazori-kun reads a raster illustration as an underdrawing and replays inking and coloring in a browser. The result can be exported as a composite image, closed paths, or separate editable color layers. The browser processes the source locally and requires no API key.

AI assisted with implementation. The main tracing and original-color recovery use image-processing algorithms.

## Method

1. **Ink detection.** For monochrome sources, the detector uses luminance over white. For color sources, it combines darkness, chroma, and contrast on either side of a candidate line. This helps separate thin dark lines from broad dark fills.
2. **Ink reconstruction.** The program follows closed perimeters, including holes. Scanline intersections reconstruct the ink mask. A G-pen preset varies ink strength near exposed tips and thicker segments according to local ink coverage. Fine pen, brush pen, and an unstyled outline are also available.
3. **Timing and cursor.** The simulated pen follows the perimeter. Ink appears near the cursor as it passes and progresses toward the interior of broader shapes. The program builds a traversal from the visible raster geometry. The creator's historical pen path is unknown.
4. **Coloring.** For colored sources, representative colors and ink boundaries determine the color regions. The virtual brush reveals color in passes restricted to a color mask. Tracing monochrome input produces line art. A color original receives its own color layers, which can be adjusted individually.

## Exports and integration

The workspace and WebM replay use a preview with a long edge of at most 1,600 pixels and a common scale on both axes. For original-size export, a web worker decodes the original file and rebuilds geometry from its pixels. The preview palette and color edits are preserved by projecting markers and separators into the original coordinate space. Import accepts up to 32 million pixels. Original-size export accepts up to 16 million pixels, subject to contour and layer complexity limits.

The monitor uses the same contour vertices and brush-tip coordinates as the replay. It estimates ink width by counting contiguous ink pixels perpendicular to the current contour segment. During coloring it reports the active color, the total target pixels in its regions, and replay progress for both the active color and the painting phase.

PNG provides a composite. PSD contains transparent ink, separate layers for assigned colors, and paper. SVG stores editable pen perimeters and color shapes. Coordinate JSON uses source pixels with a top-left origin. WebM records the replay. Project JSON retains originals, pen settings, color assignments, boundary edits, and speed settings.

The local MCP server supports standard input and output and authenticated Streamable HTTP through the Windows launcher. It accepts PNGs from a designated workspace and writes PNG, PSD, SVG, and coordinate JSON to a new directory under that workspace. The Windows batch launcher checks the official GitHub release and verifies files against the commit referenced by its tag before installing them. If the update fails, it uses a working version. The HTTP listener binds to 127.0.0.1 and requires a token generated at launch for MCP requests.

## Verification and limitations

The Chromium app was exercised at G-pen strength 100 with a detailed fine-line clock restorer and a full-color kite maker. The kite maker opens by default; the clock restorer is second in the image list. A live transition from inking to coloring was checked on two color examples. Color and monochrome PSDs displayed correctly in Photoshop 2026 with paper beneath the artwork. The tested color PSD contained one pen layer, 34 color layers, and one paper layer. The app was exercised for single-color edits, undo and redo, and saving and reopening a detailed project.

Photographs and continuous gradients are approximated. Low-contrast boundaries and overlapping dark colors may need adjustment.

## References

A public demonstration on X and a separate public repository were concept references. The internal implementation of the X demonstration remains unverified. The program, UI, and examples in this application were developed for Nazori-kun.

- [Public demonstration](https://x.com/masamune_sakaki/status/2125131744991199307)
- [line-trace-strokes](https://github.com/nekomimianko/line-trace-strokes)
- [Adobe Photoshop File Formats Specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)
- [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

Version 0.1.2 updates the user documentation. The tracing, coloring, and export pipelines match v0.1.1. The application header opens the PDF covering operation and API settings.

Version 0.1.3 adapts the header controls to the available width. Image import, project actions, and the manual retain their own controls.
