// Reads a QR code the plugin draws (pages.js, qrSvg) as a camera would: its SVG's modules painted
// into an image, decoded by jsQR (a reader of its own, not the encoder's code).

import assert from "node:assert/strict";

import jsQR from "jsqr";

/** The modules of a QR code's SVG (quiet zone included): rows of booleans, true for dark. */
export function svgModules(svg) {
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.ok(view && view[1] === view[2], "a square viewBox");
  const full = Number(view[1]);
  const path = /<path fill="#000000" d="([^"]*)"\/>/.exec(svg);
  assert.ok(path, "one path of dark modules");
  const modules = Array.from({ length: full }, () => new Array(full).fill(false));
  const run = /M(\d+) (\d+)h(\d+)v1h-\3z/g;
  let read = 0;
  for (let m = run.exec(path[1]); m; m = run.exec(path[1])) {
    assert.equal(m.index, read, "nothing but runs of modules in the path");
    const [x, y, length] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < length; i += 1) modules[y][x + i] = true;
    read = m.index + m[0].length;
  }
  assert.equal(read, path[1].length, "nothing but runs of modules in the path");
  return modules;
}

/** The text of a QR code's SVG, decoded from an image of it at `px` pixels per module. */
export function readQr(svg, px = 4) {
  const modules = svgModules(svg);
  const size = modules.length * px;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = modules[Math.floor(y / px)][Math.floor(x / px)] ? 0 : 255;
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const code = jsQR(pixels, size, size, { inversionAttempts: "dontInvert" });
  return code ? code.data : null;
}
