import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EARTH, project, cellCenter, resolvePlace, snapToFigure, DEFAULTS, Mappo, parseFigureStyle
} from "../dist/mappo.js";

// The dist bundle is what ships — test THAT, not src/, so a build bug can
// never pass the suite.

const GRID = { cols: 120, rows: 47, latRange: [ -58, 84 ] };

test("Earth figure: known land and sea points", () => {
  assert.equal(EARTH.figure(40.4, -3.7), true, "Madrid");
  assert.equal(EARTH.figure(-5, -60), true, "Amazon");
  assert.equal(EARTH.figure(65, 100), true, "Siberia");
  assert.equal(EARTH.figure(23, 10), true, "Sahara");
  assert.equal(EARTH.figure(30, -40), false, "mid-Atlantic");
  assert.equal(EARTH.figure(0, -150), false, "mid-Pacific");
  assert.equal(EARTH.figure(-20, 80), false, "Indian Ocean");
});

test("Earth figure: poles, bounds, NaN and wrapped longitudes", () => {
  assert.equal(typeof EARTH.figure(90, 180), "boolean");
  assert.equal(typeof EARTH.figure(-90, -180), "boolean");
  assert.equal(EARTH.figure(91, 0), false, "off the sphere is ground");
  assert.equal(EARTH.figure(NaN, 0), false);
  assert.equal(EARTH.figure(0, NaN), false);
  // 180 and -180 are one meridian; longitude is periodic, not clamped.
  for (const lat of [ 0, 40.4, -33.9, 65 ]) {
    assert.equal(EARTH.figure(lat, -170 + 360), EARTH.figure(lat, -170), `lon wraps at lat ${lat}`);
    assert.equal(EARTH.figure(lat, 180), EARTH.figure(lat, -180));
  }
});

test("Earth: the body that ships in the box is a complete body", () => {
  assert.equal(EARTH.id, "earth");
  assert.equal(EARTH.name, "Earth");
  assert.equal(EARTH.radiusKm, 6371);
  assert.deepEqual(EARTH.latRange, [ -58, 84 ]);
  assert.deepEqual(EARTH.terms, { figure: "land", ground: "ocean" });
  assert.ok(EARTH.places.length > 150);
  assert.ok(EARTH.outlines().length > 50, "a world has many coastline rings");
  assert.ok(EARTH.borders().length > 100, "and the country borders came along");
});

test("projection: project and cellCenter are inverses at cell centres", () => {
  for (const [ col, row ] of [ [ 0, 0 ], [ 60, 23 ], [ 119, 46 ] ]) {
    const { lat, lon } = cellCenter(col, row, GRID);
    const { x, y } = project(lat, lon, GRID);
    assert.ok(Math.abs(x - (col + 0.5)) < 1e-9, `x roundtrip for ${col}`);
    assert.ok(Math.abs(y - (row + 0.5)) < 1e-9, `y roundtrip for ${row}`);
  }
});

test("projection: latRange top edge maps to y=0", () => {
  const { y } = project(GRID.latRange[1], 0, GRID);
  assert.equal(y, 0);
});

test("places: gazetteer lookups are case-insensitive and trimmed", () => {
  assert.deepEqual(resolvePlace("London", EARTH), { name: "London", lat: 51.5, lon: -0.1 });
  assert.equal(resolvePlace("  lagos ", EARTH).lat, 6.5);
  assert.equal(resolvePlace("SINGAPORE", EARTH).lon, 103.8);
});

test("places: accents are folded on the way in, kept on the way out", () => {
  // The gazetteer spells São Paulo properly; a person typing either spelling
  // should find it, and should get their own spelling back on the label.
  assert.deepEqual(resolvePlace("Sao Paulo", EARTH), { name: "Sao Paulo", lat: -23.6, lon: -46.6 });
  assert.deepEqual(resolvePlace("São Paulo", EARTH), { name: "São Paulo", lat: -23.6, lon: -46.6 });
  assert.equal(resolvePlace("Zurich", EARTH).lat, resolvePlace("Zürich", EARTH).lat);
  assert.equal(resolvePlace("BOGOTÁ", EARTH).lon, resolvePlace("bogota", EARTH).lon);
  // Precomposed (a-with-tilde) and decomposed (a + combining tilde) look
  // identical on screen and are different bytes; both have to find it.
  assert.equal(resolvePlace("São Paulo", EARTH).lat, resolvePlace("São Paulo", EARTH).lat);
});

test("places: unknown names resolve to null, never throw", () => {
  assert.equal(resolvePlace("Atlantis", EARTH), null);
  assert.equal(resolvePlace("", EARTH), null);
  assert.equal(resolvePlace({ name: "no coords" }, EARTH), null);
  assert.equal(resolvePlace(null, EARTH), null);
});

test("places: custom coordinate records pass through, with their extras", () => {
  const custom = resolvePlace({ name: "HQ", lat: 1.2, lon: 3.4, color: "#f00", kind: "office" }, EARTH);
  assert.deepEqual(custom, { name: "HQ", lat: 1.2, lon: 3.4, color: "#f00", kind: "office" });
  assert.equal(resolvePlace({ lat: 1, lon: 2 }, EARTH).name, "");
});

test("places: every Earth gazetteer entry sits on land after snapping", () => {
  // The gazetteer's whole promise: type a name, get a marker ON the map.
  // The snapped cell must be figure for every place at the default resolution.
  for (const { name, lat, lon } of EARTH.places) {
    const { col, row } = snapToFigure(lat, lon, GRID, EARTH);
    const c = cellCenter(col, row, GRID);
    assert.equal(EARTH.figure(c.lat, c.lon), true, `${name} snaps to sea at the default resolution`);
  }
});

test("snapToFigure: coastal city moves onto land, inland city stays put", () => {
  // Venice sits in the lagoon — must snap to a land cell.
  const venice = snapToFigure(45.4, 12.3, GRID, EARTH);
  const vc = cellCenter(venice.col, venice.row, GRID);
  assert.equal(EARTH.figure(vc.lat, vc.lon), true);

  // Madrid's own cell is land — snapping must not move it.
  const { x, y } = project(40.4, -3.7, GRID);
  const madrid = snapToFigure(40.4, -3.7, GRID, EARTH);
  assert.equal(madrid.col, Math.floor(x));
  assert.equal(madrid.row, Math.floor(y));
});

test("snapToFigure: a body is required — there is no default world", () => {
  assert.throws(() => snapToFigure(0, 0, GRID), /body/);
});

test("defaults: sane, internally consistent, and Earth-free", () => {
  assert.equal(DEFAULTS.cols, null, "cols is auto — resolved per mode (120 flat / 170 globe)");
  assert.equal("latRange" in DEFAULTS, false, "framing comes from the body, not from a default");
  assert.equal(DEFAULTS.latMin, null);
  assert.equal(DEFAULTS.latMax, null);
  assert.equal(DEFAULTS.body, null, "null body means Earth, the body that ships in the box");
  assert.equal(DEFAULTS.figure, "dots");
  assert.equal(DEFAULTS.figureSource, "grid");
  assert.equal(DEFAULTS.groundColor, "none");
  assert.deepEqual(DEFAULTS.places, []);
  assert.equal(DEFAULTS.animation, "none", "animation is opt-in");
  assert.equal(DEFAULTS.interactive, true);
  for (const gone of [ "land", "landColor", "landSource", "oceanColor", "dotColor", "cities", "markers", "onCityClick" ]) {
    assert.equal(gone in DEFAULTS, false, `${gone} is Earth vocabulary and is gone`);
  }
});

test("locate: the flat map answers in CSS pixels from its own corner", () => {
  // No DOM here, so this exercises the arithmetic through a stand-in host —
  // the contract being pinned is that lon -180…180 spans the width and the
  // latRange spans the height, corner to corner.
  const box = { clientWidth: 360, style: {} };
  const map = Object.create(Mappo.prototype);
  Object.assign(map, {
    container: box, options: { ...DEFAULTS, latRange: [ -90, 90 ] },
    grid: { cols: 360, rows: 180, latRange: [ -90, 90 ] }, _globe: null, svg: null
  });
  assert.deepEqual(map.locate(90, -180), { x: 0, y: 0, depth: 1, front: true });
  assert.deepEqual(map.locate(-90, 180), { x: 360, y: 180, depth: 1, front: true });
  assert.deepEqual(map.locate(0, 0), { x: 180, y: 90, depth: 1, front: true });
});

test("hover: a figure style without dots has no dots to hover", () => {
  // The globe used to hit-test the dot grid whatever the figure style was, so
  // an outline map painted a hover blob, moved the cursor and fired dotenter
  // for a dot that was never drawn. Both renderers now key off the parsed style.
  assert.equal(parseFigureStyle("dots").dots, true);
  for (const v of [ "outline", "solid", "solid outline", "stroke", "filled" ]) {
    assert.equal(parseFigureStyle(v).dots, false, v);
  }
  assert.equal(parseFigureStyle(undefined).dots, true);
  assert.equal(parseFigureStyle("").dots, true);
});
