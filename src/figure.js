// The figure as SHAPE — the single source of truth behind every non-dot figure
// style, on both renderers.
//
// One sampling pass produces two things:
//
//   cells — the figure cells themselves, for anything that fills by cell (the
//           globe fills projected quads, because a filled outline that crosses
//           the limb cannot be closed correctly on a sphere).
//   loops — the boundary contours of the figure, in grid-corner coordinates,
//           for anything that draws its edge (the flat map fills and strokes
//           the very same path; the globe strokes it).
//
// Why contours and not "a rectangle per cell": a rectangle grid strokes every
// internal cell edge, which draws a wireframe, not a coastline. Tracing the
// boundary means the outline is exactly where figure meets ground and nowhere
// else — and because the loops are closed and consistently wound, the SAME
// path data fills correctly, holes included. That is what lets `solid`,
// `outline` and `solid outline` be three renderings of one geometry rather
// than three implementations that can disagree.
//
// Winding: outer rings run clockwise in screen space (y down), holes run
// counter-clockwise, which is what `fill-rule: nonzero` wants — inland seas
// stay empty without anyone declaring them.
//
// The tracer is shared with the generators: a body pack's vector outlines are
// traced from its source raster by traceCells() at full resolution, so the
// grid outline and the vector outline of a body are the same algorithm on the
// same data at two levels of detail.

import { cellCenter } from "./projection.js";

// A body object is the geometry identity. IDs are human-facing registry keys
// and may legitimately be re-registered during development; keying by the
// object prevents a replacement pack from replaying the old pack's contours.
const cache = new WeakMap();

// wrapX: treat column -1 and column `cols` as the far side of the map. The
// globe wants this (there is no edge at the antimeridian, only more world);
// the flat map does not (its frame really does end at ±180). With wrapX a
// loop that crosses the seam is left open at the seam corners, which is what
// a stroke on a sphere wants: the line continues on the other side.
function figureAt(col, row, grid, wrapX, body) {
  if (row < 0 || row >= grid.rows) return false;
  let c = col;
  if (c < 0 || c >= grid.cols) {
    if (!wrapX) return false;
    c = ((c % grid.cols) + grid.cols) % grid.cols;
  }
  const p = cellCenter(c, row, grid);
  return body.figure(p.lat, p.lon);
}

// Chain directed boundary edges into rings. Each edge is stored under its
// start point; walking successors terminates because every corner of a closed
// cell boundary has as many outgoing as incoming edges.
function chain(edges) {
  const from = new Map();
  for (const e of edges) {
    const key = `${e[0]},${e[1]}`;
    if (!from.has(key)) from.set(key, []);
    from.get(key).push(e);
  }

  const loops = [];
  for (const [ , bucket ] of from) {
    while (bucket.length) {
      const start = bucket.pop();
      const loop = [ [ start[0], start[1] ] ];
      let x = start[2], y = start[3];
      // Guard the walk: a malformed edge set must not spin forever.
      for (let guard = 0; guard <= edges.length; guard++) {
        loop.push([ x, y ]);
        if (x === start[0] && y === start[1]) break;
        const next = from.get(`${x},${y}`);
        if (!next?.length) break;
        const e = next.pop();
        x = e[2]; y = e[3];
      }
      if (loop.length > 2) loops.push(loop);
    }
  }
  return loops;
}

// The tracer itself, over any cols×rows grid with any `inside(col, row)`
// predicate (which must answer for out-of-range indices too). Returns cells
// as [col, row] and loop vertices as grid corners [col, row].
export function traceCells(cols, rows, inside) {
  const cells = [];
  const edges = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!inside(col, row)) continue;
      cells.push([ col, row ]);
      // Clockwise with y pointing down.
      if (!inside(col, row - 1)) edges.push([ col, row, col + 1, row ]);
      if (!inside(col + 1, row)) edges.push([ col + 1, row, col + 1, row + 1 ]);
      if (!inside(col, row + 1)) edges.push([ col + 1, row + 1, col, row + 1 ]);
      if (!inside(col - 1, row)) edges.push([ col, row + 1, col, row ]);
    }
  }
  return { cells, loops: chain(edges) };
}

// grid: { cols, rows, latRange }. Returns { cells, loops } in GRID units —
// renderers scale (flat: × CELL) or project (globe: corner → lat/lon → sphere).
// Memoised per body object, grid and wrap.
export function buildFigure(grid, { body, wrapX = false } = {}) {
  if (!body) throw new TypeError("buildFigure needs a body — pass { body: EARTH } or another registered body");
  let perBody = cache.get(body);
  if (!perBody) cache.set(body, perBody = new Map());
  const key = `${grid.cols}|${grid.rows}|${grid.latRange[0]}|${grid.latRange[1]}|${wrapX}`;
  const hit = perBody.get(key);
  if (hit) return hit;

  const out = traceCells(grid.cols, grid.rows, (col, row) => figureAt(col, row, grid, wrapX, body));
  perBody.set(key, out);
  return out;
}

// The figure styles, parsed once so both renderers agree on what a value means.
// `figure` is a space-separated token list so combinations read naturally:
//   figure="dots"           the dot field mappo is named for (default)
//   figure="solid"          filled
//   figure="outline"        the edge only
//   figure="solid outline"  filled, with the edge drawn on top
export function parseFigureStyle(value) {
  const tokens = String(value ?? "dots").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const dots = tokens.includes("dots") || tokens.length === 0;
  return {
    dots,
    fill: tokens.includes("solid") || tokens.includes("filled"),
    stroke: tokens.includes("outline") || tokens.includes("stroke")
  };
}

// Where figure geometry comes from. Two levels of detail of the same world:
//
//   "grid"   — contours traced from the body's figure() on the dot grid.
//              Blocky by design, resolution-following, zero extra bytes, and
//              the only source the dot field agrees with.
//   "vector" — the body's own pre-traced outlines, smooth at any size and
//              independent of cols. A body without outlines falls back to the
//              grid, so the option is always safe to set.
export function figureOutlines(source, body) {
  return source === "vector" ? (body.outlines?.() ?? null) : null;
}

export function figureBorders(body) {
  return body.borders?.() ?? null;
}
