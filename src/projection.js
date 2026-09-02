// The grid: how a lat/lon becomes a cell and a cell becomes a lat/lon.
//
// A grid is { cols, rows, latRange } and, on the flat map, a `projection`
// instance from projections.js. Without one the grid is equirectangular —
// linear lat/lon ↔ x/y, matching the packed figure mask and everyone's mental
// image of "the world map" — which is what the globe samples the sphere with
// and what the flat map draws by default. With one, cell centres are the
// inverse projection of the screen grid, so the dot field is uniform on screen
// whatever the projection, and a cell that lands off the world (the corners of
// an Equal Earth frame) has no centre: it is null.
//
// Conventions, everywhere in mappo: latitude is positive north, longitude is
// positive EAST and runs −180…180 with 0 at the centre of the default frame.
// Bodies whose native maps use another convention (Mars's 0–360°E) are
// converted when their pack is generated, never at draw time.

import { resolveProjection, wrapLon } from "./projections.js";

const validGrid = (grid) => grid && Number.isFinite(grid.cols) && grid.cols > 0 && Number.isFinite(grid.rows) && grid.rows > 0;
const validLocation = (lat, lon, grid) => validGrid(grid) && Number.isFinite(lat) && Number.isFinite(lon) &&
  Array.isArray(grid.latRange) && grid.latRange.length === 2 && lat >= grid.latRange[0] - 1e-9 && lat <= grid.latRange[1] + 1e-9 &&
  lat >= -90 && lat <= 90;

// Map a lat/lon to fractional grid coordinates, or null when the point has no
// place on this map.
export function project(lat, lon, grid) {
  if (!validLocation(lat, lon, grid)) return null;
  if (grid.projection) {
    const p = grid.projection.forward(lat, lon);
    return p ? { x: p.x * grid.cols, y: p.y * grid.rows } : null;
  }
  const [ latMin, latMax ] = grid.latRange;
  const normalizedLon = lon >= -180 && lon <= 180 ? lon : wrapLon(lon);
  return {
    x: ((normalizedLon + 180) / 360) * grid.cols,
    y: ((latMax - lat) / (latMax - latMin)) * grid.rows
  };
}

// The centre lat/lon of a grid cell — where the figure is sampled and where a
// dot is drawn — or null for a cell that is off the world.
export function cellCenter(col, row, grid) {
  if (!validGrid(grid) || !Number.isFinite(col) || !Number.isFinite(row) || col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
  if (grid.projection) return grid.projection.inverse((col + 0.5) / grid.cols, (row + 0.5) / grid.rows);
  const [ latMin, latMax ] = grid.latRange;
  return {
    lat: latMax - ((row + 0.5) / grid.rows) * (latMax - latMin),
    lon: -180 + ((col + 0.5) / grid.cols) * 360
  };
}

// The lat/lon of a grid CORNER — where cell boundaries live, and therefore
// where contour geometry lives. Same mapping as cellCenter, no +0.5 offset.
export function cellCorner(col, row, grid) {
  if (!validGrid(grid) || !Number.isFinite(col) || !Number.isFinite(row) || col < 0 || col > grid.cols || row < 0 || row > grid.rows) return null;
  if (grid.projection) return grid.projection.inverse(col / grid.cols, row / grid.rows);
  const [ latMin, latMax ] = grid.latRange;
  return {
    lat: latMax - (row / grid.rows) * (latMax - latMin),
    lon: -180 + (col / grid.cols) * 360
  };
}

// Normalized projection: lat/lon → {x, y} in 0…1 across the rendered box, or
// null when the point is off the map.
//
// This is the one a HOST needs. `project` above answers in grid units, which
// requires `rows` — and rows is derived internally from cols and the frame, so
// asking a consuming app for it forces that app to re-derive mappo's own
// arithmetic (and to keep re-deriving it correctly forever). Normalized
// coordinates need only what the map was told: its latRange and, if it has
// one, its projection and central meridian. They map straight onto CSS
// percentages, canvas pixels, or a server-rendered `style="left:%"`.
//
// latRange is REQUIRED. It is the one thing that differs between Earth's
// default framing, a full-sphere Moon and your own crop, and a silent Earth
// default here would put every other world's labels in the wrong place. The
// range a live map uses is `map.options.latRange`; a body's default framing is
// `body.latRange` (EARTH.latRange is [-58, 84]).
export function projectNormalized(lat, lon, { latRange, projection = "equirectangular", centerLon = 0 } = {}) {
  if (!Array.isArray(latRange) || latRange.length !== 2) {
    throw new TypeError("projectNormalized needs { latRange: [min, max] } — the map's own range, e.g. EARTH.latRange");
  }
  return resolveProjection(projection, { latRange, centerLon }).forward(lat, lon);
}
