import { test } from "node:test";
import assert from "node:assert/strict";
import { geoMercator, geoOrthographic } from "d3-geo";
import { geoBerghaus, geoMollweide } from "d3-geo-projection";
import { EARTH } from "../src/bodies/earth.js";
import { MARS } from "../src/bodies/mars.js";
import { cellCenter, project, projectNormalized } from "../src/projection.js";
import { snapToFigure } from "../src/renderer.js";
import { projectPolyline, resolveProjection } from "../src/projections.js";
import { projectRings, stitchRings } from "../src/vector.js";
import "../src/entries/projections.js";
import "../src/entries/vector.js";
import "../src/bodies/earth-vector.js";

const FULL = [ -90, 90 ];
const close = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;
function windingAt(fill, point) {
  let winding = 0;
  for (const { points } of fill) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j], b = points[i];
      const side = (b[0] - a[0]) * (point.y - a[1]) - (point.x - a[0]) * (b[1] - a[1]);
      if (a[1] <= point.y) { if (b[1] > point.y && side > 0) winding++; }
      else if (b[1] <= point.y && side < 0) winding--;
    }
  }
  return winding;
}

test("projection inputs cannot create impossible geography or an infinite grid", () => {
  for (const latRange of [ [ -100, 90 ], [ -90, 100 ], [ 91, 92 ], [ -90, 91 ], [ 0, 0 ], [ 0, Infinity ] ]) {
    assert.throws(() => resolveProjection("equirectangular", { latRange }), /latRange/);
  }
  for (const aspect of [ 0, -1, NaN, Infinity ]) {
    assert.throws(() => resolveProjection({
      aspect,
      forward: (lat, lon) => ({ x: (lon + 180) / 360, y: (90 - lat) / 180 }),
      inverse: (x, y) => ({ lat: 90 - y * 180, lon: x * 360 - 180 })
    }, { latRange: FULL }), /aspect/);
  }

  const equal = resolveProjection("equal-earth", { latRange: FULL });
  const north = resolveProjection("stereographic-north", { latRange: [ 0, 90 ] });
  for (const projection of [ equal, north ]) {
    assert.equal(projection.forward(91, 0), null);
    assert.equal(projection.forward(NaN, 0), null);
    assert.equal(projection.inverse(NaN, 0.5), null);
    assert.equal(projection.inverse(Infinity, 0.5), null);
  }
  assert.equal(resolveProjection("equirectangular", { latRange: FULL, centerLon: 360 }).centerLon, 0);
});

test("legacy and normalized projection helpers share the strict contract", () => {
  const grid = { cols: 36, rows: 18, latRange: FULL };
  assert.equal(project(100, 190, grid), null, "an impossible latitude is off-map");
  assert.ok(close(project(0, 190, grid).x, 1), "periodic longitude wraps into the frame");
  assert.ok(close(projectNormalized(0, 190, { latRange: FULL }).x, 10 / 360));
  assert.equal(projectNormalized(91, 0, { latRange: FULL }), null);
  assert.equal(cellCenter(-1, 0, grid), null);
  assert.equal(cellCenter(36, 0, grid), null);
});

test("custom projections validate their frame and cut the default antimeridian seam", () => {
  const sinusoidal = {
    id: "sinusoidal",
    aspect: 2,
    forward(lat, lon) {
      return { x: 0.5 + lon * Math.cos(lat * Math.PI / 180) / 360, y: (90 - lat) / 180 };
    },
    inverse(x, y) {
      const lat = 90 - y * 180;
      return { lat, lon: (x - 0.5) * 360 / Math.cos(lat * Math.PI / 180) };
    }
  };
  const projection = resolveProjection(sinusoidal, { latRange: FULL });
  assert.equal(projection.kind, "cylindrical");
  const projected = projectRings(stitchRings(EARTH.outlines()), projection);
  assert.equal(projected.complete, true);
  let worst = 0;
  for (const arc of projected.edge) {
    for (let i = 1; i < arc.length; i++) worst = Math.max(worst, Math.hypot(arc[i][0] - arc[i - 1][0], arc[i][1] - arc[i - 1][1]));
  }
  assert.ok(worst < 0.25, `no false antimeridian chord (${worst})`);

  assert.throws(() => resolveProjection({ ...sinusoidal, outline: () => [ [ [ 0, 0 ], [ 2, 0 ], [ 0, 1 ] ] ] }, { latRange: FULL }), /unit frame/);
  const clipped = resolveProjection({
    ...sinusoidal,
    seam: false,
    forward: (lat, lon) => lon > 0 ? null : sinusoidal.forward(lat, lon)
  }, { latRange: FULL });
  assert.equal(projectRings([ [ [ -10, -20 ], [ 10, -20 ], [ 10, 20 ], [ -10, 20 ], [ -10, -20 ] ] ], clipped).complete, false,
    "missing vertices invalidate topology instead of joining survivors");
});

test("real d3 projections use the stream for clipping, outline, and latitude bands", () => {
  const orthographic = resolveProjection(geoOrthographic(), { latRange: FULL });
  assert.ok(orthographic.forward(0, 0));
  assert.equal(orthographic.forward(0, 180), null, "the hidden hemisphere is clipped");
  assert.equal(orthographic.outline().length, 1);
  assert.ok(orthographic.outline()[0].length > 100, "the frame is d3's circular sphere, not a rectangle");
  assert.ok(close(orthographic.aspect, 1, 1e-6));

  const mollweide = resolveProjection(geoMollweide(), { latRange: FULL });
  assert.ok(close(mollweide.aspect, 2, 1e-6));
  assert.equal(mollweide.inverse(0.001, 0.001), null, "a rectangular corner outside the curved sphere is off-map");

  const cropped = resolveProjection(geoMollweide(), { latRange: [ -30, 60 ] });
  assert.equal(cropped.forward(-40, 0), null);
  assert.ok(cropped.forward(59, 0));
  for (let y = 0; y <= 1; y += 0.05) {
    const p = cropped.inverse(0.5, y);
    if (p) assert.ok(p.lat >= -30 - 1e-7 && p.lat <= 60 + 1e-7);
  }

  const mercator = resolveProjection(geoMercator(), { latRange: FULL });
  assert.ok(close(mercator.aspect, 1, 1e-6), "d3's default Mercator streamed sphere has its square clip extent");
});

test("d3 geometry is stream-cut and mutable projection state invalidates its adapter", () => {
  const raw = geoOrthographic();
  const first = resolveProjection(raw, { latRange: FULL });
  assert.equal(resolveProjection(raw, { latRange: FULL }), first, "unchanged state reuses the adapter");
  raw.rotate([ -90, 0 ]);
  const rotated = resolveProjection(raw, { latRange: FULL });
  assert.notEqual(rotated.key, first.key);
  assert.equal(rotated.forward(0, -90), null);
  assert.ok(close(rotated.forward(0, 90).x, 0.5));

  const specialized = geoBerghaus();
  const fiveLobes = resolveProjection(specialized, { latRange: FULL });
  specialized.lobes(7);
  assert.notEqual(resolveProjection(specialized, { latRange: FULL }).key, fiveLobes.key,
    "projection-specific d3-geo-projection setters are fingerprinted too");

  const ring = [ [ -20, 170 ], [ 20, 170 ], [ 20, -170 ], [ -20, -170 ], [ -20, 170 ] ];
  const mapped = projectRings([ ring ], resolveProjection(geoMollweide(), { latRange: FULL }));
  assert.equal(mapped.complete, true);
  assert.ok(mapped.edge.length >= 2, "the stream cuts an antimeridian-crossing outline");
  for (const arc of mapped.edge) for (let i = 1; i < arc.length; i++) {
    assert.ok(Math.abs(arc[i][0] - arc[i - 1][0]) < 0.25, "no edge crosses the frame as a chord");
  }

  const rearLine = [ [ 0, 120 ], [ 0, 180 ], [ 0, -120 ] ];
  assert.equal(projectPolyline(rearLine, resolveProjection(geoOrthographic(), { latRange: FULL })).length, 0);
});

test("d3 compound-ring winding fills figure, not its complement", () => {
  const projection = resolveProjection(geoOrthographic(), { latRange: FULL });
  const { fill } = projectRings(stitchRings(EARTH.outlines()), projection);
  for (const [ lat, lon ] of [ [ 0, 20 ], [ 50, 10 ], [ -25, 25 ] ]) {
    assert.notEqual(windingAt(fill, projection.forward(lat, lon)), 0, `${lat},${lon} is land and is filled`);
  }
  for (const [ lat, lon ] of [ [ 0, -30 ], [ 20, -40 ] ]) {
    assert.equal(windingAt(fill, projection.forward(lat, lon)), 0, `${lat},${lon} is ocean and stays ground`);
  }

  const mars = projectRings(stitchRings(MARS.outlines()), resolveProjection(geoMollweide(), { latRange: FULL })).fill;
  for (const [ lat, lon ] of [ [ -42.4, 70.5 ], [ 70, 0 ] ]) {
    assert.notEqual(windingAt(mars, resolveProjection(geoMollweide(), { latRange: FULL }).forward(lat, lon)), 0,
      `${lat},${lon} is a Martian lowland and is filled`);
  }
  for (const [ lat, lon ] of [ [ 18.65, -133.8 ], [ -40, 0 ] ]) {
    assert.equal(windingAt(mars, resolveProjection(geoMollweide(), { latRange: FULL }).forward(lat, lon)), 0,
      `${lat},${lon} is a Martian highland and stays ground`);
  }
});

test("failed seam stitching is transactional and never duplicates a partial source", () => {
  const a = [ [ 20, 180 ], [ 25, 170 ], [ 30, 180 ], [ 0, -180 ], [ 5, -170 ], [ 10, -180 ], [ 20, 180 ] ];
  const b = [ [ 10, 180 ], [ 25, 160 ], [ 40, 180 ], [ 10, 180 ] ];
  const c = [ [ 30, -180 ], [ 25, -160 ], [ 20, -180 ], [ 30, -180 ] ];
  const stitched = stitchRings([ a, b, c ]);
  assert.deepEqual(stitched, [ a, b, c ]);
});

test("snapToFigure never returns an off-world cell at a curved frame edge", () => {
  for (const [ projection, lat, lon ] of [
    [ resolveProjection("equal-earth", { latRange: FULL }), -74, -180 ],
    [ resolveProjection("stereographic-north", { latRange: [ 0, 90 ] }), 0, -168.25 ]
  ]) {
    const grid = { cols: 40, rows: Math.round(40 / projection.aspect), latRange: projection.latRange, projection };
    const cell = snapToFigure(lat, lon, grid, { figure: () => false });
    assert.ok(cell, "a ground marker near the rim still has a drawable cell");
    assert.ok(cellCenter(cell.col, cell.row, grid), "the returned cell has a geographic centre");
  }
});
