import { test } from "node:test";
import assert from "node:assert/strict";
import { geoEquirectangular } from "d3-geo";
import {
  EARTH, resolveProjection, knownProjections, projectNormalized, buildFigure, snapToFigure, cellCenter, project
} from "../dist/mappo.js";
import "../dist/projections.js";
import { stitchRings, projectRings } from "../dist/vector.js";
import "../dist/bodies/earth-vector.js";
import { projectPolyline, wrapLon, projectionDefaultRange } from "../dist/mappo.js";
import { MARS } from "mappo/bodies/mars";
import { MOON } from "mappo/bodies/moon";

const FULL = [ -90, 90 ];
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("the four built-ins are known and resolve; nothing else does", () => {
  assert.deepEqual(knownProjections(), [ "equirectangular", "equal-earth", "stereographic-north", "stereographic-south" ]);
  for (const id of knownProjections()) {
    const p = resolveProjection(id, { latRange: projectionDefaultRange(id, FULL) });
    assert.equal(p.id, id);
    assert.ok(p.aspect > 0);
    assert.equal(typeof p.forward, "function");
    assert.equal(typeof p.inverse, "function");
  }
  assert.equal(resolveProjection(" Equal-Earth ", { latRange: FULL }).id, "equal-earth", "names fold case and whitespace");
  assert.throws(() => resolveProjection("mercator", { latRange: FULL }), /unknown projection "mercator"/);
  assert.throws(() => resolveProjection(42, { latRange: FULL }), /known name/);
  assert.throws(() => resolveProjection("equal-earth", { latRange: [ 10, -10 ] }), /latRange/);
  assert.throws(() => resolveProjection("equal-earth", { latRange: FULL, centerLon: NaN }), /centerLon/);
  assert.equal(resolveProjection("equal-earth", { latRange: FULL }), resolveProjection("equal-earth", { latRange: FULL }), "instances are memoised");
});

test("equirectangular is the default and unchanged: linear, full-frame, aspect 360/span", () => {
  const p = resolveProjection("equirectangular", { latRange: [ -58, 84 ] });
  assert.ok(close(p.aspect, 360 / 142));
  assert.deepEqual(p.forward(84, -180), { x: 0, y: 0 });
  const br = p.forward(-58, 180);
  assert.ok(close(br.x, 1) && close(br.y, 1));
  assert.deepEqual(p.inverse(0.5, 0.5), { lat: 13, lon: 0 });
  assert.equal(p.inverse(1.5, 0.5), null, "outside the frame is off the world");
  assert.deepEqual(p.outline(), [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ], [ 0, 0 ] ] ]);
});

test("every built-in round-trips forward → inverse → forward to 1e-9 on a lat/lon grid", () => {
  for (const id of knownProjections()) {
    const p = resolveProjection(id, { latRange: id.startsWith("stereographic") ? (id.endsWith("north") ? [ 0, 90 ] : [ -90, 0 ]) : FULL });
    let worst = 0, count = 0;
    for (let lat = -89; lat <= 89; lat += 4) {
      for (let lon = -179; lon <= 179; lon += 6) {
        const f = p.forward(lat, lon);
        if (!f) continue;                          // off the map (the far hemisphere of a polar map): legitimately null
        assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), `${id}: finite forward at ${lat},${lon}`);
        const back = p.inverse(f.x, f.y);
        assert.ok(back, `${id}: a point forward() placed is on the map for inverse() at ${lat},${lon}`);
        const f2 = p.forward(back.lat, back.lon);
        worst = Math.max(worst, Math.abs(f2.x - f.x), Math.abs(f2.y - f.y), Math.abs(back.lat - lat));
        count++;
      }
    }
    assert.ok(count > 500, `${id}: enough points inverted (${count})`);
    assert.ok(worst < 1e-9, `${id}: worst round-trip error ${worst}`);
  }
});

test("Equal Earth: the published extents, equal-area behaviour, corners off the world", () => {
  const p = resolveProjection("equal-earth", { latRange: FULL });
  assert.ok(close(p.aspect, 2.0545, 5e-4), `aspect ${p.aspect} ≈ 2.05:1`);
  const centre = p.forward(0, 0);
  assert.ok(close(centre.x, 0.5) && close(centre.y, 0.5));
  // Parallels are horizontal and meridians curve: same y along a parallel.
  assert.ok(close(p.forward(40, -120).y, p.forward(40, 120).y));
  assert.ok(p.forward(60, 180).x < p.forward(0, 180).x, "the frame narrows toward the poles");
  assert.equal(p.inverse(0.001, 0.001), null, "the top-left corner is outside the world");
  assert.equal(p.inverse(0.999, 0.999), null);
  assert.ok(p.inverse(0.5, 0.01) !== null, "the pole itself is on the map");
  for (const ring of p.outline()) assert.deepEqual(ring[0], ring[ring.length - 1], "closed outline");
});

test("polar stereographic: pole at the centre, rim from the far bound, USGS orientation", () => {
  const north = resolveProjection("stereographic-north", { latRange: [ 0, 90 ] });
  const south = resolveProjection("stereographic-south", { latRange: [ -90, 0 ] });
  assert.equal(north.aspect, 1);
  assert.deepEqual(north.forward(90, 123), { x: 0.5, y: 0.5 }, "the pole is the centre whatever the longitude");
  // On the rim (the equator here) the radius is half the frame.
  assert.ok(close(Math.hypot(north.forward(0, 45).x - 0.5, north.forward(0, 45).y - 0.5), 0.5));
  // 90°E to the right in both aspects; the central meridian points down on a
  // north map and up on a south map.
  assert.ok(north.forward(45, 90).x > 0.5 && close(north.forward(45, 90).y, 0.5));
  assert.ok(south.forward(-45, 90).x > 0.5 && close(south.forward(-45, 90).y, 0.5));
  assert.ok(north.forward(45, 0).y > 0.5, "north: 0° at the bottom");
  assert.ok(south.forward(-45, 0).y < 0.5, "south: 0° at the top");
  // Conformal scale: ρ = 2 tan(c/2) puts 60°N at tan(15°)/tan(45°) of the rim.
  const r60 = Math.hypot(north.forward(60, 0).x - 0.5, north.forward(60, 0).y - 0.5);
  assert.ok(close(r60, 0.5 * Math.tan(15 * Math.PI / 180) / Math.tan(45 * Math.PI / 180), 1e-12));
  assert.equal(north.inverse(0.01, 0.01), null, "the corner of the frame is outside the disc");
  assert.equal(north.inverse(0.5, 0.5).lat, 90);
  // The far hemisphere has no place on the map: forward() says so. The
  // permissive forwardShifted the ring geometry uses still lands far outside,
  // finitely, so an outline crossing the rim keeps its shape under the clip.
  assert.equal(north.forward(-60, 0), null, "a far point is off the map");
  const far = north.forwardShifted(-60, 0);
  assert.ok(Number.isFinite(far.x) && Math.hypot(far.x - 0.5, far.y - 0.5) > 1);
  const antipode = north.forwardShifted(-90, 0);
  assert.ok(Number.isFinite(antipode.x) && Number.isFinite(antipode.y), "even the antipode is finite");
  assert.ok(north.forward(0, 45) && north.forward(0.5, 45), "the rim itself is on the map");
  assert.throws(() => resolveProjection("stereographic-north", { latRange: [ -90, 90 ] }), /cannot reach the opposite pole/);
  // A rim short of the equator and an inner bound short of the pole: an annulus.
  const annulus = resolveProjection("stereographic-south", { latRange: [ -85, -60 ] });
  assert.equal(annulus.inverse(0.5, 0.5), null, "the hole is off the map");
  assert.equal(annulus.outline().length, 2, "outer rim and inner hole");
});

test("a central meridian shifts cylindrical maps and rotates polar ones", () => {
  const pacific = resolveProjection("equirectangular", { latRange: FULL, centerLon: 150 });
  assert.ok(close(pacific.forward(0, 150).x, 0.5), "150°E sits at the centre");
  assert.ok(close(pacific.forward(0, -30).x, 0), "the seam is now at −30°");
  assert.deepEqual(pacific.inverse(0.5, 0.5), { lat: 0, lon: 150 });
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(180), -180);
  const polar = resolveProjection("stereographic-south", { latRange: [ -90, 0 ], centerLon: 90 });
  assert.ok(polar.forward(-45, 90).y < 0.5 && close(polar.forward(-45, 90).x, 0.5), "the central meridian now points up");
});

test("projectNormalized speaks every projection and stays exact for the default", () => {
  assert.deepEqual(projectNormalized(84, -180, { latRange: [ -58, 84 ] }), { x: 0, y: 0 });
  const ee = projectNormalized(0, 0, { latRange: FULL, projection: "equal-earth" });
  assert.ok(close(ee.x, 0.5) && close(ee.y, 0.5));
  assert.equal(projectNormalized(-60, 0, { latRange: [ 0, 90 ], projection: "stereographic-north" }), null, "a far point has no place on this map");
  assert.equal(projectNormalized(89, 0, { latRange: [ -58, 84 ] }), null, "nor does a latitude outside the band");
  assert.ok(close(projectNormalized(0, 150, { latRange: FULL, centerLon: 150 }).x, 0.5));
});

test("a grid with a projection samples cells by inverse projection; off-world cells are null", () => {
  const projection = resolveProjection("stereographic-south", { latRange: [ -90, -60 ] });
  const grid = { cols: 40, rows: 40, latRange: [ -90, -60 ], projection };
  assert.equal(cellCenter(0, 0, grid), null, "a corner cell is outside the disc");
  const centre = cellCenter(20, 20, grid);
  assert.ok(centre && centre.lat < -88.5, "the centre cell is at the pole");
  assert.equal(project(-89.7, 129.2, grid) !== null, true, "Shackleton is on the map");
  assert.equal(project(45, 0, grid), null, "the northern hemisphere is not");
  const { cells, loops } = buildFigure(grid, { body: { id: "south-cap", figure: (lat) => lat < -80 } });
  assert.ok(cells.length > 0 && cells.length < 40 * 40, "only the cap's cells, none outside the disc");
  for (const loop of loops) assert.deepEqual(loop[0], loop[loop.length - 1], "closed contours in screen space");
  assert.equal(snapToFigure(45, 0, grid, EARTH), null, "a place off the map has no cell");
});

test("stitching removes the packs' cut at ±180° and joins the halves into whole rings", () => {
  const before = EARTH.outlines();
  const seamEdges = (rings) => rings.reduce((n, ring) => {
    for (let i = 0; i + 1 < ring.length; i++) if (Math.abs(Math.abs(ring[i][1]) - 180) < 1e-9 && Math.abs(Math.abs(ring[i + 1][1]) - 180) < 1e-9) n++;
    return n;
  }, 0);
  // A closure edge runs ALONG the seam: both vertices on the same side of ±180
  // at different latitudes. A stitched ring may still hold seam-to-seam edges
  // that are not closures — its closing vertex repeating the start across the
  // seam (the same point on the sphere), or an oblique crossing from one side
  // to the other where the boundary meets the raster's two edge columns a few
  // rows apart.
  const closureEdges = (rings) => rings.reduce((n, ring) => {
    for (let i = 0; i + 1 < ring.length; i++) {
      if (Math.abs(Math.abs(ring[i][1]) - 180) < 1e-9 && ring[i][1] === ring[i + 1][1] && ring[i][0] !== ring[i + 1][0]) n++;
    }
    return n;
  }, 0);
  assert.ok(seamEdges(before) > 0, "the pack is cut at the antimeridian");
  assert.equal(closureEdges(before), 7, "Antarctica ×2 (down to the pole and back), Chukotka + Eurasia, Wrangel ×2, and Vanua Levu's tip, which ENDS at 180° in the raster");
  const after = stitchRings(before);
  assert.equal(stitchRings(before), after, "memoised on the rings array");
  // Every cut with a partner across the seam is stitched. The one edge left is
  // real coastline: land in the raster's last column with none in the first.
  assert.equal(closureEdges(after), 1, "only the unpaired raster-edge coastline survives");
  assert.equal(after.filter((ring) => ring.some(([ lat, lon ]) => Math.abs(lon) === 180 && lat > -17 && lat < -16)).length, 1, "and it is the Fiji sliver, drawn as stored");
  assert.ok(after.length < before.length, `rings merged: ${before.length} → ${after.length}`);
  for (const ring of after) assert.deepEqual(ring[0], ring[ring.length - 1], "every stitched ring is closed");
  // Antarctica: one ring that winds once around the south pole.
  const antarctica = after.filter((ring) => ring.every(([ lat ]) => lat < -60)).sort((a, b) => b.length - a.length)[0];
  assert.ok(antarctica && antarctica.length > 300, "Antarctica is a single ring (the offshore islands are the short ones)");
  let swing = 0;
  for (let i = 1; i < antarctica.length; i++) swing += wrapLon(antarctica[i][1] - antarctica[i - 1][1]);
  assert.ok(Math.abs(Math.abs(swing) - 360) < 1e-6, `it winds around the pole (${swing.toFixed(3)}°)`);
  // Mars: Vastitas Borealis is stored as an annulus cut open at the seam — one
  // ring whose two seam edges connect the dichotomy boundary to the polar cap
  // boundary, meeting the seam 1/8° apart. Stitched, it is two whole rings: the
  // outer boundary and the hole.
  const mars = stitchRings(MARS.outlines());
  assert.equal(mars.length, MARS.outlines().length + 1);
  assert.equal(closureEdges(mars), 0);
  // The Moon: a mare cut by the seam whose halves meet it 0.7° apart, because
  // the boundary crosses obliquely; the join keeps the crossing edge.
  const moon = stitchRings(MOON.outlines());
  assert.equal(moon.length, MOON.outlines().length - 1);
  assert.equal(closureEdges(moon), 0);
});

test("projecting rings: cylindrical maps cut at their own seam, polar maps never do", () => {
  const stitched = stitchRings(EARTH.outlines());
  const eq = resolveProjection("equirectangular", { latRange: FULL });
  const { fill, edge } = projectRings(stitched, eq);
  assert.ok(fill.length >= stitched.length, "pieces cut at the seam add up to at least the rings");
  for (const piece of fill) {
    assert.equal(piece.complement, false);
    for (const [ x, y ] of piece.points) assert.ok(x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9, "every fill vertex is inside the frame");
  }
  for (const arc of edge) for (let i = 1; i < arc.length; i++) {
    assert.ok(Math.abs(arc[i][0] - arc[i - 1][0]) < 0.5, "an edge arc never jumps across the frame");
  }
  // Antarctica's piece closes via the pole: two vertices at the bottom edge.
  const bottom = fill.filter((p) => p.points.filter(([ , y ]) => y > 1 - 1e-9).length >= 2);
  assert.ok(bottom.length >= 1, "a pole-encircling ring closes along the pole edge");

  const south = resolveProjection("stereographic-south", { latRange: [ -90, 0 ] });
  const polar = projectRings(stitched, south);
  assert.equal(polar.fill.length, stitched.length, "no cutting on an azimuthal map");
  assert.equal(polar.edge.filter((arc) => arc[0][0] !== arc[arc.length - 1][0] || arc[0][1] !== arc[arc.length - 1][1]).length, 0, "every edge is a closed ring");
  assert.equal(polar.fill.filter((p) => p.complement).length, 0, "Antarctica encloses the near pole: a normal fill");
  const north = resolveProjection("stereographic-north", { latRange: [ 0, 90 ] });
  const complements = projectRings(stitched, north).fill.filter((p) => p.complement);
  assert.equal(complements.length, 1, "on a north polar map Antarctica encloses the far pole and is filled as a complement");

  const shifted = projectRings(stitched, resolveProjection("equirectangular", { latRange: FULL, centerLon: 150 }));
  for (const piece of shifted.fill) for (const [ x ] of piece.points) assert.ok(x >= -1e-9 && x <= 1 + 1e-9);
});

test("a pole-encircling ring on Equal Earth closes along the curved seam, not with a chord", () => {
  // Mars's northern lowlands wind the north pole; cut at the seam, the piece
  // is closed up one seam to the pole and down the other. Equal Earth bends
  // the seam, so a single straight leg from 45° to the pole would slice a
  // false edge across the map. Every closure vertex must invert back onto
  // the seam or the pole; a chord's midpoints invert to interior longitudes.
  const stitched = stitchRings(MARS.outlines());
  const eq = resolveProjection("equal-earth", { latRange: FULL });
  const { fill, edge } = projectRings(stitched, eq);
  assert.equal(fill.length, edge.length);
  let checked = 0;
  for (let i = 0; i < fill.length; i++) {
    const closure = fill[i].points.slice(edge[i].length);
    if (!closure.some(([ , y ]) => y < 1e-6)) continue;          // only the piece that reaches the north pole
    const last = edge[i][edge[i].length - 1];
    const path = [ last, ...closure ].map(([ x, y ]) => {
      const back = eq.inverse(x, y);
      assert.ok(back, "a closure vertex lies on the world");
      assert.ok(Math.abs(Math.abs(back.lon) - 180) < 1e-6 || Math.abs(back.lat - 90) < 1e-6,
        `closure vertex (${x.toFixed(4)}, ${y.toFixed(4)}) is on the seam or the pole, not at lon ${back.lon.toFixed(2)}`);
      return back;
    });
    // Steps of at most two degrees along each seam leg: a single leg from the
    // ring's last vertex straight to the pole is the chord this test exists for.
    for (let k = 1; k < path.length; k++) {
      assert.ok(Math.abs(path[k].lat - path[k - 1].lat) <= 2 + 1e-6,
        `closure steps ${Math.abs(path[k].lat - path[k - 1].lat).toFixed(1)}° in one leg`);
    }
    checked++;
  }
  assert.ok(checked >= 1, "the lowlands produce a pole-closing piece");
});

test("graticule lines project and break at the seam and the edge of the world", () => {
  const parallel = [];
  for (let lon = -180; lon <= 180; lon += 3) parallel.push([ 30, lon ]);
  const eq = resolveProjection("equirectangular", { latRange: FULL, centerLon: 100 });
  const pieces = projectPolyline(parallel, eq);
  assert.equal(pieces.length, 2, "a parallel crossing the shifted seam breaks into two");
  assert.ok(close(pieces[0][pieces[0].length - 1][0], 1) && close(pieces[1][0][0], 0),
    "both pieces meet the exact frame boundary, not the nearest graticule sample");
  const north = resolveProjection("stereographic-north", { latRange: [ 0, 90 ] });
  assert.equal(projectPolyline(parallel, north).length, 1, "and stays whole on a polar map");
});

test("a d3-shaped projection (a function with .invert) is accepted and normalised", () => {
  const d3like = geoEquirectangular();
  const p = resolveProjection(d3like, { latRange: FULL });
  assert.equal(p.kind, "d3");
  assert.ok(close(p.aspect, 2));
  const c = p.forward(0, 0);
  assert.ok(close(c.x, 0.5) && close(c.y, 0.5));
  const back = p.inverse(0.25, 0.25);
  assert.ok(close(back.lon, -90) && close(back.lat, 45));
  assert.equal(resolveProjection(d3like, { latRange: FULL }).key, p.key, "the same function keeps its key");
  const incompleteFake = ([ lon, lat ]) => [ lon, lat ];
  incompleteFake.invert = ([ lon, lat ]) => [ lon, lat ];
  assert.throws(() => resolveProjection(incompleteFake, { latRange: FULL }), /needs \.stream/,
    "point-call lookalikes are rejected because they cannot apply d3's clipping and resampling contract");
  const custom = resolveProjection({ forward: (lat, lon) => ({ x: (lon + 180) / 360, y: (90 - lat) / 180 }), inverse: (x, y) => ({ lat: 90 - y * 180, lon: x * 360 - 180 }), aspect: 2 }, { latRange: FULL });
  assert.equal(custom.kind, "cylindrical");
  assert.ok(close(custom.forward(45, 90).x, 0.75));
});
