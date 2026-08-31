import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLand, parseLandStyle, cellCorner, cellCenter, isLand,
         DEFAULTS, landShapes, countryShapes } from "../dist/mappo.js";

const GRID = { cols: 120, rows: 47, latRange: [ -58, 84 ] };

test("parseLandStyle: the four documented values", () => {
  assert.deepEqual(parseLandStyle("dots"), { dots: true, fill: false, stroke: false });
  assert.deepEqual(parseLandStyle("solid"), { dots: false, fill: true, stroke: false });
  assert.deepEqual(parseLandStyle("outline"), { dots: false, fill: false, stroke: true });
  assert.deepEqual(parseLandStyle("solid outline"), { dots: false, fill: true, stroke: true });
});

test("parseLandStyle: order, case and spacing don't matter", () => {
  const want = { dots: false, fill: true, stroke: true };
  assert.deepEqual(parseLandStyle("outline solid"), want);
  assert.deepEqual(parseLandStyle("  SOLID   OutLine "), want);
  assert.deepEqual(parseLandStyle("filled stroke"), want, "synonyms accepted");
});

test("parseLandStyle: missing/empty falls back to dots", () => {
  assert.equal(parseLandStyle(undefined).dots, true);
  assert.equal(parseLandStyle("").dots, true);
});

test("buildLand: every contour is a closed ring", () => {
  const { loops } = buildLand(GRID);
  assert.ok(loops.length > 0);
  for (const loop of loops) {
    const first = loop[0], last = loop[loop.length - 1];
    assert.deepEqual(first, last, "ring returns to its start");
    assert.ok(loop.length >= 4, "a ring needs at least a cell's worth of corners");
  }
});

test("buildLand: cell count matches a direct mask sweep", () => {
  const { cells } = buildLand(GRID);
  let expected = 0;
  for (let row = 0; row < GRID.rows; row++) {
    for (let col = 0; col < GRID.cols; col++) {
      const c = cellCenter(col, row, GRID);
      if (isLand(c.lat, c.lon)) expected++;
    }
  }
  assert.equal(cells.length, expected, "the shape renderer sees exactly the mask's land");
});

test("buildLand: contours trace ONLY land/sea boundaries — no internal edges", () => {
  // The whole point of tracing contours rather than stroking per-cell
  // rectangles: an outline must never draw a line between two land cells.
  const { loops } = buildLand(GRID);
  const land = (col, row) => {
    if (row < 0 || row >= GRID.rows || col < 0 || col >= GRID.cols) return false;
    const c = cellCenter(col, row, GRID);
    return isLand(c.lat, c.lon);
  };
  let checked = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length - 1; i++) {
      const [ x1, y1 ] = loop[i];
      const [ x2, y2 ] = loop[i + 1];
      let a, b;
      if (y1 === y2) {            // horizontal edge: cells above and below
        const col = Math.min(x1, x2);
        a = land(col, y1 - 1); b = land(col, y1);
      } else {                    // vertical edge: cells left and right
        const row = Math.min(y1, y2);
        a = land(x1 - 1, row); b = land(x1, row);
      }
      assert.notEqual(a, b, `edge (${x1},${y1})->(${x2},${y2}) sits between two like cells`);
      checked++;
    }
  }
  assert.ok(checked > 500, `sanity: checked ${checked} edges`);
});

test("buildLand: wrapX removes the antimeridian seam", () => {
  const plain = buildLand(GRID);
  const wrapped = buildLand(GRID, { wrapX: true });
  const onSeam = (geom) => geom.loops.flat().filter(([ x ]) => x === 0 || x === GRID.cols).length;
  assert.ok(onSeam(wrapped) < onSeam(plain),
    "a globe has no edge at ±180, so fewer contour vertices land there");
});

test("buildLand: memoized per grid + wrap", () => {
  assert.equal(buildLand(GRID), buildLand(GRID), "same object back");
  assert.notEqual(buildLand(GRID), buildLand(GRID, { wrapX: true }), "wrap is part of the key");
});

test("cellCorner: corners bound their cell's centre", () => {
  const centre = cellCenter(10, 10, GRID);
  const tl = cellCorner(10, 10, GRID);
  const br = cellCorner(11, 11, GRID);
  assert.ok(tl.lon < centre.lon && centre.lon < br.lon, "longitude brackets the centre");
  assert.ok(br.lat < centre.lat && centre.lat < tl.lat, "latitude brackets the centre (north is up)");
});

test("cellCorner: the grid's corners are the frame's corners", () => {
  const tl = cellCorner(0, 0, GRID);
  const br = cellCorner(GRID.cols, GRID.rows, GRID);
  assert.equal(tl.lon, -180);
  assert.equal(tl.lat, GRID.latRange[1]);
  assert.equal(br.lon, 180);
  assert.equal(br.lat, GRID.latRange[0]);
});

test("DEFAULTS carry every land option an attribute can set", () => {
  // element.js resets an option to DEFAULTS[key] when its attribute is removed.
  // That only works if the key EXISTS in DEFAULTS — a missing one silently
  // latches the option on forever, which is the bug this guards.
  for (const key of [ "land", "landSource", "landColor", "landStroke", "landStrokeWidth",
                      "borders", "bordersColor", "bordersWidth", "bordersOpacity",
                      "graticule", "meridians", "parallels", "graticuleColor",
                      "equatorColor", "graticuleOpacity", "equatorOpacity",
                      "roll", "overlays", "maxDpr" ]) {
    assert.ok(key in DEFAULTS, `DEFAULTS is missing "${key}" — removing its attribute would not reset it`);
  }
});

test("vector shapes decode to plausible geography", () => {
  const land = landShapes();
  assert.ok(land.length > 50, "a world has many coastline rings");
  assert.ok(land.every((r) => r.length > 2));
  const pts = land.flat();
  assert.ok(pts.every(([ lat, lon ]) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180),
    "every vertex is a real coordinate");
  assert.equal(landShapes(), land, "memoized — decoded once");
  assert.ok(countryShapes().length > 100, "and the borders came along");
});
