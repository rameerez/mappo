// A body from a raster: a global map image whose pixels carry ONE scalar the
// figure is a threshold of — brightness for the Moon's maria, elevation for
// Mars's lowlands. The generator for each body chooses only how a pixel
// becomes that scalar, which fraction of the sphere the figure should cover,
// and which named places check the result.
//
// The threshold is found by area, not by eye: binary search until the
// cos(lat)-weighted fraction of cells below it hits the published figure. An
// equirectangular raster over-weights the poles, so a naive pixel count would
// pick the wrong level.

import { traceCells } from "../../src/figure.js";
import { encodeRings, maskAt, packBits } from "./codec.js";
import { simplifyRing } from "./geometry.js";
import { readImage } from "./image.js";

const RAD = Math.PI / 180;

export function classifyRaster({
  imagePath,
  valueAt,                    // (r, g, b) → the scalar; the figure is where it is BELOW the threshold
  targetCoverage,             // fraction of the sphere the figure should cover
  maskWidth = 512,
  maskHeight = 256,
  poleCut = 90,               // |lat| beyond this is never figure (polar shadow is not basalt)
  roll = 0,                   // degrees to rotate the source so 0° sits at the centre column
  thresholdRange = [ 0, 255 ],
  epsilon = 0.22,             // Douglas-Peucker tolerance for the traced rings, degrees
  minPoints = 10              // rings simplified below this many points are dropped
}) {
  if (typeof valueAt !== "function") throw new TypeError("valueAt must be a function");
  if (!(targetCoverage > 0 && targetCoverage < 1)) throw new RangeError("targetCoverage must be between 0 and 1");
  if (!Number.isInteger(maskWidth) || maskWidth <= 0 || !Number.isInteger(maskHeight) || maskHeight <= 0) {
    throw new RangeError("maskWidth and maskHeight must be positive integers");
  }

  const { width, height, rgba } = readImage(imagePath);
  const values = new Float32Array(width * height);
  const shift = Math.round((width * roll) / 360);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = (((x + shift) % width) + width) % width;
      const i = (y * width + sx) * 4;
      const v = valueAt(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (!Number.isFinite(v)) throw new Error(`${imagePath}: non-finite value at pixel ${sx},${y}`);
      values[y * width + x] = v;
    }
  }

  const cells = downsample(values, width, height, maskWidth, maskHeight);
  const latOfRow = (row, rows) => 90 - ((row + 0.5) / rows) * 180;
  const weights = Array.from({ length: maskHeight }, (_, row) => Math.cos(latOfRow(row, maskHeight) * RAD));
  const totalWeight = weights.reduce((sum, w) => sum + w * maskWidth, 0);
  const coverage = (threshold) => {
    let inside = 0;
    for (let row = 0; row < maskHeight; row++) {
      if (Math.abs(latOfRow(row, maskHeight)) > poleCut) continue;
      for (let col = 0; col < maskWidth; col++) {
        if (cells[row * maskWidth + col] < threshold) inside += weights[row];
      }
    }
    return inside / totalWeight;
  };

  let [ lo, hi ] = thresholdRange;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (coverage(mid) < targetCoverage) lo = mid; else hi = mid;
  }
  const threshold = (lo + hi) / 2;

  const bits = new Uint8Array(Math.ceil((maskWidth * maskHeight) / 8));
  for (let row = 0; row < maskHeight; row++) {
    if (Math.abs(latOfRow(row, maskHeight)) > poleCut) continue;
    for (let col = 0; col < maskWidth; col++) {
      if (cells[row * maskWidth + col] >= threshold) continue;
      const index = row * maskWidth + col;
      bits[index >> 3] |= 1 << (index & 7);
    }
  }

  // Contours at the source's full resolution, with the SAME tracer the
  // renderer uses for grid outlines. The antimeridian is a hard edge here (no
  // wrap): a region that crosses it becomes two rings hugging the seam, which
  // is what a cylindrical map wants and the only way every ring closes.
  const inside = (col, row) => row >= 0 && row < height && col >= 0 && col < width &&
    Math.abs(latOfRow(row, height)) <= poleCut && values[row * width + col] < threshold;
  const { loops } = traceCells(width, height, inside);
  for (const loop of loops) {
    if (loop[0][0] !== loop[loop.length - 1][0] || loop[0][1] !== loop[loop.length - 1][1]) {
      throw new Error("a traced contour did not close");
    }
  }
  const rings = loops
    .filter((loop) => loop.length > 8)
    .map((loop) => loop.map(([ col, row ]) => [ 90 - (row / height) * 180, -180 + (col / width) * 360 ]))
    .map((ring) => simplifyRing(ring, epsilon))
    .filter((ring) => ring.length >= minPoints)
    .sort((a, b) => b.length - a.length);

  return {
    mask: { width: maskWidth, height: maskHeight, bits, base64: packBits(bits) },
    threshold,
    coverage: coverage(threshold),
    rings,
    outlines: encodeRings(rings),
    at: (lat, lon) => maskAt(bits, maskWidth, maskHeight, lat, lon)
  };
}

// Box-filter the source into the mask grid: each cell is the mean of the
// pixels it covers, so a threshold applied to it is applied to the area, not
// to whichever pixel happened to sit at the centre.
function downsample(values, width, height, targetWidth, targetHeight) {
  const cells = new Float32Array(targetWidth * targetHeight);
  const sx = width / targetWidth, sy = height / targetHeight;
  for (let row = 0; row < targetHeight; row++) {
    for (let col = 0; col < targetWidth; col++) {
      let sum = 0, count = 0;
      for (let y = Math.floor(row * sy); y < Math.ceil((row + 1) * sy); y++) {
        for (let x = Math.floor(col * sx); x < Math.ceil((col + 1) * sx); x++) {
          sum += values[y * width + x];
          count++;
        }
      }
      cells[row * targetWidth + col] = sum / count;
    }
  }
  return cells;
}

// Area-weighted fraction of a lat/lon window that the mask calls figure.
// Used for the held-out checks (the Moon's near side).
export function coverageWithin(at, { latMin = -90, latMax = 90, lonMin = -180, lonMax = 180 } = {}) {
  let inside = 0, total = 0;
  for (let lat = latMin + 0.5; lat < latMax; lat += 1) {
    const weight = Math.cos(lat * RAD);
    for (let lon = lonMin + 0.5; lon < lonMax; lon += 1) {
      total += weight;
      if (at(lat, lon)) inside += weight;
    }
  }
  return inside / total;
}
