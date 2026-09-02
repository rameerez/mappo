import { test } from "node:test";
import assert from "node:assert/strict";
import { latLonToXYZ, buildGlobePoints, buildGlobePhases, buildGlobeFlags, buildGlobeTiles, forEachSample, uniformCount } from "../src/globe.js";
import { EARTH } from "../src/bodies/earth.js";
import { hoverShade } from "../src/color.js";

test("hoverShade derives contrast-aware shades from the figure colour", () => {
  const darkFromLight = hoverShade("#d3dce6"); // the default light dots
  const lightFromDark = hoverShade("#223041"); // the off-dark ground shade
  const lum = (hex) => {
    const [ r, g, b ] = [ 1, 3, 5 ].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  assert.ok(lum(darkFromLight) < lum("#d3dce6"), "light dots hover darker");
  assert.ok(lum(lightFromDark) > lum("#223041"), "dark dots hover lighter");
  assert.match(darkFromLight, /^#[0-9a-f]{6}$/);
  assert.equal(hoverShade("#abc"), hoverShade("#aabbcc"), "short hex expands");
  assert.ok(hoverShade("rebeccapurple").startsWith("color-mix("), "non-hex falls back to color-mix");
});

// The globe's math layer is pure and must hold in Node — the canvas half
// only ever runs in a browser.

test("latLonToXYZ puts known points where the projection says", () => {
  const origin = latLonToXYZ(0, 0); // equator, prime meridian → faces viewer
  assert.ok(Math.abs(origin.x) < 1e-9 && Math.abs(origin.y) < 1e-9 && Math.abs(origin.z - 1) < 1e-9);

  const pole = latLonToXYZ(90, 0); // north pole → straight up
  assert.ok(Math.abs(pole.y - 1) < 1e-9 && Math.abs(pole.x) < 1e-9 && Math.abs(pole.z) < 1e-9);

  const east = latLonToXYZ(0, 90); // 90°E → +x
  assert.ok(Math.abs(east.x - 1) < 1e-9 && Math.abs(east.z) < 1e-9);
});

test("every globe point sits on the unit sphere", () => {
  const pts = buildGlobePoints(120, [ -58, 84 ], EARTH);
  assert.ok(pts.length > 0, "no figure points generated");
  for (let i = 0; i < pts.length; i += 3) {
    const r = Math.hypot(pts[i], pts[i + 1], pts[i + 2]);
    assert.ok(Math.abs(r - 1) < 1e-6, `point ${i / 3} off the sphere: |r|=${r}`);
  }
});

test("globe density scales with resolution and stays land-only-plausible", () => {
  const lo = buildGlobePoints(80, [ -58, 84 ], EARTH).length / 3;
  const hi = buildGlobePoints(160, [ -58, 84 ], EARTH).length / 3;
  // Doubling cols quadruples cells; land fraction is scale-free, so the
  // point count should land near 4× (sampling noise allowed).
  assert.ok(hi > lo * 3 && hi < lo * 5, `expected ~4× density, got ${hi / lo}×`);
  // Sanity: the world is about 30% land; the grid should be nowhere near
  // all-land or all-ocean.
  const cells = 160 * Math.round((160 / 360) * 142);
  const frac = hi / cells;
  assert.ok(frac > 0.15 && frac < 0.5, `implausible land fraction ${frac}`);
  assert.ok(EARTH.figure(51.5, -0.1), "London sanity anchor");
});

test("figure and ground buffers partition the grid exactly", () => {
  const cols = 100;
  const latRange = [ -58, 84 ];
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const figure = buildGlobePoints(cols, latRange, EARTH).length / 3;
  const ground = buildGlobePoints(cols, latRange, EARTH, true).length / 3;
  assert.equal(figure + ground, cols * rows, "every cell is exactly one of figure|ground");
  assert.ok(ground > figure, "Earth is mostly ocean");
});

test("animation phases align one-to-one with globe points", () => {
  for (const mode of [ "wave", "noise", "ripple", "sweep", "sparkle" ]) {
    const pts = buildGlobePoints(90, [ -58, 84 ], EARTH).length / 3;
    const ph = buildGlobePhases(90, [ -58, 84 ], mode, EARTH);
    assert.equal(ph.length / 2, pts, `${mode}: phase pairs must match point count`);
    for (let i = 0; i < ph.length; i += 2) {
      assert.ok(ph[i] >= 0 && ph[i] <= 1.01, `${mode}: phase in [0,1]`);
      assert.ok(ph[i + 1] >= 0.55 && ph[i + 1] <= 1, `${mode}: amp in [0.55,1]`);
    }
  }
});

// ── the uniform distribution and tiles ──────────────────────────────────────

test("uniform distribution: an equal-area lattice with the grid's equatorial spacing", () => {
  const cols = 120, n = uniformCount(cols);
  assert.equal(n, Math.round((cols * cols) / Math.PI));
  let count = 0;
  const bands = new Array(6).fill(0);
  let first = null;
  forEachSample(cols, [ -90, 90 ], "uniform", (lat, lon) => {
    first ??= [ lat, lon ];
    count++;
    assert.ok(lat >= -90 && lat <= 90 && lon >= -180 && lon < 180, `sample in range: ${lat}, ${lon}`);
    bands[Math.min(5, Math.floor((lat + 90) / 30))]++;
  });
  assert.equal(count, n, "every candidate is visited once");
  // Equal area: a 30° band holds (sin top − sin bottom) / 2 of the sphere.
  const RAD = Math.PI / 180;
  for (let i = 0; i < 6; i++) {
    const share = (Math.sin((-90 + 30 * (i + 1)) * RAD) - Math.sin((-90 + 30 * i) * RAD)) / 2;
    assert.ok(Math.abs(bands[i] / n - share) < 0.01, `band ${i}: ${(bands[i] / n).toFixed(3)} of the samples for ${share.toFixed(3)} of the area`);
  }
  // The lattice's axis is the first sample, and it lies on the equator at 90°W.
  assert.ok(Math.abs(first[0]) < 1e-9 && Math.abs(first[1] + 90) < 1e-9, `axis at ${first}`);
  // Figure and ground partition the lattice exactly, as they do the grid.
  const figure = buildGlobePoints(cols, [ -90, 90 ], EARTH, false, "uniform").length / 3;
  const ground = buildGlobePoints(cols, [ -90, 90 ], EARTH, true, "uniform").length / 3;
  assert.equal(figure + ground, n);
  assert.ok(figure / n > 0.25 && figure / n < 0.33, `Earth is about 29% land (${(100 * figure / n).toFixed(1)}%)`);
  // latRange still crops the field.
  let north = 0;
  forEachSample(cols, [ 0, 90 ], "uniform", () => north++);
  assert.ok(Math.abs(north / n - 0.5) < 0.01, "half the samples lie north of the equator");
  // Flags and phases stay index-aligned with the points.
  assert.equal(buildGlobeFlags(cols, [ -90, 90 ], (lat) => lat > 0, EARTH, "uniform").length, figure);
  assert.equal(buildGlobePhases(cols, [ -90, 90 ], "wave", EARTH, "uniform").length, figure * 2);
  // The default is the grid, unchanged.
  assert.equal(buildGlobePoints(60, [ -58, 84 ], EARTH).length, buildGlobePoints(60, [ -58, 84 ], EARTH, false, "grid").length);
});

test("tiles: a unit centre and two orthogonal half-side tangents per dot, aligned with the points", () => {
  const h = 0.01;
  for (const distribution of [ "grid", "uniform" ]) {
    const tiles = buildGlobeTiles(60, [ -90, 90 ], EARTH, h, false, distribution);
    const pts = buildGlobePoints(60, [ -90, 90 ], EARTH, false, distribution);
    assert.equal(tiles.length / 9, pts.length / 3, `${distribution}: one tile per point`);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const len = (a) => Math.hypot(a[0], a[1], a[2]);
    for (let i = 0; i < tiles.length; i += 9) {
      const c = [ tiles[i], tiles[i + 1], tiles[i + 2] ];
      const e = [ tiles[i + 3], tiles[i + 4], tiles[i + 5] ];
      const n = [ tiles[i + 6], tiles[i + 7], tiles[i + 8] ];
      assert.ok(Math.abs(len(c) - 1) < 1e-5, "the centre is on the unit sphere");
      assert.ok(Math.abs(c[0] - pts[i / 3]) < 1e-6 && Math.abs(c[2] - pts[i / 3 + 2]) < 1e-6, "the centre is the point");
      assert.ok(Math.abs(len(e) - h) < 1e-6 && Math.abs(len(n) - h) < 1e-6, "tangents are half a side long");
      assert.ok(Math.abs(dot(c, e)) < 1e-6 && Math.abs(dot(c, n)) < 1e-6 && Math.abs(dot(e, n)) < 1e-6, "tangents lie in the tangent plane, at right angles");
      assert.ok(Math.abs(e[1]) < 1e-9 && n[1] >= -1e-9, "east is level, north points up");
    }
  }
});
