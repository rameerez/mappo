import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraticule, projectNormalized, DEFAULTS, EARTH } from "../dist/mappo.js";

// The dist bundle is what ships — test THAT, not src/.

test("graticule: meridian count is exact, and each spans pole to pole", () => {
  const g = buildGraticule({ meridians: 24, parallels: 0 });
  assert.equal(g.meridians.length, 24);
  for (const m of g.meridians) {
    assert.equal(m[0][0], -90, "starts at the south pole");
    assert.equal(m[m.length - 1][0], 90, "ends at the north pole");
    const lon = m[0][1];
    assert.ok(m.every(([ , l ]) => l === lon), "a meridian holds one longitude");
  }
});

test("graticule: meridians are evenly spaced from -180", () => {
  const g = buildGraticule({ meridians: 4, parallels: 0 });
  assert.deepEqual(g.meridians.map((m) => m[0][1]), [ -180, -90, 0, 90 ]);
});

test("graticule: the equator is returned separately, exactly once", () => {
  const g = buildGraticule({ meridians: 0, parallels: 0 });
  assert.equal(g.parallels.length, 0);
  assert.ok(g.equator.length > 0);
  assert.ok(g.equator.every(([ lat ]) => lat === 0));
});

test("graticule: a parallel landing on the equator is dropped, not doubled", () => {
  // 23 parallels across 180° puts one exactly on 0° — the case that would
  // draw the equator twice at double opacity.
  const g = buildGraticule({ meridians: 0, parallels: 23 });
  assert.equal(g.parallels.length, 22, "the 0° parallel is skipped");
  assert.ok(g.parallels.every(([ p ]) => Math.abs(p[0]) >= 5));
});

test("graticule: an odd count that misses the equator keeps every parallel", () => {
  const g = buildGraticule({ meridians: 0, parallels: 10 });
  assert.equal(g.parallels.length, 10);
});

test("graticule: skipDeg is honoured", () => {
  const g = buildGraticule({ meridians: 0, parallels: 23, skipDeg: 20 });
  assert.ok(g.parallels.every(([ p ]) => Math.abs(p[0]) >= 20));
  assert.ok(g.parallels.length < 22, "a wider skip drops more");
});

test("graticule: parallels are full rings", () => {
  const g = buildGraticule({ meridians: 0, parallels: 3 });
  for (const p of g.parallels) {
    assert.equal(p[0][1], -180);
    assert.equal(p[p.length - 1][1], 180);
    const lat = p[0][0];
    assert.ok(p.every(([ l ]) => l === lat), "a parallel holds one latitude");
  }
});

test("projectNormalized: corners of the frame map to 0 and 1", () => {
  const latRange = [ -58, 84 ];
  assert.deepEqual(projectNormalized(84, -180, { latRange }), { x: 0, y: 0 });
  const br = projectNormalized(-58, 180, { latRange });
  assert.ok(Math.abs(br.x - 1) < 1e-12);
  assert.ok(Math.abs(br.y - 1) < 1e-12);
});

test("projectNormalized: lon 0 is the horizontal centre", () => {
  assert.equal(projectNormalized(0, 0, { latRange: [ -90, 90 ] }).x, 0.5);
  assert.equal(projectNormalized(0, 0, { latRange: [ -90, 90 ] }).y, 0.5);
});

test("projectNormalized: the range is required — there is no silent Earth default", () => {
  assert.throws(() => projectNormalized(10, 20), /latRange/);
  assert.throws(() => projectNormalized(10, 20, {}), /latRange/);
  assert.throws(() => projectNormalized(10, 20, { latRange: [ 1 ] }), /latRange/);
  // The documented spelling of "Earth's default framing":
  assert.deepEqual(projectNormalized(84, -180, { latRange: EARTH.latRange }), { x: 0, y: 0 });
});

test("projectNormalized: reproduces the ERB glue it replaces", () => {
  // The exact numbers soupfestivals hand-derived before this function existed.
  const p = projectNormalized(38.9, -10.1, { latRange: [ -56, 78 ] });
  assert.equal((p.x * 100).toFixed(2), "47.19");
  assert.equal((p.y * 100).toFixed(2), "29.18");
});

test("globe options carry defaults", () => {
  assert.equal(DEFAULTS.graticule, false, "opt-in, like every other flourish");
  assert.equal(DEFAULTS.meridians, 12);
  assert.equal(DEFAULTS.parallels, 11);
  assert.equal(DEFAULTS.overlays, true);
  assert.equal(DEFAULTS.maxDpr, 2);
  assert.equal(DEFAULTS.graticuleColor, null, "falls back to figureColor at draw time");
});
