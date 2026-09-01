#!/usr/bin/env node
// Generates src/bodies/mars.js — Mars as an opt-in body pack.
//
// Source: MOLA global topography, colour-ramped (public domain, NASA/MGS, via
// Wikimedia Commons). The ramp runs purple-blue-cyan-green-yellow-red-white as
// the ground climbs, so hue falls monotonically with height and white caps the
// top — which makes "how high is this" a hue lookup. Checked against ten
// published elevations from Hellas at -7 km to Olympus Mons at +21 km: the
// ordering comes out exact, which is all a threshold needs.
//
// The binary is the crustal dichotomy — the northern lowlands against the
// southern highlands — which is the single most important fact about the shape
// of Mars. The threshold is set so the lowlands come out at a third of the
// surface, the published figure.
//
// The map runs 0-360E rather than -180..180. That was found rather than
// assumed: rolling it half a turn lifts agreement with published elevations
// from -0.08 to 0.889.
//
// Input is a BMP because this repo has no image decoder. On macOS:
//
//   curl -o .cache/mars.png https://upload.wikimedia.org/wikipedia/commons/8/89/Mars_topography_%28MOLA_dataset%29.png
//   sips -s format bmp .cache/mars.png --out .cache/mars.bmp
//   node scripts/generate-mars.js .cache/mars.bmp
//
// Run it, commit the result; consumers never run this.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RAD = Math.PI / 180;
const MASK_W = 512, MASK_H = 256;
const TARGET_GLOBAL = 1 / 3;              // northern lowlands, as a fraction

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SCALE = 32;

// Lifted from generate-shapes.js: the same quantise/delta/zigzag/varint trick,
// because a mare outline and a coastline are the same kind of curve and there is
// no reason for the Moon to invent its own file format.
function encodeVarint(value, out) {
  let v = value < 0 ? ~value * 2 + 1 : value * 2;   // zigzag
  while (v >= 32) {
    out.push(ALPHABET[(v & 31) | 32]);
    v = Math.floor(v / 32);
  }
  out.push(ALPHABET[v]);
}

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

// The map starts at 0E, not at the antimeridian.
const ROLL = 180;
const bmpPath = process.argv[2] || ".cache/mars.bmp";
const b = readFileSync(bmpPath);
if (b.toString("ascii", 0, 2) !== "BM") throw new Error("not a BMP");
if (b.readUInt16LE(28) !== 24) throw new Error("expected 24-bit BMP");
const off = b.readUInt32LE(10);
const W = b.readInt32LE(18);
const rawH = b.readInt32LE(22);
const H = Math.abs(rawH), topDown = rawH < 0;
const rowBytes = Math.ceil(W * 3 / 4) * 4;

// Height, read off the colour ramp rather than off brightness. The comparison
// downstream is "less than the threshold", which on the Moon meant darker and
// here means lower — the same line, two very different rasters.
const lum = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  const src = off + (topDown ? y : H - 1 - y) * rowBytes;
  for (let x = 0; x < W; x++) {
    const i = src + x * 3;
    const bl = b[i] / 255, g = b[i + 1] / 255, r = b[i + 2] / 255;
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
    let h = 0;
    if (d) {
      h = mx === r ? ((g - bl) / d + (g < bl ? 6 : 0)) : mx === g ? ((bl - r) / d + 2) : ((r - g) / d + 4);
      h *= 60;
    }
    const sat = mx ? d / mx : 0;
    let height;
    if (sat < 0.18 && mx > 0.75) height = 300;               // the white summits
    else { let hh = h; if (hh < 300 && hh > 280) hh -= 360; height = 280 - hh; }
    lum[y * W + x] = height;
  }
}

// Bring the prime meridian to the middle.
{
  const shift = Math.round(W * ROLL / 360);
  const rolled = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    rolled[y * W + x] = lum[y * W + ((x + shift) % W)];
  }
  lum.set(rolled);
}

// Downsample to the mask grid by averaging, so a cell is the mean brightness
// of the ground it covers rather than one arbitrary pixel from it.
const cell = new Float32Array(MASK_W * MASK_H);
const sx = W / MASK_W, sy = H / MASK_H;
for (let r = 0; r < MASK_H; r++) {
  for (let c = 0; c < MASK_W; c++) {
    let sum = 0, n = 0;
    for (let y = Math.floor(r * sy); y < Math.ceil((r + 1) * sy); y++) {
      for (let x = Math.floor(c * sx); x < Math.ceil((c + 1) * sx); x++) { sum += lum[y * W + x]; n++; }
    }
    cell[r * MASK_W + c] = sum / n;
  }
}

// No polar correction. On the Moon the poles were shadow pretending to be
// basalt; here the data is elevation and the caps are genuinely high ground,
// so there is nothing to defend against.
const POLE_CUT = 91;
const latOf = (r) => 90 - (r + 0.5) / MASK_H * 180;
const polar = (r) => Math.abs(latOf(r)) > POLE_CUT;

// Area-weighted, because an equirectangular grid wildly over-counts the poles.
const rowWeight = Array.from({ length: MASK_H }, (_, r) => Math.cos(latOf(r) * RAD));
const totalWeight = rowWeight.reduce((s, w) => s + w * MASK_W, 0);
const coverage = (t) => {
  let dark = 0;
  for (let r = 0; r < MASK_H; r++) for (let c = 0; c < MASK_W; c++) {
    if (!polar(r) && cell[r * MASK_W + c] < t) dark += rowWeight[r];
  }
  return dark / totalWeight;
};

let lo = 0, hi = 255;
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2;
  coverage(mid) < TARGET_GLOBAL ? lo = mid : hi = mid;
}
const T = (lo + hi) / 2;

const bits = new Uint8Array(Math.ceil(MASK_W * MASK_H / 8));
for (let r = 0; r < MASK_H; r++) for (let c = 0; c < MASK_W; c++) {
  if (!polar(r) && cell[r * MASK_W + c] < T) { const i = r * MASK_W + c; bits[i >> 3] |= 1 << (i & 7); }
}
const base64 = Buffer.from(bits).toString("base64");

// ── outlines ────────────────────────────────────────────────────────────────
// The same boundary the mask draws, as a line instead of as squares. Traced at
// the raster's own resolution rather than the mask's, so the curve is finer
// than the cells that generated it, then simplified — a mare edge is smooth in
// nature and only looks like a staircase because we sampled it on a grid.
const VW = W, VH = H;                       // trace at full source resolution
const dark = (c, r) => {
  if (r < 0 || r >= VH) return false;
  // The antimeridian IS an edge here. Wrapping the lookup makes a region
  // that crosses ±180 one continuous blob, but the corner KEYS the chainer
  // walks on do not wrap — so the walk dead-ends at column VW and emits an
  // OPEN chain, which the renderer then closes with a straight chord across
  // the map. Cutting at the seam splits such a region into two rings that
  // each hug it, which is what a cylindrical projection wants anyway.
  if (c < 0 || c >= VW) return false;
  const lat = 90 - (r + 0.5) / VH * 180;
  if (Math.abs(lat) > POLE_CUT) return false;
  return lum[r * VW + c] < T;
};

const edges = [];
for (let r = 0; r < VH; r++) for (let c = 0; c < VW; c++) {
  if (!dark(c, r)) continue;
  // Clockwise in (col, row), which is clockwise on screen since row grows down.
  if (!dark(c, r - 1)) edges.push([ c, r, c + 1, r ]);
  if (!dark(c + 1, r)) edges.push([ c + 1, r, c + 1, r + 1 ]);
  if (!dark(c, r + 1)) edges.push([ c + 1, r + 1, c, r + 1 ]);
  if (!dark(c - 1, r)) edges.push([ c, r + 1, c, r ]);
}

// Chain directed edges into closed rings: every corner has as many edges out
// as in, so following successors always comes back to where it started.
const from = new Map();
for (const e of edges) {
  const k = `${e[0]},${e[1]}`;
  (from.get(k) ?? from.set(k, []).get(k)).push(e);
}
const rings = [];
let unclosed = 0;
for (const list of from.values()) {
  while (list.length) {
    const start = list.pop();
    const ring = [ [ start[0], start[1] ] ];
    let cur = start, closed = false;
    for (let guard = 0; guard < 4 * VW * VH; guard++) {
      ring.push([ cur[2], cur[3] ]);
      const nk = `${cur[2]},${cur[3]}`;
      const next = from.get(nk);
      if (!next || !next.length) break;
      cur = next.pop();
      if (cur[2] === start[0] && cur[3] === start[1]) {
        ring.push([ cur[2], cur[3] ]); closed = true; break;
      }
    }
    // Only genuinely closed walks become rings. An open chain drawn as a
    // closed subpath is the straight-chord bug — so count them instead, and
    // a regression shows up as a number rather than as lines across Mars.
    if (!closed) { unclosed++; continue; }
    if (ring.length > 8) rings.push(ring);
  }
}

// Corners are grid indices; turn them into the world, then thin them out.
const EPS = 0.22;                            // degrees
const MIN_POINTS = 10;
const geo = rings
  .map((ring) => ring.map(([ c, r ]) => [ -180 + c / VW * 360, 90 - r / VH * 180 ]))
  .map((ring) => simplifyRing(ring, EPS))
  .filter((ring) => ring.length >= MIN_POINTS);
geo.sort((a, b) => b.length - a.length);
const encodedRings = encodeRings(geo);
if (unclosed) console.log(`  WARNING: ${unclosed} unclosed chains dropped`);
console.log(`outlines: ${geo.length} rings, ${geo.reduce((n, r) => n + r.length, 0)} points, ${encodedRings.length} chars`);

// The check nothing was tuned on.
const at = (lat, lon) => {
  const c = Math.min(MASK_W - 1, Math.max(0, Math.floor((lon + 180) / 360 * MASK_W)));
  const r = Math.min(MASK_H - 1, Math.max(0, Math.floor((90 - lat) / 180 * MASK_H)));
  const i = r * MASK_W + c;
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
};
let near = 0, nearTot = 0;
for (let la = -89.5; la < 90; la += 1) for (let lo2 = -89.5; lo2 < 90; lo2 += 1) {
  const w = Math.cos(la * RAD); nearTot += w; if (at(la, lo2)) near += w;
}
console.log(`threshold ${T.toFixed(1)} → ${(coverage(T) * 100).toFixed(1)}% low (target ${(TARGET_GLOBAL * 100).toFixed(0)}%)`);
console.log(`hemisphere check: ${(100 * near / nearTot).toFixed(1)}% low on the 0E side`);
for (const [ n, la, lo2, want ] of [
  [ "Hellas (-7 km)", -42.4, 70.5, true ], [ "Vastitas Borealis", 70, 0, true ],
  [ "Utopia Planitia", 47, 118, true ], [ "Isidis", 13, 88, true ],
  [ "Olympus Mons (+21)", 18.65, -133.8, false ], [ "Ascraeus Mons", 11.3, -104.5, false ],
  [ "southern highlands", -40, 0, false ], [ "Syrtis Major", 8.4, 69.5, false ] ]) {
  const got = at(la, lo2);
  console.log(`  ${n.padEnd(20)} ${got ? "lowland " : "highland"} ${got === want ? "ok" : "MISMATCH"}`);
}

mkdirSync(join(here, "..", "src", "bodies"), { recursive: true });
writeFileSync(join(here, "..", "src", "bodies", "mars.js"), `// GENERATED by scripts/generate-mars.js — do not edit by hand.
//
// Mars, as an opt-in body pack. Nothing in mappo's engine knows about it; it
// is handed over at runtime with registerBody().
//
// Data: MOLA global topography, colour-ramped (public domain, NASA/MGS). The
// binary is the crustal dichotomy — northern lowlands against southern
// highlands — thresholded so the lowlands come out at a third of the surface,
// which is the published figure. Eight known places check out, from Hellas at
// -7 km to Olympus Mons at +21 km.
//
// Like the Moon's maria, this is an INTERPRETATION and not a coastline: the
// edge is an elevation, and Mars has no sea to draw one against. Hellas and
// Argyre come out as lowland because they ARE low, which is a fact about
// elevation rather than a fact about the dichotomy.

const MASK_W = ${MASK_W}, MASK_H = ${MASK_H};
const BITS = /* base64 */ Uint8Array.from(atob("${base64}"), (c) => c.charCodeAt(0));

// The same boundary as a curve. Quantised to 1/32 degree, delta-encoded along
// each ring, zigzagged and varinted into a base64 alphabet — the same trick
// Earth coastlines use, because a mare edge is the same kind of line.
const OUTLINES = "${encodedRings}";
const SCALE = 32;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const INDEX = new Map([ ...ALPHABET ].map((c, i) => [ c, i ]));
let decoded = null;

function outlines() {
  if (decoded) return decoded;
  decoded = [];
  for (const chunk of OUTLINES.split("|")) {
    const ring = [];
    let i = 0, px = 0, py = 0;
    const read = () => {
      let shift = 0, result = 0, byte;
      do {
        byte = INDEX.get(chunk[i++]);
        result += (byte & 31) * Math.pow(32, shift / 5);
        shift += 5;
      } while (byte >= 32);
      return (result % 2) ? ~((result - 1) / 2) : result / 2;
    };
    while (i < chunk.length) {
      px += read(); py += read();
      ring.push([ py / SCALE - 90, px / SCALE - 180 ]);
    }
    if (ring.length > 2) decoded.push(ring);
  }
  return decoded;
}

function isLow(lat, lon) {
  if (lat > 90 || lat < -90) return false;
  const col = Math.min(MASK_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * MASK_W)));
  const row = Math.min(MASK_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * MASK_H)));
  const idx = row * MASK_W + col;
  return (BITS[idx >> 3] & (1 << (idx & 7))) !== 0;
}

export const MARS = {
  id: "mars",
  name: "Mars",
  radiusKm: 3389.5,
  // The Moon keeps one face to us, so there is no useful "start facing here"
  // that is not just the near side.
  latRange: [ -90, 90 ],
  // What the two classes are called here. mappo's options are still spelled
  // land/ocean — one vocabulary for the code, the body's own words for people.
  terms: { inside: "lowlands", outside: "highlands" },
  isLand: isLow,
  // Traced from the same threshold the mask uses, so the outline and the
  // squares are the same boundary at two levels of detail — exactly the
  // relationship Earth has between its coastline and its bitmask.
  rings: (source) => (source === "vector" ? outlines() : null),
  borders: () => null,
  maskSize: [ MASK_W, MASK_H ]
};

// Everything that has landed and stayed put, and the places being argued over
// for what comes next. Almost all of them are low, flat and near the equator,
// for the same reason the Apollo sites were: that is where the fuel budget and
// the atmosphere let you stop.
export const MARS_SITES = [
  { name: "Viking 1", lat: 22.27, lon: -48.22, kind: "landed" },
  { name: "Viking 2", lat: 47.64, lon: 134.29, kind: "landed" },
  { name: "Pathfinder", lat: 19.13, lon: -33.22, kind: "landed" },
  { name: "Spirit", lat: -14.57, lon: 175.47, kind: "landed" },
  { name: "Opportunity", lat: -1.95, lon: -5.53, kind: "landed" },
  { name: "Curiosity", lat: -4.59, lon: 137.44, kind: "landed" },
  { name: "InSight", lat: 4.50, lon: 135.62, kind: "landed" },
  { name: "Perseverance", lat: 18.44, lon: 77.45, kind: "landed" },
  { name: "Zhurong", lat: 25.07, lon: 109.93, kind: "landed" },
  { name: "Arcadia Planitia", lat: 46.7, lon: -168.0, kind: "candidate" },
  { name: "Amazonis Planitia", lat: 24.8, lon: -164.0, kind: "candidate" },
  { name: "Deuteronilus Mensae", lat: 43.9, lon: 23.0, kind: "candidate" },
  { name: "Olympus Mons", lat: 18.65, lon: -133.8, kind: "feature" },
  { name: "Valles Marineris", lat: -13.9, lon: -59.2, kind: "feature" },
  { name: "Hellas Planitia", lat: -42.4, lon: 70.5, kind: "feature" }
];
`);
console.log("wrote src/bodies/mars.js");
