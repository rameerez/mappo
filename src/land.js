// Land as SHAPE — the single source of truth behind every non-dot land style,
// on both renderers.
//
// One sampling pass produces two things:
//
//   cells — the land cells themselves, for anything that fills by cell (the
//           globe fills projected quads, because a filled outline that crosses
//           the limb cannot be closed correctly on a sphere).
//   loops — the CLOSED boundary contours of the landmass, in grid-corner
//           coordinates, for anything that draws the coastline (the flat map
//           fills and strokes the very same path; the globe strokes it).
//
// Why contours and not "a rectangle per cell": a rectangle grid strokes every
// internal cell edge, which draws a wireframe, not a coastline. Tracing the
// boundary means the outline is exactly where land meets sea and nowhere else —
// and because the loops are closed and consistently wound, the SAME path data
// fills correctly, holes included. That is what lets `solid`, `outline` and
// `solid outline` be three renderings of one geometry rather than three
// implementations that can disagree.
//
// Winding: outer rings run clockwise in screen space (y down), holes run
// counter-clockwise, which is what `fill-rule: nonzero` wants — inland seas
// stay empty without anyone declaring them.

import { cellCenter } from "./projection.js";
import { EARTH } from "./body.js";

const cache = new Map();

// wrapX: treat column -1 and column `cols` as the far side of the map. The
// globe wants this (there is no edge at the antimeridian, only more world);
// the flat map does not (its frame really does end at ±180).
function landAt(col, row, grid, wrapX, body) {
  if (row < 0 || row >= grid.rows) return false;
  let c = col;
  if (c < 0 || c >= grid.cols) {
    if (!wrapX) return false;
    c = ((c % grid.cols) + grid.cols) % grid.cols;
  }
  const p = cellCenter(c, row, grid);
  return body.isLand(p.lat, p.lon);
}

// Chain directed boundary edges into closed rings. Each edge is stored under
// its start point; walking successors always terminates because every corner
// has as many outgoing as incoming edges (a cell boundary is a closed curve).
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

// grid: { cols, rows, latRange }. Returns { cells, loops } in GRID units —
// cells as [col, row], loop vertices as grid corners [col, row]. Renderers
// scale (flat: × CELL) or project (globe: corner → lat/lon → sphere).
export function buildLand(grid, { wrapX = false, body = EARTH } = {}) {
  // The body is in the cache key: two spheres are not the same geometry.
  const key = `${body.id}|${grid.cols}|${grid.rows}|${grid.latRange[0]}|${grid.latRange[1]}|${wrapX}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cells = [];
  const edges = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!landAt(col, row, grid, wrapX, body)) continue;
      cells.push([ col, row ]);
      // Clockwise with y pointing down.
      if (!landAt(col, row - 1, grid, wrapX, body)) edges.push([ col, row, col + 1, row ]);
      if (!landAt(col + 1, row, grid, wrapX, body)) edges.push([ col + 1, row, col + 1, row + 1 ]);
      if (!landAt(col, row + 1, grid, wrapX, body)) edges.push([ col + 1, row + 1, col, row + 1 ]);
      if (!landAt(col - 1, row, grid, wrapX, body)) edges.push([ col, row + 1, col, row ]);
    }
  }

  const out = { cells, loops: chain(edges) };
  cache.set(key, out);
  return out;
}

// The land styles, parsed once so both renderers agree on what a value means.
// `land` is a space-separated token list so combinations read naturally:
//   land="dots"           the dot field mappo is named for (default)
//   land="solid"          filled landmass
//   land="outline"        coastline only
//   land="solid outline"  filled, with the coast drawn on top
export function parseLandStyle(value) {
  const tokens = String(value ?? "dots").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const dots = tokens.includes("dots") || tokens.length === 0;
  return {
    dots,
    fill: tokens.includes("solid") || tokens.includes("filled"),
    stroke: tokens.includes("outline") || tokens.includes("stroke")
  };
}

// Where land geometry comes from. Two levels of detail of the same world:
//
//   "grid"   — contours traced from the packed bitmask. Blocky by design,
//              resolution-following (cols changes the coastline), ~0 extra
//              bytes, and the only source the dot field can agree with.
//   "vector" — the real Natural Earth coastline, quantized to 1/32°. Smooth
//              at any size, independent of cols, ~13 KB.
//
// Both answer in rings of [lat, lon] for renderers that project (the globe);
// the flat map converts grid contours in its own units. Country borders are
// vector-only — a 512×256 raster cannot express a border that follows a
// river.
// Both of these now ask the BODY. The Moon answers null to each: a mare has
// no coastline to trace and the Moon has no countries.
export function landRings(source, body = EARTH) {
  return body.rings?.(source) ?? null;
}
export function borderRings(body = EARTH) {
  return body.borders?.() ?? null;
}
