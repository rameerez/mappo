#!/usr/bin/env node
// Generates demo/countries.js — every country as fillable rings keyed by
// ISO 3166-1 alpha-2, each with an anchor point inside it, plus the countries
// that have no polygon at all at 110m as anchors alone.
//
// WHY THIS IS IN demo/ AND NOT IN THE LIBRARY. mappo ships country BORDERS as
// one flat list of anonymous rings: enough to draw the lines, not enough to
// fill Brazil. A choropleth — the single most common thing anyone does with a
// world map in a dashboard — needs each country as its own closed shape with a
// name you can look it up by, and somewhere to put a marker when the country
// is too small to have a shape. The source data has all of it: Natural Earth
// admin-0 carries ISO codes, English names and a curated label point on every
// feature, and ships a companion point layer for the countries that vanish at
// 110m (Singapore, Malta, Bahrain, the island states). generate-earth.js
// currently throws every one of those properties away.
//
// So this file is a demonstration of a gap, not a workaround for one. The
// shape it exports — regions() → [{ id, name, rings, anchor }] — is the
// proposal for what the earth pack should answer beside outlines() and
// borders(). If it survives contact with the demo it belongs there, and this
// script should be deleted rather than kept.
//
//   node scripts/generate-countries.js
//
// Same pinned commit and checksums the earth pack uses, and the SAME simplifier
// at the SAME tolerance the earth pack cuts its borders with — so every fill
// edge here is, vertex for vertex, one of the border lines mappo draws over it.
// test/countries.test.js holds that.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { fetchCached } from "./lib/fetch.js";
import { simplifyRing, ringArea } from "./lib/geometry.js";
import { encodeRings, SCALE, ALPHABET } from "./lib/codec.js";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19";
const SOURCES = {
  countries: {
    url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson/ne_110m_admin_0_countries.geojson`,
    sha256: "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
    file: "ne_110m_admin_0_countries.geojson"
  },
  // The countries Natural Earth draws as a point rather than a polygon at
  // this scale. Without them a real analytics feed loses every city-state.
  tiny: {
    url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson/ne_110m_admin_0_tiny_countries.geojson`,
    sha256: "753c4b167361f0f1223091d52f98aaddfb9101529eef263cc094057e43228c40",
    file: "ne_110m_admin_0_tiny_countries.geojson"
  }
};

// generate-earth.js cuts the borders with exactly these. Change one, change both.
const EPSILON = 0.10;      // degrees
const MIN_AREA = 0.35;     // deg², dropping specks — but never a country's largest ring

// Natural Earth's English names, in the register a GeoIP database reports and
// a dashboard shows. NAME_EN is closest; these few read otherwise.
const NAMES = {
  "United States of America": "United States",
  "The Bahamas": "Bahamas",
  "The Gambia": "Gambia",
  "Ivory Coast": "Côte d'Ivoire",
  "East Timor": "Timor-Leste",
  "Czech Republic": "Czechia",
  "Turkish Republic of Northern Cyprus": "Northern Cyprus",
  "People's Republic of China": "China",
  "Federated States of Micronesia": "Micronesia"
};
const nameOf = (p) => {
  const name = p.NAME_EN || p.NAME_LONG || p.NAME;
  return NAMES[name] ?? name;
};

// ISO_A2 is "-99" for France, Norway and Kosovo in this release and "CN-TW"
// for Taiwan; ISO_A2_EH carries the code everyone actually uses. Somaliland
// and Northern Cyprus have no alpha-2 at all and keep their alpha-3.
const A2 = /^[A-Z]{2}$/, A3 = /^[A-Z]{3}$/;
const keyOf = (p) =>
  [ p.ISO_A2_EH, p.ISO_A2 ].find((k) => A2.test(k ?? "")) ??
  [ p.ISO_A3, p.ADM0_A3 ].find((k) => A3.test(k ?? "")) ?? null;

const round = (v) => Math.round(v * 100) / 100;
const load = async (source) => JSON.parse(readFileSync(await fetchCached(source), "utf8"));
const countries = await load(SOURCES.countries);
const tiny = await load(SOURCES.tiny);

const out = new Map();
for (const feature of countries.features) {
  const g = feature.geometry, p = feature.properties;
  if (!g) continue;
  const id = keyOf(p);
  if (!id) throw new Error(`no usable code for ${p.NAME}`);
  const polygons = g.type === "Polygon" ? [ g.coordinates ] : g.type === "MultiPolygon" ? g.coordinates : [];
  // GeoJSON is [lon, lat]; everything downstream is [lat, lon]. Holes come
  // along: the fills are drawn even-odd, so Lesotho stays a hole in South
  // Africa without anyone having to trust the winding.
  const rings = polygons
    .flatMap((polygon) => polygon.map((ring) => ring.map(([ lon, lat ]) => [ lat, lon ])))
    .map((ring) => ({ ring, area: ringArea(ring) }))
    .sort((a, b) => b.area - a.area);
  const kept = rings
    .filter((r, i) => i === 0 || r.area >= MIN_AREA)
    .map((r) => simplifyRing(r.ring, EPSILON))
    .filter((ring) => ring.length >= 4);
  if (!kept.length) continue;
  // Natural Earth's label point is curated to sit inside the main body of the
  // country; a centroid would put France's in the Bay of Biscay.
  const anchor = Number.isFinite(p.LABEL_Y) && Number.isFinite(p.LABEL_X)
    ? [ round(p.LABEL_Y), round(p.LABEL_X) ]
    : centroid(kept[0]);
  out.set(id, { id, name: nameOf(p), rings: kept, anchor });
}

for (const feature of tiny.features) {
  const p = feature.properties;
  const id = keyOf(p);
  // Five of the points are pieces of countries already drawn (the Azores, the
  // Canaries, Jan Mayen…) and carry no code of their own; Vanuatu, Fiji and
  // Trinidad have both a polygon and a point, and the polygon wins.
  if (!id || !A2.test(id) || out.has(id)) continue;
  const [ lon, lat ] = feature.geometry.coordinates;
  out.set(id, { id, name: nameOf(p), rings: [], anchor: [ round(lat), round(lon) ] });
}

function centroid(ring) {
  let lat = 0, lon = 0;
  for (const [ a, b ] of ring) { lat += a; lon += b; }
  return [ round(lat / ring.length), round(lon / ring.length) ];
}

const list = [ ...out.values() ].sort((a, b) => a.id.localeCompare(b.id));
const body = list.map((c) =>
  `  ${JSON.stringify(c.id)}: [${JSON.stringify(c.name)}, ${JSON.stringify(c.rings.length ? encodeRings(c.rings) : "")}, ${c.anchor[0]}, ${c.anchor[1]}]`
).join(",\n");

const source = `// GENERATED by scripts/generate-countries.js — do not edit by hand.
//
// Every country as closed [lat, lon] rings keyed by ISO 3166-1 alpha-2, in the
// same 1/${SCALE}° delta+zigzag+varint encoding mappo uses for its own coastlines,
// cut with the same simplifier at the same tolerance — so these fills register
// vertex for vertex with the borders mappo draws over them. Each carries an
// anchor point inside it; the countries too small for a polygon at this
// resolution carry only the anchor. Natural Earth admin-0 110m and its
// tiny-countries layer, public domain, pinned by checksum.
//
// This lives in demo/ because mappo does not ship it. See the header of
// scripts/generate-countries.js for what that means.

const RAW = {
${body}
};

const SCALE = ${SCALE};
const ALPHABET = "${ALPHABET}";

${decodeSource()}

let decoded = null, index = null;

// The proposal for the earth pack, in the shape it would take there:
//
//   regions() → [{ id, name, rings, anchor }]
//
// rings is [] for a country that has no shape at this resolution (Singapore,
// Malta, Bahrain…) and anchor is a [lat, lon] inside the country either way,
// so a consumer fills what has rings and marks what does not. Decoded on
// first ask and kept: a choropleth wants every country, a tooltip wants one.
export function regions() {
  return decoded ??= Object.freeze(Object.entries(RAW).map(([ id, [ name, encoded, lat, lon ] ]) => Object.freeze({
    id, name, rings: encoded ? decodeRings(encoded, SCALE, ALPHABET) : [], anchor: [ lat, lon ]
  })));
}

// One country by code, case-insensitive, or null.
export function region(id) {
  index ??= new Map(regions().map((r) => [ r.id, r ]));
  return index.get(String(id ?? "").trim().toUpperCase()) ?? null;
}
`;

// The decoder travels with the data, exactly as a body pack's does, so this
// file stays standalone and cannot drift from the codec it was written with.
function decodeSource() {
  const src = readFileSync(join(here, "lib", "codec.js"), "utf8");
  const start = src.indexOf("export function decodeRings");
  if (start < 0) throw new Error("codec.js: decodeRings not found");
  let depth = 0, i = src.indexOf("{", start);
  const from = i;
  do { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; } while (depth > 0);
  return "function decodeRings" + src.slice(src.indexOf("(", start), from) + src.slice(from, i);
}

writeFileSync(join(here, "..", "demo", "countries.js"), source);
const shaped = list.filter((c) => c.rings.length), points = list.filter((c) => !c.rings.length);
console.log(`${list.length} countries: ${shaped.length} with rings (${shaped.reduce((n, c) => n + c.rings.length, 0)} rings, ` +
  `${shaped.reduce((n, c) => n + c.rings.reduce((m, r) => m + r.length, 0), 0)} points), ${points.length} as anchors only ` +
  `(${points.map((c) => c.id).join(" ")})`);
console.log(`wrote demo/countries.js (${(source.length / 1024).toFixed(1)} KB, ${(gzipSync(source).length / 1024).toFixed(1)} KB gzipped)`);
