import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFigure, parseFigureStyle, cellCorner, cellCenter, EARTH, DEFAULTS } from "../dist/mappo.js";
import "../dist/bodies/earth-vector.js";   // Earth's rings are an opt-in module

const GRID = { cols: 120, rows: 47, latRange: [ -58, 84 ] };
const earth = { body: EARTH };

test("parseFigureStyle: the four documented values", () => {
  assert.deepEqual(parseFigureStyle("dots"), { dots: true, fill: false, stroke: false });
  assert.deepEqual(parseFigureStyle("solid"), { dots: false, fill: true, stroke: false });
  assert.deepEqual(parseFigureStyle("outline"), { dots: false, fill: false, stroke: true });
  assert.deepEqual(parseFigureStyle("solid outline"), { dots: false, fill: true, stroke: true });
});

test("parseFigureStyle: order, case and spacing don't matter", () => {
  const want = { dots: false, fill: true, stroke: true };
  assert.deepEqual(parseFigureStyle("outline solid"), want);
  assert.deepEqual(parseFigureStyle("  SOLID   OutLine "), want);
  assert.deepEqual(parseFigureStyle("filled stroke"), want, "synonyms accepted");
});

test("parseFigureStyle: missing/empty falls back to dots", () => {
  assert.equal(parseFigureStyle(undefined).dots, true);
  assert.equal(parseFigureStyle("").dots, true);
});

test("buildFigure: a body is required — there is no default world", () => {
  assert.throws(() => buildFigure(GRID), /body/);
  assert.throws(() => buildFigure(GRID, {}), /body/);
});

test("buildFigure: every flat contour is a closed ring", () => {
  const { loops } = buildFigure(GRID, earth);
  assert.ok(loops.length > 0);
  for (const loop of loops) {
    assert.deepEqual(loop[0], loop[loop.length - 1], "ring returns to its start");
    assert.ok(loop.length >= 4, "a ring needs at least a cell's worth of corners");
  }
});

test("buildFigure: cell count matches a direct figure sweep", () => {
  const { cells } = buildFigure(GRID, earth);
  let expected = 0;
  for (let row = 0; row < GRID.rows; row++) {
    for (let col = 0; col < GRID.cols; col++) {
      const c = cellCenter(col, row, GRID);
      if (EARTH.figure(c.lat, c.lon)) expected++;
    }
  }
  assert.equal(cells.length, expected, "the shape renderer sees exactly the body's figure");
});

test("buildFigure: contours trace ONLY figure/ground boundaries — no internal edges", () => {
  // The whole point of tracing contours rather than stroking per-cell
  // rectangles: an outline must never draw a line between two figure cells.
  const { loops } = buildFigure(GRID, earth);
  const figure = (col, row) => {
    if (row < 0 || row >= GRID.rows || col < 0 || col >= GRID.cols) return false;
    const c = cellCenter(col, row, GRID);
    return EARTH.figure(c.lat, c.lon);
  };
  let checked = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length - 1; i++) {
      const [ x1, y1 ] = loop[i];
      const [ x2, y2 ] = loop[i + 1];
      let a, b;
      if (y1 === y2) {            // horizontal edge: cells above and below
        const col = Math.min(x1, x2);
        a = figure(col, y1 - 1); b = figure(col, y1);
      } else {                    // vertical edge: cells left and right
        const row = Math.min(y1, y2);
        a = figure(x1 - 1, row); b = figure(x1, row);
      }
      assert.notEqual(a, b, `edge (${x1},${y1})->(${x2},${y2}) sits between two like cells`);
      checked++;
    }
  }
  assert.ok(checked > 500, `sanity: checked ${checked} edges`);
});

test("buildFigure: wrapX removes the antimeridian seam", () => {
  const plain = buildFigure(GRID, earth);
  const wrapped = buildFigure(GRID, { ...earth, wrapX: true });
  const onSeam = (geom) => geom.loops.flat().filter(([ x ]) => x === 0 || x === GRID.cols).length;
  assert.ok(onSeam(wrapped) < onSeam(plain),
    "a globe has no edge at ±180, so fewer contour vertices land there");
});

test("buildFigure: memoized per body, grid and wrap", () => {
  assert.equal(buildFigure(GRID, earth), buildFigure(GRID, earth), "same object back");
  assert.notEqual(buildFigure(GRID, earth), buildFigure(GRID, { ...earth, wrapX: true }), "wrap is part of the key");
});

test("buildFigure: body object identity prevents same-id cache collisions", () => {
  const inside = { id: "replaceable", figure: () => true };
  const outside = { id: "replaceable", figure: () => false };
  assert.equal(buildFigure(GRID, { body: inside }).cells.length, GRID.cols * GRID.rows);
  assert.equal(buildFigure(GRID, { body: outside }).cells.length, 0,
    "a replacement pack must never replay geometry from the old object");
});

test("buildFigure: a procedural world works exactly like a data pack", () => {
  // The seam is a function, so an invented world is a one-liner: a band of
  // figure around the equator.
  const band = { id: "band", figure: (lat) => Math.abs(lat) < 30 };
  const grid = { cols: 36, rows: 18, latRange: [ -90, 90 ] };
  const { cells, loops } = buildFigure(grid, { body: band });
  assert.equal(cells.length, 36 * 6, "six rows of 36 cells fall inside ±30°");
  assert.equal(loops.length, 1, "one contour: the band's outline");
  assert.deepEqual(loops[0][0], loops[0][loops[0].length - 1]);
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

test("DEFAULTS carry every option an attribute can set", () => {
  // element.js resets an option to DEFAULTS[key] when its attribute is removed.
  // That only works if the key EXISTS in DEFAULTS — a missing one silently
  // latches the option on forever, which is the bug this guards.
  for (const key of [ "figure", "figureSource", "figureColor", "figureStroke", "figureStrokeWidth",
                      "groundColor", "background", "borders", "bordersColor", "bordersWidth", "bordersOpacity",
                      "graticule", "meridians", "parallels", "graticuleColor",
                      "equatorColor", "graticuleOpacity", "equatorOpacity",
                      "roll", "overlays", "maxDpr", "places", "focus", "highlightPolygon", "highlightColor" ]) {
    assert.ok(key in DEFAULTS, `DEFAULTS is missing "${key}" — removing its attribute would not reset it`);
  }
});

test("Earth's vector outlines and borders decode to plausible, closed geography", () => {
  const outlines = EARTH.outlines();
  assert.ok(outlines.length > 50, "a world has many coastline rings");
  assert.equal(EARTH.outlines(), outlines, "memoized — decoded once");
  const borders = EARTH.borders();
  assert.ok(borders.length > 100, "and the borders came along");
  for (const ring of [ ...outlines, ...borders ]) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring[ring.length - 1], "every ring is closed");
    for (const [ lat, lon ] of ring) {
      assert.ok(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, "every vertex is a real coordinate");
    }
  }
});
