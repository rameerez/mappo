// Region highlight: a polygon (rings of [lat, lon] pairs) tested per dot
// at geometry-build time. The consumer supplies the shape — mappo stays
// dependency-free (no bundled boundary dataset); VehiclesDB feeds it
// Natural Earth rings per jurisdiction.
//
// Ray-cast in lon/lat space. Rings that cross the antimeridian should be
// pre-normalized by the caller (shift western lons +360); normalizeRings
// below does it for rings whose lon span exceeds 180°.

export function normalizeRings(rings) {
  return rings.map((ring) => {
    let min = Infinity, max = -Infinity;
    for (const [, lon] of ring) { if (lon < min) min = lon; if (lon > max) max = lon; }
    if (max - min <= 180) return { ring, shifted: false };
    return { ring: ring.map(([la, lo]) => [la, lo < 0 ? lo + 360 : lo]), shifted: true };
  });
}

export function pointInRings(lat, lon, normalized) {
  for (const { ring, shifted } of normalized) {
    const x = shifted && lon < 0 ? lon + 360 : lon;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if ((yi > lat) !== (yj > lat) && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

// Does a grid CELL touch the region? The "touch" coverage (highlight-coverage
// attribute): a dot lights when any part of its cell overlaps the rings, not
// only its centre. At world scale a small country holds no cell centre at all
// (Luxembourg, the Netherlands and Switzerland lit nothing at 170 columns),
// and a mid-sized one lights a ragged few; touch lights every cell it covers.
//
// A cell touches when one of nine sample points spread over it (corners,
// edge midpoints, centre, inset 10% so a shared edge belongs to one cell
// only) is inside the rings, or when a ring vertex falls inside the cell's
// lat/lon box (the region is smaller than the cell). `point(fx, fy)` maps a
// fraction of the cell to lat/lon, so any projection works.
const SAMPLES = [ 0.1, 0.5, 0.9 ];

export function cellTouchesRings(point, normalized) {
  let latLo = Infinity, latHi = -Infinity, lonLo = Infinity, lonHi = -Infinity;
  for (const fy of SAMPLES) {
    for (const fx of SAMPLES) {
      const p = point(fx, fy);
      if (!p) continue;
      if (pointInRings(p.lat, p.lon, normalized)) return true;
    }
  }
  for (const [ fx, fy ] of [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ] ]) {
    const p = point(fx, fy);
    if (!p) continue;
    latLo = Math.min(latLo, p.lat); latHi = Math.max(latHi, p.lat);
    lonLo = Math.min(lonLo, p.lon); lonHi = Math.max(lonHi, p.lon);
  }
  if (!Number.isFinite(latLo)) return false;
  for (const { ring, shifted } of normalized) {
    for (const [ lat, lon0 ] of ring) {
      const lon = shifted && lon0 > 180 ? lon0 - 360 : lon0;
      if (lat >= latLo && lat <= latHi && lon >= lonLo && lon <= lonHi) return true;
    }
  }
  return false;
}
