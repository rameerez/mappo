#!/usr/bin/env node
// Generates src/bodies/earth.js — the body that ships in the bundle.
//
// Source: Natural Earth 110m land polygons and admin-0 country polygons
// (public domain, https://www.naturalearthdata.com/about/terms-of-use/), from
// the natural-earth-vector repository at a pinned commit, verified by SHA-256.
// The land polygons are rasterised into the 512×256 mask AND simplified into
// the vector coastline; the country polygons become the borders.
//
// Run: npm run generate:earth   (network on first run; .cache/ after that)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCached } from "./lib/fetch.js";
import { maskAt } from "./lib/codec.js";
import { renderBodyPack } from "./lib/pack.js";
import { encodeRings, geoJsonRings, rasterizeRings, simplifiedRings } from "./lib/vector-body.js";
import places from "./data/earth-places.js";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19";
const SOURCES = {
  land: {
    url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson/ne_110m_land.geojson`,
    sha256: "9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9",
    file: "ne_110m_land.geojson"
  },
  countries: {
    url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson/ne_110m_admin_0_countries.geojson`,
    sha256: "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
    file: "ne_110m_admin_0_countries.geojson"
  }
};

const load = async (source) => JSON.parse(readFileSync(await fetchCached(source), "utf8"));
const landRings = geoJsonRings(await load(SOURCES.land));
const countryRings = geoJsonRings(await load(SOURCES.countries));

const mask = rasterizeRings(landRings, 512, 256);
// 110m is already generalised; these tolerances only remove points the 1/32°
// quantiser would collapse anyway. 0.35 deg² drops specks smaller than a pixel.
const outlines = simplifiedRings(landRings, { epsilon: 0.08, minPoints: 4, minArea: 0.35 });
const borders = simplifiedRings(countryRings, { epsilon: 0.10, minPoints: 4, minArea: 0.35 });

let landCells = 0;
for (const byte of mask.bits) for (let b = byte; b; b >>= 1) landCells += b & 1;
const landFraction = landCells / (mask.width * mask.height);
console.log(`land cells: ${landCells} / ${mask.width * mask.height} (${(landFraction * 100).toFixed(1)}% of the frame)`);
if (landFraction < 0.2 || landFraction > 0.45) throw new Error("land fraction looks wrong — rasterisation bug or bad source data");

const at = (lat, lon) => maskAt(mask.bits, mask.width, mask.height, lat, lon);
const checks = [
  [ "Madrid", 40.4, -3.7, true ], [ "Amazon", -5, -60, true ], [ "Siberia", 65, 100, true ],
  [ "Sahara", 23, 10, true ], [ "London", 51.5, -0.1, true ],
  [ "mid-Atlantic", 30, -40, false ], [ "mid-Pacific", 0, -150, false ], [ "Indian Ocean", -20, 80, false ]
];
for (const [ name, lat, lon, expected ] of checks) {
  if (at(lat, lon) !== expected) throw new Error(`${name}: expected ${expected ? "land" : "sea"}`);
  console.log(`  ${name.padEnd(14)} ${expected ? "land" : "sea "} ok`);
}
console.log(`outlines: ${outlines.length} rings, ${outlines.reduce((n, r) => n + r.length, 0)} points`);
console.log(`borders:  ${borders.length} rings, ${borders.reduce((n, r) => n + r.length, 0)} points`);

const source = renderBodyPack({
  generatedBy: "generate-earth.js",
  notes: `Earth. Data: Natural Earth 110m land and admin-0 countries (public domain),
natural-earth-vector @ ${COMMIT}, SHA-256 pinned in the generator. The figure is
land against ocean; the borders are national boundaries. Default framing cuts
Antarctica and the arctic emptiness.`,
  body: {
    id: "earth",
    name: "Earth",
    radiusKm: 6371,
    latRange: [ -58, 84 ],
    terms: { figure: "land", ground: "ocean" }
  },
  mask,
  outlines: encodeRings(outlines),
  borders: encodeRings(borders),
  placesNotes: "About 160 cities chosen for world coverage. Coordinates are city centres to one decimal.",
  places
});

writeFileSync(join(here, "..", "src", "bodies", "earth.js"), source);
console.log("wrote src/bodies/earth.js");
