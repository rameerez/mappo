import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EARTH, knownBodies, registerBody, resolveBody, onBodyRegistered, resolvePlace, buildFigure
} from "../dist/mappo.js";
import { MOON } from "mappo/bodies/moon";
import { MARS } from "mappo/bodies/mars";
import { buildGlobeFlags, buildGlobePhases, buildGlobePoints } from "../src/globe.js";

const RAD = Math.PI / 180;
// Area-weighted fraction of a lat/lon window the body calls figure, sampled
// on a 1° grid.
function coverage(body, { latMin = -90, latMax = 90, lonMin = -180, lonMax = 180 } = {}) {
  let inside = 0, total = 0;
  for (let lat = latMin + 0.5; lat < latMax; lat += 1) {
    const weight = Math.cos(lat * RAD);
    for (let lon = lonMin + 0.5; lon < lonMax; lon += 1) {
      total += weight;
      if (body.figure(lat, lon)) inside += weight;
    }
  }
  return inside / total;
}

test("every shipped body satisfies the body contract", () => {
  for (const body of [ EARTH, MOON, MARS ]) {
    assert.match(body.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(body.name);
    assert.ok(body.radiusKm > 0);
    assert.equal(typeof body.figure, "function");
    assert.ok(body.latRange[0] < body.latRange[1]);
    assert.equal(typeof body.terms.figure, "string");
    assert.equal(typeof body.terms.ground, "string");
    assert.ok(Array.isArray(body.places) && body.places.length > 0);
    assert.ok(Array.isArray(body.outlines()));
    assert.ok(body.borders() === null || Array.isArray(body.borders()));
    assert.equal(resolveBody(body), body, "a pack passes validation unchanged");
  }
  assert.deepEqual(MOON.terms, { figure: "maria", ground: "highlands" });
  assert.deepEqual(MARS.terms, { figure: "lowlands", ground: "highlands" });
  assert.equal(MOON.borders(), null, "the Moon has no politics");
  assert.equal(MARS.borders(), null);
});

test("body packs pass their published sanity anchors", () => {
  assert.equal(MOON.figure(17, 59), true, "Mare Crisium");
  assert.equal(MOON.figure(33, -16), true, "Mare Imbrium");
  assert.equal(MOON.figure(0, 180), false, "lunar far-side centre");
  assert.equal(MOON.figure(-85, 0), false, "lunar south pole");
  assert.equal(MARS.figure(-42.4, 70.5), true, "Hellas is low");
  assert.equal(MARS.figure(70, 0), true, "Vastitas Borealis is low");
  assert.equal(MARS.figure(18.65, -133.8), false, "Olympus Mons is high");
  assert.equal(MARS.figure(-40, 0), false, "the southern highlands are high");
});

test("body masks retain their independently sourced area targets", () => {
  assert.ok(Math.abs(coverage(MOON) - 0.16) < 0.005, "lunar maria cover about 16% of the sphere");
  assert.ok(Math.abs(coverage(MARS) - 1 / 3) < 0.005, "the Martian low class covers one third");
  // Held out — the threshold was not tuned on this: the near side alone.
  const nearSide = coverage(MOON, { lonMin: -90, lonMax: 90 });
  assert.ok(Math.abs(nearSide - 0.30) < 0.025, `near-side maria ${(nearSide * 100).toFixed(1)}% vs published ~30%`);
  const earth = coverage(EARTH);
  assert.ok(earth > 0.26 && earth < 0.32, `Earth is about 29% land (${(earth * 100).toFixed(1)}%)`);
});

test("every packed vector outline is closed, finite and memoized", () => {
  for (const body of [ EARTH, MOON, MARS ]) {
    const rings = body.outlines();
    assert.ok(rings.length > 20, `${body.id} has outlines`);
    assert.equal(body.outlines(), rings, "decode only once");
    for (const ring of rings) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring.at(-1));
      assert.ok(ring.every(([ lat, lon ]) =>
        Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180));
    }
  }
});

test("gazetteers are per body: bounded, uniquely named, typed records", () => {
  for (const body of [ EARTH, MOON, MARS ]) {
    assert.equal(new Set(body.places.map((p) => p.name)).size, body.places.length, `${body.id} names are unique`);
    assert.ok(body.places.every((p) =>
      p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180));
  }
  assert.equal(MOON.places.length, 14);
  assert.equal(MARS.places.length, 16);
  assert.deepEqual(resolvePlace("apollo 11", MOON), { name: "apollo 11", lat: 0.67, lon: 23.47, kind: "apollo" });
  assert.equal(resolvePlace("Olympus Mons", MARS).kind, "feature");
  assert.equal(resolvePlace("Apollo 11", EARTH), null, "Earth has no Apollo 11");
  assert.equal(resolvePlace("London", MOON), null, "the Moon has no London");
});

test("registration validates strictly and permits replacement", () => {
  const first = { id: "audit-body", name: "First", figure: () => true };
  const second = { id: "audit-body", name: "Second", figure: () => false };
  registerBody(first);
  assert.equal(resolveBody("AUDIT-BODY"), first, "lookups fold case");
  assert.equal(resolveBody(" audit-body "), first, "and whitespace");
  registerBody(second);
  assert.equal(resolveBody("audit-body"), second);
  assert.equal(knownBodies().filter((body) => body.id === "audit-body").length, 1);
  assert.ok(knownBodies().includes(EARTH));

  assert.throws(() => registerBody({ id: "Audit Body", name: "x", figure: () => true }), /id must match/);
  assert.throws(() => registerBody({ id: "  padded  ", name: "x", figure: () => true }), /id must match/);
  assert.throws(() => registerBody({ id: "no-name", figure: () => true }), /name/);
  assert.throws(() => registerBody({ id: "missing-classifier", name: "x" }), /figure\(lat, lon\)/);
  assert.throws(() => registerBody({ id: "bad-range", name: "x", figure: () => true, latRange: [ 10, -10 ] }), /latRange/);
  assert.throws(() => registerBody({ id: "impossible-range", name: "x", figure: () => true, latRange: [ -91, 90 ] }), /latRange/);
  assert.throws(() => registerBody({ id: "bad-radius", name: "x", figure: () => true, radiusKm: -1 }), /radiusKm/);
  assert.throws(() => registerBody({ id: "infinite-radius", name: "x", figure: () => true, radiusKm: Infinity }), /radiusKm/);
  assert.throws(() => resolveBody({ id: "bad-rings", name: "x", figure: () => true, outlines: [] }), /outlines/);
  assert.throws(() => resolveBody({ id: "bad-terms", name: "x", figure: () => true, terms: { inside: "a" } }), /terms/);
  assert.throws(() => resolveBody({ id: "empty-terms", name: "x", figure: () => true, terms: { figure: "", ground: "x" } }), /terms/);
  assert.throws(() => resolveBody({ id: "bad-places", name: "x", figure: () => true, places: {} }), /places/);
  assert.throws(() => resolveBody({ id: "bad-place-name", name: "x", figure: () => true, places: [ { lat: 0, lon: 0 } ] }), /non-empty name/);
  assert.throws(() => resolveBody({ id: "bad-place-lat", name: "x", figure: () => true, places: [ { name: "x", lat: 91, lon: 0 } ] }), /lat\/lon/);
  assert.throws(() => resolveBody({ id: "bad-place-kind", name: "x", figure: () => true, places: [ { name: "x", lat: 0, lon: 0, kind: 1 } ] }), /kind/);
  assert.throws(() => resolveBody({
    id: "duplicate-places", name: "x", figure: () => true,
    places: [ { name: "São", lat: 0, lon: 0 }, { name: "sao", lat: 1, lon: 1 } ]
  }), /duplicate place/);
  assert.throws(() => resolveBody("not a valid id"), /body name/);
  assert.throws(() => resolveBody(42), /name or a body object/);
});

test("nothing means Earth; an unregistered name means a pending body, not Earth", () => {
  assert.equal(resolveBody(null), EARTH);
  assert.equal(resolveBody(undefined), EARTH);
  assert.equal(resolveBody(""), EARTH);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const pending = resolveBody("never-registered");
    assert.equal(pending.pending, true);
    assert.equal(pending.id, "never-registered");
    assert.equal(pending.figure(0, 0), false, "a pending body draws nothing");
    assert.equal(pending.outlines(), null);
    assert.deepEqual(pending.latRange, [ -90, 90 ]);
    assert.equal(resolveBody("never-registered"), pending, "stable identity while pending");
    assert.equal(knownBodies().includes(pending), false, "pending bodies are not known bodies");
    assert.deepEqual(warnings, [], "no warning at resolve time — packs normally arrive a moment later");
  } finally {
    console.warn = originalWarn;
  }

  const real = { id: "never-registered", name: "Arrived", figure: () => true };
  registerBody(real);
  assert.equal(resolveBody("never-registered"), real, "registration replaces the placeholder");
});

test("onBodyRegistered fires for every later registration and can be unsubscribed", () => {
  const seen = [];
  const off = onBodyRegistered((body) => seen.push(body.id));
  registerBody({ id: "listener-one", name: "One", figure: () => false });
  off();
  registerBody({ id: "listener-two", name: "Two", figure: () => false });
  assert.deepEqual(seen, [ "listener-one" ]);
});

test("all pure geometry builders honour a supplied body", () => {
  const body = { id: "north-only", figure: (lat) => lat > 0 };
  const cols = 40, latRange = [ -90, 90 ];
  const rows = Math.round(cols / 2);
  const points = buildGlobePoints(cols, latRange, body);
  const ground = buildGlobePoints(cols, latRange, body, true);
  const phases = buildGlobePhases(cols, latRange, "wave", body);
  const flags = buildGlobeFlags(cols, latRange, (lat) => lat > 45, body);
  assert.equal(points.length / 3, cols * rows / 2);
  assert.equal(points.length + ground.length, cols * rows * 3);
  assert.equal(phases.length / 2, points.length / 3);
  assert.equal(flags.length, points.length / 3);

  const grid = { cols, rows, latRange };
  assert.equal(buildFigure(grid, { body }).cells.length, cols * rows / 2);
});

test("globe buffers treat truthy and falsy classifier results as a binary partition", () => {
  const numeric = { id: "numeric", figure: (_lat, lon) => lon > 0 ? 1 : 0 };
  const cols = 40, latRange = [ -90, 90 ];
  const rows = Math.round(cols / 2);
  const figure = buildGlobePoints(cols, latRange, numeric).length / 3;
  const ground = buildGlobePoints(cols, latRange, numeric, true).length / 3;
  assert.equal(figure, cols * rows / 2);
  assert.equal(figure + ground, cols * rows);
});
