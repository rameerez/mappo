#!/usr/bin/env node
// Generates src/shapes.js — the VECTOR coastlines and country borders, for
// `land-source="vector"`.
//
// Source: Natural Earth 110m (public domain,
// https://www.naturalearthdata.com/about/terms-of-use/) — the same dataset
// scripts/generate-mask.js rasterizes into the bitmask, so the grid world and
// the vector world are the same world at two levels of detail.
//
// Encoding: quantize to 1/SCALE degree, delta-encode along each ring, zigzag
// the signed deltas, then varint into a base64 alphabet (6 data bits per
// character, high bit continues). This is the polyline trick: coastlines move
// in small steps, so almost every delta fits in one character. Rings are joined
// with "|", sets with "\n" — no JSON punctuation to pay for.
//
// Run: node scripts/generate-shapes.js   (network required; commit the result —
// consumers never run this.)

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCALE = 32;              // 1/32° ≈ 3.5 km — far finer than any symbolic map resolves
const MIN_RING_POINTS = 4;
const MIN_AREA = 0.35;         // deg² — drops specks that render as a single pixel

const SOURCES = {
  land: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson",
  countries: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVarint(value, out) {
  let v = value < 0 ? ~value * 2 + 1 : value * 2;   // zigzag
  while (v >= 32) {
    out.push(ALPHABET[(v & 31) | 32]);
    v = Math.floor(v / 32);
  }
  out.push(ALPHABET[v]);
}

// Perpendicular-distance simplification. 110m is already generalized, so this
// only removes points the quantizer would collapse anyway.
function simplify(points, epsilon) {
  if (points.length < 3) return points;
  let maxDist = 0, index = 0;
  const [ ax, ay ] = points[0];
  const [ bx, by ] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const [ px, py ] = points[i];
    const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (dist > maxDist) { maxDist = dist; index = i; }
  }
  if (maxDist <= epsilon) return [ points[0], points[points.length - 1] ];
  return [
    ...simplify(points.slice(0, index + 1), epsilon).slice(0, -1),
    ...simplify(points.slice(index), epsilon)
  ];
}

// A CLOSED ring cannot be fed to Douglas-Peucker directly: its first and last
// points are identical, so the baseline is degenerate, every perpendicular
// distance computes as zero, and the whole ring collapses to two points. Split
// it at the vertex farthest from the start, simplify the two open halves, and
// re-close.
function simplifyRing(ring, epsilon) {
  const closed = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length < 4) return ring;

  let far = 0, best = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = simplify(open.slice(0, far + 1), epsilon);
  const b = simplify(open.slice(far), epsilon);
  const merged = [ ...a.slice(0, -1), ...b ];
  if (closed) merged.push([ merged[0][0], merged[0][1] ]);
  return merged;
}

function ringArea(points) {

  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] * points[i][1]) - (points[i][0] * points[j][1]);
  }
  return Math.abs(a / 2);
}

function encodeRings(rings) {
  const parts = [];
  for (const ring of rings) {
    const out = [];
    let px = 0, py = 0;
    for (const [ lon, lat ] of ring) {
      const qx = Math.round((lon + 180) * SCALE);
      const qy = Math.round((lat + 90) * SCALE);
      encodeVarint(qx - px, out);
      encodeVarint(qy - py, out);
      px = qx; py = qy;
    }
    parts.push(out.join(""));
  }
  return parts.join("|");
}

async function collect(url, epsilon) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  const geojson = await res.json();
  const rings = [];
  for (const feature of geojson.features) {
    const g = feature.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [ g.coordinates ] : g.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        if (ring.length < MIN_RING_POINTS) continue;
        if (ringArea(ring) < MIN_AREA) continue;
        const s = simplifyRing(ring.map(([ lon, lat ]) => [ lon, lat ]), epsilon);
        if (s.length >= MIN_RING_POINTS) rings.push(s);
      }
    }
  }
  return rings;
}

const land = await collect(SOURCES.land, 0.08);
const countries = await collect(SOURCES.countries, 0.10);

const encodedLand = encodeRings(land);
const encodedCountries = encodeRings(countries);

const here = dirname(fileURLToPath(import.meta.url));
const body = `// GENERATED by scripts/generate-shapes.js — do not edit.
//
// Vector coastlines and country borders from Natural Earth 110m (public
// domain), quantized to 1/${SCALE}° and delta+varint encoded. The same source
// the bitmask is rasterized from, kept as outlines instead: this is what
// land-source="vector" draws.
//
// Decoded lazily and memoized — a map that never asks for vector land pays
// only the bytes, never the parse.

const SHAPE_SCALE = ${SCALE};
const ALPHABET = "${ALPHABET}";
const INDEX = (() => {
  const m = new Map();
  for (let i = 0; i < ALPHABET.length; i++) m.set(ALPHABET[i], i);
  return m;
})();

function decodeRings(encoded) {
  const rings = [];
  for (const chunk of encoded.split("|")) {
    const ring = [];
    let i = 0, px = 0, py = 0;
    while (i < chunk.length) {
      const read = () => {
        let shift = 0, result = 0, byte;
        do {
          byte = INDEX.get(chunk[i++]);
          result += (byte & 31) * Math.pow(32, shift / 5);
          shift += 5;
        } while (byte >= 32);
        return (result % 2) ? ~((result - 1) / 2) : result / 2;   // un-zigzag
      };
      px += read();
      py += read();
      ring.push([ py / SHAPE_SCALE - 90, px / SHAPE_SCALE - 180 ]);   // [lat, lon]
    }
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}

const RAW_LAND = "${encodedLand}";
const RAW_COUNTRIES = "${encodedCountries}";

let _land = null, _countries = null;

// Coastlines: the outline of every landmass. Rings of [lat, lon].
export function landShapes() {
  return (_land ??= decodeRings(RAW_LAND));
}

// Country borders, as closed rings of [lat, lon].
export function countryShapes() {
  return (_countries ??= decodeRings(RAW_COUNTRIES));
}
`;

writeFileSync(join(here, "..", "src", "shapes.js"), body);
console.log(`land rings ${land.length} (${land.reduce((n, r) => n + r.length, 0)} pts) → ${(encodedLand.length / 1024).toFixed(1)} KB`);
console.log(`country rings ${countries.length} (${countries.reduce((n, r) => n + r.length, 0)} pts) → ${(encodedCountries.length / 1024).toFixed(1)} KB`);
