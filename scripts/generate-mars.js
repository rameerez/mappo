#!/usr/bin/env node
// Generates src/bodies/mars.js — Mars as an opt-in body pack.
//
// Source: MOLA global topography, colour-ramped (public domain, NASA/MGS; via
// Wikimedia Commons), pinned by SHA-256. Hue follows elevation, so the ramp is
// inverted back into a height; the figure is the lowest third of the surface —
// the crustal dichotomy of northern lowlands against southern highlands, with
// Hellas correctly appearing as a low island in the south. Eight places with
// known heights, from Hellas at −7 km to Olympus Mons at +21 km, guard the
// interpretation.
//
// Coordinates: the source is IAU 2000 planetocentric latitude with east
// longitude running 0–360° from the left edge, so it is rolled half a turn
// into mappo's −180…180 convention. This was found, not assumed: the roll
// lifted the correlation with published elevations from −0.08 to 0.89.
//
// Run: npm run generate:mars   (network on first run; .cache/ after that)

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCached } from "./lib/fetch.js";
import { renderBodyPack } from "./lib/pack.js";
import { classifyRaster } from "./lib/raster-body.js";
import places from "./data/mars-places.js";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = {
  url: "https://upload.wikimedia.org/wikipedia/commons/8/89/Mars_topography_%28MOLA_dataset%29.png",
  sha256: "83742ad578de03977bd7ccfbcc008eaba4120cbeec6e8f05d86a1c03c7d60261",
  file: "mars.png"
};
const TARGET_COVERAGE = 1 / 3;

// The MOLA ramp runs blue (low) → green → yellow → red → white (highest). Hue
// therefore decreases with height; 280 − hue climbs with it, and the white
// summits, which have no hue, are placed above everything.
function rampHeight(r, g, b) {
  const red = r / 255, green = g / 255, blue = b / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let hue = 0;
  if (delta) {
    hue = max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    hue *= 60;
  }
  const saturation = max ? delta / max : 0;
  if (saturation < 0.18 && max > 0.75) return 300;   // white summits
  if (hue < 300 && hue > 280) hue -= 360;
  return 280 - hue;
}

const generated = classifyRaster({
  imagePath: await fetchCached(SOURCE),
  valueAt: rampHeight,
  targetCoverage: TARGET_COVERAGE,
  roll: 180
});

console.log(`threshold ${generated.threshold.toFixed(1)} → ${(generated.coverage * 100).toFixed(1)}% low (target ${(TARGET_COVERAGE * 100).toFixed(1)}%)`);
const checks = [
  [ "Hellas (−7 km)", -42.4, 70.5, true ],
  [ "Vastitas Borealis", 70, 0, true ],
  [ "Utopia Planitia", 47, 118, true ],
  [ "Isidis Planitia", 13, 88, true ],
  [ "Olympus Mons (+21 km)", 18.65, -133.8, false ],
  [ "Ascraeus Mons", 11.3, -104.5, false ],
  [ "southern highlands", -40, 0, false ],
  [ "Syrtis Major", 8.4, 69.5, false ]
];
for (const [ name, lat, lon, expected ] of checks) {
  if (generated.at(lat, lon) !== expected) throw new Error(`${name}: expected ${expected ? "lowland" : "highland"}`);
  console.log(`  ${name.padEnd(22)} ${expected ? "lowland " : "highland"} ok`);
}
console.log(`outlines: ${generated.rings.length} rings, ${generated.rings.reduce((n, r) => n + r.length, 0)} points, ${generated.outlines.length} chars`);

const source = renderBodyPack({
  generatedBy: "generate-mars.js",
  notes: `Mars. Data: colour-ramped MOLA global topography (public domain, NASA/MGS),
SHA-256 pinned in the generator. The figure is the lowest third of the
surface — the northern-lowlands/southern-highlands dichotomy — checked at eight
places of known height from Hellas (−7 km) to Olympus Mons (+21 km).

This is an elevation class, not a coastline or a geologic boundary; the thin
bright strip at the north edge is Planum Boreum, which really is high.`,
  body: {
    id: "mars",
    name: "Mars",
    radiusKm: 3389.5,
    latRange: [ -90, 90 ],
    terms: { figure: "lowlands", ground: "highlands" }
  },
  mask: generated.mask,
  outlines: generated.outlines,
  borders: null,
  placesNotes: `Long-lived successful landings, three illustrative human-exploration prospects,
and reference features for scale. Marker records, not renderer behaviour.`,
  places
});

writeFileSync(join(here, "..", "src", "bodies", "mars.js"), source);
console.log("wrote src/bodies/mars.js");
