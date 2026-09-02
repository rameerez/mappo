#!/usr/bin/env node
// Generates src/bodies/moon.js — the Moon as an opt-in body pack.
//
// Source: Clementine UVVIS 750 nm global albedo mosaic, simple cylindrical
// (public domain, NASA/USGS; via Wikimedia Commons), pinned by SHA-256. The
// figure is the dark basaltic maria against the bright highlands. The
// threshold is set by area — maria cover about 16% of the sphere — and then
// checked against a figure it was NOT tuned on: the near side alone should
// come out near the published 30%.
//
// Coordinates: the mosaic is in the IAU Mean Earth/polar axis frame, east
// longitude positive, centred on 0° — mappo's convention already.
//
// Run: npm run generate:moon   (network on first run; .cache/ after that)

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCached } from "./lib/fetch.js";
import { renderBodyPack } from "./lib/pack.js";
import { classifyRaster, coverageWithin } from "./lib/raster-body.js";
import places from "./data/moon-places.js";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = {
  url: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Clementine_albedo_simp750.jpg",
  sha256: "fa15f4ea38c825578b7d1906b92fca06513dca2f8824e39756828cdc2ce58560",
  file: "moon.jpg"
};
const TARGET_COVERAGE = 0.16;
// Beyond about 72° the mosaic is illumination shadow, not basalt: 75–90°N read
// 21% dark against 0.1% just below when profiled by latitude band. No named
// mare lies above 62°, so the cut is deliberately conservative.
const POLE_CUT = 72;

const generated = classifyRaster({
  imagePath: await fetchCached(SOURCE),
  valueAt: (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b,
  targetCoverage: TARGET_COVERAGE,
  poleCut: POLE_CUT
});

const nearSide = coverageWithin(generated.at, { lonMin: -90, lonMax: 90 });
console.log(`threshold ${generated.threshold.toFixed(1)} → ${(generated.coverage * 100).toFixed(1)}% of the sphere (target ${TARGET_COVERAGE * 100}%)`);
console.log(`near side ${(nearSide * 100).toFixed(1)}% maria (published ~30%, not tuned on)`);
if (Math.abs(nearSide - 0.30) > 0.02) throw new Error(`near-side maria coverage ${(nearSide * 100).toFixed(1)}% is outside 28–32%`);

const checks = [
  [ "Mare Crisium", 17, 59, true ],
  [ "Mare Imbrium", 33, -16, true ],
  [ "Mare Tranquillitatis", 8.5, 31, true ],
  [ "far side centre", 0, 180, false ],
  [ "south pole", -85, 0, false ]
];
for (const [ name, lat, lon, expected ] of checks) {
  if (generated.at(lat, lon) !== expected) throw new Error(`${name}: expected ${expected ? "mare" : "highland"}`);
  console.log(`  ${name.padEnd(20)} ${expected ? "mare    " : "highland"} ok`);
}
console.log(`outlines: ${generated.rings.length} rings, ${generated.rings.reduce((n, r) => n + r.length, 0)} points, ${generated.outlines.length} chars`);

const source = renderBodyPack({
  generatedBy: "generate-moon.js",
  notes: `The Moon. Data: Clementine UVVIS 750 nm global albedo mosaic (public domain,
NASA/USGS), SHA-256 pinned in the generator. The figure is the dark maria
against the highlands, thresholded so maria cover ${TARGET_COVERAGE * 100}% of the sphere;
the held-out near-side check lands near the published 30%. Beyond ${POLE_CUT}° the
mosaic is shadow rather than basalt and is read as highland.

This figure is an interpretation, unlike Earth's coastline: mare boundaries
are gradational, so the edge here is a brightness level, not a shore.`,
  body: {
    id: "moon",
    name: "Moon",
    radiusKm: 1737.4,
    latRange: [ -90, 90 ],
    terms: { figure: "maria", ground: "highlands" }
  },
  mask: generated.mask,
  outlines: generated.outlines,
  borders: null,
  placesNotes: `Crewed and robotic landing sites, four of the nine regions on NASA's October
2024 Artemis III candidate list, and Shackleton as a reference feature.
Mission assignments change; these are marker records, not renderer behaviour.`,
  places
});

writeFileSync(join(here, "..", "src", "bodies", "moon.js"), source);
console.log("wrote src/bodies/moon.js");
