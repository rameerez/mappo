#!/usr/bin/env node
// Generates src/bodies/moon.js — the Moon as an opt-in body pack.
//
// Source: Clementine 750 nm global albedo mosaic, simple cylindrical
// (public domain, NASA/USGS; via Wikimedia Commons). The maria are basalt and
// the highlands are anorthosite, and the two differ in reflectance by about a
// factor of two — so the "is it mare" question really is a threshold on
// brightness, in a way that Earth's land/sea question is not.
//
// The threshold is not chosen by eye. Maria cover about 16% of the sphere, so
// the search picks the level that reproduces that — and then the NEAR SIDE
// figure, which nothing was tuned on, comes out at 30% against a published
// ~31%. That is the check that the map is aligned and the level is right.
//
// Input is a BMP because this repo has no image decoder and is not about to
// grow one for a build script. On macOS:
//
//   curl -o /tmp/moon.jpg https://upload.wikimedia.org/wikipedia/commons/e/ea/Clementine_albedo_simp750.jpg
//   sips -s format bmp -z 512 1024 /tmp/moon.jpg --out /tmp/moon.bmp
//   node scripts/generate-moon.js /tmp/moon.bmp
//
// Run it, commit the result; consumers never run this.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RAD = Math.PI / 180;
const MASK_W = 512, MASK_H = 256;
const TARGET_GLOBAL = 0.16;                 // maria, as a fraction of the sphere

const bmpPath = process.argv[2] || "/tmp/moon.bmp";
const b = readFileSync(bmpPath);
if (b.toString("ascii", 0, 2) !== "BM") throw new Error("not a BMP");
if (b.readUInt16LE(28) !== 24) throw new Error("expected 24-bit BMP");
const off = b.readUInt32LE(10);
const W = b.readInt32LE(18);
const rawH = b.readInt32LE(22);
const H = Math.abs(rawH), topDown = rawH < 0;
const rowBytes = Math.ceil(W * 3 / 4) * 4;

const lum = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  const src = off + (topDown ? y : H - 1 - y) * rowBytes;
  for (let x = 0; x < W; x++) {
    const i = src + x * 3;                  // BMP stores BGR
    lum[y * W + x] = 0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2];
  }
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

// The poles are dark in this mosaic and it is not basalt: the Sun never rises
// far above the horizon there, so what the camera saw is shadow. The latitude
// profile gives it away — 75-90°N reads 21% dark while the band immediately
// below reads 0.1%, and a lava flow cannot appear above nothing. No mare lies
// above about 62°, so beyond 72° is called highland, and the threshold is
// chosen with that already applied or the artefact eats part of the budget.
const POLE_CUT = 72;
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
console.log(`threshold ${T.toFixed(1)} → ${(coverage(T) * 100).toFixed(1)}% of the sphere (target ${TARGET_GLOBAL * 100}%)`);
console.log(`near side ${(100 * near / nearTot).toFixed(1)}% maria (published ~31%, not tuned on)`);
for (const [ n, la, lo2, want ] of [
  [ "Mare Crisium", 17, 59, true ], [ "Mare Imbrium", 33, -16, true ],
  [ "Tranquillitatis", 8.5, 31, true ], [ "far side centre", 0, 180, false ],
  [ "south pole", -85, 0, false ] ]) {
  const got = at(la, lo2);
  console.log(`  ${n.padEnd(18)} ${got ? "mare    " : "highland"} ${got === want ? "ok" : "MISMATCH"}`);
}

mkdirSync(join(here, "..", "src", "bodies"), { recursive: true });
writeFileSync(join(here, "..", "src", "bodies", "moon.js"), `// GENERATED by scripts/generate-moon.js — do not edit by hand.
//
// The Moon, as an opt-in body pack. Nothing in mappo's engine knows about it;
// it is handed over at runtime with registerBody().
//
// Data: Clementine 750 nm global albedo mosaic, simple cylindrical (public
// domain, NASA/USGS). Thresholded so the dark basaltic maria come out at 16%
// of the sphere, which is the published figure; the near side then lands at
// ~30% against a published ~31% without being tuned for. Beyond 72 degrees the
// mosaic is shadow rather than basalt, and is read as highland.
//
// This binary is an INTERPRETATION, unlike Earth's coastline. Mare boundaries
// are gradational — basalt thins out rather than stopping at a line — so the
// edge here is a brightness level, not a shore.

const MASK_W = ${MASK_W}, MASK_H = ${MASK_H};
const BITS = /* base64 */ Uint8Array.from(atob("${base64}"), (c) => c.charCodeAt(0));

function isMare(lat, lon) {
  if (lat > 90 || lat < -90) return false;
  const col = Math.min(MASK_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * MASK_W)));
  const row = Math.min(MASK_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * MASK_H)));
  const idx = row * MASK_W + col;
  return (BITS[idx >> 3] & (1 << (idx & 7))) !== 0;
}

export const MOON = {
  id: "moon",
  name: "Moon",
  radiusKm: 1737.4,
  // The Moon keeps one face to us, so there is no useful "start facing here"
  // that is not just the near side.
  latRange: [ -90, 90 ],
  // What the two classes are called here. mappo's options are still spelled
  // land/ocean — one vocabulary for the code, the body's own words for people.
  terms: { inside: "maria", outside: "highlands" },
  isLand: isMare,
  // No vector outline: a mare has no coastline to trace. Asking for
  // land-source="vector" on the Moon falls back to the grid, which is the
  // honest answer rather than a smooth line that means nothing.
  rings: () => null,
  borders: () => null,
  maskSize: [ MASK_W, MASK_H ]
};

// Places worth pointing at. Apollo sites are where people have stood; the
// Artemis III regions are candidate landing areas near the south pole, chosen
// for sunlight and for the permanently shadowed craters beside them.
export const MOON_SITES = [
  { name: "Apollo 11", lat: 0.67, lon: 23.47, kind: "apollo" },
  { name: "Apollo 12", lat: -3.01, lon: -23.42, kind: "apollo" },
  { name: "Apollo 14", lat: -3.65, lon: -17.47, kind: "apollo" },
  { name: "Apollo 15", lat: 26.13, lon: 3.63, kind: "apollo" },
  { name: "Apollo 16", lat: -8.97, lon: 15.50, kind: "apollo" },
  { name: "Apollo 17", lat: 20.19, lon: 30.77, kind: "apollo" },
  { name: "Luna 9", lat: 7.13, lon: -64.37, kind: "robotic" },
  { name: "Chang'e 4", lat: -45.44, lon: 177.60, kind: "robotic" },
  { name: "Chang'e 6", lat: -41.64, lon: -153.99, kind: "robotic" },
  { name: "Malapert Massif", lat: -86.0, lon: -2.7, kind: "artemis" },
  { name: "Nobile Rim 1", lat: -85.4, lon: 31.5, kind: "artemis" },
  { name: "Peak near Cabeus B", lat: -82.2, lon: -58.0, kind: "artemis" },
  { name: "Haworth", lat: -87.5, lon: -5.0, kind: "artemis" },
  { name: "Shackleton", lat: -89.7, lon: 129.2, kind: "artemis" }
];
`);
console.log("wrote src/bodies/moon.js");
