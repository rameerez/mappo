// Equirectangular projection — the deliberate choice for a SYMBOLIC map:
// linear lat/lon ↔ x/y, matching both the packed figure mask and everyone's
// mental image of "the world map". Not area-accurate (Mercator-style debates
// don't apply — nothing here encodes quantity by area).
//
// All renderer geometry flows through these functions, which is what makes
// globe mode a renderer swap instead of an API change: callers speak lat/lon,
// only the projection changes.
//
// Conventions, everywhere in mappo: latitude is positive north, longitude is
// positive EAST and runs −180…180 with 0 at the centre of the frame. Bodies
// whose native maps use another convention (Mars's 0–360°E) are converted
// when their pack is generated, never at draw time.

// Map a lat/lon to fractional grid coordinates in a cols×rows grid covering
// latRange (north→south) across the full −180…180 longitude span.
export function project(lat, lon, { cols, rows, latRange }) {
  const [ latMin, latMax ] = latRange;
  return {
    x: ((lon + 180) / 360) * cols,
    y: ((latMax - lat) / (latMax - latMin)) * rows
  };
}

// The centre lat/lon of a grid cell — where the figure is sampled and where a
// dot is drawn.
export function cellCenter(col, row, { cols, rows, latRange }) {
  const [ latMin, latMax ] = latRange;
  return {
    lat: latMax - ((row + 0.5) / rows) * (latMax - latMin),
    lon: -180 + ((col + 0.5) / cols) * 360
  };
}

// The lat/lon of a grid CORNER — where cell boundaries live, and therefore
// where contour geometry lives. cellCenter answers for the middle of a cell;
// contours are traced along its edges, so they need this. Same linear
// mapping, no +0.5 offset.
export function cellCorner(col, row, { cols, rows, latRange }) {
  const [ latMin, latMax ] = latRange;
  return {
    lat: latMax - (row / rows) * (latMax - latMin),
    lon: -180 + (col / cols) * 360
  };
}

// Normalized projection: lat/lon → {x, y} in 0…1 across the rendered box.
//
// This is the one a HOST needs. `project` above answers in grid units, which
// requires `rows` — and rows is derived internally from cols and latRange, so
// asking a consuming app for it forces that app to re-derive mappo's own
// arithmetic (and to keep re-deriving it correctly forever). Normalized
// coordinates need neither: the viewBox is linear in the grid, so 0…1 maps
// straight onto CSS percentages, canvas pixels, or a server-rendered
// `style="left:%"` in a template in any language.
//
// latRange is REQUIRED. It is the one thing that differs between Earth's
// default framing, a full-sphere Moon and your own crop, and a silent Earth
// default here would put every other world's labels in the wrong place. The
// range a live map uses is `map.options.latRange`; a body's default framing is
// `body.latRange` (EARTH.latRange is [-58, 84]).
export function projectNormalized(lat, lon, { latRange } = {}) {
  if (!Array.isArray(latRange) || latRange.length !== 2) {
    throw new TypeError("projectNormalized needs { latRange: [min, max] } — the map's own range, e.g. EARTH.latRange");
  }
  const [ latMin, latMax ] = latRange;
  return {
    x: (lon + 180) / 360,
    y: (latMax - lat) / (latMax - latMin)
  };
}
