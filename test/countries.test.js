import { test } from "node:test";
import assert from "node:assert/strict";
import { EARTH } from "../dist/mappo.js";
import { regions, region } from "../demo/countries.js";

// The analytics demo's data module: every country as keyed rings plus an
// anchor, in the shape proposed for the earth pack's regions(). Two things are
// pinned here: the contract the demo consumes, and the registration claim —
// that the fills are cut from the same data with the same simplifier as
// mappo's own borders, so the lines mappo draws over them are the very edges
// of the fills.

test("regions: every country has a valid code, a name, closed in-range rings and an in-range anchor", () => {
  const all = regions();
  assert.ok(all.length >= 220, `${all.length} countries`);
  assert.equal(regions(), all, "decoded once");
  assert.ok(Object.isFrozen(all));
  assert.equal(new Set(all.map((r) => r.id)).size, all.length, "codes are unique");
  for (const r of all) {
    assert.match(r.id, /^[A-Z]{2,3}$/, r.id);
    assert.ok(r.name && typeof r.name === "string", `${r.id} has a name`);
    assert.ok(Math.abs(r.anchor[0]) <= 90 && Math.abs(r.anchor[1]) <= 180, `${r.id} anchor on the sphere`);
    for (const ring of r.rings) {
      assert.ok(ring.length >= 4, `${r.id} ring has at least four points`);
      assert.deepEqual(ring[0], ring.at(-1), `${r.id} ring is closed`);
      assert.ok(ring.every(([ lat, lon ]) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180), `${r.id} ring in range`);
    }
  }
});

test("regions: the codes a dashboard actually sends resolve, including the ones Natural Earth mislabels", () => {
  // ISO_A2 is -99 for France, Norway and Kosovo and CN-TW for Taiwan in this
  // release; the pack keys on the code everyone uses.
  for (const [ id, name ] of [
    [ "US", "United States" ], [ "GB", "United Kingdom" ], [ "FR", "France" ], [ "NO", "Norway" ],
    [ "TW", "Taiwan" ], [ "XK", "Kosovo" ], [ "CZ", "Czechia" ], [ "RU", "Russia" ], [ "KR", "South Korea" ]
  ]) {
    const r = region(id);
    assert.ok(r, `${id} exists`);
    assert.equal(r.name, name);
    assert.ok(r.rings.length > 0, `${id} has a shape`);
  }
  assert.equal(region("us"), region("US"), "lookups fold case");
  assert.equal(region("ZZ"), null);
  assert.equal(region(null), null);
});

test("regions: a country too small for a polygon at 110m still has an anchor", () => {
  for (const id of [ "SG", "MT", "BH", "BB", "MV", "HK", "MO", "LI" ]) {
    const r = region(id);
    assert.ok(r, `${id} exists`);
    assert.deepEqual(r.rings, [], `${id} has no shape at this resolution`);
    assert.ok(Number.isFinite(r.anchor[0]) && Number.isFinite(r.anchor[1]), `${id} has an anchor`);
  }
  const sg = region("SG");
  assert.ok(Math.abs(sg.anchor[0] - 1.36) < 0.05 && Math.abs(sg.anchor[1] - 103.8) < 0.05, "Singapore is where Singapore is");
  // Countries with both a polygon and a point keep the polygon.
  assert.ok(region("TT").rings.length > 0, "Trinidad and Tobago is a shape, not a point");
  assert.ok(region("FJ").rings.length > 0);
});

test("registration: every border ring mappo draws is, vertex for vertex, an edge of one of these fills", () => {
  const edges = new Set();
  for (const r of regions()) for (const ring of r.rings) edges.add(JSON.stringify(ring));
  const borders = EARTH.borders();
  assert.ok(borders.length > 100);
  const missing = borders.filter((ring) => !edges.has(JSON.stringify(ring)));
  assert.deepEqual(missing, [], `${missing.length} of mappo's ${borders.length} border rings are not fill edges`);
});
