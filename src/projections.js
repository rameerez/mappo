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
// This file is the CORE of the projection system: the interface, a registry of
// named projections, equirectangular (the one every version of mappo has
// drawn), and the helpers the other modules share. Equal Earth, polar
// stereographic and the adapters for your own or d3-geo projections are the
// opt-in module mappo/projections, which registers them here. A map that
// names a projection before its module has registered draws nothing until it
// does — the same rule as a body pack that arrives after the page's maps.
//
// The seam: every body's vector rings are cut at ±180°, and a map centred
// elsewhere or drawn on a polar disc needs them stitched and re-cut. That is
// the vector module (src/vector.js, mappo/vector); the longitude-unwrapping it
// and the d3 adapter share lives here so neither depends on the other.

import { rerenderLive } from "./body.js";

const FULL = [ -90, 90 ];
export const EPS = 1e-9;

export function validateLatRange(latRange) {
  if (!Array.isArray(latRange) || latRange.length !== 2 || !latRange.every(Number.isFinite) ||
      latRange[0] < -90 || latRange[1] > 90 || latRange[0] >= latRange[1]) {
    throw new RangeError("a projection needs latRange [min, max] within [-90, 90] with min < max");
  }
  return Object.freeze([ ...latRange ]);
}

export const inRange = (value, min, max) => value >= min - EPS && value <= max + EPS;
export const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
export const finiteLocation = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
// A longitude already inside the frame keeps its side (180 is the right edge,
// not a wrap to −180); only out-of-range input is wrapped.
export const frameLon = (lon) => lon >= -180 && lon <= 180 ? lon : wrapLon(lon);

// Longitude into [-180, 180).
export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

// ── the registry ────────────────────────────────────────────────────────────
// A spec has a `kind` the seam logic keys on ("cylindrical" | "azimuthal"), a
// `defaultLatRange(bodyRange)` used when the caller has not set bounds, and
// `create({ latRange, centerLon })` returning the mapping functions in
// unit-frame coordinates: { aspect, forwardShifted(lat, lonS), inverse(x, y) →
// { lat, lonS } | null, outline(), farPole? }. Longitudes arrive already
// shifted by the central meridian (λ' = lon − centerLon).
const REGISTRY = new Map();
const ADAPTERS = [];           // (value, latRange) → instance | null, for non-string values
const INSTANCES = new Map();   // memoised built instances of registered names

export function normalizeProjectionId(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function registerProjection(id, spec) {
  const key = normalizeProjectionId(id);
  if (!key) throw new TypeError("registerProjection needs an id");
  if (!spec || typeof spec.kind !== "string" || typeof spec.defaultLatRange !== "function" || typeof spec.create !== "function") {
    throw new TypeError(`registerProjection("${id}") needs { kind, defaultLatRange(bodyRange), create({ latRange, centerLon }) }`);
  }
  REGISTRY.set(key, spec);
  for (const k of [ ...INSTANCES.keys() ]) if (k.startsWith(`${key}|`)) INSTANCES.delete(k);
  rerenderLive((m) => m.options.mode === "flat" && typeof m.options.projection === "string" &&
    normalizeProjectionId(m.options.projection) === key);
  return spec;
}

// Adapters answer for values that are not names: an object with forward and
// inverse, a d3-geo projection. The module registers one; the core has none.
export function registerProjectionAdapter(adapt) {
  if (typeof adapt !== "function") throw new TypeError("registerProjectionAdapter needs a function (value, latRange) → instance | null");
  ADAPTERS.push(adapt);
  rerenderLive((m) => m.options.mode === "flat" && m.options.projection != null && typeof m.options.projection !== "string");
  return adapt;
}

export function knownProjections() {
  return [ ...REGISTRY.keys() ];
}

// Whether resolveProjection can answer for this value right now. A map whose
// projection is not available yet waits for it instead of failing.
export function hasProjection(value) {
  if (value == null) return true;
  if (typeof value === "string") return REGISTRY.has(normalizeProjectionId(value));
  return ADAPTERS.length > 0;
}

// The latitude band a projection wants when the caller has not asked: the
// body's own framing for cylindrical maps, a hemisphere for polar ones (Earth's
// default −58…84 would put a north polar map's rim in the southern ocean).
export function projectionDefaultRange(value, bodyRange) {
  const spec = typeof value === "string" ? REGISTRY.get(normalizeProjectionId(value)) : null;
  return spec ? spec.defaultLatRange(bodyRange) : bodyRange;
}

// The one projection every mappo has: linear in latitude and longitude, the
// frame 360° wide by the latitude band, the mask's own geometry.
registerProjection("equirectangular", {
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
});

// value: a registered name, or (with mappo/projections loaded) an object with
// forward/inverse or a d3-geo projection. Returns the instance the renderer
// draws with. Throws for a name nobody has registered: the renderer checks
// hasProjection() first and waits instead.
export function resolveProjection(value, { latRange = FULL, centerLon = 0 } = {}) {
  latRange = validateLatRange(latRange);
  if (!Number.isFinite(centerLon)) throw new RangeError("centerLon must be a finite number of degrees");
  centerLon = wrapLon(centerLon);
  const shift = (lon) => { const s = lon - centerLon; return s >= -180 && s <= 180 ? s : wrapLon(s); };

  if (typeof value === "string" || value == null) {
    const id = normalizeProjectionId(value ?? "equirectangular");
    const spec = REGISTRY.get(id);
    if (!spec) {
      const hint = REGISTRY.size === 1 ? '; Equal Earth and polar stereographic are in the module: import "mappo/projections"' : "";
      throw new RangeError(`unknown projection "${value}" — known: ${knownProjections().join(", ")}${hint}`);
    }
    const key = `${id}|${centerLon}|${latRange[0]}|${latRange[1]}`;
    const hit = INSTANCES.get(key);
    if (hit) return hit;
    const built = spec.create({ latRange, centerLon });
    if (!Number.isFinite(built.aspect) || built.aspect <= 0) throw new RangeError(`${id} produced an invalid aspect ratio`);
    const instance = Object.freeze({
      id, kind: spec.kind, key, aspect: built.aspect, centerLon, latRange,
      farPole: built.farPole ?? null,
      shift,
      forwardShifted: built.forwardShifted,
      // The public forward is STRICT: null for a point with no place on this map
      // (off the disc of a polar map, outside the latitude band). The internal
      // forwardShifted stays permissive so ring geometry never has holes.
      forward: (lat, lon) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRange(lat, latRange[0], latRange[1])) return null;
        const p = built.forwardShifted(lat, shift(lon));
        return finitePoint(p) && built.inverse(p.x, p.y) ? p : null;
      },
      inverse: (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const p = built.inverse(x, y);
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lonS) || !inRange(p.lat, latRange[0], latRange[1])) return null;
        return { lat: Math.max(-90, Math.min(90, p.lat)), lon: wrapLon(p.lonS + centerLon) };
      },
      outline: built.outline
    });
    if (INSTANCES.size > 64) INSTANCES.delete(INSTANCES.keys().next().value);
    INSTANCES.set(key, instance);
    return instance;
  }

  for (const adapt of ADAPTERS) {
    const instance = adapt(value, latRange);
    if (instance) return instance;
  }
  if (ADAPTERS.length === 0 && (typeof value === "function" || typeof value === "object")) {
    throw new TypeError('custom and d3-geo projections need the projections module: import "mappo/projections"');
  }
  throw new TypeError("projection must be a known name, a { forward, inverse } object, or a d3-geo projection");
}

// ── shared geometry ─────────────────────────────────────────────────────────

// Continuous shifted longitudes for a closed ring: consecutive vertices never
// jump by more than 180°, so the ring's total swing says whether it winds
// around a pole (±360) or not (0).
export function unwrap(ring, shift) {
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

export const meanLat = (pts) => pts.reduce((s, p) => s + p[0], 0) / pts.length;

// A polyline of [lat, lon] (a graticule line) → unit-frame polylines, broken
// wherever the line leaves the map or crosses a cylindrical seam, with the
// crossing itself interpolated so the line meets the frame edge.
export function projectPolyline(line, projection) {
  if (typeof projection.projectPolyline === "function") return projection.projectPolyline(line);
  const out = [];
  let cur = [], prevS = null, prevLat = null;
  for (const [ lat, lon ] of line) {
    const s = projection.shift(lon);
    if (prevS !== null && projection.kind === "cylindrical" && Math.abs(s - prevS) > 180) {
      const lifted = s < prevS ? s + 360 : s - 360;
      const boundary = lifted > prevS ? 180 : -180;
      const t = (boundary - prevS) / (lifted - prevS);
      const crossLat = prevLat + t * (lat - prevLat);
      const before = projection.forwardShifted(crossLat, boundary);
      if (before) cur.push([ before.x, before.y ]);
      if (cur.length > 1) out.push(cur);
      const after = projection.forwardShifted(crossLat, -boundary);
      cur = after ? [ [ after.x, after.y ] ] : [];
    }
    const p = projection.kind === "custom" ? projection.forward(lat, lon) : projection.forwardShifted(lat, s);
    if (!p) { if (cur.length > 1) out.push(cur); cur = []; prevS = null; prevLat = null; continue; }
    cur.push([ p.x, p.y ]);
    prevS = s;
    prevLat = lat;
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
