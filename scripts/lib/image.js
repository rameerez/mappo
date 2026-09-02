// Raster input for the generators. Two pure-JS decoders (dev dependencies —
// the published package still depends on nothing) so a pack can be rebuilt on
// any platform from the original PNG or JPEG, with no image tool in between.

import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

// → { width, height, rgba: Uint8Array } with four bytes per pixel, row-major
// from the top-left, whatever the source format.
export function readImage(path) {
  const bytes = readFileSync(path);
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length) };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: image.width, height: image.height, rgba: image.data };
  }
  throw new Error(`${path}: not a PNG or JPEG`);
}

// The generator tests build their inputs with this; it is not on any
// production path.
export function writePng(path, width, height, rgba) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  writeFileSync(path, PNG.sync.write(png));
}
