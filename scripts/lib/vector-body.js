// A body from vector polygons (GeoJSON): the figure is the union of the
// polygons. Two products come out of the same features — a rasterised mask
// for the dot grid, and the simplified rings for figure-source="vector" — so
// the grid world and the vector world are the same world at two levels of
// detail, by construction.

import { encodeRings, packBits, packMask } from "./codec.js";
import { ringArea, simplifyRing } from "./geometry.js";

// Every polygon ring in the collection (outer rings AND holes), as [lat, lon].
export function geoJsonRings(geojson) {
  const rings = [];
  for (const feature of geojson.features) {
    const g = feature.geometry;
    if (!g) continue;
    const polygons = g.type === "Polygon" ? [ g.coordinates ] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const polygon of polygons) {
      for (const ring of polygon) rings.push(ring.map(([ lon, lat ]) => [ lat, lon ]));
    }
  }
  return rings;
}

// Scanline rasterisation with the even-odd rule: per row, every edge crossing
// the row's centre latitude is collected, sorted, and the cells between pairs
// are filled. Holes need no special handling — a point inside a hole crosses
// one extra edge and flips back out. O(edges × rows), a second or so.
export function rasterizeRings(rings, width, height) {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (let row = 0; row < height; row++) {
    const lat = 90 - ((row + 0.5) * 180) / height;
    const crossings = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ y1, x1 ] = ring[i];
        const [ y2, x2 ] = ring[i + 1];
        // Half-open interval: a vertex exactly on the scanline counts once.
        if ((y1 <= lat) === (y2 <= lat)) continue;
        crossings.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const colStart = Math.ceil(((crossings[k] + 180) / 360) * width - 0.5);
      const colEnd = Math.floor(((crossings[k + 1] + 180) / 360) * width - 0.5);
      for (let col = Math.max(0, colStart); col <= Math.min(width - 1, colEnd); col++) {
        const index = row * width + col;
        bits[index >> 3] |= 1 << (index & 7);
      }
    }
  }
  return { width, height, bits, base64: packBits(bits), rle: packMask(bits, width, height) };
}

// Simplified, size-filtered rings ready to encode. `minArea` (deg²) drops
// specks that would render as a single pixel; `minPoints` drops rings the
// simplifier reduced to nothing.
export function simplifiedRings(rings, { epsilon, minPoints = 4, minArea = 0 }) {
  const out = [];
  for (const ring of rings) {
    if (ring.length < minPoints || ringArea(ring) < minArea) continue;
    const s = simplifyRing(ring, epsilon);
    if (s.length >= minPoints) out.push(s);
  }
  return out;
}

export { encodeRings };
