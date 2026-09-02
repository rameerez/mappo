// Flat projections: how a latitude and longitude become a point in the frame.
//
// A projection is a small object, like a body is:
//
//   forward(lat, lon)  → { x, y } in the unit frame (0…1 across, 0…1 down),
//                        or null when the point has no place on this map
//   inverse(x, y)      → { lat, lon }, or null when the frame point is off the
//                        world (the corners of an Equal Earth frame, outside a
//                        polar disc)
//   aspect             frame width / height
//   outline()          the world's edge, as closed rings in unit-frame
//                      coordinates; the map is clipped to it
//
// The flat renderer's dot grid is "sample the body at the inverse projection of
// every screen cell", so any projection with an inverse gets a uniform dot
// field, grid contours and highlights for free. Markers, overlays, locate()
// and the vector outlines use the forward mapping.
//
// Four projections ship. Equirectangular is the default and the one every
// version of mappo has drawn. Equal Earth (Šavrič, Patterson & Jenny, 2019) is
// the modern equal-area standard for global thematic maps. Polar stereographic,
// north and south, is what the planetary community uses for the poles — the
// only honest way to show the Artemis candidate regions at 85° south, which an
// equirectangular map smears across most of a row. Anything else can be handed
// in as an object with the interface above, or as a d3-geo projection.
//
// THE SEAM. Every body's vector rings are cut at ±180° with closure edges along
// the cut, because that is what a cylindrical map centred on 0° needs. Nothing
// else needs it: a polar map has no seam there, and a map centred on 150° has
// its seam somewhere else. So rings are STITCHED back into whole rings once per
// body (the cut edges removed, the halves joined across ±180), and then cut
// again per projection — at the projection's own seam for cylindrical
// projections, not at all for azimuthal ones. Fills get closed pieces; the
// edge stroke gets the open arcs, so no seam is ever stroked.

const DEG = Math.PI / 180;
const FULL = [ -90, 90 ];
const EPS = 1e-9;

// Longitude into [-180, 180).
export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

// ── Equal Earth ─────────────────────────────────────────────────────────────
// Šavrič, Patterson & Jenny, "The Equal Earth map projection", International
// Journal of Geographical Information Science 33(3), 2019. The polynomial and
// its constants are the published ones; the inverse is Newton's method on the
// y polynomial, converging to 1e-13 rad in a handful of steps.
const EE = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: Math.sqrt(3) / 2 };
const eeTheta = (latRad) => Math.asin(EE.M * Math.sin(latRad));
const eeY = (t) => { const t2 = t * t, t6 = t2 * t2 * t2; return t * (EE.A1 + EE.A2 * t2 + t6 * (EE.A3 + EE.A4 * t2)); };
const eeDy = (t) => { const t2 = t * t, t6 = t2 * t2 * t2; return EE.A1 + 3 * EE.A2 * t2 + t6 * (7 * EE.A3 + 9 * EE.A4 * t2); };
const eeX = (lonRad, t) => (lonRad * Math.cos(t)) / (EE.M * eeDy(t));
function eeThetaFromY(y) {
  let t = y;
  for (let i = 0; i < 25; i++) {
    const step = (eeY(t) - y) / eeDy(t);
    t -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return t;
}

// ── the built-ins ───────────────────────────────────────────────────────────
// Each has a `kind` the seam logic keys on, a `defaultLatRange` used when the
// caller has not set bounds, and `create({ latRange, centerLon })` returning
// the mapping functions in unit-frame coordinates. Longitudes arrive already
// shifted by the central meridian (λ' = lon − centerLon) so a piece cut at the
// seam can sit exactly on ±180 without being wrapped to the other edge.
const BUILTINS = {
  "equirectangular": {
    kind: "cylindrical",
    defaultLatRange: (bodyRange) => bodyRange,
    create({ latRange: [ lat0, lat1 ] }) {
      const span = lat1 - lat0;
      return {
        aspect: 360 / span,
        forwardShifted: (lat, lonS) => ({ x: (lonS + 180) / 360, y: (lat1 - lat) / span }),
        inverse: (x, y) => (x < -EPS || x > 1 + EPS || y < -EPS || y > 1 + EPS) ? null
          : { lat: lat1 - y * span, lonS: -180 + x * 360 },
        outline: () => [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ], [ 0, 0 ] ] ]
      };
    }
  },
  "equal-earth": {
    kind: "cylindrical",
    defaultLatRange: (bodyRange) => bodyRange,
    create({ latRange: [ lat0, lat1 ] }) {
      const yTop = eeY(eeTheta(lat1 * DEG)), yBottom = eeY(eeTheta(lat0 * DEG));
      const xMax = eeX(Math.PI, 0);
      const width = 2 * xMax, height = yTop - yBottom;
      const forwardShifted = (lat, lonS) => {
        const t = eeTheta(lat * DEG);
        return { x: 0.5 + eeX(lonS * DEG, t) / width, y: (yTop - eeY(t)) / height };
      };
      return {
        aspect: width / height,
        forwardShifted,
        inverse: (x, y) => {
          const t = eeThetaFromY(yTop - y * height);
          const s = Math.sin(t) / EE.M;
          if (s < -1 - EPS || s > 1 + EPS) return null;
          const lat = Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
          if (lat < lat0 - EPS || lat > lat1 + EPS) return null;
          const lonS = ((x - 0.5) * width * EE.M * eeDy(t) / Math.cos(t)) / DEG;
          if (lonS < -180 - EPS || lonS > 180 + EPS) return null;
          return { lat, lonS };
        },
        outline: () => {
          const ring = [];
          const step = 2;
          for (let lat = lat1; lat > lat0; lat -= step) ring.push(forwardShifted(lat, -180));
          ring.push(forwardShifted(lat0, -180), forwardShifted(lat0, 180));
          for (let lat = lat0 + step; lat < lat1; lat += step) ring.push(forwardShifted(lat, 180));
          ring.push(forwardShifted(lat1, 180), forwardShifted(lat1, -180));
          return [ ring.map((p) => [ p.x, p.y ]) ];
        }
      };
    }
  },
  "stereographic-north": { kind: "azimuthal", pole: 1, defaultLatRange: () => [ 0, 90 ], create: (o) => polar(1, o) },
  "stereographic-south": { kind: "azimuthal", pole: -1, defaultLatRange: () => [ -90, 0 ], create: (o) => polar(-1, o) }
};

// Polar stereographic on the unit sphere: ρ = 2·tan(c/2) for colatitude c from
// the centre pole. Conformal; the scale factor is 2/(1 + cos c), so a screen
// cell at the equator of a hemispheric map spans half the ground distance (a
// quarter of the ground area) of one at the pole.
// Convention (USGS/NASA planetary maps): 90°E to the right in both aspects,
// which puts the central meridian at the bottom of a north polar map and at
// the top of a south polar one.
function polar(pole, { latRange: [ lat0, lat1 ] }) {
  const rim = pole > 0 ? lat0 : lat1;      // the far bound: the edge of the disc
  const inner = pole > 0 ? lat1 : lat0;    // the near bound: the pole itself, normally
  const aspectName = pole > 0 ? "stereographic-north" : "stereographic-south";
  if (pole * rim <= -90 + 1e-6) {
    throw new RangeError(`${aspectName} cannot reach the opposite pole: keep ${pole > 0 ? "lat-min above -90" : "lat-max below 90"}`);
  }
  const rho = (lat) => 2 * Math.tan(((90 - pole * lat) / 2) * DEG);
  const rhoMax = rho(rim), rhoMin = rho(inner);
  const clampAt = 4 * rhoMax;              // finite, far outside the disc; the clip hides it
  return {
    aspect: 1,
    farPole: -pole * 90,
    forwardShifted: (lat, lonS) => {
      let r = rho(lat);
      if (!(r <= clampAt)) r = clampAt;    // NaN and Infinity land here too
      const a = lonS * DEG;
      return { x: 0.5 + (r * Math.sin(a)) / (2 * rhoMax), y: 0.5 + (pole * r * Math.cos(a)) / (2 * rhoMax) };
    },
    inverse: (x, y) => {
      const dx = (x - 0.5) * 2 * rhoMax, dy = (y - 0.5) * 2 * rhoMax;
      const r = Math.hypot(dx, dy);
      if (r > rhoMax + EPS || r < rhoMin - EPS) return null;
      return { lat: pole * (90 - (2 * Math.atan(r / 2)) / DEG), lonS: Math.atan2(dx, pole * dy) / DEG };
    },
    outline: () => {
      const circle = (radius) => {
        const ring = [];
        for (let i = 0; i <= 180; i++) {
          const a = (i / 180) * 2 * Math.PI;
          ring.push([ 0.5 + radius * Math.cos(a), 0.5 + radius * Math.sin(a) ]);
        }
        return ring;
      };
      // An inner bound short of the pole makes an annulus; the hole is part of
      // the outline so the clip (evenodd) cuts it out too.
      return rhoMin > EPS ? [ circle(0.5), circle(0.5 * (rhoMin / rhoMax)) ] : [ circle(0.5) ];
    }
  };
}

export function knownProjections() {
  return Object.keys(BUILTINS);
}

// The latitude band a projection wants when the caller has not asked: the
// body's own framing for cylindrical maps, a hemisphere for polar ones (Earth's
// default −58…84 would put a north polar map's rim in the southern ocean).
export function projectionDefaultRange(value, bodyRange) {
  const spec = typeof value === "string" ? BUILTINS[normalizeProjectionId(value)] : null;
  return spec ? spec.defaultLatRange(bodyRange) : bodyRange;
}

function normalizeProjectionId(value) {
  return String(value).trim().toLowerCase();
}

// One resolved projection instance per (id, latRange, centerLon); a small cache
// keeps repeated renders and projectNormalized() calls from rebuilding tables.
const INSTANCES = new Map();
const CUSTOM_KEYS = new WeakMap();
let customSeq = 0;

// value: a built-in id, an object with forward/inverse, or a d3-geo projection
// (a function of [lon, lat] with an .invert). Returns the instance the renderer
// draws with.
export function resolveProjection(value, { latRange = FULL, centerLon = 0 } = {}) {
  if (!Array.isArray(latRange) || latRange.length !== 2 || !latRange.every(Number.isFinite) || latRange[0] >= latRange[1]) {
    throw new RangeError("a projection needs latRange [min, max] with min < max");
  }
  if (!Number.isFinite(centerLon)) throw new RangeError("centerLon must be a finite number of degrees");
  // A longitude of exactly ±180 keeps its side: the right edge of a map centred
  // on 0° is 180, not a wrap to −180. Only out-of-range input is wrapped.
  const shift = (lon) => { const s = lon - centerLon; return s >= -180 && s <= 180 ? s : wrapLon(s); };

  if (typeof value === "string" || value == null) {
    const id = normalizeProjectionId(value ?? "equirectangular");
    const spec = BUILTINS[id];
    if (!spec) throw new RangeError(`unknown projection "${value}" — known: ${knownProjections().join(", ")}`);
    const key = `${id}|${centerLon}|${latRange[0]}|${latRange[1]}`;
    const hit = INSTANCES.get(key);
    if (hit) return hit;
    const built = spec.create({ latRange, centerLon });
    const instance = Object.freeze({
      id, kind: spec.kind, key, aspect: built.aspect, centerLon, latRange: [ ...latRange ],
      farPole: built.farPole ?? null,
      shift,
      forwardShifted: built.forwardShifted,
      // The public forward is STRICT: null for a point with no place on this map
      // (off the disc of a polar map, outside the latitude band). The internal
      // forwardShifted stays permissive so ring geometry never has holes.
      forward: (lat, lon) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const p = built.forwardShifted(lat, shift(lon));
        return p && built.inverse(p.x, p.y) ? p : null;
      },
      inverse: (x, y) => {
        const p = built.inverse(x, y);
        return p ? { lat: p.lat, lon: wrapLon(p.lonS + centerLon) } : null;
      },
      outline: built.outline
    });
    if (INSTANCES.size > 64) INSTANCES.delete(INSTANCES.keys().next().value);
    INSTANCES.set(key, instance);
    return instance;
  }

  if (typeof value === "function" && typeof value.invert === "function") return adaptD3(value, latRange);
  if (value && typeof value === "object" && typeof value.forward === "function" && typeof value.inverse === "function") {
    return adaptCustom(value, latRange);
  }
  throw new TypeError("projection must be a known name, a { forward, inverse } object, or a d3-geo projection");
}

function customKey(value, latRange) {
  let base = CUSTOM_KEYS.get(value);
  if (!base) CUSTOM_KEYS.set(value, base = `custom-${++customSeq}`);
  return `${base}|${latRange[0]}|${latRange[1]}`;
}

// Your own projection. The seam is yours too: rings are drawn as the body
// stores them (cut at ±180°), which is right for any projection centred on 0°.
function adaptCustom(value, latRange) {
  const forward = (lat, lon) => {
    const p = value.forward(lat, lon);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  };
  return Object.freeze({
    id: value.id ?? "custom", kind: "custom", key: customKey(value, latRange),
    aspect: value.aspect ?? 2, centerLon: 0, latRange: [ ...latRange ], farPole: null,
    shift: (lon) => lon,
    forwardShifted: forward,
    forward,
    inverse: (x, y) => {
      const p = value.inverse(x, y);
      return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { lat: p.lat, lon: p.lon } : null;
    },
    outline: () => (typeof value.outline === "function" ? value.outline() : null) ??
      [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ], [ 0, 0 ] ] ]
  });
}

// A d3-geo projection: proj([lon, lat]) → [x, y] in its own pixel space, and
// proj.invert([x, y]) → [lon, lat]. The frame is the bounding box of the whole
// sphere as the projection draws it, found by sampling; a frame point is off
// the world when the inverse does not round-trip, which is how d3 signals it.
function adaptD3(proj, latRange) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const see = (lon, lat) => {
    const p = proj([ lon, lat ]);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  };
  for (let lon = -180; lon <= 180; lon += 1) { see(lon, latRange[0]); see(lon, latRange[1]); for (let lat = -90; lat <= 90; lat += 5) see(lon, lat); }
  for (let lat = -90; lat <= 90; lat += 0.5) { see(-180, lat); see(180, lat); see(0, lat); }
  if (!(maxX > minX && maxY > minY)) throw new RangeError("d3 projection produced no finite frame");
  const width = maxX - minX, height = maxY - minY, tolerance = 1e-6 * Math.max(width, height);
  const forward = (lat, lon) => {
    const p = proj([ lon, lat ]);
    return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { x: (p[0] - minX) / width, y: (p[1] - minY) / height } : null;
  };
  return Object.freeze({
    id: "d3", kind: "custom", key: customKey(proj, latRange),
    aspect: width / height, centerLon: 0, latRange: [ ...latRange ], farPole: null,
    shift: (lon) => lon,
    forwardShifted: forward,
    forward,
    inverse: (x, y) => {
      const px = minX + x * width, py = minY + y * height;
      const ll = proj.invert([ px, py ]);
      if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
      const back = proj(ll);
      if (!back || Math.hypot(back[0] - px, back[1] - py) > tolerance) return null;
      return { lat: ll[1], lon: ll[0] };
    },
    outline: () => [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ], [ 0, 0 ] ] ]
  });
}

// ── rings across the seam ───────────────────────────────────────────────────

const onSeam = (v) => Math.abs(Math.abs(v[1]) - 180) < 1e-9;
const closeRing = (pts) => [ ...pts, [ pts[0][0], pts[0][1] ] ];
const STITCHED = new WeakMap();

// Undo the cut every pack makes at ±180°: remove the closure edges that run
// along the seam and join the halves back into whole rings. A ring that never
// touches the seam passes through unchanged. Memoised on the rings array, which
// a body memoises in turn, so this runs once per body per page.
export function stitchRings(rings) {
  const cached = STITCHED.get(rings);
  if (cached) return cached;

  const out = [];
  const arcs = [];   // open arcs, seam vertex to seam vertex, with the ring they came from
  rings.forEach((ring0, source) => {
    let ring = ring0;
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
    if (ring.length < 3) return;
    const n = ring.length;
    const seamEdge = (i) => onSeam(ring[i]) && onSeam(ring[(i + 1) % n]);
    let firstSeamEdge = -1;
    for (let i = 0; i < n; i++) if (seamEdge(i)) { firstSeamEdge = i; break; }
    if (firstSeamEdge < 0) { out.push(closeRing(ring)); return; }
    // Start just after a seam edge and collect arcs between seam edges.
    let arc = [];
    for (let k = 0; k < n; k++) {
      const i = (firstSeamEdge + 1 + k) % n;
      arc.push(ring[i]);
      if (seamEdge(i)) {
        if (arc.length >= 2) arcs.push({ pts: arc, source });
        arc = [];
      }
    }
  });

  // Chain arcs across the seam: an arc leaving at (lat, +180) continues with
  // the arc arriving at (lat, −180), and vice versa. The two latitudes need not
  // be identical: a boundary that crosses the seam obliquely meets the raster's
  // last column and its first column a few rows apart (Vastitas Borealis: 1/8°;
  // a lunar mare: 0.7°), so the join is the nearest candidate on the other side
  // within a degree, and when the two vertices differ the crossing edge between
  // them is kept — the cut step interpolates the seam crossing on it.
  const TOL = 1;
  const used = new Set();
  const failed = new Set();   // source rings whose arcs could not all be matched
  for (const first of arcs) {
    if (used.has(first)) continue;
    const chain = [ ...first.pts ];
    const members = [ first ];
    used.add(first);
    let cur = first;
    let closed = false;
    for (let guard = 0; guard <= arcs.length; guard++) {
      const end = cur.pts[cur.pts.length - 1];
      const endSide = Math.sign(end[1]);
      const start = first.pts[0];
      const closeGap = Math.sign(start[1]) === -endSide ? Math.abs(end[0] - start[0]) : Infinity;
      let next = null, gap = TOL;
      for (const a of arcs) {
        if (used.has(a) || Math.sign(a.pts[0][1]) !== -endSide) continue;
        const d = Math.abs(a.pts[0][0] - end[0]);
        if (d < gap) { gap = d; next = a; }
      }
      if (closeGap < TOL && closeGap <= gap) { closed = true; break; }
      if (!next) break;
      used.add(next);
      members.push(next);
      chain.push(...(Math.abs(next.pts[0][0] - end[0]) < 1e-9 ? next.pts.slice(1) : next.pts));
      cur = next;
    }
    if (closed) out.push(closeRing(chain));
    else for (const m of members) failed.add(m.source);
  }
  // Anything that would not stitch is drawn as the pack stored it.
  for (const source of failed) out.push(rings[source]);

  STITCHED.set(rings, out);
  return out;
}

// Continuous shifted longitudes for a closed ring: consecutive vertices never
// jump by more than 180°, so the ring's total swing says whether it winds
// around a pole (±360) or not (0).
function unwrap(ring, shift) {
  const n = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
  const seq = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    let s = shift(ring[i][1]);
    if (prev !== null) {
      const d = s - prev;
      if (d > 180) s -= 360 * Math.ceil((d - 180) / 360);
      else if (d < -180) s += 360 * Math.ceil((-d - 180) / 360);
    }
    seq.push([ ring[i][0], s ]);
    prev = s;
  }
  let dClose = seq[0][1] - prev;
  while (dClose > 180) dClose -= 360;
  while (dClose < -180) dClose += 360;
  const total = prev + dClose - seq[0][1];
  return { seq, total, winding: Math.round(total / 360) };
}

const meanLat = (pts) => pts.reduce((s, p) => s + p[0], 0) / pts.length;

// Cut one unwrapped ring at the seam of a cylindrical projection (λ' = ±180 and
// its 360° repeats). Returns pieces with shifted longitudes inside [−180, 180],
// each tagged with how it must be closed.
function cutAtSeam({ seq, total }) {
  const band = (lon) => Math.floor((lon + 180) / 360);
  const pieces = [];
  let piece = [ seq[0] ];
  for (let i = 0; i < seq.length; i++) {
    let a = seq[i];
    const b = i + 1 < seq.length ? seq[i + 1] : [ seq[0][0], seq[0][1] + total ];
    let ba = band(a[1]);
    const bb = band(b[1]);
    while (ba !== bb) {
      const dir = bb > ba ? 1 : -1;
      const boundary = dir > 0 ? 180 + 360 * ba : -180 + 360 * ba;
      const t = (boundary - a[1]) / (b[1] - a[1]);
      const cross = [ a[0] + t * (b[0] - a[0]), boundary ];
      piece.push(cross);
      pieces.push(piece);
      piece = [ cross ];
      a = cross;
      ba += dir;
    }
    if (i + 1 < seq.length) piece.push(b);
  }
  if (pieces.length === 0) return [ { pts: normalizePiece(piece), closure: "ring" } ];
  // The last piece runs on to the first vertex — one full turn further round
  // for a ring that winds a pole. Lifted by the ring's total swing, the first
  // piece continues it exactly, so the two are one piece in one band.
  pieces[0] = [ ...piece, ...pieces[0].slice(1).map(([ lat, lon ]) => [ lat, lon + total ]) ];
  return pieces.map((pts) => {
    const norm = normalizePiece(pts);
    const startSide = Math.sign(norm[0][1]), endSide = Math.sign(norm[norm.length - 1][1]);
    return { pts: norm, closure: startSide === endSide ? "seam" : "pole" };
  });
}

// A piece lies within one 360° band; put it into [−180, 180] by its midpoint,
// and drop the repeated vertices a cut exactly on a vertex leaves behind.
function normalizePiece(pts) {
  const lons = pts.map((p) => p[1]);
  const mid = (Math.min(...lons) + Math.max(...lons)) / 2;
  const k = Math.round(mid / 360);
  const out = [];
  for (const [ lat, lon ] of pts) {
    const v = [ lat, lon - 360 * k ];
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - v[0]) > 1e-12 || Math.abs(last[1] - v[1]) > 1e-12) out.push(v);
  }
  return out;
}

// Rings of [lat, lon] → what the flat renderer draws, in unit-frame
// coordinates: `fill` pieces (closed; `complement` marks a ring whose interior
// contains the far pole of an azimuthal map and must be filled outside-in) and
// `edge` arcs (open, never along a seam).
export function projectRings(rings, projection) {
  const fill = [], edge = [];
  const toFrame = (pts) => pts.map(([ lat, lonS ]) => { const p = projection.forwardShifted(lat, lonS); return [ p.x, p.y ]; });

  for (const ring of rings) {
    if (ring.length < 4) continue;
    if (projection.kind === "custom") {
      const pts = [];
      for (const [ lat, lon ] of ring) { const p = projection.forward(lat, lon); if (p) pts.push([ p.x, p.y ]); }
      if (pts.length >= 3) { fill.push({ points: pts, complement: false }); edge.push(pts); }
      continue;
    }
    const unwrapped = unwrap(ring, projection.shift);
    if (projection.kind === "azimuthal") {
      const pts = toFrame(unwrapped.seq);
      const enclosedPole = unwrapped.winding !== 0 ? (meanLat(unwrapped.seq) >= 0 ? 90 : -90) : null;
      fill.push({ points: pts, complement: enclosedPole !== null && enclosedPole === projection.farPole });
      edge.push([ ...pts, pts[0] ]);
      continue;
    }
    for (const { pts, closure } of cutAtSeam(unwrapped)) {
      const frame = toFrame(pts);
      if (closure === "ring") {
        fill.push({ points: frame, complement: false });
        edge.push([ ...frame, frame[0] ]);
      } else {
        edge.push(frame);
        if (closure === "pole") {
          const pole = meanLat(pts) >= 0 ? 90 : -90;
          const last = pts[pts.length - 1], first = pts[0];
          fill.push({ points: [ ...frame, ...toFrame([ [ pole, last[1] ], [ pole, first[1] ] ]) ], complement: false });
        } else {
          fill.push({ points: frame, complement: false });   // the seam edge closes it
        }
      }
    }
  }
  return { fill, edge };
}

// A polyline of [lat, lon] (a graticule line) → unit-frame polylines, broken
// wherever the line leaves the map or crosses a cylindrical seam.
export function projectPolyline(line, projection) {
  const out = [];
  let cur = [], prevS = null;
  for (const [ lat, lon ] of line) {
    const s = projection.shift(lon);
    if (prevS !== null && projection.kind === "cylindrical" && Math.abs(s - prevS) > 180) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    const p = projection.kind === "custom" ? projection.forward(lat, lon) : projection.forwardShifted(lat, s);
    if (!p) { if (cur.length > 1) out.push(cur); cur = []; prevS = null; continue; }
    cur.push([ p.x, p.y ]);
    prevS = s;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// Signed area of a unit-frame ring (shoelace); the sign is its orientation.
export function signedArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return a / 2;
}
