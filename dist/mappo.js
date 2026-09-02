// mappo v0.7.0
// Maps of any world as a zero-dependency web component. MIT license.
// https://github.com/rameerez/mappo
// Earth data: Natural Earth (public domain, naturalearthdata.com).
// GENERATED from src/ by scripts/build.js — edit src/, not this file.

// ══════════ src/projections.js ══════════
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

function validateLatRange(latRange) {
  if (!Array.isArray(latRange) || latRange.length !== 2 || !latRange.every(Number.isFinite) ||
      latRange[0] < -90 || latRange[1] > 90 || latRange[0] >= latRange[1]) {
    throw new RangeError("a projection needs latRange [min, max] within [-90, 90] with min < max");
  }
  return Object.freeze([ ...latRange ]);
}

const inRange = (value, min, max) => value >= min - EPS && value <= max + EPS;
const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const finiteLocation = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const frameLon = (lon) => lon >= -180 && lon <= 180 ? lon : wrapLon(lon);

// Longitude into [-180, 180).
function wrapLon(lon) {
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

function knownProjections() {
  return Object.keys(BUILTINS);
}

// The latitude band a projection wants when the caller has not asked: the
// body's own framing for cylindrical maps, a hemisphere for polar ones (Earth's
// default −58…84 would put a north polar map's rim in the southern ocean).
function projectionDefaultRange(value, bodyRange) {
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
function resolveProjection(value, { latRange = FULL, centerLon = 0 } = {}) {
  latRange = validateLatRange(latRange);
  if (!Number.isFinite(centerLon)) throw new RangeError("centerLon must be a finite number of degrees");
  centerLon = wrapLon(centerLon);
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

function validateOutline(value) {
  const raw = typeof value.outline === "function" ? value.outline() : null;
  const source = raw ?? [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ], [ 0, 0 ] ] ];
  if (!Array.isArray(source) || source.length === 0) throw new TypeError("projection outline() must return one or more rings");
  return Object.freeze(source.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 3) throw new TypeError("projection outline rings need at least three points");
    const points = ring.map((point) => {
      if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
          !inRange(point[0], 0, 1) || !inRange(point[1], 0, 1)) {
        throw new RangeError("projection outline points must be finite [x, y] coordinates in the unit frame");
      }
      return Object.freeze([ Math.max(0, Math.min(1, point[0])), Math.max(0, Math.min(1, point[1])) ]);
    });
    if (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1]) points.push(points[0]);
    return Object.freeze(points);
  }));
}

// Your own projection. By default its spherical seam is the antimeridian,
// which is what a conventional projection centred on 0° expects. Set
// `seam: false` when the mapping has no cylindrical seam; if its forward
// function cannot project a complete vector ring, the renderer deliberately
// falls back to screen-grid contours instead of connecting survivors by a
// false chord.
function adaptCustom(value, latRange) {
  const aspect = value.aspect ?? 2;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError("a custom projection needs a positive finite aspect ratio");
  const outline = validateOutline(value);
  const rawForward = value.forward.bind(value);
  const rawInverse = value.inverse.bind(value);
  const lonInFrame = frameLon;
  const forward = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRange(lat, latRange[0], latRange[1])) return null;
    const p = rawForward(lat, lonInFrame(lon));
    return finitePoint(p) && inRange(p.x, 0, 1) && inRange(p.y, 0, 1)
      ? { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }
      : null;
  };
  const inverse = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !inRange(x, 0, 1) || !inRange(y, 0, 1)) return null;
    const p = rawInverse(x, y);
    if (!finiteLocation(p) || !inRange(p.lat, latRange[0], latRange[1]) || !inRange(p.lat, -90, 90)) return null;
    const result = { lat: Math.max(-90, Math.min(90, p.lat)), lon: frameLon(p.lon) };
    const back = forward(result.lat, result.lon);
    return back && Math.hypot(back.x - x, back.y - y) <= 1e-6 ? result : null;
  };
  return Object.freeze({
    id: value.id ?? "custom", kind: value.seam === false ? "custom" : "cylindrical", key: customKey(value, latRange),
    aspect, centerLon: 0, latRange, farPole: null,
    shift: lonInFrame,
    forwardShifted: (lat, lon) => forward(lat, lon),
    forward,
    inverse,
    outline: () => outline
  });
}

const D3_ADAPTERS = new WeakMap();
let d3Seq = 0;
const D3_GETTERS = [ "angle", "center", "clipAngle", "clipExtent", "parallels", "precision", "reflectX", "reflectY", "rotate", "scale", "translate" ];
const D3_NOT_GETTERS = new Set([ "stream", "invert", "fitExtent", "fitSize", "fitWidth", "fitHeight", "copy" ]);
const STATE_IDS = new WeakMap();
let stateSeq = 0;

function stateValue(value) {
  if (Array.isArray(value)) return value.map(stateValue);
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => [ key, stateValue(value[key]) ]);
    if (entries.length) return entries;
  }
  if (typeof value === "function" || (value && typeof value === "object")) {
    let id = STATE_IDS.get(value);
    if (!id) STATE_IDS.set(value, id = ++stateSeq);
    return `<identity:${id}>`;
  }
  return value;
}

function d3Signature(proj) {
  const names = [ ...new Set([ ...D3_GETTERS, ...Object.keys(proj) ]) ].filter((name) =>
    !D3_NOT_GETTERS.has(name) && typeof proj[name] === "function").sort();
  return JSON.stringify(names.map((name) => {
    try { return [ name, stateValue(proj[name]()) ]; }
    catch { return [ name, "<unreadable>" ]; }
  }));
}

function streamPaths(proj, write) {
  const paths = [];
  let line = null;
  const sink = {
    point(x, y) { if (line && Number.isFinite(x) && Number.isFinite(y)) line.push([ x, y ]); },
    lineStart() { line = []; },
    lineEnd() { if (line?.length > 1) paths.push(line); line = null; },
    polygonStart() {}, polygonEnd() {}, sphere() {}
  };
  write(proj.stream(sink));
  return paths;
}

function streamLine(proj, coordinates, polygon = false) {
  return streamPaths(proj, (stream) => {
    if (polygon) stream.polygonStart();
    stream.lineStart();
    const n = polygon && coordinates.length > 1 && coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
      coordinates[0][1] === coordinates[coordinates.length - 1][1] ? coordinates.length - 1 : coordinates.length;
    for (let i = 0; i < n; i++) stream.point(coordinates[i][0], coordinates[i][1]);
    stream.lineEnd();
    if (polygon) stream.polygonEnd();
  });
}

function pointProjector(proj) {
  let point = null;
  const sink = {
    point(x, y) { if (!point && Number.isFinite(x) && Number.isFinite(y)) point = [ x, y ]; },
    lineStart() {}, lineEnd() {}, polygonStart() {}, polygonEnd() {}, sphere() {}
  };
  const stream = proj.stream(sink);
  return (lon, lat) => {
    point = null;
    stream.point(lon, lat);
    return point;
  };
}

function bandRing([ lat0, lat1 ]) {
  const ring = [];
  const step = 0.25;
  for (let lon = -180; lon <= 180; lon += step) ring.push([ lon, lat1 ]);
  for (let lon = 180; lon >= -180; lon -= step) ring.push([ lon, lat0 ]);
  ring.push(ring[0]);
  return ring;
}

function d3Frame(proj, latRange) {
  const paths = latRange[0] === -90 && latRange[1] === 90
    ? streamPaths(proj, (stream) => stream.sphere())
    : streamLine(proj, bandRing(latRange), true);
  const points = paths.flat();
  if (points.length < 3) throw new RangeError("d3 projection produced no finite frame");
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [ x, y ] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!(maxX > minX && maxY > minY)) throw new RangeError("d3 projection produced no finite frame");
  const width = maxX - minX, height = maxY - minY;
  const normalize = ([ x, y ]) => [ (x - minX) / width, (y - minY) / height ];
  const outline = paths.filter((path) => path.length >= 3).map((path) => {
    const ring = path.map(normalize);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([ ...ring[0] ]);
    return ring;
  });
  return { minX, minY, width, height, normalize, outline };
}

// A real d3-geo projection is adapted through projection.stream, not by direct
// point calls. The stream is where d3 applies spherical clipping, rotation,
// antimeridian cutting and adaptive resampling.
function adaptD3(proj, latRange) {
  if (typeof proj.stream !== "function") {
    throw new TypeError("a d3-geo projection needs .stream() as well as .invert(); pass a { forward, inverse } object for a custom projection");
  }
  const signature = d3Signature(proj);
  let cache = D3_ADAPTERS.get(proj);
  if (!cache) D3_ADAPTERS.set(proj, cache = new Map());
  const cacheKey = `${latRange[0]}|${latRange[1]}|${signature}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const frame = d3Frame(proj, latRange);
  const streamPoint = pointProjector(proj);
  const tolerance = 1e-6 * Math.max(frame.width, frame.height);
  const normalized = (point) => ({ x: (point[0] - frame.minX) / frame.width, y: (point[1] - frame.minY) / frame.height });
  const forward = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRange(lat, latRange[0], latRange[1])) return null;
    const p = streamPoint(wrapLon(lon), lat);
    if (!p) return null;
    const result = normalized(p);
    return inRange(result.x, 0, 1) && inRange(result.y, 0, 1) ? result : null;
  };
  const adapter = Object.freeze({
    id: "d3", kind: "d3", key: `${customKey(proj, latRange)}|state-${++d3Seq}`,
    aspect: frame.width / frame.height, centerLon: 0, latRange, farPole: null,
    shift: (lon) => lon,
    forwardShifted: forward,
    forward,
    inverse: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !inRange(x, 0, 1) || !inRange(y, 0, 1)) return null;
      const px = frame.minX + x * frame.width, py = frame.minY + y * frame.height;
      const ll = proj.invert([ px, py ]);
      if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
      const lon = frameLon(ll[0]), lat = ll[1];
      if (!inRange(lat, -90, 90) || !inRange(lat, latRange[0], latRange[1])) return null;
      const back = streamPoint(lon, lat);
      if (!back || Math.hypot(back[0] - px, back[1] - py) > tolerance) return null;
      return { lat: Math.max(-90, Math.min(90, lat)), lon };
    },
    outline: () => frame.outline,
    projectRings(rings) {
      const fill = [], edge = [];
      for (const ring of rings) {
        if (ring.length < 4) continue;
        const coordinates = ring.map(([ lat, lon ]) => [ lon, lat ]);
        // Measure semantic fill winding on continuous longitude, including a
        // pole closure for a pole-encircling ring. Discontinuous longitude
        // made tiny Chukotka look like a hemisphere-sized hole; omitting the
        // pole closure made Mars's northern lowlands look like one too.
        const sourceSign = ringFillSign(unwrap(ring, frameLon));
        const polygonInput = sourceSign < 0 ? [ ...coordinates ].reverse() : coordinates;
        for (const path of streamLine(proj, polygonInput, true)) {
          const points = path.map(frame.normalize);
          if (points.length < 3) continue;
          // d3 may emit several related rings for one clipped polygon: a clip
          // boundary and one or more geographic arcs with deliberately
          // opposite winding. Preserve that relationship. A source hole was
          // reversed before streaming so d3 clips its small interior; reverse
          // the whole emitted compound (every ring), not each ring toward one
          // sign, to turn that interior back into a nonzero-fill hole.
          if (sourceSign < 0) points.reverse();
          fill.push({ points, complement: false });
        }
        for (const path of streamLine(proj, coordinates, false)) {
          if (path.length > 1) edge.push(path.map(frame.normalize));
        }
      }
      return { fill, edge, complete: true };
    },
    projectPolyline(line) {
      return streamLine(proj, line.map(([ lat, lon ]) => [ lon, lat ]), false).map((path) => path.map(frame.normalize));
    }
  });
  cache.set(cacheKey, adapter);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return adapter;
}

// ── rings across the seam ───────────────────────────────────────────────────

const onSeam = (v) => Math.abs(Math.abs(v[1]) - 180) < 1e-9;
const closeRing = (pts) => [ ...pts, [ pts[0][0], pts[0][1] ] ];
const STITCHED = new WeakMap();

// Undo the cut every pack makes at ±180°: remove the closure edges that run
// along the seam and join the halves back into whole rings. A ring that never
// touches the seam passes through unchanged. Memoised on the rings array, which
// a body memoises in turn, so this runs once per body per page.
function stitchRings(rings) {
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
  const successes = [];
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
    if (closed) successes.push({ ring: closeRing(chain), members });
    else for (const m of members) failed.add(m.source);
  }
  // Stitching is transactional at SOURCE-ring level. A source may contain
  // several arcs; if any one cannot be paired, no successful chain containing
  // another of its arcs may also be emitted beside the untouched original.
  // Propagate that invalidation through chains before deciding what survives.
  let invalidated = true;
  while (invalidated) {
    invalidated = false;
    for (const success of successes) {
      if (!success.members.some((m) => failed.has(m.source))) continue;
      for (const m of success.members) {
        if (!failed.has(m.source)) { failed.add(m.source); invalidated = true; }
      }
    }
  }
  for (const success of successes) {
    if (!success.members.some((m) => failed.has(m.source))) out.push(success.ring);
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

// The sign a spherical ring contributes to nonzero fill. Longitude must be
// continuous, and a ring winding a pole must include the same pole closure the
// cylindrical renderer adds later; without it, a polar cap and the complement
// of that cap are indistinguishable in planar shoelace area.
function ringFillSign({ seq, winding }) {
  const closed = [ ...seq ];
  if (winding !== 0) {
    const pole = meanLat(seq) >= 0 ? 90 : -90;
    closed.push([ pole, seq[seq.length - 1][1] ], [ pole, seq[0][1] ]);
  }
  return Math.sign(signedArea(closed.map(([ lat, lon ]) => [ lon, -lat ])));
}

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

// Interior points along one side of a cylindrical frame. Equal Earth and
// sinusoidal seams are curves, so closing a fill with SVG's one straight Z
// segment cuts a shallow false chord through the map edge. A two-degree
// latitude step is finer than the stored vector geometry and follows the
// projection's real boundary; the stroke remains the open geographic arc.
function seamClosure(last, first) {
  const count = Math.ceil(Math.abs(first[0] - last[0]) / 2);
  const points = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    points.push([ last[0] + t * (first[0] - last[0]), last[1] ]);
  }
  return points;
}

// Rings of [lat, lon] → what the flat renderer draws, in unit-frame
// coordinates: `fill` pieces (closed; `complement` marks a ring whose interior
// contains the far pole of an azimuthal map and must be filled outside-in) and
// `edge` arcs (open, never along a seam).
function projectRings(rings, projection) {
  if (typeof projection.projectRings === "function") return projection.projectRings(rings);
  const fill = [], edge = [];
  let complete = true;
  const toFrame = (pts) => {
    const frame = [];
    for (const [ lat, lonS ] of pts) {
      const p = projection.forwardShifted(lat, lonS);
      if (!p) { complete = false; return null; }
      frame.push([ p.x, p.y ]);
    }
    return frame;
  };

  for (const ring of rings) {
    if (ring.length < 4) continue;
    if (projection.kind === "custom") {
      const pts = [];
      for (const [ lat, lon ] of ring) {
        const p = projection.forward(lat, lon);
        if (!p) { complete = false; break; }
        pts.push([ p.x, p.y ]);
      }
      if (pts.length === ring.length && pts.length >= 3) { fill.push({ points: pts, complement: false }); edge.push(pts); }
      continue;
    }
    const unwrapped = unwrap(ring, projection.shift);
    if (projection.kind === "azimuthal") {
      const pts = toFrame(unwrapped.seq);
      if (!pts) continue;
      const enclosedPole = unwrapped.winding !== 0 ? (meanLat(unwrapped.seq) >= 0 ? 90 : -90) : null;
      fill.push({ points: pts, complement: enclosedPole !== null && enclosedPole === projection.farPole });
      edge.push([ ...pts, pts[0] ]);
      continue;
    }
    for (const { pts, closure } of cutAtSeam(unwrapped)) {
      const frame = toFrame(pts);
      if (!frame) continue;
      if (closure === "ring") {
        fill.push({ points: frame, complement: false });
        edge.push([ ...frame, frame[0] ]);
      } else {
        edge.push(frame);
        if (closure === "pole") {
          const pole = meanLat(pts) >= 0 ? 90 : -90;
          const last = pts[pts.length - 1], first = pts[0];
          const closureFrame = toFrame([ [ pole, last[1] ], [ pole, first[1] ] ]);
          if (closureFrame) fill.push({ points: [ ...frame, ...closureFrame ], complement: false });
        } else {
          const boundary = toFrame(seamClosure(pts[pts.length - 1], pts[0]));
          if (boundary) fill.push({ points: [ ...frame, ...boundary ], complement: false });
        }
      }
    }
  }
  return { fill, edge, complete };
}

// A polyline of [lat, lon] (a graticule line) → unit-frame polylines, broken
// wherever the line leaves the map or crosses a cylindrical seam.
function projectPolyline(line, projection) {
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
function signedArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return a / 2;
}

// ══════════ src/projection.js ══════════
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


const validGrid = (grid) => grid && Number.isFinite(grid.cols) && grid.cols > 0 && Number.isFinite(grid.rows) && grid.rows > 0;
const validLocation = (lat, lon, grid) => validGrid(grid) && Number.isFinite(lat) && Number.isFinite(lon) &&
  Array.isArray(grid.latRange) && grid.latRange.length === 2 && lat >= grid.latRange[0] - 1e-9 && lat <= grid.latRange[1] + 1e-9 &&
  lat >= -90 && lat <= 90;

// Map a lat/lon to fractional grid coordinates, or null when the point has no
// place on this map.
function project(lat, lon, grid) {
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
function cellCenter(col, row, grid) {
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
function cellCorner(col, row, grid) {
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
function projectNormalized(lat, lon, { latRange, projection = "equirectangular", centerLon = 0 } = {}) {
  if (!Array.isArray(latRange) || latRange.length !== 2) {
    throw new TypeError("projectNormalized needs { latRange: [min, max] } — the map's own range, e.g. EARTH.latRange");
  }
  return resolveProjection(projection, { latRange, centerLon }).forward(lat, lon);
}

// ══════════ src/graticule.js ══════════
// The graticule: meridians, parallels, and the equator, as lat/lon polylines.
//
// Renderer-agnostic on purpose — the same discipline as highlight.js. This
// module knows nothing about SVG, canvas, spheres or grids; it emits lines in
// world coordinates and each renderer projects them its own way. That is what
// lets the flat map and the globe share one definition of "the grid on the
// world" instead of drifting apart.
//
// Two rules here are not arbitrary, they are what makes a graticule readable:
//
//   1. The EQUATOR IS ITS OWN LINE, returned separately, so a renderer can
//      give it its own colour and weight. It is the line a reader orients
//      against; drowning it in eleven identical parallels wastes it.
//   2. A parallel that lands within `skipDeg` of the equator is DROPPED
//      rather than drawn. Evenly spacing parallels across 180° will, for many
//      counts, put one right on 0° — which double-draws the equator at double
//      opacity and makes it look like a rendering bug.

// Sampling step in degrees along each line. 3° gives a circle of 120
// segments, which stays smooth at any globe size a browser will draw and
// still costs nothing to project.
const STEP = 3;

function ring(fn) {
  const pts = [];
  for (let d = 0; d <= 360; d += STEP) pts.push(fn(d));
  return pts;
}

// A full meridian: pole to pole and back is unnecessary — a half circle from
// -90 to 90 is the whole line, and the renderer decides how much of it is
// visible.
function meridian(lon) {
  const pts = [];
  for (let lat = -90; lat <= 90; lat += STEP) pts.push([ lat, lon ]);
  return pts;
}

function parallel(lat) {
  return ring((d) => [ lat, -180 + d ]);
}

// meridians: how many evenly spaced longitudes (0 disables).
// parallels: how many evenly spaced latitudes BETWEEN the poles, equator
//            excluded (it is always returned separately).
// skipDeg:   parallels closer than this to the equator are dropped.
function buildGraticule({ meridians = 12, parallels = 11, skipDeg = 5 } = {}) {
  const mers = [];
  for (let i = 0; i < meridians; i++) mers.push(meridian(-180 + (360 / meridians) * i));

  const pars = [];
  for (let i = 0; i < parallels; i++) {
    const lat = -90 + (180 / (parallels + 1)) * (i + 1);
    if (Math.abs(lat) < skipDeg) continue;
    pars.push(parallel(lat));
  }

  return { meridians: mers, parallels: pars, equator: parallel(0) };
}

// ══════════ src/bodies/earth.js ══════════
// GENERATED by scripts/generate-earth.js — do not edit by hand.
// Places live in scripts/data/earth-places.js; everything else is derived
// from the pinned sources named below. `npm run generate:earth` rewrites this file.
//
// Earth. Data: Natural Earth 110m land and admin-0 countries (public domain),
// natural-earth-vector @ ca96624a56bd078437bca8184e78163e5039ad19, SHA-256 pinned in the generator. The figure is
// land against ocean; the borders are national boundaries. Default framing cuts
// Antarctica and the arctic emptiness.
//
// Format: a 512×256 bitmask (row-major from lat +90 down, lon −180 → +180,
// one bit per cell) and closed [lat, lon] rings quantised to 1/32° and
// delta+varint encoded — the same encoding every mappo body uses.

const EARTH = (() => {
  const MASK_W = 512, MASK_H = 256;
  const BITS = Uint8Array.from(atob("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//DwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA/P///wAA4P////8DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA/////w/+77/////HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHP/////h////////f/8/AAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP8B/P8f////////////AQAAAAAAMAcAAAD4AAAAAAAAAPgPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAID/7///B/j/////////PwAAAAAAxvE/AAAAAAAAAAAAAADwPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwA/I//D4D//////////x8AAAAAAP8/AAAAAAAAAAAAAAAAgD8HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD88/D7/w////////////8PAAAAAAD8BwEAAAAAAAAAAAAAAADAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAHAIADuP8B/P//////////DwAAAAAA4MEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAHAADAA/7/Afj//////////z8AAAAAAMAAAAAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB8ODjAH3gAMADg//////////8HAAAAAAAAAAAAAAAAAAD/AQAAAADw//8BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7jQx7wwx8AAADw////////DwAAAAAAAAAAAAAAAAD8BwAAAAD/////AwAAAPg/AAAAAAAAAAAAAAAAAAAAAACAHwCA5/8/AAAAwP///////wcAAAAAAAAAAAAAAACAPwAAAAD4////fwAAAADwHzwAAAAAAAAAAAAAAAAAAID/AQAAAAAAAAAAAID///////8BAAAAAAAAAAAAAAAAwAcAAAAA+P///w8AAAAAAAAAAAAAAAAAAAAAAAAAAACA/w8ABz8/HO4DAAAA////////AwAAAAAAAAAAAAAAAOABAAAA+P///////YEfAIAPAAAAAAAAAAAAAAAAAAAAwP/eycM+B/8fAAAAAPz//////wAAAAAAAAAAAAAAAAD4AAB8BPj/////////fwCAAQAAAAAAAAAAAAAAAAAAAOCf/78HfwP//x8AAAD+/////38AAAAAAAAAAAAAAAAAfAAAfOz7/////////38AwP8fAAAAAAAHAAAAAAAAAAAAD///B5gP////AwAA8P//////AQAAAAAAAAAAAAAAAPwAAD/3////////////+Pf/fwAAAACAAAAA8H8AAAAAAAD//x+AH/7//x8AALj/////zwEAAAAAAAAA/AcAAAAAAYB//P//////////////////BwAAAAAAAP7//x8A4E4A/v//kB+Af///AAD8/////38AAAAAAAAA8P8HAAAAAAAAf/7//////////////////wcAHAAAAID/////h///f/j/P/h8wA/4/wEAgP////8PAAAAAAAAAPz//wEAAADAD37+//////////////////////h/AwD4//////////8fwAMA/McPwH8AAMD/////AQAAAAAAAID///8/AAAY3H/8/P///////////////////////x8A4P//////////H4h/cP/jDxz/DwDw////AwAAAAAAAADg/////4GD//////j///////////////////////9/AID//////////////////w8M/x8A+P///wAAAAAAAAAA8P////+D8f///3/+/////////////////////////x9g/v///////////////78DgP//APD//z8AAAAGAAAAAPj////4kf////+///////////////////////////w//v////////////////8fAMB/eADw//8DAMD/BwAAAAD+//j/A/7////////////////////////////////AB/j/////////////////7wH+/wEAwP9/AAAA/w8AAAAA/z/w/wP+////////////////////////////////AAIA+P///////////////+cPjv8HAMD/PwAAAP4HAAAAgP8//v/j////////////////////////////////HwAgAPj//////////////3/wOQC8DwCA/z8AAAAwAAAAAOD/D////////////////////////////////////z8AAMD///////////////9/AAAA+AwAAP8PAAAAAAAAAAD8/8P///////////////////////////////////9/AADg////////////////DwBC3oADAAD+BwAAAAAAAAAA///B//////////////////////////////////z/BwAA8P///////////////wcAAP4DAAAA/AcAAAAAAAAAgP//gP///////////////////////////////3j+fwAAAOD//77///////////8DAAD+HwAAAMAHAAAAAAAAAID//8H//////////////////////////////z8Y/w8AAADM/38f+P//////////AQAA/B8AAAAAAwAAAAAAAACA//8HB/7///////////////////////////8PwD8EAAAAAPwfAwD+/////////wEAAP4fGAAAAAAAAAAAAAAAAP//A/j///////////////////////////+PD/AAAAAAAAC0PwAA+P////////8HAAD+fzwAAAAAAAAAAAAAAAAf/wD+//////////////////////////8BAAB4AAAAAAAAAA8AAAD+////////DwAA/P9/AAAAAAAAAAAAAAcAAP8A+P//////////////////////////AAAAPgAAAAAAAIBzAAAA/P///////x8AAPj//wAAAAAAAAAAAAAfAEB+gP3/////////////////////////PwAAgP8AAAAAAADgAAAAAPj/////////AwD4//8AAAAAAAAAAAAADwBwfMD//////////////////////////x8AAMD/AAAAAAAAPAAAAADw/////////w8A/P//AwAAAAAAAAAAAB8AMB/A//////////////////////////8HAADgPwAAAAAAAAMAAAAAwP//////////A/7//wcAAAAAAAAAAAA+ADADwP//////////////////////////AQAA4D8AAAAAAAAAAAAAAMD//////////4f///9/AAAAAAAAAADweABwgPf//////////////////////////wcAAOAfAAAAAAAAAAAAAAAI//////////8H////fwAAAAAAAAAAfPAA8P/////////////////////////////vAADADwAAAAAAAAAAAAAAAP//////////B/////8BAAAAAAAAAHj+gf///////////////////////////////w8AwAcAAAAAAAAAAAAAABD8/////////w//////AQAAAAAAAAA8/MP///////////////////////////////8PAMABAAAAAAAAAAAAAAAA/P////////8f/////wAAAAAAAAAAAP7j////////////////////////////////DADAAAAAAAAAAAAAAAAAAPj//////////////48BAAAAAAAAAAD++f///////////////////////////////wwAAAAAAAAAAAAAAAAAAADc/////////////+fHAAAAAAAAAAAABfz///////////////////////////////8cAAAAAAAAAAAAAAAAAAAAMP////////////9g4AEAAAAAAAAAACD/////////////////////////////////HAAAAAAAAAAAAAAAAAAAAOD+//////////8/D/APAAAAAAAAAADI////////////////////////////////fwQAAAAAAAAAAAAAAAAAAACA/P//////////3w/wHwAAAAAAAAAA/P///////////////////////////////38EAAAAAAAAAAAAAAAAAAAAgP3//////////+8PABoAAAAAAAAAAPD///////////////////////////////8/BAAAAAAAAAAAAAAAAAAAAAD/////////////HwAYAAAAAAAAAADg////////z///+P//////////////////HwwAAAAAAAAAAAAAAAAAAAAA/////////////18GAAAAAAAAAAAAwP//////h8P/H/D//////////////////w8AAAAAAAAAAAAAAAAAAAAAAP//////////////AQAAAAAAAAAAAMD///v//8Pv/wf8//////////////////8HAAAAAAAAAAAAAAAAAAAAAAD/////////////PAAAAAAAAAAAAADA///h//+B4f8D/v//////////////////AwYAAAAAAAAAAAAAAAAAAACA////////////PwwAAAAAAAAAAAAAwP/Hw///AQD/B////////////////////wF+AAAAAAAAAAAAAAAAAAAAgP///////////w8AAAAAAAAAAAAA+P8fgw///wAA/g/+/////////////////3+AfwAAAAAAAAAAAAAAAAAAAID///////////8HAAAAAAAAAAAAAPj/DxAP/H8AAPgP+P////////////////8DgA0AAAAAAAAAAAAAAAAAAACA////////////HwAAAAAAAAAAAAD4/w8QfvD/gAf4H+D/////////////////AYABAAAAAAAAAAAAAAAAAAAAgP///////////wAAAAAAAAAAAAAA8P8DAPjw//U//D/A/////////////////wCAAQAAAAAAAAAAAAAAAAAAAID//////////38AAAAAAAAAAAAAAPj/ATDg86L///9/+P//////////////x38AgAMAAAAAAAAAAAAAAAAAAAAA//////////9/AAAAAAAAAAAAAAD4/wAwwPDA////P/D//////////////2MeAIADAAAAAAAAAAAAAAAAAAAAAP//////////PwAAAAAAAAAAAAAA+P8AEIDgwf///z/w//////////////8QPACAAwAAAAAAAAAAAAAAAAAAAAD+/////////xcAAAAAAAAAAAAAAPh/AABAwMP///8/4P//////////////AHwAwAEAAAAAAAAAAAAAAAAAAAAA/P////////8PAAAAAAAAAAAAAADwfwAAPMCB////P+D//////////////xnwAOAAAAAAAAAAAAAAAAAAAAAAAPz/////////DwAAAAAAAAAAAAAAmB8AvyCAgf/////w//////////////8/8AD0AAAAAAAAAAAAAAAAAAAAAAD4/////////w8AAAAAAAAAAAAAAIAB/n8AAADE+P//////////////////D/AA/AAAAAAAAAAAAAAAAAAAAAAA8P////////8PAAAAAAAAAAAAAACAwf//AAAAAPn//////////////////wPw4P8AAAAAAAAAAAAAAAAAAAAAAPD/////////BwAAAAAAAAAAAAAAgP//fwAAAMD4//////////////////8DMPA/AAAAAAAAAAAAAAAAAAAAAACA/////////wEAAAAAAAAAAAAAAMD//38AAAAA+P//////////////////BwDcAwAAAAAAAAAAAAAAAAAAAAAAAP7///////8AAAAAAAAAAAAAAADw////AAAAAPz//////////////////w8ANwAAAAAAAAAAAAAAAAAAAAAAAAD+//////8/AAAAAAAAAAAAAAAA+P///w/AAAD8//////////////////8PAAYAAAAAAAAAAAAAAAAAAAAAAAAA/P//////HwAAAAAAAAAAAAAAAPj///8/8AMA/v//////////////////HwAGAAAAAAAAAAAAAAAAAAAAAAAAAJz//////w8AAAAAAAAAAAAAAAD8////f/B/HP7//////////////////x8AAgAAAAAAAAAAAAAAAAAAAAAAAACY//////8PAAAAAAAAAAAAAAAA/P/////z//////////////////////8fAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP/////BDgAAAAAAAAAAAAAAAPz///////////+P////////////////PwAAAAAAAAAAAAAAAAAAAAAAAAAAACD///+BABwAAAAAAAAAAAAAAAD+////////v/3/D////////////////x8AAAAAAAAAAAAAAAAAAAAAAAAAAABA/v9/AAAcAAAAAAAAAAAAAAAA/////////////x/+//////////////8fAAAAAAAAAAAAAAAAAAAAAAAAAAAA8Pj/PwAAPAAAAAAAAAAAAAAAwP////////9//P8f/P//////////////DwAAAAAAAAAAAAAAAAAAAAAAAAAAAOD5/z8AADgAAAAAAAAAAAAAAOD///////////j/P/D+/////////////wcAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4f8/AAA4AAAAAAAAAAAAAADw///////////w/38A/v////////////8HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOP/PwAAMAAAAAAAAAAAAAAA+P//////////8f9/gfj/////////////AwAAAAAAAAAAAAAAAAAAAAAAAAAAAADD/x8AAAAAAAAAAAAAAAAAAPj//////////+P//8EAgP///////////xEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAhP8fAAAAAgAAAAAAAAAAAAD8///////////j///jAQD///////////8YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAj/HwAAAAAAAAAAAAAAAAAA/v//////////g////w8A/v////////9/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI/h8AAD4AAAAAAAAAAAAAAP7//////////4f///8PAPj/////////HwgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwfAADxAQAAAAAAAAAAAAD///////////8P////HwD8////+f///wEAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAD8HwAMAAcAAAAAAAAAAAAA////////////H////w8A+P//D/j//zEAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAA/D+ADwAOAAAAAAAAAAAAAP///////////x////8HAID//w/4//8QAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAPx/gA8APAAAAAAAAAAAAAD+//////////8f/v//AwAA//8H8P9/MAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAD4f4APAAAfAAAAAAAAAAAA/v//////////H/z//wMAAP//AeD/PxwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8P/hBwBAfgAAAAAAAAAAAP7//////////x/4//8BAAD//wDA/38YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAID//wcADgQAAAAAAAAAAAD+//////////9/+P//AAAA/38AwP9/AAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8DAAAAAAAAAAAAAAAA/v//////////f/D/fwAAAP8fAMD//wAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPj/AwAAAAAAAAAAAAAAAP/////////////g/wcAAAD/HwDA/f8BADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA+OMAAAAAAAAAAAAAAAD/////////////4P8DAAAA/gMAgPj/AwAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD/AwAAAAAAAAAAAAAA/////////////+H/AAAAAP4DAAD4/wcAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg/wMAAAAAAAAAAAAAAP/////////////nPwAAAAD8AwAA+P8HABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8BAAAAAAAAAAAAAAD/////////////zw8AAAAA/AMAAPj/BwDQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4AQAAAAAAAAAAAAAA/////////////98AAAAAAPwDAAAw/wcAkAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AEABAAAAAAAAAAAAP////////////8/AAAAAAD4AwAAMPwHABACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOABABcAAAAAAAAAAAD+////////////H4ABAAAA+AMAADD8BwAgBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAeB/AAAAAAAAAAAA+P///////////z/4AQAAAPADAAAw+AMA4AIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAPg+3cBAAAAAAAAAPj//////////////wAAAADwAQAAEOAAAIICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH8Pv/AQAAAAAAAADg//////////////8AAAAA4AQAABBgAABBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfvv//wMAAAAAAAAA4P//////////////AAAAAGAEAAAwIAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADD+//8PAAAAAAAAAOD/////////////fwAAAABADgAAYAAAAMAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAg/v//HwAAAAAAAADA/////////////38AAAAAAA4AAGAAAABADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPz//z8AAAAAAAAAAP////////////8/AAAAAAAMAADAAQBAAAsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8//9/AgAAAAAAAAD+/4P/////////PwAAAAAAAAAAgAMAYAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P///x8AAAAAAAAA/H+A/////////x8AAAAAAAAAAIMHAPABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPz///8/AAAAAAAAADAAAPf///////8PAAAAAAAAAACPBwD8AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8////fwAAAAAAAAAAAADg////////BwAAAAAAAAAAngcAfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P////8AAAAAAAAAAAAAwP///////wcAAAAAAAAAADwHAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAAAAAAAAAAAMD///////8DAAAAAAAAAAB4DsD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wEAAAAAAAAAAADg////////AAAAAAAAAAAA8A3Q/wAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA//////8BAAAAAAAAAAAA4P//////fwAAAAAAAAAAAOAD+P8RYgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwP//////AAAAAAAAAAAAAOD//////x8AAAAAAAAAAADgB/h/iGEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD//////wcAAAAAAAAAAADg//////8fAAAAAAAAAAAAwAf4fwQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg//////8/AAAAAAAAAAAA4P//////DwAAAAAAAAAAAIAP8H9kAHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4P///////wAAAAAAAAAAAOD//////wcAAAAAAAAAAACAH+A/HABwGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOD///////8FAAAAAAAAAADA//////8DAAAAAAAAAAAAAD/gPx4AQHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA/////////wAAAAAAAAAAgP//////AQAAAAAAAAAAAAB+gB820PP+BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4P////////8DAAAAAAAAAAD//////wEAAAAAAAAAAAAAfAAINACg/z8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD/////////BwAAAAAAAAAA//////8AAAAAAAAAAAAAAHgAAGQAAP5/AAMAAAAAAAAAAAAAAAAAAAAAAAAAAADg/////////z8AAAAAAAAAAP7///9/AAAAAAAAAAAAAABwAABEAADw/6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4P////////8/AAAAAAAAAAD+////fwAAAAAAAAAAAAAAgAEAAACA4P9zEAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD/////////PwAAAAAAAAAA/P////8AAAAAAAAAAAAAAMBjAAAAAOD/AyAAAAAAAAAAAAAAAAAAAAAAAAAAAACA/////////38AAAAAAAAAAPz/////AAAAAAAAAAAAAAAA/wEAAADg/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP////////8/AAAAAAAAAAD4/////wAAAAAAAAAAAAAAAOAPAAAA8A8HAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////////PwAAAAAAAAAA+P////8AAAAAAAAAAAAAAAAAwDkMAAAPBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////x8AAAAAAAAAAPj/////AAAAAAAAAAAAAAAAAAAEAwAAAA4AKAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7///////8fAAAAAAAAAAD4/////wEAAAAAAAAAAAAAAAAACAEAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+////////DwAAAAAAAAAA+P////8DAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P///////wcAAAAAAAAAAPj/////AwAAAAAAAAAAAAAAAAAAACAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPz///////8DAAAAAAAAAAD4/////wMAAAAAAAAAAAAAAAAAAAD8BwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4////////AQAAAAAAAAAA/P////8DYAAAAAAAAAAAAAAAAAAA/gMOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+P///////wEAAAAAAAAAAPz/////A2AAAAAAAAAAAAAAAAAAAP4DDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD///////8BAAAAAAAAAAD+/////wNwAAAAAAAAAAAAAAAAADj/AT4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg////////AQAAAAAAAAAA/v////8D+AAAAAAAAAAAAAAAAAD8/wF+AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAwP///////wEAAAAAAAAAAP7/////Af4AAAAAAAAAAAAAAAAA/v8HfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////8AAAAAAAAAAAD+/////4B/AAAAAAAAAAAAAAAAAP//D34AAABAAMAAAAAAAAAAAAAAAAAAAAAAAAAA/P//////AAAAAAAAAAAA/v///z+APwAAAAAAAAAAAAAAAMD//z//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPj//////wAAAAAAAAAAAP7///8fgD8AAAAAAAAAAAAAAADA/////wAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAADw//////8AAAAAAAAAAAD+////D4A/AAAAAAAAAAAAAAAA4P////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8P//////AAAAAAAAAAAA/P///wOAPwAAAAAAAAAAAAAAAPD/////AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD/////fwAAAAAAAAAAAPz///8BgB8AAAAAAAAAAAAAAAD+/////wcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADw/////z8AAAAAAAAAAAD4////A4AfAAAAAAAAAAAAAADA//////8PAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAA8P////8/AAAAAAAAAAAA+P///wPAHwAAAAAAAAAAAAAA8P//////DwAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD/////HwAAAAAAAAAAAPD///8HwA8AAAAAAAAAAAAAAPj//////x8AADAAAAAAAAAAAAAAAAAAAAAAAAAAAADw/////w8AAAAAAAAAAADw////B8APAAAAAAAAAAAAAAD8//////8/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8P////8AAAAAAAAAAAAA8P///wPADwAAAAAAAAAAAAAA/P//////fwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD///8/AAAAAAAAAAAAAOD///8DwAcAAAAAAAAAAAAAAP7///////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADw////DwAAAAAAAAAAAADg////AIAHAAAAAAAAAAAAAAD8////////AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+P///wcAAAAAAAAAAAAA4P//PwAAAAAAAAAAAAAAAAAA/P///////wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPj///8HAAAAAAAAAAAAAOD//38AAAAAAAAAAAAAAAAAAP7///////8DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4////BwAAAAAAAAAAAADA//9/AAAAAAAAAAAAAAAAAAD8////////AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+P///wcAAAAAAAAAAAAAwP//PwAAAAAAAAAAAAAAAAAA/P///////wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPj///8HAAAAAAAAAAAAAID//z8AAAAAAAAAAAAAAAAAAPj///////8DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8////AwAAAAAAAAAAAAAA//8fAAAAAAAAAAAAAAAAAAD4////////AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P///wEAAAAAAAAAAAAAAP//DwAAAAAAAAAAAAAAAAAA8P///////wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPz///8AAAAAAAAAAAAAAAD+/wcAAAAAAAAAAAAAAAAAAPD///////8DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8//9/AAAAAAAAAAAAAAAA/P8HAAAAAAAAAAAAAAAAAADw////////AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P//PwAAAAAAAAAAAAAAAPz/AQAAAAAAAAAAAAAAAAAA4P8/8P///wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPz//x8AAAAAAAAAAAAAAAD8/wAAAAAAAAAAAAAAAAAAAOD/A4D///8BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8//8fAAAAAAAAAAAAAAAA/D8AAAAAAAAAAAAAAAAAAADw/wAA9///AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P//DwAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAA8AMAAPP/fwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7/PwIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAADo/38AAABAAAAAAAAAAAAAAAAAAAAAAAAAAAD+/38AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4P8/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAA//9/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAID/PwAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAP//fwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA/x8AAAAAAwAAAAAAAAAAAAAAAAAAAAAAAID//z8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP8fAAAAAAMAAAAAAAAAAAAAAAAAAAAAAACA//8fAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADcAQAAAAA/AAAAAAAAAAAAAAAAAAAAAAAAAP9/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAAID//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAACA/38AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAgP8nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAcAAACgAgAAAAAAAAAAAAAAAAAAAAAAAID/DwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAHAAAA8AAAAAAAAAAAAAAAAAAAAAAAAABA/j8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAwAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAQP8PAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAEAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAD/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAAADA/wcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwA8AAAAAAAAAAAAAAAAAAAAAAAAAwP8BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAHAAAAAAAAAAAAAAAAAAAAAAAAAOD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAwAAAAAAAAAAAAAAAAAAAAAAAADg/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwP8HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOD/AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADw/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4D8APgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAdwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAD+AQAAAAAgAAA/wA8AAPwDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAADg/wcAAAAA/kTQ////8f////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAA/v9/fAAA+P//////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAAAB8P////8HAP///////////////x8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACcPwAAAAAAAAAAAAAAAAAAAACAH/7/////B4D/////////////////PwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvH8AAAAAAAAAAAAAAAAAAA8A+P///////wH+//////////////////8HAAAAAAAAAAAAAAAAAAAAAAAAAAAAALz/AAAAAAAAAAAAAACAf/7///////////8B////////////////////fwAAAAAAAAAAAAAAAAAAAAAAAAAAAMB//wEAAAAAAAAAAMZ4/v//////////////wf//////////////////////AwAAAAAAAAAAAAAAAAAAgH8AAADgP/4BAAAAAAAAAID//////////////////+H//////////////////////wcAAAAAAAAAAAAAAAAAACACAAIAAID/AQAAAAAAAADg//////////////////////////////////////////8DAAAAAAAAAAAAABgEAADgH/5/YAP//wMAAAAAAAAA/v//////////////////////////////////////////AQAAAAAAAAAAAAAAgHsAAP////////8BAAAAAAAAAPz/////////////////////////////////////////PwAAAAAAAAAAAPj/////HwD8//////8fAAAAAAAAAAD//////////////////////////////////////////wcAAAAAAAAAAP//////////////////BwAAAAAAAADw//////////////////////////////////////////8BAAAAAAAAAAD/////////////////HwAAAAAAAADw////////////////////////////////////////////AQAAAAAAAADw////////////////AwAAAAAAAADA/////////////////////////////////////////////wEAAAAAAID//////////////////38AAAAAAAAA/P////////////////////////////////////////////8DAAAAAAAH//////////////////8BAAAAAPwB4P//////////////////////////////////////////////HwAAAAAAHvD/////////////////AQAAAAD+A+D//////////////////////////////////////////////wEAAAAAAAAAwP///////////////wcAAAKA/wMAwP///////////////////////////////////////////x8AAAAAAAAAAID/////////////////AfwH+H8AAMD///////////////////////////////////////////8PAAAAAAAAAPz5/////////////////z8AAAAAAPj/////////////////////////////////////////////HwAAAAAAAADg////////////////////fwAA//n//////////////////////////////////////////////38AAAAAAAAAgP////////////////////8P/v//////////////////////////////////////////////////AwAAAAAAAMD///////////////////////////////////////////////////////////////////////////8AAAB4AAAA/P//////////////////////////////////////////////////////////////////////////HwD//x8AAADg//////////////////////////////////////////////////////////////////////////////////+H/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////w=="), (c) => c.charCodeAt(0));
  const OUTLINES = "8wH+TlB9BlEIvEDvCWhBW6IJwCyBkCZ|ypBgV5DHzCWxCsBoBY2DJyDpBQd|2tI8XwCZanBK7BpGjB9Hb3EEzCWKaqES2BU2EkDgEOgDN|y1DghB0CJsCMjBX7BP5CG/BWOWsCL|8sDihBiDZ3DI3CSuBOgCN|iiFkkBmCHmCImBlBlJChCMhBaoBMwFN|k/GimBGbbvBxEVzCCeYxERxBUBayDgBqCBSgBCsCkBe8BKiBXyCtD|4yH2zBZNvBK1BF5CfdRJZEVeVrBP7BDvDlCJXWZiBTmDhB6BpCeVUXI5BsBpCHhBpCvBzCHjCrBhDX7HlBxBZpNFUXiDLoCRoBVnCTtDG7CPFzBsCTOXwCXoEJkK5B8JbkHnB+C1BuCW4GoB4HiB+EA+IXqBc4CUiFAqQwBiDQnCuBAY7LNRYIwBeOmGe8EmB6BY6GagGM8J+B2DoBSajCOWasBUqGwByBaeewBSsCDeVuCBCYgBYmCFQXsCDkFUoCDcZmCU6K2B2BOoBWwBPiCKyC1BqCOcYiCS0CDYX0BY0GIsEJoCnBmCK8GEkEQ4BS+DSwBSkBiBkBWiCJaV2BPiCG+CnBgCQYa8DiBqEU4EsB8BHkDoB8BB0BQMW2BSwFc0DJ0BRGbgDlBsCHgDjB8BB0BM4Ba2Fb+DF2BhCBPHd9BPxBXIXoCAHX/BxByBTqCFqCK4ByBsCmByB2ByHayByBsBY0DciBW0CUgCF4DOmCDuBSiBqB2BvB0BL6HDoBG2BBwBN6FQiCHoGsD6CZ8D9B6DBqESgDkBoCCuBOyBLuCnBmCC6DfwCHiCG8CoB6BG8DP2DK0DL+DU+HOSgBCaoBRMbwBvB2BLmLK8EFsBTLXqBTsEdqHfoCBqBWiFzB4ENeZqCNwBXoCJoJFsGjBuBRHZhBVxCtCzCJlBVxCNbZ7CrBpBxBDzBkBZOXeV2DHab1GX3DB1BjBLd9BvB2CVgBZmEtB4FnB0ETgBd4FN8BXyFQgIjBAxK/vWAAyK8BmB0DT0CWkDbgDe8FM6FrBmKjB4HP4FSwIL6ET8KkBMe7HCtGQ1BYrFOMcwByBNcpDQvBYjDU8ED0EK8CV8GsB0BUXavFmBzLSnBYzCUxBWTqC6CbuGQ2BbkDGuH2BiDGDYVYUWyCKmBTsFcyFIoHqB+CHgDI0CJsFK2FNuLEgCSuCKwCNsCMmCWoD/BkCUsCX2CHqCRsFQgDDuFTiBcnCsBxCGlBWjBoCyBHmFAsCJgCTcV2CD6HeiCP0CG4BwByBbqCLyCG0BXiFJsCNyBYaW+BZ4CIiCNsBV2CGiEe6Ha+BOmBUQaHcvCiDBYGa2ByBKYT2BgBcsCqBgDoBYcsCgB+BEoBUiDUyCmByBGmBPXThCT|wgHqoC0ClB4CPbf7BDhBWTZ3BTjCIvBUhCIvCkBhCiB3CoC0BN6CpB2CVgBcUsB8BauBF4BtC|8yH6tC0BdTV1CRbW1BdfesCmB2BPmBa|y0PywChDDBiBOoBqBT8BHCLRd|6qUuiD+BV0CUmBDGrCVVHzBVSrBrBzBEnB4BJqBjB4BCcqBD|iiWmiDObuBaSZAbhCrCfZYdxBB3BXzBpDxCvB7BCpBWjCELYiBuByCgCoBMmD6BmBiBcuBYSKiBuBeOZ|olW2rDuBjCAsBeRKvByBTsBFkBYiBFP5BTjBvBARRGbhC5CvBZLQZKkB0BTkBlCaCWuBWMyBDqBZqBCMvCyCbuBYGkBjByBPS5B|o2V2nEXPxCuBzCwCHWcBkBVmErD|4sWqxEWRJhBnBHjBIFcYWeHQK|4uWsyEpBLHY6CkBAfnBP|m2Vk2EMzBRINBHQByBeT|ksO84EKrCQdFfLRTmBLTMtBFbRND1B1E/NrDpB3CmBRiBD6BVyBFuBMuBeMAUeyBGoBbmCD8BWkBIoBgBC8BacA6CsCSgBHcaHkBsBCmBUeoB3BQpB|knUw4EYzBoBa0B1BFbO1BIfQHS1BFhBUrBmCf4C7BHNkBnBalCYOabQKMjC8DzDSxBBrCe3BD3Bb1CClBLrBd7BtBdtBxCR3BXfRtBDhCjBVnCB7BZjCzB7CoBKgBhBL3BtB/FyBnBoBbyCda9BGUgBNwBfrB3BLgBiBKmBYgBDuBzB1BnBVXxBxBaCiBnBuBhBYMOxCoBtBC9BexDF7ErB7BEjCf3BPLfXZ9CH3BM5CJlBhBTC9BlB5CClD2BCkBeIMQGiCHmBhBiCJkBCkBXqBBSbaHyBlB0BHacbV8BgBRSZAiBzB6CGkBOQIgBFmBauBExBcsB0BWecyBYcESHyBYoBIKOQGkBBiCSkBcQiBmBiBE8BsB2Bc3BaOVeUecLIwBkBgBOYgBMCScHCQ6BSwBdkBlBwCFNkBeyBeSJQckBmBWiBH0BMAiBvBUiBKsBPiBZ2BPSGoBTkBSYFQOcfPhBXZVBGZnB/BERyBjByBTwC7BSAgBPKT+BVqBW0B2EJ2CIwBMMJWe4CWYUfEnBQHCZYhBC5B|u5Sw/EbAzCsB8BM4BlBDR|2pVogF/BGNKEYsBJed|srV6gFJLvB4BLmBUAYzBad|8gT4/E1BPHIGWaoBgCYIQ4DYYHXP3DvBpBtB|6zS6jFWRoBGQb1DThBAWkBiBCSW|69S6jFJjB/CRzCIBY0BMoBRqBE6BY|4nVqjFCLxBa5BuBKGcP0BdQT|ohSumF6DFOa4DdWpBgDLwClBpCXlCa7DC1FqBZHzDcLa5BGsB8BsCDwCdIV|u1TynFfrBFwBYuBOTAd|4/UsmFRFbYboBNyBKGGTyCrCJR|+3UipFfFJRjCdhBA5CkBGU6BJiBGKeICIhBkBESWkBYHmBmBAOJBjBVlB|wmTitFXTrBMLagCEQV|+sT6tFYvB1BalECOkBwCCmCR|o6UgrFTRZgChCwBtBSSQ0CvByBtBGhB|q0T2xFSnDiClB0BkCqCmB6BCmDtBkCLmHxCwC/BIlBsDnBQhB7BFOpB6BpBoBjCmBCBbwBLRLkCZHTpBDPQ3DS1CsCf4BzCc9CnBItBxBVjBKhCC3B0BhCOPRvCBa0BoBSPmCd0B7D4B1BE/C8BRfZFNYAcvBgBkCWuBAFQ9CAXmB5BMZgB2CQgBUoDZKX|wiT62FzB9BvBL9BMhFLJxB6B3BiBc4DWFbbIblB3BX+BxCLV4BpCApBhBRXWe0B9BXPSIYtBmBE+BpBTIlFpBJZUS6BJ+BZATsBaqBI0BuB6D2BwByBTyCHoCCgCwBMP|spTo2FD3BfGJlBahBRHZoBRyCM0BWYEjBmBFGZ|07RqoFlCB1B2BxC0BrC6CvCqE5B2BpBoD5BqBf2BvBkBjCmCFgBuEN4B9B0ClC+BlCgCA2BrBkB1ByBdZzBkBVYBKrBWjBwBFenBPvCBhD|4zS03FoC5BrCHVrBE5B9BrBB9BXhDJWnCbZmBtBEfUrCVVepBD1BIJ2CfSd2BJ4BI8BmBqBwBVwBMO2BoDamD0D2BiByBuBgByBaAiBfCbgDlBDXrBDMfvBVjB3BwB9BLd|4kT6kGKtCV5BVgCdfUtBRdrCkBRuBUgBnBeVbdEtBjBLSa2BsCqBWbwBQKeuBCDwB0BdK3B|uqQsgG3BNdyBL8CeoDsBhB8BvDJjCZR|kuHooG1BHJGSSBYmBIMBBtB|+/SyoG9BvCnBsBeiBGoBkBEJpBuB8BF7B|g1S0mGzC7BesB2C0CgBgCMzBpBjBhBrB|47S6rGmBTqBABbdZnBTC+BJgB|gjTqsGSnCxBSS9BdNDuBRCJoBmBFBYlByB8BBSX|i7SkuGR1B7BwC4BBWX|06Sg5GoBRUQGPJZWtBR1BlBTJzBOxBiBHcIwCjBFhBWPHdvBgBXiBRXnBmB5BJfOEcUQTOHVfkBJcB+BaVGkDW6BmBA|6kHu4GPP1CBDcKK0BBgBDMN|muG43GTLjBMjBWIQaE6BHiBPMRtBA|62G47G4BJIKyBAmBPSCKXkBCBTcBgBVXZdOxBALLZDHQVJZrBPKDSpBMlCAdLhBUGUsDNWObcAYnBKOSmBB|2kSs5G3BfzBUB4BgBcmCSkBBOXbbNjB|+wBm6GJLPKCSJWOSBUqBRaftBZ|0oGwhHaV8BG0DxC8BLDRuBDwBZFNrBHxFFqBkBZSnBEVSPkBjBB7BQTOxCKVMYQ/BEtBhBZAJPfFZGiBUOWcOgDaqDF8BV|+sGwjHPBPkBXSOqBUDWzBAlB|s6SyhHbzBhB2BHwBmB+B0BwBcRvBtE|ssGmpHlCLDYoCECP|o1Tq4HKVjBnBbWfPRjBnBSAekBmBkBHacuBN|ktNq7HpBZGRhCZdIPakBEIOuBA6BS|s3Mu7HkBViDBBJiBIHT7CFCMvCMMc|inMugIXxBKTNfvBY5DoBIgBsCFyDM|u6LumImBtBJzCbEZVXQDuCNkBkBBgBU|+hUq+HXzBMfhBtBxCdvDD7CnCpBYBwBvDNrCdpCBgCtBpBtDpBZfYQ6BnBUZqB8BUiBoBgCiBwBsB+DSmCLiCyDqBfkE6CoBuCLoCcoBkCMiB3CBzB5B/BAhC|k7LqoIVxBbOPqBOYoBYM1B|6nUssIuBNsBaOnC9CP3B/BjDsBjBlClCBJgCgByBkCCU6CSyBsCjCwBT|2oHkxIuBJ8BCfZXDxCcPUaUWd|ssHm2IdAzCU7BeWG2CPgCbCL|gxDg1IfHpDcTY3BWLShCMXiBGQmFf2BzB+BZcjB|43Hs5IpB3BoBWsBNVV4BReQgCTTtBsBKcpCZ3BdBpBMO0BRIpC3BlBCuBe9BQhGBHUoBWbS0BmBkCmDmBkB4BWeBtB5B|y+CigJ+BGTnC4BzBXAnBcXefULcEUeH|qnUw5IgCxD9CWnB7C+BhCBtBvBoBpBxBL2BI+BHkCOyBE0ClBgCG4C6BcXecKmBnDA/Ba/B|u6Kw8IxDlB5CK0BkChBgCoEwC2BEkCnBhBrBKtBvB5B|shMojJlBzBjCkBHa+CWUf|g2BomJ/BXhBQHe8CgBqBDaT1Bd|giLopJjCjCmEIPzB5B5BiCD+BxCsBJ6BhDuCLHpBfRYhB3Bf1CAtDRdMpBd5BItBXhBM+CkC6BOjDKTakCUjBiBMqBgDFKmBrBoBtCKPSYcVShBdD+BfgBYiCyB0ByBDuCE|6c6rJlBJxCegCKyBFGX|upGqwJXhBbGRUcWaAQN|mkGuxJpCjBtBCNQwBe4CABL|yQyzJmBLoBG0BPgCH1BVnCa5BDNGEY|29Fq3JMbgBK0F5BGfwBGuBV5BTjDQhBc/BhB7CfVkB1CF4BgBIyBW8BuBF|grK+4JPpBoCrBxCvBvH3BlIe+BcrEgByDMBSlEQqBoBiDKkDrBgDkBwCRqDiBqDD|owGq6JnCDPgBckB6BIyBRCZxBb|gKm5JqBPNuBuFJ8D7B/BbnDFB9BZN7BCvBWzCUPa/BMpCJhBYOYrCPcdjBbAgI8ExBoF9BDnB|2oFm+JnBV1CUzBH3Ce6BUsBcqDd6BlB|gwW2hKlCDLUyCcArB|0C6hKzCDAsB+BC+CRFJhCN|8yFg/JAhC2CyBsCnBRvB+BrBiCuBwB4BCmC6FN2CfEfvBhBuBhBHd9DtB5CJhCURf9B1BRbpCrB7CDzBZDpBpCHtCzBlCnCXxBDrC+CJ6BrD6CM4DbgCXuBdwCRkCZuFJJ3BU/BuBnCgD7BwBUkBiChBmDtBgBoDeoCuBkBsBFqBrB4BtCwBsCiCb6BTkDsBQwFX0BQqE5BUZyDDB1BWvC6BJuBlB+CkB8BmCqBesG3GZnB2CjB6BjBmDRoBTa1ByBHaXEnC7CvBpDVvCzBrDJpEMhFD1BtBvCblFvE2BMmD0CmE0BgDG6Bd9BrBqBzDyCfqDIgCoCGtBoBXtCpBtElB/BZnCtBvBGB2BuD0BrFJKTjCflEnBjBpBHJAhBUhBaBFYUNFT5FZ1BR+CMUL5CTnBACITRSBNtBtBxBDQjBUOhBOLCX3BrCFCUsBfYH2BLbMnBnBIqBTE7BSDQ1CpBvBhCTpBjBfDfXJVlCpBhCjCJtBMrBW1BctBAbepCDjCPlBTHfGJcXQnCgEMsBRiBxB2BXK/BdrBiBnBQnCH3BGxBDZHMRBZONLHXKXLtBCvBiB3BHtBOnBD1BP5BtB/BbhBdPdCpCOVjBlDL1DgBhCMxBqBtBQlBYdkCRaZ6EkBoBKoBaQmBG2BKSwDgB+CCQLBfhBlBPlBMLZtCPSNBCJMALrBGJJ9BNRJBNVWJEIaJOMgCHeCcOkBHeImBJ+BjBQRHTGXVvBEpCJFBrBLPCRarBuCrCBNgBCSPgBEiCeWUkCNcJuBlBgBBwBuBaGOsCkBeoBAGOyBFqCwBgBeWDSPPlBjBFUdAhBbjBYzBcEOwBTWDwBwCaHeWUWrBuBBqBjBCT+DGkBdyBHiBUCS8EE1BTWdyBDwBfMxBgBAkClBoBpBAfaB6B1BuCLGM0BEkCRmCVkC1BKZWE0BzEiBJCtBvBzBUTwDJC/ByBqB6F9BgBjBLjBsCU8DhBgDC+CzByCnCyBR2BDWTiB3DZpD5DhEpBnCvB3BPBRtBG3DZtETXJ1ChCzCJhCzBbPlBjCAlDXrBbnCTrCxB1B/BJvBMjBL/BNftBhBlCvDjDxCd7BpBlBbnBnChBvBMhBH5BcrBBnBkBDhByC1BJrBoBbBf9BxC9ChBhENlCIOnBNvBMflBVhCH7BWZPK/BqBRkBUShB5BTzBnBJ/BNhB7BAxBhBTvBgCtB8BNV3BpCjBpBrC5BXZdUjCqBjBzCE3CnBJ7BbAnCU3EyCToBSmBfqBHsDa+BkCyBhDS+B6BWqDmCXiBmEpBQTvCpBKqByGesBR+BFoCcCyCuGcgDNgDS0BHuCmBwC0BuMDqDN6C/BkBFa9DiCzDkCvBoBb2BMS1B0C7D2HZcTwBxBqBtBaUcd8BUuByBoBiBwBNcXdlBcOSL6BWKMoBYqBDawCmBJUYGBgBOWgBE0BqCXQMkBN8BOQJ2BvB0BNkBQQPELWfSbDLVnBRFNehBZRdDLmBHJVELYlCMBNpBYNOGahCkBDSPMETNNNSTGJMKoBRKOM7D0DGKKJGGLUREHNjBAxBUjBExBYnBC/BmBnCmChBUzBQjBDzCdxIgDjCwBlDYZelCkBfoBNgBUGFSOQAYvB2C3BgC/ByBfoB1BaLOKoBhBQlBePuBhBEhCiCDUhBwBVwBAYtBaVBjBSJZQvC6C5CKVKCOpBoCnCW7BkB5BEfeByB5BBLZXLAPoBpBkBvCwBCuBJiBpCyBHJPSnBQlBkBgBCYYCcxBuBlBSrCkEjB6CpBmBdIHSjBEVQ7BGPKHkB9BgC1B6CEOtCqCJ2BhBiBO2BB2BTyBY8BQ0DL2ClB0CIM8CViB7BQSJ0BV0BxF6CzDcjB4BKoBxCaL0BrCuBBiBjBY3BUR4BxC0BhB8BjFGrCSjEiCrFkB5CF9DerCalCLMtBrDP3BVnCNHmBc+BkCURQxCjBrBpB7CtBwBd7BtBlEtBPdjDfTdpCbrBGxF9BtDRJKkEyBkCkBwCGgBa2EqCKyBiBkBpCRVKhBVpBgBPXXgB/BZnBAFoBMWpBYxCLhDsBAkBxBcakB0BkBWiB0BEsBJ0BeuBDwBULcjBMwBYpDNTNxBO7CH9CQZaxCkBqH6B0BAHfmEEzBoBtCYtBgB7Ba3CUiBiByDCyCeOeiCgB4FkB6BFiDiBiDLuBdcMsDBDPiDJiCG0JhB0CK+IrBmDdiCF4BauCU+CHgDcqDQsBZuBOQesBFsD5B0CsBKvBuCKYSuCBiDb2EX4CJ+BE2Cf5Cf0DNsFI4BKkClBmCgBhCcqBWgEK0BPgChBoCEwDbkDK+CBHoB6BMiDVA9BoB0B0BBegClCoBpCaEmCsCuB2CJgCb2CnC3Bf2DL|2jEomKfduEU4ChBqCiB6BV0B9BgBatBiC4BKgCLoCX8BrDgH9BHbnDFoBXVXhHcpCD3DVzIPhBe3CS3BHvC0BuES6CD0CM7DOjHDhBY0EahDBvDS2BwBsBasFmBiCL|g3E6mK3BpBjDuBWI2CCwBN|qvGmmKGRpEElCH3CmBCWgBEyEFuDjB|86FqmKyBnB8B0BiFauDhCJpB+DS+BauEf4CdIb2DOkCpB6EX4BZ8B7B1Dd4EpBkDN8C5BmDDTtBvDpCvCcjD8BxCHJjBkClB4CbaRqB9BVtBxCQ/E0B8E9CMVtFapEkBtCgBYS9FgCCT5FJ1BWqBwB8HKTWWgByC+BRcXWhDgBhEWqBQjCoB3BCzBWhBRzDHnHOvHczBWiCe5CAViCyB4BiCamFSvBpB|q/E2nKsCNyDIQR7BdiDbL5BpDX7BErBa/EwBCWiEHlCqBsCe|mnUumKtHK8BYwCG6CXIP|0tFylKlCvBnCCnB4BAgBiBcgCQmEB6DP/C3BrCL|i3D6iKnFfhBczEiBoCqC4BqB9BmB4GK6CLkFDkEtBtH7BvCtBAZ|u1UmqKpCZlDG1DaOU4IZ|4sF+pKhBX7CEtCSiBc8CS4BXWT|mqUkrKxBvBrHCpDN/DoBiBsB2CMoFBoHhB|gjFutKwBdCfbvBpDFjCKAmBnDFDyBkCBiDW6CDEI|yvEssKaV4BKkCBKflBd3GJhFbhDAHUmEchJH5CM4C+B8BS0FTyDlBwDF7C+B6BWiCFWf|i7OuhKlBFvGIRezDQHiBgCOBkBgE2B7BI6E4BReiLqC2GMuDY8DIsBZpBTlN9BnG7BjG7DO1B6DzB|0qFmuKoCT+DA2BVNXyDb0FJmDOqHCkCXOZnBR9CNxCI7JJxIcViBFgBhCcjEIpCUYakED|0/DqvKJxBvBV7BD3DZlDJ1COsDwBkEoBiDA4CK|+9R+tKSf6BQ6FAyEfyBXPhBtH1BvBRuFZ6BMgBnBcQmDKuGJQdqIJEyBuHLoDhBenBlBbwCxBkDZ+BkCmDduDS8DTuBSqDHtB6B0CciSpB2BlBoFvBiIMgEJ2BZHvBuCR2COyDA4DL6DIuD5BwCUzBqBecsGRkEE4Fd6CbA/HxCbzCE6BhBmBzBeRIZRP1DOzFvB3BH/FzCVd7CsBnFxBbY9Bb1CKTpBrC9BCZoCNH9C7BBb1BcbvDfVpC/CNThC7C7BXsB9BsHe6C2BmBEekDOgHyEyD0B0B6CtCFlBzBhFnCzBwClFV/ErD0BlBvHXEuBjDKvCfhGMzGTjOzIkDHgBnB+BNqBgBmCD8ClCC1BxB/BFtCblD/C7CVrB1G5F1ClBnBAnBe1CtBJVXEbVTVEtBhBNjBdpBJbRBbHF+BlB4BrCQpBApCXhB5BNzBZ3BFHkBMwBbiCwBMrB2BfMHLRFBMhBQSeOGFMQiBDMjBGdS5CTvBdjCPiBeNYyBsBhBgB1BVpCrBlBpB/BBfdiBrB0BJCdyBRoCuB6BZoBAMhB7CRdhB9BfftBkChBa/ByCrDAvBpBPQhBmBTZnDjBFhD3E7BrCvFxDpCHlBbVWjBf5CfjCJVjCjBDPuBQa1CUdJ1C3B1B7BNrBuD3E6BlBmBzBe1DJxDzBpBpCnBzB1BvC7BXqBSqBtBmB1BIZiBfiC5Be1BBIyB3BADlC3B1EEtBqBBa7BM1BkBlBmBF2CtCarBEpBFdK7BWRa3BBVrBDnEiDHiBlBqBH2BXiBIuBNcZYJgBhCiCJlBLkBamDFwBSwBTmBEmCZgBf+Eb2BxDtCrCUWwCN8BxBqCIWjBItB0BRiBPgCbkB5BEGZTjBbMJLpBOJXpBCvCNEvBhBlB7CrBnCpCvDxCAd5CnBdBRxBQnEZ7BBtDfBdxBUT5BRVrBZR7B8B1B6E3B8Cb4D5B4CtBuGAsCL8B7ClBtBIzCuCgBWTapC2BvBQRuBxByB3JVlIqBbuCdMxBL/BftCWhCyB7BS5CyEjBJnBUXXlBCObFNuBnDgBNKVsBbEZFVsBrCDuBQiBSIUTAlBNlBOXKCCPyBK8CD4EyEIFPlBKxBcrBkBX0CTuB5BYHANhB3BZTXrBdCNNJfIrBFHdAlBXHdNNnBAXPAZfRhBGrBTrCVNxBlF3B3BtBvBAlBZnBLlCHNPPDJRhDDPmBCkBViCTaOCHeIMBcHcTSDahBYhB0BR2BrBsBbKrB8BD0CjBmCdajBMTkBEQRgBTOXwBnCgDfAU8CRZfxCPJxBwBrB8CHFchC2CjFsBnC6BlCLLCpB2ClCU9BNLKhCWrC8BnBmBpCS5B6D7CoEnEBZjBNwBdMZebgBA8BQmCIuDkB6BE+BQeWaAF3CLXRlCnC3E1B9C1BnCrC3C7GjFlCrCbxBtBZPZXDHtBTZNpBZVbtCEjBoBXCPRnBAxBwBlDYNKbI7GMfrB5CpBnBhE3BnCjCXLtBtBZNFtBgBvBM3BMCB9BJdOLHZbVhE3BbXGbQDblEPb5BpBvCtD1DpDvBbjCZfBHRlBKfNlCOlBHbChCX1BJnBXbBbWVCZcDHHQAmBTqBUMByB3DmGvBwBXuBzBwGBsCHiB5BwCvB2DzB+BJ4CK6BuBuEoCiDE0CTWfuCYmBhBoDfqBGMZkC/E4FlBiCsBoELKe6DXsBdKLcPKAShCXXEZNxBAhBoBVwBtBqB7EH3EzBjBV5BR3BSzDKrCJrDpBbAhCgBvD0CrBoB/BefkBTmCzB+BhBWPqBzBmBbENcTMNgCIcZyBfWcMuBuCFkBSeI8BNgDGgBPehBcG4BYSWiBDWWsBiBoBWMSkBAiBYoBqBYqBgCgBa8BIyBsBgBQ2B2BPwCgB4CqBsBwD4B+BoDwBAmBZ+BE+CP8BkBmCKoBc+BS2GSgBJ8BamCAaPqBEmCauBHBf2BYELffAdWPH1BpBfMjBgBAQfaJqCVcG0BJ2Cde3B0EnBkCdeQgBePwBUgBuBesBI4CNWbqDRQV2CC6EtBsCmB4BGuBHSfOU0BNyBDeQUWDCQeOwBiC2DFwBQaXeYYlBF1BOrBjBhDHzBkBjCCNbtBF9BiBjCBlBgCvBkBgByBpBeoC8BiDEcwB6DHsCqBqCSqDAwDrB8CZqCK4BFsCiBKcPsBlBWjBInDqCpCY1BmBuBK0B2BhBY+CaBOrDNrBV7BB1BXEnBePiCELVlCL3CjBjBMQelCSKO+BURQjDQDY7BHXjBxBvBCPdNTGRrChBbVtBc7B4BTLPrCDxC1BTeCMnCItCPsBjBfJjBAhBgBLNOlBgBdXNkCvBAjB5BQSfnBFY3BpBB1BchB+C5BiCPkBjBWFeOgCpBkB7D8B7BSzBwBMEdcAUpBKTZRUCWQIxBKzBXCfHRWf8BfgB1BoCxByBAONRNqDpB2BhBGLLVhBe3BKbpBuBVFhBbDhB1BZFO2BMOrBmCZIRapBMbavBExBelDuCT+BzCebJlBbZF5BjB9DS9CVFlBCjB7BrBxCNFTnBjBXzBajBlBdNnBvBNtBvBtEAnBXXXfGXWRkB7BKXPhBIhBFKyBFoBbEPaGqBYWSgCPoCEuBbc8CuBoHV8ECiBmBM+DhCkCvBgBhDaFuB0COqDPToC8Bb2EyBS0BsDaiBS4B+C2Ca2BBMO2BEMNsBgBPYBkBZkBBgCcmB6BEWQ0BSDfRVIPiBJPXRGtBtBSfAXgCNAXiCMkBSoCZeTgHmCgCJEP+BAOc6CUN2BCwBgBoB8BWyBvB0BCU2CXHnBYFkBiFckCLiCCqCkBjCezDD3GlBlBkB9BUOgCd4BemB6BoB+F0CHa3CetDR9BrBKnBhHpDtB5CuBtB8BhB5BnChCPZrDjB7BtCGjBxBpCBT8B1BoCvB6CrBoB9DpCzCN5CgBVkCT0E6BqBqF2B+DiCuI0G8IgEsEcqDDgD2B2DByDMoGtBxCRmCnBiCWqDlBuFPyHnCyBdErBlCfpDR9IwBtBHoDtBI/CkEjBKgBnBcqBY6EnB2BOrBwB2E+B8BD6BVmBsB1BmBgBmBvBoB0FTkBjBvCHAjByBVkDOOqBmL0CwBB9BnBuCFuBW4DCgDaoClBoCqBhCmBiBU8FR4CToHpCsBiBhCiBBMrCIUehByBBU2D6BqB6BwBMqFPMjB7BzBoBTUrBN3CmCnBZpB9D7CqCHYWmCQSgB4BelBmBeqBlCEPkB0BgCzC0B0DsBPuBgBAiBhBZ9BkCLbuBqDamEC2DjB3B2BHkCwDM6EBqEIzBiBqCqBqCC8DeqFKUSqFE0BNwEiB0DASc+Ba2EauDT1CPwEJ|oqOymIgBtBeBUR1BDVnCXPCfUtB+BNsBf6CLkDSGOJuBIiCxBWQsBpBEO2B8BP6BUvBoBRkBzBPFvBX6BQaLWpCWb6BjBQBW+BHCwB2BK4BJMgCLmB/BB1BQlEpBblB9BJ/BjC6B7BFpBoDtD|qsFivKzECRSgEBuBLHF|0rEsvK3DR9CU0BW+CG6CJVT|u5M2vKtEZxDQsBQlBUkEOaX8CP|2sEmxKtCLpDAAKiCS2DP|qoFkwK9CNzBQbYDa4DFsCXRV|8/E0wKaZpDInDUvEC+BUrCOFasJfwBf|k6R0wKnLZ0D0C2BIyGnBTZ|wsMszKyGtB/EZjBvB3BLdzBtCBpEmB6BY/CS7D2BxByBuFWkBV8CCYW+CCwCX|86M60K+DV9ChB5FH9FKJS7CClCcmGS8CPgCUiFP|ouOk1KtENJJpCLlCQkBUtEC+GMORkBQ8BKgDNZH|8vR4xKrEHxFSpDaxBuB1CMmFsBqEO8Df0E9BP5B|+5FqzKuCT3CT1DvBxDDjEIjCaAYyBQzDAlCWpBc6CwBgCEbQ2ECyChB0GZyBpB|g/Gm6K0JL2DRDP7Eb5EN5BNsEA/H3BtDzBjELnBLhGH4CHrBJ0Bf7BVhDRfZ3CRIPuDECPrFlBnFS7FJ3GKHe2DQduBmBEsFb3CqBnDM0BYyDQSW5CabgBiHJkDYvEI/GDxDUzBarCUNWoJY+CYwCDkCRyBkBmGQkGEiBH4FK2IH|6xJi7KwMzB1DXtSJgBJkHGgGV8DU2BVlClBiFY2JYgGLkBbjIrBjBPrGJ0ED/D3CCnCuCnBjDDpDT2DhBQ1BjCFyC3BtEDqCZTVzFJwCrBAb9DafP2CP0CnBYzBxDL/D+BWrBrChBiIF5KpD7FVlCAhCX3CjCpEtB9Gf1BnBBtBfpBnDxBaxB9BzD5CD9C0B/DA9BkBrB+BtDwCfqBJ6B3C6BWwBpBWgCqCgDYYcOyBlFpBtCWDqBaiB6BCkERnFgC/BJ1BQoC8BlBY/DwDxCYAcrFkBnEGlKH5F8BoFUiEExIQxEaKa8O+BaWtFY4Ba+GsB8CGZe4EQkGKmGAmCTqFkB2LxB3EiBKc2GmBgHByCYiHGgQH";
  const BORDERS = "gwW8zEAfxCbHY6CkB|osWgxEQKWRJhBnBHjBIFcYWeH|6rNkyFyHpEGlB6C/BbtCEjBoBXP3BAxBwBlDYNxBlBlCXnBAVR9BJrCSvBFR4ChBwB/BM/D4BjBwCjBkBNmBIiBL6BaEgCmCR8BSIEmBZkBYIoGE|22KqrHBxDxGECjF7BFPfM9C5HCNVCcyEEiB0BU4C6CmCewCUEUyB2BI0BHWOoBCBiBKA|qyDg2IxF6CzDcjB4BKoBxCaL0BrCuBBiBkBeBoBtDqBnD2DlD4BhBgB/BT9BjBlDmC9BS/BCA6SgJzB4BauCU+CHgDcqDQsBZuBOQesBFsD5B0CsBKvBuCKYSuCBiDb2EX4CJ+BE2Cf5Cf0DNsFI4BKkClBmCgBhCcqBWgEK0BPgChBoCEwDbiGIHoB6BMiDVA9BoB0B0BBegClCoBpCaEmCsCuB2CJgCb2CnC3Bf2DLAhC2CyBsCnBRvB+BrBiCuBwB4BCmC6FN2CfEfvBhBuBhBHd9DtB5CJhCURfvCxCpCrB7CDzBZDpBpCHtCzBlCnCXxBDrC+CJ6BrD6CM4DbgCXuBd0ErBuFJJ3BU/BuBnCgD7BwBUkBiChBmDtBgBoDeoCuBkBsBFqBrB4BtCwBsCiCb6BTkDsBQwFX0BQqE5BUZyDDB1BWvC6BJuBlB+CkB8BmCqBesG3GZnB2CjB6BjBmDRoBTa1ByBHaXEnC7CvBpDVvCzBrDJpEMhFD1BtBvCblFvE2BMmD0CmE0BgDG6Bd9BrBqBzDyCfqDIgCoCGtBoBXtCpBtG/BnCtBvBGB2BuD0BrFJpBkBA4CdSpBJVQvBvBpBtCvBNFP3GAnD9BTZ5DAbJOlBzCfhCJpChBtBSiCmDbyDhCeIMbIPYbDEGPGFS/G6C5BRjDQxBJ/BUtDORMLiBVAAXr3BA|ggG8wJwBe4CABLpCjBtBCNQ|uoG0lKlCiBCWgBEyEFuDjBGRhHA|snGmwJYSaAQNXhBbGNY|4sF+pKhBX7CEtCSiBc8CS4BXWT|qsFivKzECRSgEBuBLHF|wmFyxKsCXRV9CNzBQbYDa4DF|23F6oKxIcbiChCcjEIpCUYakEDoCT+DA2BVNXyDb0FJmDOqHCkCXOZnBR9CNxCI7JJ|wpEqwK6CJVT3DR9CU0BW+CG|iqE0xK0CNtCLpDAAKiCSiBB|64H06IrC/CoBWsBNVV4BReQgCTTtBsBKcpCZ3BnCKO0BRIpC3BlBCuBe9BQhGBHUoBWbS0BmBkCmDmBkB4BWeBLR|ogGo2JuEpBGfwBGuBV5BTjDQhBc7EhCVkB1CF4BgBeuDuBFMbgBKmBP|uqG2kK+BamH9BIb2DOkCpB6EX4BZ8B7B1Dd4EpBkDN8C5BmDDTtBvDpCvCcjD8BxCHJjB2FzCqB9BVtBxHkC8E9CMVtFapEkBtCgBYS9FgCCT5FJ1BWqBwB8HKTWWgByC+BpByBhDgBhEWqBQjCoB3BCzBWhBRzDHnHOvHczBWiCe5CAViCyB4BiCamFSvBpByBnB8B0BiFauDhCJpB+DS|grFooKmEB6DP/C3BrCLlCvBnCCnB4BAgBiBcgCQ|qyDosKsDwBkEoB6FKJxBvBV5InB1CO|y+CigJ+BGTnC4BzBXA/CuCLcEUeH|g1E0yKsJfqC5BpDInDUvEC+BUrCOFa|gxDg1IfHpDcTY3BWLShCMXiBGQmFf2BzB+BZcjB|+0D8oK6CLkFDkEtBtH7BvCtBAbnFdhBczEiBgE0D9BmB4GK|swE2rK4BKkCBKflBd3GJhFbhDAHUmEchJH5CM4C+B8BS0FTyDlBwDF7C+B6BWiCFwB1B|+yEkmKoCX8BrDgH9BHbnDFoBXVXhHchGZzIPhBe3CS3BHvC0B8Ja7DOjHDhBY0EahDBvDSiDqCsFmBiCLfduEU4ChBqCiB6BV0B9BgBatBiC4BKgCL|k/EulKlCqBsCesCNyDIQR7BdiDbL5BpDX7BErBa/EwBCWiEH|6yEmnK2CCwBN3BpBjDuBWI|gjFutKwBdCfbvBpDFjCKAmBnDFDyBkCBiDW6CDEI|+nFm1KuBUgCEbQ2ECyChB0GZyBpBuCT3CT1DvB1HEjCaAYyBQzDAlCWpBcsBc|6wF63KoJY+CYwCDkCRyBkBmGQmHD4FKiOL+HZDPvL3BsEA/H3BtDzBjELnBLhGH4CHrBJ0Bf7BVhDRfZ3CRIPuDECPrFlBnFS7FJ3GKHe2DQduBmBEsFb3CqBnDM0BYyDQSW5CabgBiHJkDYvLExDUzBarCUNW|yxG86JpBRnCDPgBckB6BIyBRFjB|wnFg/JmBZnBV1CUzBH3CemDwB+DpB|+mH43IWG2CPgCbCLxDU7Be|goHiyIWdqDHfZXDxCcPUaU|qyDg2Is3BAAYWAMhBSLuDNgCTyBKkDP6BSgH5CGRQFDFcEQXcHHLiCdcxD/B9CGPWJwHsCNmBcK6DAUaoD+B4GAGQwBOqBuCwBwBWPqBKeRA3C0B3BpGnCrBzBAhBUhBaBFYUNFT5FZ1BR+CMUL5CTnBACITRSBNtBtBxBDQjBUOhBQLAX3BrCOuBfYH2BLbMnBpBKsBVE7BSDQ1CpBvBhCTpBjBfDfXJVlCpBhCjCJtBMrByBjDAbepCDjCPlBTHfGJcXQnCgEMsBRiBxB2BXK/BdrBiBnBQnCH3BGrCNMPBZONLHXKXLtBCvBiB3BHtBO9CT5BtB/BbhBdPdArBQzBZB/CiBfqClBmB1BwCrBazBBpBxBzBUhBSjBmC9CmCvDAAZxFAxHsCGM5ELJgBpBmBdIHSjBCVS7BGPKHkB9BgC1B6CEOtCqCJ2BhBiBO2BB2BTyBY8BQ0DL2ClB0CIM8CViB7BQSfoD|mxBm8GmBlB3BlBPKHoBOSBUeL|ib4sJyBFGXlBJxCegCK|y1B+nJqBDaT1D1BhBQHe8CgB|guCu/JA5SgCB+BRmDlC+BkBgCUiBfmD3BoD1DuDpBCnBjBd7CsBR4BxC0BhB8BjFGrCSjEiCrFkB5CFpG4BlCLMtBrDP/DjBJmBe+BkCURQxCjBrBpB7CtBwBd7BtBlEtBPdjDfTdpCbrBGxF9BtDRJKoG2CwCGgBa4CoB+BiBKyBiBkBpCRVKhBVpBgBPXXgB/BZnBAFoBMWpBYxCLhDsBAkBxBcYkB2BkBWiB0BEsBJ0BeuBDwBULcjBMwBYpDNTNxBO7CH9CQZaxCkBqH6B0BAHfmEEzBoBtCYpD6B3CUiBiByDCyCeOeiCgB4FkB6BFiDiBiDLuBdcMsDBDPiDJiCG0JhB0CKmFb|yQyzJmBLoBG0DX1BVnCa5BDNGEY|42Qu2IxBpBzBFDhCjBb9DWtBzD/EnB6BtDrBREjBlBKfWpGKXH5CcjBNJlBpDWpBHNb5D5BbtBXAPexCCN2BdAEgCrCuB5FN7B6BjFsCjFlBCrHfDtByBpBSpCLbVDQQaLWpCWb6BjBQBW+BHCwB2BK4BJMgCLmB/BB1BQlEpBfKGgBnBsBvBB1BsBkBwBRM0BoCgClBIuBmEmCkDC4GlCkCamDCyChBSU6CBQenDsB+BeLS8BQtBsBeWwHWeQgFY6Ba0DNUhCiCQyCVDhB8BCiF+BXTyCxBuEhFiBgB4CjB8CQkBLejBuBLab0CIiBlB|+3O0mIBsHkFmBkFrC8B5B6FOsCtBD/BeAO1ByCBQdYAcuB6D6BSH1BnBwBXuBQsChBxCtBrCEHSMezCPzBrC1BEPdwBNOvBjB/BzCOAmB3E8BxDqCfiCTMlCDXOHyB1CiB1BlB1BVKfnCA|giU6uFmHxCwC/BIlBsDnBQhB7BFOpB6BpBoBjCmBCBbwBLRLkCZHTpBDPQ3DS1CsCf4BzCc9CnBItBxBVlDMBiN|o5U2sFaTGhBTRZgChCwBtBSSQ0CvBYZ|02UqoFjCdhBA5CkBGU6BJiBGKeICIhBkBE2BuBHmBmBAOJBjBVlBfFJR|w9UqpFyCrCJRRFbYboBNyBKGGT|giU6uFChN3B0BhCOPRvCBa0BoBSPmCd0B7D4B1BE/C8BRfZFNYAcvBgBkCWuBAFQ9CAXmB5BMZgB2CQgBUoDZc/DiClB0BkCqCmB6BCmDtBkCL|+hTmiFIfpBtB1BPHIgB+BgCY|u0TmmFFwBYuBOTAdfrB|4zSo8FjB3BwB9BLdoC5BrCHVrBE5B9BrBB9BXhDJWnCbZmBtBEfUrCVVe/CEJ2CfSd2BJ4BI8BmBqBMpBqBjBqBMqBDkBgBgBG8BR0BOgB4CaWWqCgEL|4qTsuFmCRYvB1BalECOkBwCC|4lTusFrBMLagCEQVXT|8nTs4FEjBmBFGZD3BfGJlBahBRHZoBRyCM0BWY|89S41FoCCgCwBMPzB9BvBL9BMhFLJxB6B3BiBc4DWFbbIblB3BX+BxCLV4BpCApBhBRXWe0B9BXPSIYtBmBE+BpBTIlFpBJZUS6BJ+BZATsBaqBoB0EOa2BwByBTyCH|y4Sw/EzCsB8BM4BlBDRbA|26S+iFqBE6BYJjB/CRzCIBY0BMoBR|w0SojFoBGQb3ETWkBiBCSWWR|ghSknFIV6DFOa4DdWpBgDLwClBpCXlCa7DClEkBvBGZHzDcLa5BGsB8BsCDwCd|44R6xFKrBWjBwBFenBPvCBhDlCB1B2BxC0BrC6CvCqE5B2BpBoD5BqBf2BvBkBjCmCFgBuENqGpGgCA2BrBkB1ByBdZzBkBVYB|4+G4qC4BtC0ClB4CPbf7BDhBWpDCAwE|40Hy3DhBzDC/BNNJrCyC1BJrBoBbBf9BxC9ChBhENlCIOnBNvBMflBVhCH7BWZPK/BqBRkBUShB5BTzBnBJ/BNhB7BAxBhBTvBgCtB8BNV3BpCjBpBrC5BXZdUjCqBjBvHWbkBCwBpBDVYFkCwBcUoBFgBiB4BW0CFmBcMHYbMUcbYPqCaMJuCgB8DmBWTgCA6BwBqBA2BkB+BA6BPMduDoBiCF+BW6BqB8BuBoBTaOUBqDkCgBWiCFQ0B6B0CNmBvBY0BqCBgE1D0BJuCvBiCXKb/BhDoEb0BM6BwBK4BgBMgBjBBzB/C7B9E1E|4+G4qCAvEqDBTZ3BT1FkBxEmC3CoCkHtCgBcUsB8BauBF|68G6wEgBpBItBiBbT9BiBnCY3CwBIGPVhCjCfCpDNTUZtBnBpB7BV5BG9BnBhCetDQLA5BjB9BA1BvBpBA5BU/BlBVf7DKtCZLQpCcXTbcLIXbLGlBVzChB3BGfTnBvBbGjCWXqBEBvBcjB2GT5BC3CnBJ7BbAnCU3EyCToBSmBfqBHsDa+BkCyBhDS+B6BWqDmCXiBmEpBQTvCpBKqByGesBR+BFoCcCyCuGcgDNgDS0BHuCmBwC0BuMRkGiBQQgB|2iNgrFM5BHhBOlBkBjBkBvCZGlDRTnBQbTrE+BlBSMEjCvBAxB+BxBKNiBlBVzBKVclCGDUxBEzCNEsCVYDoBImBLaBoBtCBGYfADLnBBX1BjBK/BNlB2BjB2C7FAjCNHUQGMsBYOQFWYkBAERYL6C8CB0Bc+BoCgCGUMuBG+CgBqCIyCaiBiBU+CtB+CRcsBeFmCeaLUCKOYG4CHWGmBzBeHyCUQZ4BrBDpCaHtBnBlB/BDzBNXAvBTRPtCQbEtC|m7N0wFlB2BBoHqC8CqBC4BuB0CC0FgGqC8CA+D0CSeWaAF3Cd9CnC3E1B9ChE/E7GjFlCrCbxB|s2N0qF5CgCFmBxHqEAkCoCyDjBqDdsB0CwCgBJAjBWVsBAyC1B8CJSa8BaYVsBA3BnCCnHmB1BtBZPZXDHtBTZNpBZV|k5MukGlCwBGoClBoBFqBXUAkBNaVDWyBFaUULOuB4C2BDB4IqCAAgE4XAU9BNLKhCWrC8BnBfjBvBLTRhBpEIXJ3BZ9BnBfhBrCdRRhCA5BAyBJAF2BfaHuBIwBdEDNnBDQRGlBjCxCfF1BkBXLFThBLBL/BAHMtBCXJRGrB2BtBHhB3CpBRsBZ|23Mm7GC9H1BEtB3CMNTTGZVxBWEOZAjBYTANpBLfZtBlC7BdvCBGV7BtBvCZbQLPzBDKQdmCbMjBmBMe0CDhB8BB0CZqBGenBAAqBbYc0CyC8BE0CYiEOaZWBWXQPkDiCiB+PzH|y4Gu7GC7BPJQTBRpBMlCAdLhBUGUsDNWObcAYnBKOS+CL|y4Gi4GCSPUQKB8BIKyBA4BNKXkBCBTcBgBVXZdOxBAlBPHQVJZrBPKDS|utWmiKyCcArBlCDLU|mqO6wIblB9BJ/BjC6B7BFpBmCrCxBpBbErBmB5BSTa7BOlBJLM1Ce1EWFHxC2BpCY1BmBuBK0B2BhBY+CaBO5BJCciBS+BGKUNkBaiBBSjEUlBexBJxCWCOVczBCDUQOpBkB1CDPNXCd+BgCEYORSrBKEMZMnBqBOSFe9BOhBHJQhCQZmCfOcUT8BuBmBJKqCkBjCekG2DaiB/CsBaqB5BuBsB4BpCoC6BwBhDsBKsBiH2BqDlBuFPyHnCyBdErBlCfpDR9IwBtBHoDtBI/CkEjBKgBnBaqBa6EnB2BOrBwB2E+B8BD6BVmBsB1BmBgBmBvBoB0FTkBjBvCHAjByBVkDOOqBmL0CwBB9BnBuCFuBW4DCgDaoClBoCqBhCmBiBU8FRgK9CsBiBhCiBBMrCIUehByBBU2D6BqB6BwBMqFPMjB7BzBoBTUrBN3CmCnBZpB9D7CqCHYWmCQSgB4BelBmBeqBlCEPkB0BgCzC0B0DsBPuBgBAiBhBZ9BkCLbuBqDamEC2DjB3B2BHkCwDMkJGzBiBqCqBqCC8DeqFKUSqFE0BNwEiB0DASc+Ba2EauDT1CPwEJSf6BQ6FAyEfyBXPhBtH1BvBRuFZ6BMgBnBcQmDKuGJQdqIJEyBuHLoDhBenBlBbwCxBkDZ+BkCmDduDS8DTuBSqDHtB6B0CciSpB2BlBoFvBiIMgEJ2BZHvBuCR2COyDA4DL6DIuD5BwCUzBqBecsGRkEE4Fd6CbA/HxCbzCE6BhBmBzBeRIZRP1DOrH3B/FzCVd7CsBnFxBbY9Bb1CKTpBrC9BCZoCNH9C7BBb1BcbvDfVpC/CNThC7C7BXsB9BsHe6C2BmBEekDOgHyEyD0B0B6CtCFlBzBhFnCzBwClFV/ErD0BlBvHXEuBjDKvCfhGMzGTjOzIkDHgBnB+BNqBgBmCD8ClCC1BxB/BFtCblD/C7CVrB1G5F1ClBnBAnBe1CtBJVJMAgBiBCIsCP2B2BWuCJsB+BWmCYYiB4BpDR3BZ/CAZ8BrCuBvDUXgC1CiE3BY/CUjFNzBfiBNCjBjBT5BjCAb5CpBrCYrCDhBUlBI9CtBvEZrEKlBgB/BgB/BIrET7CaLwBlEYlCcjCjCajB9BtB7ESpBejCC1BUhDd5D3B7CPhBmBzCHZctBMdkBjBM7CP3CkBhBftEiFxCyBYUhF9B7BBEiBxCWhCPTiCzDO5BZ/EXdPvHVdVuBrB7BPMR9BdoDrBPd5CCRTxCiBlDBjCZ3GmCjDBlElCHtB/BmBzBnCSLjBvB2BrBwBCoBrBFfgBJ|yjRi2KqEO8Df0E9BP5BrEHxFSpDaxBuB1CMmFsB|21RyyKiFjBTZnLZ0D0CmDE|29TosKoFBoHhBxBvBrHCpDN/DoBiBsB2CM|uwU2qKgFPpCZlDG1DaOU4DJ|4/T4mK8BYwCG6CXIPtHK|2hOm1K+GMORgDagDN7HrBlCQkBUtEC|u1M0gJjGIOc6CU+CVBhB|gzOwnK6E4BReiLqC2GMuDY8DIsBZpBTlN9BnG7BjG7DO1B6DzB1HCRezDQHiBgCOBkBgE2B7BI|6lUu/IW9BA/B6CxF9CWnB7C+BhCBtBvBoBpBxBL2BI+BHkCOyBE0ClBgCG4C6BcXecKQpB|kKu6JDnBqBPNuBuFJ8D7B/BbnDFB9BZN7BCvBWzCUPa/BMpCJhBYOYrCPcdjBbAgIkKvD|0C6hKzCDAsB+BC+CRFJhCN|8qN+vIQQiCPyBjBiCELVlCL3CjBjBMQelCSoCiBJI|iqGypHoCECPlCLDY|0rGumHUDWzBAlBPBPkBXSOqB|0tHqsCsCmB2BPmBa0BdTV1CRbW1Bdfe|qmMszKYW+CCiJlC/EZjBvB3BLdzBtCBpEmB6BY/CS7D2BxByBuFWkBV8CC|mmNk/J/EfauBxCYhDVftB7BblCQzCDlCiBlBRnBBJpB3DKRjB7BArDzDhD5CWVVX9BApB7BEzCoBhBTpCxCxCrBoB9DpCzCN5CgBVkCT0E6BqBqF2B+DiCuI0G8IgEsEcqDDgD2B2DByDMoGtBxCRmCnB|6+Mk0K9ChB5FH9FKJS7CClCcmGS8CPgCUgJlB|u5M2vKtEZxDQsBQlBUkEOaX8CP|wqIo5K2GmBgHByCYiHGgQHwMzB1DXtSJgBJkHGgGV8DU2BVlClBiFY2JYgGLkBbjIrBjBPrGJ0ED/D3CCnCuCnBjDDpDT2DhBQ1BjCFyC3BtEDqCZTVzFJwCrBAb9DafP2CP0CnBYzBxDL/D+BWrBrChBiIF5KpDhIVhCX3CjCpEtB9Gf1BnBBtBfpBnDxBaxB9BzD5CD9C0B/DA9BkBrB+BtDwCfqBJ6B3C6BWwBpBWgCqCgDYYcOyBlFpBtCWDqBaiB+FPnFgC/BJ1BQoC8BlFoExCYAcrFkBtOB5F8BoFUiEExIQxEaKa8O+BaWtFY4Ba+GsB8CGZe8KamGAmCTqFkB2LxB3EiBKc|8xP4yCqBT8BHCLRdhDDBiBOoB|+hTmiFIQ2BOiCKYHvE/BHgB|2oM86DeeaPKbmCPiBE6BgBAsHQHmB9BFlBOXuBIgCwBOegBO6BX0BDoBOS0BkBEoBkC6BwB6CuBwDJwBnELlCGXfMTDVrBAVmBhBmBGMeyBBXjDPb5BpBvCtD1DpDvBbjDbHRlBKfNlCOhCF3DhBnBXbBbWVCZcDHH2BTqBUMByB3DmG|+hNi6DbUdLjChCwBxBWIMUkBKe0BVS|+hNi6DWRdzBjBJLTVHvByBkCiCeMcT|49Di1H6EMFLyHrCyFAAawDA+ClCkBlCiBR0BTqByB0BCsBZ2BvCmBlBgBpCgDhBaCjBlDL1DsBzDqBtBoBlCkCPaZiGuBoBagBuDwDgB+CCQLBfhBlBPlBMLZtCPSZBVnBLIHL1DAAjBdAiC1BBVxCAdzBILHhBpD6CzBQ3DhBxIgDjCwBlDYZelCkBfoBNgBUGFSOQAYvB2C3E6E1BaLOKoBnCuBPuBhBEhCiCDU3BgDAYtBaVBjBSJZQvC6C5CKVKCOpBoCnCW7BkB5BEfeDyB3BbjBLAPoB5D0CCuBJiBpCyBHJ3BiBlBkBgBCYYCcxBuBlBSlD+F|40Hy3DqBGgCvBYC0DtCkBpBbdSlBbnBnChBvBMhBH5BcrBBnBkBGqBOOBgCiB0D|o9HuwDRmBcejBqBzDuCXB/BwBpBF+E2EgD8BC0BfkBfLWsCAiBXMXJXCN0CLUpBQZLjCME4CRiBUOFkBQcMyBPoBhBSFaIkB5DEXqCSCPyClBUnBBlCgBXYnCKlC6BE0DzCL5CxBNRvCEjBLdIGgD1BlB3BCXiBpBEOcjBmBb6BSMAcmBSFiBQWEeqCsB+BW4BDgBsGJkBdYCuBkBMMHCalBGAoB8DBWWe5BMIkBhBwBEOUqCaGauBSDO1BGF0CbQMGiDXSO2DiBYYHSgBEQPJbWHQdRXJ1BU9BoBdgBBGMyBOUQ2CHCsB4BCgCbUSOBKReEYY6BqDWE0BzEiBJCtBvBzBUTwDJC/ByBqB6F9BgBjBLjBsCU8DhBgDC+CzByCnCyBT2BBWTiB3DZpD5DhEpBnCvB3BPBRtBG3DZtETXJ1ChCzCJhCzBbPlBjCAlDXrBbnCTrCxB1B/BJvBMjBZ/CtBhBlCxDjDvCd7BpBlB|+8Gk+EwCDOS6CyB0CMDzDmC5BoCJYXmCfoBCmBTQxCRBYpC6DDHjBGZiBRQnBLxBPbGjBTNBU7BiB5BAvDRf3BAjBZrCJOpCCXzBlBwBzCOzB5BvBHX4ChBoCU+BhBcHuBfqBoBmCZ2BOWLWagBEkDOW3BoD|m8GsrF3BE9BVpCrBDdPVGhBlBRAbRLc5BkBlBNbqBDYhB4BB2BmBF/CeHkBM4BnDNVDjDZfMVNVa1B3BlDhBP/BkBFa9DiCjFsDb2BMS1B0CpFiK/CkCUcd8BUuByBoBIZRPCX0BBafmBaMsBmB4BuCamCiCUqBJwBSG8CrCmBjCwBHiBSYLmBGwBdnBhCSBgBhB|oiHw2FLHd6BVV7DCAnBmBFBZLIjBLBtBeXKjBfrGfiBRCoBiCvBelBFXMhBRvBIlBkC7CsCRF5BkBRJ3BKNarCkBJUYGBgBOWgBE0BqCXQMkBN8BOQJ2BZiBIgBUFMUNmBIIgBBwBuBaGOsCkBeoBAGOyBFqCwBgBeWDSPNVnBLPfrBpBZxCiBDWrBA9BQFOVyCGmBHuB3BsDMWLZ3BDtBgBrCffoBjBU/B|qtGqlGHHOlBLTTGHfVSNkBQQ7BsBbDLVnBRFNehBZRdDLmBHJVELYlCMBNHKGmBKINIAaaGWVBNgBCSPiDiBWUiBDBFgCNuBlB|+iGknGZFAZOHJHFlBhBONOGahCkBDSPMETNNhBYJMKoBRKYUqBROKWFcRQOQhB4B1B|2gG8pGPNxBYNJpBSJH7D0DGKKJaISOBgBcCOQSLqBgBOcgBJ8BaWBHTGXVvBEpCJFBrBLPMb|2hGgyGVC7BZfKNbpBfRMNPbBCflBPLUREEaJInBD1BmBMQAYwC0BgCH6BQkBHeImBJuC1B|q1F8wG2BlBcIWLLnB7BG9BSROkBgBDIQE|yvFixGIiBHMe0ByCACWhC2BeAAkB2DAD7DgCJ7BpBAXLPPDEHjBfnCM/BmB|21F03GIMMHWoBaJPzDlBpBRAE8D|yuHs+FIRXX1DhBRNhDYLFcPGzC2BFENtBRFZpCZNTvBDjBiBTgCnBkBgBgBfsCEuBa4BVMrDLtB4BlBIxCFNWPGA+BVsBhBEayCsBqBQgBoBMBPjBFUdAhBbjBYzBcEOwBTWDwBwCaHeWUWrBuBBqBjBCT+DGkBdyBHiBUCS8EE1BTWdyBDwBfMxBgBAaNzBlBDXWX3BVCdRPsBxB|+2H63FzBCTPxBNFLfCnBeT+BK2BSYPeVIKcPQfDrByBSQBe4BWVYEY0BmBqBXoBpBAfaB6B1BJ5BlBPHvBctBUAIjBoB3B|+6H04FjBO3BBBrBhBGnB4BHkBTAbuBIwBmBQK6BuCLGM0BEkCRf1BErBalBhBzC|2gIq8F5BpDXXdDJSNCTRbOiB0CZmBDsBgB2BmCVkC1BKZ|s0L+2IeR8CJfrBHtBRLbGCPvBjBAbeKWbBRSXVTQxBkBHHb5BjB9DS9CVFlBrCHnCcVL1DcZaiBmBM+DhCkCvBgBhDaFuB0COqDPToC8Bb2EyBS0B4BOKXeAqC3BiBGmCjBSC|w5LopIoBYM1BVxBbOPqBOY|oxG2zFKvBTpBlChCtCZlB3BLrBlBZZgBzBCBYSQHaiBwBNcXdlBcOSL6BWKkByCDawCmBsCjBOZ4BJSK6BjB|ujHg5GgBDMNPP1CBDcKK0BB|8sGg5GqBFiBPMRtBATLjBMjBWIQqBC|ujGsiHqDF8BVaV8BG0DxC8BLDRuBDwBZFNrBHxFFqBkBZSnBEVSPkBjBBvCexCKVMYQ/BEtBhBZAJPfFZGsC4BgDa|smNwnEvDKpBevBITgCbGnCoC5BiDyDL8C+CWGIWmBYwBKEX2BAqBbgBFgBTLlHZzBjCnC|8iN6nE5CtB5BvBnBjCjBDRzBnBNzBE5BYfNNd/BvBtBHNYGmBlB+BPIA8F+BCCkHyEYaZoBaiCI6BhDoCnCcFU/BwBHqBd|6vMuiEArH5BfhBDlCQJcZQddvBwBXuBzBwGJuD5BwCvB2DzB+BDwBmCYqBBmBdsIIuBd6EJqFqBqBDYP9CrBZaxEXBjH9BBA7F|ymKmvGZyBfWcMkCkDgBFgBOkBAoCjByC5COrCYREtB/BFtBO1EEnCPJyB6BByBY4BNcONSnBJZQTANPlCB|gxK8sGDuBXSNsCUMMkBgCPkBOaFIQiIAOsBLI9BqRiDAwN1IQdmCdAnBoCGAzEjBpBFnBvEPVVzCBPMhBJ7BZLTxBbHRbLdIRPJrBxBzBCVRbEjBpBRJcbFLTrCGTSESHINFQmBvB6BLC1Bf3BYbJBY|8lKg+GOW6HBL+CQgB8BGBkFyGDAiDwH7EhDA+BpRMHNrBhIAHPZGjBN/BQLjBTLxC6CnCkBjBAfNfGVVFkBSeI8BNgDGgBPehBc|stLwgGzBFPsBCyELOBepBqBIiBWIMcgBGkBkBWCyBlBDVQjBNZIRzB7BLnBBvE|2lM4hHQjDYPCVaVNZXhEDzCxC7BbzCcXApBoBAFdRDBVLArBmCNCxBjBzCWTHjBClBbhBBrCiBdPhBCXY/BYjCHRNHjBRZD5BxBmBVBVRCsBpCOBgBjBqBJcGgBqBCWWwEQGoBkBqBA0E6Cc4F+D8G6DmDbkBhBsBY|stLwgGCwEMoB0B8BHSOaPkBIwCSaIkBSOkCIgCXYXiBBeQsChBiBCmBckBBUI0CVyBkBOBsBlCMAYXJhB1BvBzBlEhBZd1CrBTjBaXBlBjBTBtBpDhCXXEZNxBAhBoBVwBtBqBnDB|glM4tGapBCzCiB7BzCELdkBlBcLelCpBxCPLD/Cefe3BeVItBDjBlDgBrJEIyBXsBdKLcPKQ+Be+BUCmBkBYCkBZsBUe2CiBa0BmE2BwBKiBXYCWSE|6pLgqGHhBqBpBCdMNBxEQrBzBNf+BDgBO6BPYFgDbiBGU4BB|ioLiqGFTchBG/CQXN5BEfgB9BhGtC3BSCYb4BSoCa2BZsECkB+FE|+3KuoGsCFMUcGKbqBSkCvBYQeCsBPQ7CZ1BRnCc3BBXzDKrCJ3DnBK2ChCwBOcHgBESKABoBeQduCGWMG|0sKmtGsCPgCGCXcK4BX2BgBMBwB5BPlBOGIHDRURLFFVetCdPCnBbCNZRALOEaZmBvBLH8BfwBxBChBNRfhBbzB+BhBWPqBRKcgBUBoBUFWKc|0mK4sGoCQ4DBJbGVnBTTCbfhBcbElB2B|k3KsjGExBNbiCvBJ1CxCe7E8DSoB8BgCeIalBDZMNSAOaSB|wtK6lGiBcSgBiBOyBBgBvBI7BSE7B/BRnB/BefkBTmC|m9K4oGDkBScBWyB0BKsBSQeHcMISyBcMU8BaiBKQLqBAFfKbkBpBCfqCNBrBNRfFLbVH1CGTJrECIzCrBQdBXPjCwB|4+Mu+FVF3CI1BVZMlCddGbrB9CS9CuBhBTZhBFrBzCOlBhBhB5BHuBdWd4BdgBAuBEyBQMgBiC0BEMQcPwCa8BuBFWwCC8BeuBmCgBaqBMGbmBnBFnCqDpCATmC9BQlBwBXKV|8sMg7FBlBfpCF9CLtBFTnC/Bb9BCzB5C7CXMDSjBAVXnBctBlBzBkCwBiBXsBWQsBGEekBf4BBUeIqBHyBdmBcqCPOvBFRiBEcyCDmDfEkBiB6BmBiB0CN|y+Lw4FmCDkBIIBDbShBwBGQNbpCelBIxBHpBTd3BCjBgBDdrBFVPYrBvBhBrD0DlBiCsBoEyDEAsC|q7Ly4FoDBArCxDDLKWoC|wlNqjFgE3BedS1BXjCM1BTVT7BiBPhGzBGtBvBJlBXHVVF7C9CxDMjBapBEzBP1C8CEsGmEAFWKYLeIeHUWAETmCFWb0BJmBWOhByBJyB9BwBADkCRL9BmBUsEPcUoBQI2CKaF|wpNyhFgCLiBvBS3CRvBSzCWCYTavBGxCbLTtBpBoBDuBOeDYZQRDlCuBU8BUWL2BYkCR2Bde|ktN+8EwBGsCR+BKWSoBAmCYyBmBKbI7GMfrB5CpBnBhE3BnFrEFtBgBvBM3BMCL7COLHZbVhE3BbXGbQDDhBxBCTwCMmCvBoEkCoCa0BMmHfUfGpBc1BAJmCiG0BkBdSEaPEXNdEtBqBnBUuBcMFyCZwBXUVBR0CSwB|koNy+DLdlBFlBiBAWWsBUEgBLO3B|giMuqFXNLrBPFRwBuBmBYV|0gM6nFkCO8FAkB1CmB1BgCOkBJY2BoBCEMgBAFXuCCCnBMZHlBEnBWXDrC0COcDITHdMdJXGVlEADrG2C7C1DZ5EKtBerIHlBepBClCXFoBkBwEkB0C4BmCIuBDmBTWfuCYmBhBoDfqBGM|+kNmvFS7B/BlCZDDuCPcmBDUkBiBD|uvNu1HLTVINpBQHPHBReKAZdlDrBuDUWiBiDuBMFjB|0vNy2HrBLW0BiBwBcDMZjBXPhB|irOi7EiBlCKrCQdFfLRTmBLTMtBFbRND1B1E/NrDpB3CmBRiBD6BVyBFuBMuBeMAUeyBGoBbmCD8BWkBIoB4Dc6CsCSgBHcaHkBsBCmBUeWb|6uNgzHdJCSQIPIOqBWHH5B|ymKmvGmCCOQUAaPoBKORbN3BOxBX5BCIc|+6L0wHZyD7CwCFwBoBkBO0BJ+BMgBmCauBHBf2BYELffAdWPH1BpBfMjBgBAQfaJDvB/C/BC1BfN|02K6qHA8CoDwB0DaYgBsCaCuBmBGcY0CKMaPOZqDXoB8BkBmCKoBc+BS2GSgBJ8BamCAaPqBELfK9BNzBnBjBGvB8CvCwBpFLxEGpBZZmBtBCbYjBeMyBdcnB7G5D3F9D5CbnCFAoBlCePe/UyN|ivN60HMUoCZ8DkCatCrEpBgC/BVJJVvBHrBrBlCKBKemDI0C|mvOwkHKCCPyBK8CDkE8DMVKxBhBBDnBKJbLAZhBhC/FgBZwC|0tOwlHDuBQiBSIUTAlBNlBPDTM|+nO+vHc5CrBBPe5BGwB+BqBF|s2Nq0HZuCuEiCYuCFuBkBQgBoBcKqCHWPgBKoBrCqBRGlBfVPxBsB7BwCjBgBvBJtBUAAjBkBfvCIvB9B1DG1FgE9CsBtCS|u2OuhHCaSaAacMJKEoBiBCcrBkBX0CTuB5BYHANzC3DdCNNJfCzBdAlBXHdNNnBAXPAZfRhBGpCXlC2EgGgCqBgEbuB|y1V20EJiCeTMzBfG|m1RssGPuCqB0ByCM8BH0BZesB4BXQpBHrCrDxBclBjCF1BX1BI5BkD|u6RywG7BIxCLpBzBQtC5Be1BBIyB3BADlC3B1EEtBqBBa7BM1BkBlBmBFiBhBVZpBHFiBzBcJLZYJgBhCiCJlBLkBamDiC+DZ6BFgC5B0CWMY4BhDwEcMcmCuBCqCqBcTClBsBBPjCC5BkCmBSJmBCMWyBDwBzBE/B0B3BD1BTb|4+RswG3BYdrBzBaUcE2BzB4BDgCvB0BxBELVlBBRKjClBB6BQkCrBCBmBbUOY2BqBGPiBAJoCgBKkCrDuCBY3BnBPRXsClB+CjEwBrBQtBL/B|owR68GpCpBtBBblCbLiDvEX3BVL6BzCG/Ba5BhC9DFwBSwBTmBEmCZgBf+Eb2BxDtCrCUWwCN8BxBqCIWjBItB0BD0BWJCuBeQFaOWCkCyBPe2BCekB2BBkByCsBuBJDmBWMFYmBGWlBcPBlD7BzBHrCkCKQ5BoBNRzBqCjBwBSCZ1BpBNX|24RgpG2BYkCGbmBsDyBIsCPqBMgCPuBvBsB9CkErCmBSYoBQX4BtCCjCsDkBQwDG4BiBeX6BLJjBeZiCP1C3B1B7BNrBuD3E6BlBmBzBe1DJxD9DxCzB1BvC7BXqBSqBtBmB|otT6oIKLXEvBrBEtBlCrBlCbJhB+BlBHPpCHXbfDfMZRBMhBQgBkBFMQiBDMhCY0BoBmCiBsBuBeT4BBJiBiDcakBoBlB|skTw/HgBEYcqCIIQ4BrCQpBApCXhB5BNzBZ3BFHkBMwBbiCwBMrB2B|w3Q02IkCK6D4BiDe2BTkCBqBd8ER+BuBZkBkCkCmCbmEXMvB8CZsEUgCHgCfmBfsEJwEa+CuBmBHiBTsCErCvDQZkBI+BJyBY0BT6BrBHXxBI9CHrBTtBpBhDX/BhBlDShBnBgBtB7C3BpCV/CDnDVpChBbUtCA9CmB/BKzCHrGMlBmBb8BnBGtCoBhFUVcYqCrB0B7CY1BiBPuB|0qRwsHGXVLElBtBKxCrBCjBjB1BBdd1BxBQBjCNVGZdPhBmDRAJnBjBgBUkBcEe2BjBM5DIDsBfCxBcVpBuBhBnBXNXmBRJlBWvBKzBJX5DLEvBhBlB7CrBnCpCvDxCAd5CnBdBRxBQnEZ7BBtDfBdxBUT5BRVrBZR7B8B1B6E3B8Cb4D5B4CtBuGAsCL8B7ClBtBIzCuCgBWTapC2BqBqBsEAL4BjBgBHyBpBcoCkCqCFiCkCoBgC+BgCAuB2BmBzBerBkDgBcgDPoCK+B2BkCrCFzBafBhBtBKSlC4E1CpBdX7BuG5C4CHkBhB+DT2BAE+CmBOI/B6BXoBKqDBEmBZW0BI6BwBqCoB2BPuBaelBVbkCJ|shRigHBtBVKEzBhBiDbkB5BEGZTjBbMJLpBOJ0BVwBKmBlBSOYoBYtBiBWqByBbgBBErB6DHkBLd1BbDTjBkBfKoBSAiBlD|s/QyrHaVDlBpDCnBJ5BYBOqBuBkBQuCPcP|o4Q4rHD9C1BA9DUjBiB3CItG6CY8BkCuByBTiCpBkBJWdwBL0Bb0EV|2jQg7H9B1BnCJ/CQfbsBjD0Bd1BlBAtB9B/BnB/BhCjCpCGnCjCqBbIxBkBfM3BrEApBpBvBQRuBxByB3JVYqC8CgBFedKB4B7Bc5BqCsDhBgCKmBHMOsBF0CaC4BkBkBwBAGSyBIYFYSDmBcmBoBQXsB8BBSWBYgBcX6BmBc0GoBwBdSvBqDZ|itP4+HiBBkCTwBUULWcmBAQiBcYiBPFRSDF1BaTyBUoBcuDFMRzGnBlBbY5BfbCXRV7BCYrBnBPblBElBXRXGxBHFRvBAjBjBB3BzCZrBGLNlBI/BJrDiB6B6BFoBvBMZ6CckBbKsB+DgCXyBIMcyBKkBUO0B2BMKWyBR|2vPq+HkBgCNwBvBOQe2BD0BsC0CQLdIRaCVTlCKFjBmCEuCT6DKQ7BUGoBNG9BtDGnBbxBTZUG2BREGShBQbXPhBlBAVbTMvBTRI|+1PyoIOcqBIqDVKmBkBO6CbYIqGJgBVmBJHNlDhBVZxCHXnBjCIpDpBKPRN5DJtCUlCDGkBmCJWUyBFyCuBrCiBtBPvBY2BoBRI|gxOynIcWqCMqBRuBxBoDEJgB2BW2BmB2ChBIxBYNmCEULgBhCyDpC4E7BAlBxBSJV1BLNzBjBTxBJLbxBH/BYF2BvBCnC4BzBIlCgBtBGbLrBCrBjB5BNJuBIiCxBWQsBpBEO2B8BP6BUvBoBRkBzBPFvBTqB|kpO8vHjBgBAkBTAKuBfwBvCkBrB8BQyBgBWFmBpBSrCgEMUTqCsBSKXiBdsBHWCsCuBYGSTVfoBfQCUtB+BNsBf6CLkDSGO6BOsBkBsBBcMuBFmCf0BHoC3BwBBG1BrB9DcJbjBa5CwBLGnB5B5B6BpC8BbC3BeJGd7CfXpClIqBbuCdMxBL/BftCWhCyB7BS5CyEjBJnBUXX|uvNu1HWmCkBYLabEFwByB2BEkBULmCSiBL2BAqCYqDIfnBjBPGtBXtCpIlEnCa|glOyhIVBZuBbATS1CgBGgBJW4CKmBbNPkBVRT2BbCrB|i+L2pJyCyCUqCnBiBD0CqB8B+BAWYVWiD6CsD0D8BASkB4DJKqBoBC4FpCChDWZtDR9BrBKnBhHpDtB5CuBtB8BhB5BnChCPZrDjB7BtCGjBxBpCBT8B1BoCvB6C|sgNqkJiCPKPiBI+BNGdNRoBpBaLDLsBJSRXN/BDe9B1BDTNDfzCEPOXJzGevBBjBPdBBcTeoBMAaRYDc+BAmCYQkB0BUFesDiB|ynNm8IYBQO2CEqBjBPNET0BBWbBNyCVyBKmBdkETCRZhBOjBJT9BFhBRBbxBDrBV7BB1BXChBROhCQPPrDYDY7BHpCzCbMdJdMSGcqBDMqCAdgBJaVKEWdSnCW1CPPNjCPdOvCIbNDSjBSeqBODPc6B2BgBIGSf4BeCkBQwBC0GdYKQN0CDEgBUO2BE|+2M6/IEbSXAZnBL2BxDFRfH5B1BQbrCctBHdGlBNfWZHfkBvBEFUrBGJPhBOEQvBGdUbqBGWPiBXWSSNgBgHmCgCJEPiIHiBFOT|+pMo0IDZjBAMNhBzB3BBfNvEWNW/BLFLlDWIcUEgBRIQ6BBuBKeAUNGKJqBYIWewBT6BeyBTeEeLAd|m0M80IkBRERnBLjC3CzBLnBCnCZ1BMjCkBLWLAWqBLOkBAEa4BX2BIGO+COkBUkCTOI|o9Mu0I6BQoCVeRDVWJKZefpCAELbpBRFJcE4BrC0CTG|ugNgvIeLeKcLCPdNTGRrCzCerCPfPnFIdmBQKPITNlBUFalBOHWhBY0BMkC4CkCawCHeNkCQQOcAUFsCzCD3BKb|g9MojJGdzBTPjBlCX9BANUhBGCiB9CWN2BoCUsFCINiBD+Bd|y+M+mJgBNalCrDhB9BehBEHOrFBnCTCwBgBoB8BWyBvB0BCMwB2BM0Cf0BA|+/M+qJKJtBlBU7BbTzBAzCgB1BLImBXHnBYFkBiFcmEJ|okMw/IOfRRYVQhBFVcpBdFPIjE1BStBkCrBVdXHKpBFJTOdAtBJ5BCHPfSTDjCUNN1BAIuBgBsB7CKdSEcNOIsBJiCmBAQYQ8BLUMO2BEMNsBgBPYBkBwBHqBIAXgCNAXiCMkBSmDtB|q1MwsISboFHgBQsCQ0CdhBbVtBUjB3BK/BVBd5BFrBWzBRvBCDqBfUKKFIKUaUfcFWQQ|y8M06HHT7CFCMvCMMckBViDBBJiBI|81M2mIwBB0BSsBV6BGCeePTnBNHnCItCPsBjBjCJhBgBLNOlBgBdXNkCvBAjB5BQSfnBFY3BpBB1BchB+C5BiCDSegBEUUKCQqBGYOiBBWO|yhOq+HfJVQpCIlERpCX1BAhBMlCRTMDjBhBbXeYYlBF1BOrBjBhDHzBkBjCCNbtBF9BiBjCBlBgCvBkBgByBpBeoC8BiDEcwB6DHsCqBqCSqDAsGlCqCK4BFsCiBkCE+BfKVFfoChBrBRUpCLTkBzB|o8M0nIgCW4BJIX4BTLPrCDxC1BRqBOIUoBdQ|iyM2lIBPTJDTdfvBoBFeOgCNecgBELQGeXDtBIZcP|kpMgxIkCjB2BLYKiBpBXXbOjDIdANNVONZ8DxD4BXHL7EiCzBwBMEdcAUpBKTZRUEYsBBMKuBLASWIIayBQ|m7LizIHb+BLDbbJvBINZdBLKjBVdBbOVcdJAcwBkBBQcFSM2BAOOkCT|q0L05IHrBPBFjB3BehBFpC4BdAJY+EUsCpB|61L++IMTP7BPXlBAKhCrCqB5BLvBEiBS4B+C2Ca2BB|+1K4nIyBaQf2CGSfdPBxBJJBdbFalBRpBWTfnBEVXPhBIhBFKyBFoBbEPaGqBYWSgCPoC|i5Km+HDWgBoBVUSqBZmBcGCeKKCyBeQRgB1CFPgBxBZCuBZc8CuBoHV8ECaZ2DbWMoCbsCICjB7BrBxCNFTnBjBXzBajBlBdNnBvBNtBvBtEA/BvBfGXWRkB7BK|07K4/IKtBvB5BxDlB5CK0BkChBgCoEwCMhBLhB4CL|yzV6pE2CjCXPjBS1C+BzBkCcB0C9B|srV6gFJLvB4BLmBUAyBxC|2pVogF/BGNKEYsBJed|onV+jFSfrDoCKGwCtB|4pW8jD3BtCvBZLQZKkB0BTkBlCaCWuBWMyBDqBX2BvCyCbuBYGkBjByBPS5BuBjCAsBeRKvByBTsBFkBYiBFjB9CvBARRGbJL|q7V88C+CkCcuBYSKiBuBec1BuBaSZAbhDlDYdxBB3BXzBpDxCvB7BCpBWjCELYiBuByCgC2CkB|svUsiDmBDGrCVVHzBVSrBrBzBEnB4BJqBjB4BCcoDZ0CU|qkTyzD7DvBLfXZ9CH3BM5CJlBhBTC9BlB5CClD2BCkBeIMQGiCHmBrBmDCkBZ8BbaHyBtBuCcbV8BgBRSZAiBzB6Cc0CFmBauBExBcsBkEqCcESH6CgBaUkBBiCS6CgDE8BsB2Bc3BaOVeUecLIwByB4BgBMCScHCQ6BSwBdkBlBwCFNkBeyBeSJQckBmBWiBH0BMAiBvBUiBKsBPiBZ2BPSGoBTkBSYFQOcfnB7BVBGZnB/BERkD3BwC7ByBPKT+BVqBWagCa2CJ2CIwBMMJWe4CWYUfEnBQHCZYhBC5BYzBoBa0B1BFbO1BIfQHS1BFhBUrB+E7CHNkBnBalCYOabQKMjC8DzDSxBBrCe3BD3Bb1CJxCd7BtBd/BpEXfRtBDhCjBVnCB7BZjCzB7CoBKgBhBL3BtB/FyBnBoBbyCda9BGUgBNwBfrB3BLgBiBKmBYgBDuBzB1BnBVXxBxBaCiBpCmCMOxCoBtBC9BexDF7ErB7BE|yrQijGJjCZR3BNdyBL8CeoDsBhB8BvD|+iSs4GzBUB4BgBcmCSkBBOXbbNjB3Bf|woQ2oIDkBsBS5BuDgFoBuB0D+DVkBcEiC0BGyBqBYGQtB2BhB8CXsBzBXpCWbiFTuCnBoBFc7BmBlBsGL0CIgCJ+ClBuCAcTqCiBoDWgDEqCW8C4BfuBiBoBmDRgCiBiDYuBqBsBU+CIyBHIY5BsBzBUxBX9BKjBHPasCwDsCX6CqBAc6BkCkBUBkBhBO0BgBwCM0CCgDT4BX2ChEY/BwDTsCtBa7BgDA4BaqDShB3BXXVlCrB9BtCK1BVQ1BHrChBBAfnBmBZjBhDbKhB3BCdUrBtBlChBzBnB5CTvBdjCPiBeNYyBsBhBgB/DhClBpB/BBfdiBrB0BJCdyBRoCuB6BZoBAMhB7CRdhB9BfftBkChBa/ByCrDAvBpBPQhBmBTZnDjBF9EjHvFxDpCHlBbVWjBf5CfjCJVjCjBDPuBQa1CUdJhCQdaKkB5BMdY3BhBvDFjCZKnChBAHqBvBRpCkBS0BnBOP6BjCJIsC8B0BCmDbQVmBlBFjCKWcdmBtBZ1BQpCnB5BvBzBHbQtCQjBPpBtBFyBlBNzEWzBcvBMVejBKhCqBxBUZP3E2CRmCuBJCiBZgBG0BjCsCpDaRwBvBeLSF+BnBOTFP8BSOJQ+BesBMkCHYoByCIWamDiBIO|y7S6kHhC7EhB2BHwBmB+B0BwBcRJlB|88L6xIoBJGMgCMOV8CRHdQbxBKzBXFxBWf8BfgB1BoCxByBAONRNqDpB2BhBGLLVhBe3BKbpBuBVFhBbDhB1BZFO2BMOrBmCZIRapBMbavBErDmCrBmBT+BzCebJlBbZFIcjBIPyBWURYCScNeCkBWMJeCOawBHcKEc|wlMqgIyBEXxBKTNfpFgCIgBsCFgCI|u5L6lIgBUmBtBJzCbEZVXQDuCNkBkBB|87L+hJpBHvBIZkBBgCcmB6BEqCiBDfRVIPiBJPXRGtBtBSf|4gMokJUflBzBjCkBHa+CW|07K4/I3CMMiBLiB2BEkCnBhBrB|6hL6+IKmBrBoBtCKPSYcVShBdD+BfgBYiCyB0BgEAjCjCmEIPzB5B5BiCD+BxCsBJ6BhDuCLHpBfRYhB3Bf1CAtDRdMpBd5BItBXhBM+CkC6BOjDKTakCUjBiBMqBgDF|grK+4JPpBoCrBxCvBvH3BlIe+BcrEgByDMBSlEQqBoBiDKkDrBgDkBwCRqDiBqDD|6kO4nISDsBlBcDyBqBiCvCeBUR1BDVnCXPCfPBnBgBWgBRUXFrCtBBsB1BcSUjBWOQlBcQKyCVIIdiBQK|qkOwhIrBIhBeJYOCURcAatB|+3N8qIGI2EV2CdMLmBK8BNUZoBNPJehBHHhBEvBSPJ3CJ9BgBjCDKcPsBlBWjBIVU|25SutGhBwB4BBWXR1BZgB|m9S+nGQSGoBkBEJpBuB8BF7B9BvCnBsBOQ|4kT6kGKtCV5BVgCdfUtBRdrCkBRuBUgBnBeVbdEtBjBLSa2BsCqBWbwBQKeuBCDwB0BdK3B|g1S0mGzC7BesB2C0CgBgCMzBrCvC|28Su4GJZWtBR1BlBTJzBOxBiBHcIwCjBFhBWPHdvBgBXiBRXnBmB5BJfOEcUQTOHVfkBJcB+BaVGkDW6BmBAoBRUQGP|i8S6qGJgBmBTqBABblCtBC+B|gjTqsGSnCxBSS9BdNDuBRCJoBmBFBYlByB8BBSX|mwR+gGKM0BbGhBqBIWa0BrBarBBnCK7BWRa3BBVrBDnEiDHiBlBqBH2BXiBIuBNc|4zSo8F/DMVpCZVf3CzBN7BSfFjBfpBEpBLpBkBLqBwBVwBMO2BoDauC8CchBOWeBGoCyBuBgByBaAiBfCbgDlBDXrBDMfvBV|8uS8+FFnCdCNVbiBuC6B|0jMgxI0BDgBO4BCMKMAMVxBPHZVHARtBMLJrBCOGPcIe|mhNk+JJrBiDrB5BvBqCnCrB3B6BtBZpBgDrBZhBjG1DzDD3GlBlBkB9BUOgCd4BemB6BoB+F0CHa3CeVaBiD3FqCmBSmChB0CEmCP8BcgBuBiDWyCXZtB|k1Mm2IrBxBjCUjBT9CNFN1BH3BYFWOWyBGsBmBwBEgBVmBOeFuBI+BX|imMm6IeTwBFDPiBNKQsBFGTwBDcfrBNRXxBFHNdMdDxBU5BdzDgCRuBkE2BQHeG|8wN8wGHYiBqEUSwBMgBkB4BjE6D7C6C/CgBTTNbE7CmD3BarBAPOlBPlBeTvBpCO|4jUsiI5B/BAhCXzBMfhBtBxCdvDD7CnCpBYBwBvDNrCdpCBgCtBpBtDpBZfYQ6BnBUZqB8BUiBoBgCiBwBsB+DSmCLiCyDqBfkE6CoBuCLoCcoBkCMiB3CBzB|opU+rIsBaOnC9CP3B/BjDsBjBlClCBJgCgByBkCCmBsEsCjC+ChB|4wT+2HkBmBkBHacuBNKVjBnBbWfPRjBnBSAe|2zH0rEShBD3CkCLaMqBPMTOzCYBYKYLAhBfjE5BvBzBLnEcgCiDJchCYtCwBzBK1DoDasCAkBgB4BwDS6BA8BhBCT|gwOg6GmC1EtBRNxBlF3B3BtBvBAlBZtDTnBlBhDDPmBCkBpB8COCBmCcUFcQgBaR8CIiDJQVeMuBiC8Be4FY|+tN2uHmCJsBsBwBIKWWK/BgCsEqBuCR+CrB2F/DwFLQdsBCa3BgBNKVsBbGlCkB1BULQEoBnDgGfOOctBpB/D/F/B3FX7BdtBhCdLPWhDK7CHZSPfGbbTfoChBYhB0BR2BrBsBbKrB8BD0CjBmChCmBhB0CTO/CwEfAWyC|2mI8XgEOgDNwCZanBK7BpGjB9Hb3EEzCWKaqES2BU2EkD|ujHwT6IJwCyBkCZlB9B1IEvCWhBW|m0GulB2DGSgBCsCkBe8BKiBXgCvCY5BbvBxEVzCCeYxERxBUBamCY|q7EmkBoBM2HVmCImBlBlJChCMhBa|4yD2gBOWgFVsCMjBX7BP5CG/BW|upDihBuBOiFnB3DI3CS|ygB6WoBY2DJyDpBQd5DHzCWxCsB|gwWyKAxK/vWAAyK8BmB0DT6CU+CZgDe8FM6FrBmKjB4HP4FSwIL6ET8KkBMe7HCtGQ1BYrFOMcwByBNcpDQvBYjDU8ED0EK8CV8GsB0BUXavFmBzLSnBYlEqBTqC6CbuGQ2BbkDGuH2BiDGDYVYUWyCKmBTsFcyFIoHqB+CHgDI0CJsFK2FNuLEuEcwCNyEiBoD/BkCUsCXgFZsFQuIXiBcnCsBxCGlBWjBoCkJRgCTcV2CD6HeiCP0CG4BwByBbqCLyCG0BXuHXsCuB+BZ4CIiCNsBV2CGiEe6Ha+BOmBUQaHcvCiDBYGa2ByBKYT2BgBcsFyCYckBQoBQ+BEoBUiDUyCmByBGmBPXT7ChBvBK1BF5CfdRJZEVeVrBP7BDvDlCJX4BtBmDhB6BpCeVUXI5BsBpCHhBpCvBzCHjCrBhDX7HlBxBZpNFUXiDLoCRoBVnCTtDG7CPFzBsCTOXwCXoEJkK5B8JbkHnB+C1BmJ+B4HiB+EA+IXqBc4CUiFAsTgCnCuBAY7LNRYIwBeOmGe8EmB6BY6MmB8J+B2DoBSajCOWasBUqGwByBaeewBSsCDeVuCBCYgBYmCFQXsCDkFUoCDcZmCU6K2B2BOoBWwBPiCKyC1BqCOcYiCS0CDYX0BY0GIsEJoCnBmCK8GE6J0BwBSoC4BiCJaV2BPiCG+CnBgCQYa8DiBqEU4EsB8BHkDoB8BB0BQMW2BSwFc0DJ0BRGbgDlBsCHgDjB8BBsDmB2Fb+DF2BhCBPHdvDnBIXoCAHX/BxByBTqCFqCK4ByBsCmByB2ByHayByBsBY0DciBW0CUgCF4DOmCDuBSiBqB2BvB0BLiJCmDP6FQiCHoGsD6CZ8D9B6DBqESgDkBoCCuBOyBLuCnBmCC6DfwCHiCG8CoB6BG8DP2DK0DL+DU+HOU6BoBRMbwBvB2BLmLK8EFsBTLXqBTsEdqHfoCBqBWiFzB4ENeZqCNwBXoCJoJFsGjBuBRHZzDjDzCJlBVxCNbZ7CrBpBxBDzBwCnC2DHab1GX3DB1BjBLd9BvB2CVgBZmEtB4FnB0ETgBd4FN8BXyFQgIjB|upNo6HOQuBA6BSpBZELvCE|upNo6HqBCGJaGIHhCZdIPaeC|2jLq6HYnBapDQNLZzCJbXlBFBtBrCZXfzDZnDvBFtDnBBVNzBI1BHTxBTDdvC5ClCT3ChBzBxEDEcYSWiBDWWsBiBoBWMSkBAiBYoBqBYqBgCgBa8BIyC8B2B2BPwCgB4CqBsBwD4B+BoDwBAmBZ+BE+CP|4xNggH3XAAwOTyBSoBJcWe2CC6EtBsCmB4BGuBHSfOUmDReQsBtDxBrDPJxBwBrB8CHFyDlHmDtELLCpB2ClC|g6MggHA/DpCAAZ9P0HtD5BjBiBlDcboBxBedLXkBBclBuBaaBqDM0BZ2CgBOB2BgDgCEwBqCVcG0BJ2Cde3B0EnBkCd+BuBPwBUgBuBesBI4CNWbqDRQVVdKbRnBUxBAvO|ynOgkGzF/FzCB3BtBpBBRTrBAXW7BZRZ7CKxC2BrBAVWAkBfKlBmCdOLafgBlBEUkBiBCcwEeSiBsCoBgBkB2DqCNUwBmBdmBQQNsBA4BZsBrBwB5BrB5BGjB0BCOJNXoC3CwGrC2BA|28NitGcDUOOTBZjBNcRXhBNKzBBFkBsB6B|8pO6qGA9DpC7C1BAvGsCnC4CmB6BULqB1BiFYuDkBkBC|6rNkyFnGD9BbNGAwBOYE0BmBgCuBoBZIEqCaSoBN0BOsBAoBeerBkBpDnCxDAjC|6kN4xFajBDlBRHhBETjBlBEQuCUSOFmBU|ktMqpI3BYtCgCtByBOaWNOOeA4EVPbeZHdvBXJhB|40M0oIgBTEpBVNhBCXNpBFbQHaSkBoDQ|2tM6vIwBQoBBiBXIVmBNGZmBTUOQHPJMJPPGVgBbZTJTGHJJzBDOc9BmBjBdGGnCoBQCIedaQcXAYYhBqB|kwMmpIPFDMbfET7BmBSuBgBWoCnBRT|mxM2nIDYdYcSIWME+BlBNbzBLBNHA|0sHwpGyBGBtB/BBSSBY|2lNg7F3BsBPaxCTdIvBqCvBYPmBlC+BAUvC0BqBSiB4CuBIsB1BSFYKuBBILgCACMiBMGUYM2BjBgBGkCyCFmBPSoBEEOeDHvBItBgBZG1BKAAxBJThBBTjBmBDgBfMZeNmBlC7DtDrBAzBNnBOZR";
  const SCALE = 32;
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function decodeRings(encoded, scale, alphabet) {
    const index = new Map([ ...alphabet ].map((c, i) => [ c, i ]));
    const rings = [];
    for (const chunk of encoded.split("|")) {
      const ring = [];
      let i = 0, x = 0, y = 0;
      const read = () => {
        let mul = 1, result = 0, byte;
        do {
          byte = index.get(chunk[i++]);
          result += (byte % 32) * mul;
          mul *= 32;
        } while (byte >= 32);
        return result % 2 ? -(result + 1) / 2 : result / 2;   // un-zigzag
      };
      while (i < chunk.length) {
        x += read();
        y += read();
        ring.push([ y / scale - 90, x / scale - 180 ]);
      }
      if (ring.length > 2) rings.push(ring);
    }
    return rings;
  }

  function maskAt(bits, width, height, lat, lon) {
    if (!(lat >= -90 && lat <= 90) || !(lon > -Infinity && lon < Infinity)) return false;
    const turn = (((lon + 180) % 360) + 360) % 360;
    const col = Math.min(width - 1, Math.floor((turn / 360) * width));
    const row = Math.min(height - 1, Math.floor(((90 - lat) / 180) * height));
    const index = row * width + col;
    return (bits[index >> 3] & (1 << (index & 7))) !== 0;
  }

  let outlines = null, borders = null;

  return {
    id: "earth",
    name: "Earth",
    radiusKm: 6371,
    latRange: [ -58, 84 ],
    terms: { figure: "land", ground: "ocean" },
    figure: (lat, lon) => maskAt(BITS, MASK_W, MASK_H, lat, lon),
    outlines: () => (OUTLINES === null ? null : (outlines ??= decodeRings(OUTLINES, SCALE, ALPHABET))),
    borders: () => (BORDERS === null ? null : (borders ??= decodeRings(BORDERS, SCALE, ALPHABET))),
    // About 160 cities chosen for world coverage. Coordinates are city centres to one decimal.
    places: [
      { name: "London", lat: 51.5, lon: -0.1 },
      { name: "Paris", lat: 48.9, lon: 2.4 },
      { name: "Berlin", lat: 52.5, lon: 13.4 },
      { name: "Madrid", lat: 40.4, lon: -3.7 },
      { name: "Barcelona", lat: 41.4, lon: 2.2 },
      { name: "Rome", lat: 41.9, lon: 12.5 },
      { name: "Milan", lat: 45.5, lon: 9.2 },
      { name: "Amsterdam", lat: 52.4, lon: 4.9 },
      { name: "Brussels", lat: 50.8, lon: 4.4 },
      { name: "Vienna", lat: 48.2, lon: 16.4 },
      { name: "Zürich", lat: 47.4, lon: 8.5 },
      { name: "Geneva", lat: 46.2, lon: 6.1 },
      { name: "Lisbon", lat: 38.7, lon: -9.1 },
      { name: "Dublin", lat: 53.3, lon: -6.3 },
      { name: "Copenhagen", lat: 55.7, lon: 12.6 },
      { name: "Stockholm", lat: 59.3, lon: 18.1 },
      { name: "Oslo", lat: 59.9, lon: 10.8 },
      { name: "Helsinki", lat: 60.2, lon: 24.9 },
      { name: "Warsaw", lat: 52.2, lon: 21 },
      { name: "Prague", lat: 50.1, lon: 14.4 },
      { name: "Budapest", lat: 47.5, lon: 19 },
      { name: "Athens", lat: 38, lon: 23.7 },
      { name: "Istanbul", lat: 41, lon: 28.9 },
      { name: "Kyiv", lat: 50.5, lon: 30.5 },
      { name: "Bucharest", lat: 44.4, lon: 26.1 },
      { name: "Belgrade", lat: 44.8, lon: 20.5 },
      { name: "Munich", lat: 48.1, lon: 11.6 },
      { name: "Hamburg", lat: 53.6, lon: 10 },
      { name: "Frankfurt", lat: 50.1, lon: 8.7 },
      { name: "Edinburgh", lat: 55.9, lon: -3.2 },
      { name: "Manchester", lat: 53.5, lon: -2.2 },
      { name: "Porto", lat: 41.1, lon: -8.6 },
      { name: "Valencia", lat: 39.5, lon: -0.4 },
      { name: "Seville", lat: 37.4, lon: -6 },
      { name: "Luxembourg", lat: 49.6, lon: 6.1 },
      { name: "Reykjavík", lat: 64.1, lon: -21.9 },
      { name: "New York", lat: 40.7, lon: -74 },
      { name: "Los Angeles", lat: 34.1, lon: -118.2 },
      { name: "San Francisco", lat: 37.8, lon: -122.4 },
      { name: "Chicago", lat: 41.9, lon: -87.6 },
      { name: "Miami", lat: 25.8, lon: -80.2 },
      { name: "Houston", lat: 29.8, lon: -95.4 },
      { name: "Dallas", lat: 32.8, lon: -96.8 },
      { name: "Seattle", lat: 47.6, lon: -122.3 },
      { name: "Boston", lat: 42.4, lon: -71.1 },
      { name: "Austin", lat: 30.3, lon: -97.7 },
      { name: "Denver", lat: 39.7, lon: -105 },
      { name: "Atlanta", lat: 33.7, lon: -84.4 },
      { name: "Washington", lat: 38.9, lon: -77 },
      { name: "Philadelphia", lat: 39.9, lon: -75.2 },
      { name: "Phoenix", lat: 33.4, lon: -112.1 },
      { name: "Las Vegas", lat: 36.2, lon: -115.1 },
      { name: "Toronto", lat: 43.7, lon: -79.4 },
      { name: "Vancouver", lat: 49.3, lon: -123.1 },
      { name: "Montreal", lat: 45.5, lon: -73.6 },
      { name: "Calgary", lat: 51, lon: -114.1 },
      { name: "Mexico City", lat: 19.4, lon: -99.1 },
      { name: "Guadalajara", lat: 20.7, lon: -103.3 },
      { name: "Monterrey", lat: 25.7, lon: -100.3 },
      { name: "Havana", lat: 23.1, lon: -82.4 },
      { name: "Panama City", lat: 9, lon: -79.5 },
      { name: "San José", lat: 37.3, lon: -121.9 },
      { name: "Guatemala City", lat: 14.6, lon: -90.5 },
      { name: "São Paulo", lat: -23.6, lon: -46.6 },
      { name: "Rio de Janeiro", lat: -22.9, lon: -43.2 },
      { name: "Buenos Aires", lat: -34.6, lon: -58.4 },
      { name: "Santiago", lat: -33.5, lon: -70.7 },
      { name: "Lima", lat: -12, lon: -77 },
      { name: "Bogotá", lat: 4.7, lon: -74.1 },
      { name: "Medellín", lat: 6.2, lon: -75.6 },
      { name: "Quito", lat: -0.2, lon: -78.5 },
      { name: "Caracas", lat: 10.5, lon: -66.9 },
      { name: "Montevideo", lat: -34.9, lon: -56.2 },
      { name: "Brasília", lat: -15.8, lon: -47.9 },
      { name: "Córdoba", lat: -31.4, lon: -64.2 },
      { name: "La Paz", lat: -16.5, lon: -68.1 },
      { name: "Lagos", lat: 6.5, lon: 3.4 },
      { name: "Cairo", lat: 30, lon: 31.2 },
      { name: "Nairobi", lat: -1.3, lon: 36.8 },
      { name: "Johannesburg", lat: -26.2, lon: 28 },
      { name: "Cape Town", lat: -33.9, lon: 18.4 },
      { name: "Accra", lat: 5.6, lon: -0.2 },
      { name: "Abidjan", lat: 5.3, lon: -4 },
      { name: "Dakar", lat: 14.7, lon: -17.5 },
      { name: "Casablanca", lat: 33.6, lon: -7.6 },
      { name: "Algiers", lat: 36.8, lon: 3.1 },
      { name: "Tunis", lat: 36.8, lon: 10.2 },
      { name: "Addis Ababa", lat: 9, lon: 38.7 },
      { name: "Dar es Salaam", lat: -6.8, lon: 39.3 },
      { name: "Kampala", lat: 0.3, lon: 32.6 },
      { name: "Kinshasa", lat: -4.3, lon: 15.3 },
      { name: "Luanda", lat: -8.8, lon: 13.2 },
      { name: "Kigali", lat: -1.9, lon: 30.1 },
      { name: "Tripoli", lat: 32.9, lon: 13.2 },
      { name: "Khartoum", lat: 15.6, lon: 32.5 },
      { name: "Abuja", lat: 9.1, lon: 7.4 },
      { name: "Marrakesh", lat: 31.6, lon: -8 },
      { name: "Dubai", lat: 25.2, lon: 55.3 },
      { name: "Abu Dhabi", lat: 24.5, lon: 54.4 },
      { name: "Riyadh", lat: 24.7, lon: 46.7 },
      { name: "Jeddah", lat: 21.5, lon: 39.2 },
      { name: "Doha", lat: 25.3, lon: 51.5 },
      { name: "Tel Aviv", lat: 32.1, lon: 34.8 },
      { name: "Jerusalem", lat: 31.8, lon: 35.2 },
      { name: "Amman", lat: 31.9, lon: 36 },
      { name: "Beirut", lat: 33.9, lon: 35.5 },
      { name: "Tehran", lat: 35.7, lon: 51.4 },
      { name: "Baghdad", lat: 33.3, lon: 44.4 },
      { name: "Kuwait City", lat: 29.4, lon: 48 },
      { name: "Muscat", lat: 23.6, lon: 58.6 },
      { name: "Tashkent", lat: 41.3, lon: 69.3 },
      { name: "Almaty", lat: 43.2, lon: 76.9 },
      { name: "Baku", lat: 40.4, lon: 49.9 },
      { name: "Tbilisi", lat: 41.7, lon: 44.8 },
      { name: "Yerevan", lat: 40.2, lon: 44.5 },
      { name: "Tokyo", lat: 35.7, lon: 139.7 },
      { name: "Osaka", lat: 34.7, lon: 135.5 },
      { name: "Kyoto", lat: 35, lon: 135.8 },
      { name: "Seoul", lat: 37.6, lon: 127 },
      { name: "Busan", lat: 35.2, lon: 129.1 },
      { name: "Beijing", lat: 39.9, lon: 116.4 },
      { name: "Shanghai", lat: 31.2, lon: 121.5 },
      { name: "Shenzhen", lat: 22.5, lon: 114.1 },
      { name: "Guangzhou", lat: 23.1, lon: 113.3 },
      { name: "Chengdu", lat: 30.7, lon: 104.1 },
      { name: "Hong Kong", lat: 22.3, lon: 114.2 },
      { name: "Taipei", lat: 25, lon: 121.6 },
      { name: "Singapore", lat: 1.4, lon: 103.8 },
      { name: "Kuala Lumpur", lat: 3.2, lon: 101.7 },
      { name: "Jakarta", lat: -6.2, lon: 106.8 },
      { name: "Bangkok", lat: 13.8, lon: 100.5 },
      { name: "Ho Chi Minh City", lat: 10.8, lon: 106.7 },
      { name: "Hanoi", lat: 21, lon: 105.9 },
      { name: "Manila", lat: 14.6, lon: 121 },
      { name: "Mumbai", lat: 19.1, lon: 72.9 },
      { name: "Delhi", lat: 28.6, lon: 77.2 },
      { name: "Bangalore", lat: 13, lon: 77.6 },
      { name: "Hyderabad", lat: 17.4, lon: 78.5 },
      { name: "Chennai", lat: 13.1, lon: 80.3 },
      { name: "Kolkata", lat: 22.6, lon: 88.4 },
      { name: "Karachi", lat: 24.9, lon: 67 },
      { name: "Lahore", lat: 31.5, lon: 74.3 },
      { name: "Dhaka", lat: 23.8, lon: 90.4 },
      { name: "Colombo", lat: 6.9, lon: 79.9 },
      { name: "Kathmandu", lat: 27.7, lon: 85.3 },
      { name: "Yangon", lat: 16.8, lon: 96.2 },
      { name: "Phnom Penh", lat: 11.6, lon: 104.9 },
      { name: "Ulaanbaatar", lat: 47.9, lon: 106.9 },
      { name: "Sydney", lat: -33.9, lon: 151.2 },
      { name: "Melbourne", lat: -37.8, lon: 145 },
      { name: "Brisbane", lat: -27.5, lon: 153 },
      { name: "Perth", lat: -32, lon: 115.9 },
      { name: "Adelaide", lat: -34.9, lon: 138.6 },
      { name: "Auckland", lat: -36.8, lon: 174.8 },
      { name: "Wellington", lat: -41.3, lon: 174.8 },
      { name: "Christchurch", lat: -43.5, lon: 172.6 },
      { name: "Moscow", lat: 55.8, lon: 37.6 },
      { name: "Saint Petersburg", lat: 59.9, lon: 30.3 },
      { name: "Novosibirsk", lat: 55, lon: 82.9 },
      { name: "Vladivostok", lat: 43.1, lon: 131.9 }
    ]
  };
})();

// ══════════ src/body.js ══════════
// A body is a world: the data pack behind a map. The engine draws latitude and
// longitude and knows nothing about which sphere it is on — Earth is not
// special, it is only the body that ships in the box.
//
// What a body answers, and nothing more:
//
//   id, name         "moon", "Moon". The id also names the <mappo-moon> tag.
//   radiusKm         mean radius, so a consumer can turn kilometres into the
//                    body radii locate() speaks. May be null for an invented
//                    world.
//   latRange         the default framing, when the caller has not asked.
//   terms            { figure, ground } — what the two classes are called,
//                    for people rather than for code ("land"/"ocean",
//                    "maria"/"highlands"). Used in accessible labels.
//   figure(lat,lon)  the classification everything derives from: is this
//                    point part of the FIGURE (drawn) or the GROUND (not)?
//   outlines()       closed [lat, lon] rings of the figure, for
//                    figure-source="vector"; null if the body has none.
//   borders()        closed [lat, lon] rings of region boundaries; null if
//                    the body has no regions. Only Earth has politics so far.
//   places           the gazetteer: [{ name, lat, lon, kind? }] you can name
//                    in places="…".
//
// Other bodies are opt-in on purpose. Earth's mask and coastlines are already
// a substantial part of the root bundle, and a library that made you download
// the Moon to put a world map in a hero section would have lost the plot. So
// they load separately and register themselves:
//
//   import { registerBody } from "mappo";
//   import { MOON } from "mappo/bodies/moon";
//   registerBody(MOON);                     // also defines <mappo-moon>
//   <mappo-world body="moon">  or  <mappo-moon>
//
// Order does not matter. A map that asks for a non-empty body name before its
// pack has registered draws NOTHING — not Earth — and adopts the body the
// moment registerBody() runs. Drawing the wrong planet for a frame would be
// worse than drawing none. An omitted or empty name means the default, Earth.


const ID = /^[a-z][a-z0-9-]*$/;
const FULL_RANGE = [ -90, 90 ];
const PENDING_GRACE_MS = 2000;

const REGISTRY = new Map([ [ EARTH.id, EARTH ] ]);
const PENDING = new Map();     // id → the placeholder handed out until the pack arrives
const LISTENERS = new Set();   // registerBody() subscribers (element.js defines tags)

// Live maps, so a pack that arrives late can still take effect. It always
// arrives late: mappo defines the custom element as it loads, which upgrades
// every <mappo-world body="moon"> on the page before the consumer has had a
// line of their own run.
const LIVE = new Set();
const trackMap = (m) => LIVE.add(m);
const untrackMap = (m) => LIVE.delete(m);

// Hand a body over once, use it by name for ever after. Returns it, so the
// call reads as a definition rather than a side effect. Registering the same
// id again replaces the pack: maps that asked for it BY NAME follow the
// registry; maps handed a body object directly keep the object they were given.
function registerBody(body) {
  validateBody(body);
  REGISTRY.set(body.id, body);
  PENDING.delete(body.id);
  for (const m of LIVE) {
    if (typeof m.options?.body !== "string" || normalizeId(m.options.body) !== body.id) continue;
    try {
      m.adoptBody(body);
    } catch (error) {
      // Registration is global; one live map with incompatible partial
      // latitude bounds must not prevent the pack, its tag, or other maps
      // from becoming available. That map keeps its previous body and retries
      // name resolution on its next update, after the consumer can correct it.
      console.error(`[mappo] could not apply body "${body.id}" to one live map: ${error?.message ?? String(error)}`);
    }
  }
  for (const fn of LISTENERS) fn(body);
  return body;
}

// Called with every body registered from now on. Returns an unsubscribe.
function onBodyRegistered(fn) {
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

const knownBodies = () => [ ...REGISTRY.values() ];

// Accepts a name, a body object, or nothing (Earth). A name that is not
// registered yet resolves to a PENDING body — a placeholder that draws nothing
// and is swapped for the real one by registerBody(). Its identity is stable
// per id, so geometry caches keyed on the body object stay coherent.
function resolveBody(value) {
  if (value == null || value === "") return EARTH;
  if (typeof value === "object") return validateBody(value);
  if (typeof value !== "string") throw new TypeError("body must be a name or a body object");
  const id = normalizeId(value);
  if (!ID.test(id)) throw new TypeError(`body name must match ${ID} (got ${JSON.stringify(value)})`);
  return REGISTRY.get(id) ?? pendingBody(id);
}

function pendingBody(id) {
  let body = PENDING.get(id);
  if (!body) {
    body = Object.freeze({
      id, name: id, pending: true, radiusKm: null, latRange: FULL_RANGE, terms: null,
      figure: () => false, outlines: () => null, borders: () => null, places: Object.freeze([])
    });
    PENDING.set(id, body);
    // Packs normally register within the same script run, so the warning
    // waits: it should mean "you forgot to import the pack", not "the module
    // graph has not finished loading yet".
    if (typeof setTimeout === "function") {
      const timer = setTimeout(() => {
        if (!REGISTRY.has(id)) {
          console.warn(`[mappo] body "${id}" was never registered — maps asking for it stay empty until registerBody() runs. Did you import its pack?`);
        }
      }, PENDING_GRACE_MS);
      timer.unref?.();
    }
  }
  return body;
}

function normalizeId(value) {
  return String(value).trim().toLowerCase();
}

// Strict on purpose: a body is data that other people's maps will be built
// on, and a loose shape here becomes an undefined-is-not-a-function in a
// renderer later.
function validateBody(body) {
  if (!body || typeof body !== "object") throw new TypeError("a body must be an object");
  if (typeof body.id !== "string" || !ID.test(body.id)) {
    throw new TypeError(`body id must match ${ID} (got ${JSON.stringify(body.id)})`);
  }
  const at = `body "${body.id}"`;
  if (typeof body.name !== "string" || !body.name.trim()) throw new TypeError(`${at} needs a name`);
  if (typeof body.figure !== "function") throw new TypeError(`${at} needs a figure(lat, lon) function`);
  if (body.latRange != null && !validRange(body.latRange)) {
    throw new TypeError(`${at} latRange must lie within [-90, 90] with min < max`);
  }
  if (body.radiusKm != null && (!Number.isFinite(body.radiusKm) || !(body.radiusKm > 0))) {
    throw new TypeError(`${at} radiusKm must be a finite positive number`);
  }
  for (const key of [ "outlines", "borders" ]) {
    if (body[key] != null && typeof body[key] !== "function") throw new TypeError(`${at} ${key} must be a function`);
  }
  if (body.places != null) {
    if (!Array.isArray(body.places)) throw new TypeError(`${at} places must be an array`);
    const names = new Set();
    for (let i = 0; i < body.places.length; i++) {
      const place = body.places[i];
      if (!place || typeof place !== "object" || typeof place.name !== "string" || !place.name.trim()) {
        throw new TypeError(`${at} places[${i}] needs a non-empty name`);
      }
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) ||
          Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) {
        throw new TypeError(`${at} places[${i}] needs lat/lon within [-90, 90] and [-180, 180]`);
      }
      if (place.kind != null && typeof place.kind !== "string") {
        throw new TypeError(`${at} places[${i}] kind must be a string`);
      }
      if (place.color != null && typeof place.color !== "string") {
        throw new TypeError(`${at} places[${i}] color must be a string`);
      }
      const key = fold(place.name);
      if (names.has(key)) throw new TypeError(`${at} has duplicate place name ${JSON.stringify(place.name)}`);
      names.add(key);
    }
  }
  if (body.terms != null &&
      (typeof body.terms.figure !== "string" || !body.terms.figure.trim() ||
       typeof body.terms.ground !== "string" || !body.terms.ground.trim())) {
    throw new TypeError(`${at} terms must be non-empty { figure, ground } strings`);
  }
  return body;
}

function validRange(range) {
  return Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) &&
    range[0] >= -90 && range[1] <= 90 && range[0] < range[1];
}

// The band a body wants drawn when the caller has not said.
function bodyLatRange(body) {
  return body.latRange ?? FULL_RANGE;
}

// ── places ──────────────────────────────────────────────────────────────────

// "São Paulo" and "Sao Paulo" are the same place, and a person typing the
// first should not be told their city does not exist. Lookups fold accents
// and case; the name you passed is what gets labelled — folding is how we
// find the place, not how we spell it back.
function fold(name) {
  return name.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
const PLACE_INDEX = new WeakMap();   // body → Map(folded name → record)

// One entry of the `places` option: a gazetteer name (string) or a
// { name?, lat, lon, … } record of your own. Returns a normalised record, or
// null for a name the body does not know.
function resolvePlace(entry, body) {
  if (typeof entry === "string") {
    const name = entry.trim();
    if (!name) return null;
    let index = PLACE_INDEX.get(body);
    if (!index) {
      index = new Map();
      for (const place of body.places ?? []) index.set(fold(place.name), place);
      PLACE_INDEX.set(body, index);
    }
    const hit = index.get(fold(name));
    return hit ? { ...hit, name } : null;
  }
  if (entry && Number.isFinite(entry.lat) && Number.isFinite(entry.lon) &&
      Math.abs(entry.lat) <= 90 && Math.abs(entry.lon) <= 180 &&
      (entry.name == null || typeof entry.name === "string") &&
      (entry.kind == null || typeof entry.kind === "string") &&
      (entry.color == null || typeof entry.color === "string")) {
    return { ...entry, name: entry.name ?? "" };
  }
  return null;
}

// The whole option, with one warning per unknown name and body — never a
// throw: a typo'd place must not take down a hero section. A body that is
// still pending knows no places yet, and says nothing.
const WARNED_PLACES = new Set();
function resolvePlaces(entries, body) {
  const out = [];
  for (const entry of entries ?? []) {
    const place = resolvePlace(entry, body);
    if (place) { out.push(place); continue; }
    if (body.pending) continue;
    const key = `${body.id}|${JSON.stringify(entry)}`;
    if (!WARNED_PLACES.has(key)) {
      WARNED_PLACES.add(key);
      console.warn(`[mappo] unknown place ${JSON.stringify(entry)} on ${body.name} — not in its gazetteer; pass { name, lat, lon } instead`);
    }
  }
  return out;
}

// ══════════ src/figure.js ══════════
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
  return p !== null && body.figure(p.lat, p.lon);   // null: the cell is off the world
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
function traceCells(cols, rows, inside) {
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
function buildFigure(grid, { body, wrapX = false } = {}) {
  if (!body) throw new TypeError("buildFigure needs a body — pass { body: EARTH } or another registered body");
  let perBody = cache.get(body);
  if (!perBody) cache.set(body, perBody = new Map());
  const key = `${grid.cols}|${grid.rows}|${grid.latRange[0]}|${grid.latRange[1]}|${wrapX}|${grid.projection?.key ?? ""}`;
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
function parseFigureStyle(value) {
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
function figureOutlines(source, body) {
  return source === "vector" ? (body.outlines?.() ?? null) : null;
}

function figureBorders(body) {
  return body.borders?.() ?? null;
}

// ══════════ src/noise.js ══════════
// Compact 2D value noise — smooth, deterministic, zero-dependency. Used to
// shape animation DELAY fields (animation: "noise"): neighboring dots
// get neighboring phases, so the matrix shimmers in organic patches instead
// of mechanical sweeps. Not full simplex noise — for picking per-dot delays
// once at render time, smooth value noise is indistinguishable and a third
// of the code. If a future time-evolving mode needs higher-quality gradients,
// swap the internals; the noise2(x, y) → [-1, 1] contract holds.

// Deterministic integer hash → [0, 1). Same input, same output, every load —
// re-renders must not reshuffle the field.
function hash(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0; // large primes
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Quintic smoothstep — C2-continuous interpolation, no grid-line artifacts.
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// @return [Number] smooth noise in [-1, 1]
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;

  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);

  const ux = fade(fx), uy = fade(fy);
  const value = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  return value * 2 - 1;
}

// ══════════ src/color.js ══════════
// One color utility: the auto hover shade. When dot-hover-color isn't set,
// hovers derive from figure-color itself — darker for light dots, lighter for
// dark dots — so a custom-colored map never falls back to somebody else's
// gray. Hex in, hex out; non-hex inputs (named colors, rgb()) fall back to
// a CSS color-mix() string, which every browser that runs this component
// already supports.

function hoverShade(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color?.trim?.() ?? "");
  if (!m) return `color-mix(in srgb, ${color} 65%, black)`;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (ch) => ch + ch);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const shade = luminance > 140
    ? (v) => Math.round(v * 0.62)                    // light dot → darker shade
    : (v) => Math.round(v + (255 - v) * 0.45);       // dark dot → lighter tint
  return `#${[r, g, b].map((v) => shade(v).toString(16).padStart(2, "0")).join("")}`;
}

// Resolve a CSS custom property to a concrete colour.
//
// `figure-color="var(--color-border-100)"` should Just Work: the host already
// keeps its palette in CSS variables, and asking it to duplicate those hex
// values into map attributes guarantees the two drift — most visibly the
// moment someone adds a dark mode. Accepts `var(--x)` and `var(--x, #fallback)`;
// anything else passes through untouched.
function resolveColor(value, el) {
  if (typeof value !== "string") return value;
  const m = /^var\(\s*(--[^,)\s]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim());
  if (!m) return value;
  if (typeof getComputedStyle !== "function") return (m[2] ?? "").trim() || "#000";

  const root = el?.ownerDocument?.documentElement
    ?? (typeof document !== "undefined" ? document.documentElement : null);
  const resolved = root ? getComputedStyle(root).getPropertyValue(m[1]).trim() : "";
  return resolved || (m[2] ?? "").trim() || "#000";
}

// Does this option bundle reference any CSS variable? Renderers use this to
// decide whether it's worth watching the document for theme changes at all —
// a map with literal hex colours pays nothing.
function usesCssVars(...values) {
  return values.some((v) => typeof v === "string" && v.includes("var(--"));
}

// ══════════ src/highlight.js ══════════
// Region highlight: a polygon (rings of [lat, lon] pairs) tested per dot
// at geometry-build time. The consumer supplies the shape — mappo stays
// dependency-free (no bundled boundary dataset); VehiclesDB feeds it
// Natural Earth rings per jurisdiction.
//
// Ray-cast in lon/lat space. Rings that cross the antimeridian should be
// pre-normalized by the caller (shift western lons +360); normalizeRings
// below does it for rings whose lon span exceeds 180°.

function normalizeRings(rings) {
  return rings.map((ring) => {
    let min = Infinity, max = -Infinity;
    for (const [, lon] of ring) { if (lon < min) min = lon; if (lon > max) max = lon; }
    if (max - min <= 180) return { ring, shifted: false };
    return { ring: ring.map(([la, lo]) => [la, lo < 0 ? lo + 360 : lo]), shifted: true };
  });
}

function pointInRings(lat, lon, normalized) {
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

// ══════════ src/globe.js ══════════
// Globe mode: the same figure grid wrapped on a sphere and spun — on canvas,
// not SVG. A rotating globe re-projects every dot every frame; SVG would
// mean thousands of DOM attribute writes at 60Hz, which is exactly the
// failure mode the flat renderer's architecture exists to avoid. Canvas
// redraws ~4k rects/frame without noticing.
//
// The visual grammar (matched to the reference the mode was built for):
// dots shrink and fade toward the limb (foreshortening reads as depth),
// the front hemisphere only (back culled), and a thin halo ring floats
// just outside the sphere. tilt doubles as the axial tilt here — the same
// option that lays the flat map down leans the globe.
//
// Two options change that grammar, both opt-in:
//
//   distance   a perspective camera at that many body radii from the centre
//              (Infinity, the default, is the orthographic view). The near
//              side grows, the far side shrinks, and the visible cap is
//              smaller than a hemisphere — the way a camera actually sees a
//              sphere from close by.
//   fog        [near, far] in radii from the centre plane, positive away from
//              the viewer. The globe becomes GLASS: the far hemisphere is drawn
//              too, and everything fades from opaque at `near` to invisible at
//              `far`, so depth is carried by alpha rather than by culling.
//
// Geometry is a sphere of unit radius; `radiusKm` on a body is for the
// consumer's arithmetic, never for drawing. Latitude is planetocentric,
// longitude east-positive — whatever the body, whatever its native map used.
//
// Node-safe: the point-buffer builders are pure and testable; GlobeRenderer
// touches the DOM only in its constructor, which only runs in a browser.
//
// Expensive source geometry and trigonometry stay out of the frame loop: dots,
// figure quads, contour loops and vector outlines are precomputed unit-sphere
// coordinates in typed arrays. Frames rotate those into short-lived canvas
// paths, and a frame in which nothing moved is not drawn at all. Several
// globes on one page is a first-class case.


const DEGREES = 180 / Math.PI;
const GOLDEN = (1 + Math.sqrt(5)) / 2;

// Unit-sphere position for a lat/lon. At rotation 0, lon 0 faces the
// viewer (+z out of the screen), +y is north.
function latLonToXYZ(lat, lon) {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return {
    x: cosPhi * Math.sin(lambda),
    y: Math.sin(phi),
    z: cosPhi * Math.cos(lambda)
  };
}

// The number of Fibonacci-lattice candidates that gives the same spacing at
// the equator as a grid of `cols` cells: the sphere's area over one cell's.
function uniformCount(cols) {
  return Math.round((cols * cols) / Math.PI);
}

// The dot field, one sample at a time. Two ways to lay dots on a sphere:
//
//   "grid"     the lat/lon grid the flat map draws — cols cells across 360°,
//              rows = cols · Δφ / 360 — so flat and globe agree on what the
//              world looks like at a given resolution. Cells bunch toward the
//              poles, as a grid must.
//   "uniform"  a Fibonacci lattice: equal area per dot everywhere, no bunching.
//              round(cols² / π) candidates, so the equatorial spacing matches
//              the grid's and `cols` keeps meaning "resolution". A lattice has
//              two points its spiral arms converge on; they are put on the
//              equator at ±90° so that on Earth both fall in open ocean, where
//              a swirl cannot be seen. (The sample order and the golden-ratio
//              azimuth are the standard construction; the axis is the choice.)
//
// `fn(lat, lon, col, row)`: for the grid, the cell; for the lattice, the
// fractional grid position of the sample, so the animation phase fields and
// the hit-test have something spatial to hold on to.
function forEachSample(cols, latRange, distribution, fn) {
  const [ latMin, latMax ] = latRange;
  const rows = Math.round((cols / 360) * (latMax - latMin));
  if (distribution !== "uniform") {
    const grid = { cols, rows, latRange };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const c = cellCenter(col, row, grid);
        fn(c.lat, c.lon, col, row);
      }
    }
    return;
  }
  const n = uniformCount(cols);
  for (let i = 0; i < n; i++) {
    const theta = Math.acos(1 - (2 * i) / n);
    const a = 2 * Math.PI * GOLDEN * i;
    const sx = Math.sin(theta) * Math.cos(a), sy = Math.sin(theta) * Math.sin(a), sz = Math.cos(theta);
    // sy is north; the lattice axis (sz) points at lat 0, lon −90.
    const lat = Math.asin(sy) * DEGREES;
    let lon = Math.atan2(sx, sz) * DEGREES - 90;
    if (lon < -180) lon += 360;
    if (lat < latMin || lat > latMax) continue;
    fn(lat, lon, ((lon + 180) / 360) * cols, ((latMax - lat) / (latMax - latMin)) * rows);
  }
}

// Figure dots as a flat Float32Array [x,y,z, x,y,z, …] — same sampling as the
// flat renderer for the grid distribution (cellCenter + the body's figure()),
// so flat and globe agree on what the world looks like at a given resolution.
// `ground` flips the selection to the complement (the filler dots).
function buildGlobePoints(cols, latRange, body, ground = false, distribution = "grid") {
  const out = [];
  forEachSample(cols, latRange, distribution, (lat, lon) => {
    if (Boolean(body.figure(lat, lon)) === ground) return;
    const p = latLonToXYZ(lat, lon);
    out.push(p.x, p.y, p.z);
  });
  return new Float32Array(out);
}

// Per-point highlight flags, aligned index-for-index with buildGlobePoints
// (same loop, same skip rule) — the phase-array discipline, reused: geometry
// arrays never reorder, parallel arrays annotate.
function buildGlobeFlags(cols, latRange, test, body, distribution = "grid") {
  const out = [];
  forEachSample(cols, latRange, distribution, (lat, lon) => {
    if (!body.figure(lat, lon)) return;
    out.push(test(lat, lon) ? 1 : 0);
  });
  return new Uint8Array(out);
}

// Per-point animation phase + amplitude, aligned index-for-index with
// buildGlobePoints. Phase picks WHEN a dot moves in the cycle, amp how far —
// the exact fields the flat renderer bakes into its dot markup, so the modes
// read the same on a sphere.
function buildGlobePhases(cols, latRange, mode, body, distribution = "grid") {
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const out = [];
  forEachSample(cols, latRange, distribution, (lat, lon, col, row) => {
    if (!body.figure(lat, lon)) return;
    let p;
    switch (mode) {
      case "noise":   p = (noise2(col * 0.22, row * 0.22) + 1) / 2; break;
      case "ripple":  p = Math.hypot(col - cols / 2, row - rows / 2) / Math.hypot(cols / 2, rows / 2); break;
      case "sweep":   p = col / cols; break;
      case "sparkle": p = (noise2(col * 3.7 + 9, row * 3.7 + 9) + 1) / 2; break;
      default:        p = (col + row) / (cols + rows); // wave
    }
    out.push(p, 0.55 + 0.45 * ((noise2(col * 0.31 + 47, row * 0.31 + 47) + 1) / 2));
  });
  return new Float32Array(out);
}

// Tiles: a square lying ON the surface at each dot — nine floats per dot, the
// centre and the east and north tangents scaled to half a side (`halfSide`,
// in radii). Projected corner by corner, a tile foreshortens the way a real
// tangent square does: into a sliver along the limb, not a smaller square.
// Aligned index-for-index with buildGlobePoints, like everything else.
function buildGlobeTiles(cols, latRange, body, halfSide, ground = false, distribution = "grid") {
  const out = [];
  const h = halfSide;
  forEachSample(cols, latRange, distribution, (lat, lon) => {
    if (Boolean(body.figure(lat, lon)) === ground) return;
    const phi = lat / DEGREES, lambda = lon / DEGREES;
    const cp = Math.cos(phi), sp = Math.sin(phi), cl = Math.cos(lambda), sl = Math.sin(lambda);
    out.push(
      cp * sl, sp, cp * cl,                 // centre
      h * cl, 0, -h * sl,                   // east, half a side long
      -h * sp * sl, h * cp, -h * sp * cl    // north, half a side long
    );
  });
  return new Float32Array(out);
}

// [lat, lon] rings → one Float32Array of unit-sphere xyz per ring, memoised
// on the rings array itself (a body memoises its decoded outlines, so this
// is computed once per body per page, however many globes draw it).
const XYZ_RINGS = new WeakMap();
function xyzRings(rings) {
  let out = XYZ_RINGS.get(rings);
  if (!out) {
    out = rings.map((ring) => {
      const a = new Float32Array(ring.length * 3);
      for (let i = 0; i < ring.length; i++) {
        const p = latLonToXYZ(ring[i][0], ring[i][1]);
        a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
      }
      return a;
    });
    XYZ_RINGS.set(rings, out);
  }
  return out;
}

// Alpha is quantised into this many bands for the batched fills and strokes;
// fine enough that a fog gradient reads as continuous.
const BANDS = 24;

// Fog at view depth z (unit radii, positive toward the viewer), as an sRGB
// alpha: smoothstep from near to far in radii behind the centre plane, the
// transmittance then lifted by 1/2.2 so that compositing in sRGB matches a
// mix in linear light over a dark ground. See #fadeOf.
function fogAlpha(z, [ near, far ]) {
  const t = Math.min(1, Math.max(0, (-z - near) / (far - near)));
  const transmitted = 1 - t * t * (3 - 2 * t);
  return transmitted <= 0 ? 0 : Math.pow(transmitted, 1 / 2.2);
}

class GlobeRenderer {
  // @param container [HTMLElement] emptied; a square canvas fills its width.
  // @param options   [Object] the owning Mappo's options (shared ref).
  // @param body      [Object] the resolved body — Mappo owns resolution.
  // @param overlays  [Array]  host elements carrying data-lat/data-lon,
  //   harvested by Mappo before any renderer touched the container.
  constructor(container, options, body, overlays = []) {
    this.container = container;
    this.o = options;
    this._body = body;
    // focus: start the spin facing a point — the rotation that brings
    // the focus longitude to the front (z-max at rot = -λ, since
    // latLonToXYZ puts λ=0 facing the viewer at angle 0).
    this.angle = options.focus ? ((-options.focus.lon % 360) + 360) % 360 : 0;
    this._raf = null;
    this._t = null;
    this._dirty = true;

    // The host is guaranteed block-level by Mappo#render before we get here
    // — an inline container has clientWidth 0, which turned v0.3.0's first
    // cut into a stretched ribbon. The second half of that fix lives here:
    // the canvas box is aspect-locked square via CSS, so display size and
    // backing store can never disagree on shape.
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mappo-globe";
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.aspectRatio = "1 / 1";
    container.replaceChildren(this.canvas);
    // The host's overlay elements are re-parented into an absolutely-
    // positioned layer over the canvas and given a transform every frame.
    // The host keeps ownership of everything else — markup, styling, and
    // whether they are links.
    this._overlayEls = overlays;
    if (overlays.length) {
      if (getComputedStyle(container).position === "static") container.style.position = "relative";
      this._overlayLayer = document.createElement("div");
      this._overlayLayer.className = "mappo-overlay";
      // pointer-events:none on the LAYER, not the children: the layer must
      // not swallow drag-to-spin, but a label that wants to be clickable
      // only has to set pointer-events:auto on itself.
      Object.assign(this._overlayLayer.style, { position: "absolute", inset: "0", pointerEvents: "none" });
      for (const el of overlays) {
        Object.assign(el.style, { position: "absolute", left: "0", top: "0", willChange: "transform" });
        this._overlayLayer.appendChild(el);
      }
      container.appendChild(this._overlayLayer);
    }
    this.ctx = this.canvas.getContext("2d");

    this._watchTheme();
    this._rebuildData();

    // Reduced motion: one static frame, no loop. Checked once at build —
    // the OS-level setting rarely flips mid-visit.
    this._static = typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Offscreen globes must not burn frames — pause when scrolled away.
    this._visible = true;
    if (typeof IntersectionObserver === "function") {
      this._io = new IntersectionObserver(([ entry ]) => {
        this._visible = entry.isIntersecting;
        if (this._visible && !this._raf && !this._static) {
          this._t = null; // don't let the paused gap become one giant dt
          this._dirty = true;
          this._loop();
        }
      });
      this._io.observe(this.canvas);
    }
    if (typeof ResizeObserver === "function") {
      // Observe the canvas itself: its CSS box (100% wide, aspect-locked
      // square) is the ground truth the backing store must match.
      // The observer reports the LAYOUT size, which is the one that matters:
      // an ancestor's transform (a page scaling the globe in as it appears)
      // changes the box on screen, not the pixels the canvas should hold nor
      // the frame locate() should answer in.
      this._ro = new ResizeObserver(([ entry ]) => this._resize(entry?.contentRect?.width));
      this._ro.observe(this.canvas);
    }

    this.#bindPointer();
    this._resize(); // sizes the canvas and draws the first frame
    if (!this._static) this._loop();
  }

  // Options that only change how the existing geometry is PAINTED or POINTED.
  // Everything else — resolution, figure, the point set, what is on it — has
  // to be rebuilt, and an unknown key is treated as "rebuild" so a new option
  // can never quietly land in the cheap path.
  static PAINT_ONLY = new Set([
    "tilt", "roll", "rotateSpeed", "focus", "globeRing", "background",
    "figureColor", "figureStroke", "figureStrokeWidth", "dotHoverColor", "dotHoverScale",
    "bordersColor", "bordersWidth", "bordersOpacity",
    "graticuleColor", "equatorColor", "graticuleOpacity", "equatorOpacity", "graticuleWidth",
    "markerColor", "markerScale", "markerHoverScale", "highlightColor", "overlays",
    // The camera and the fog change the frame's arithmetic, not its geometry.
    "distance", "fog",
    // Flat-map concerns the globe ignores entirely.
    "projection", "centerLon"
  ]);

  // @param changed [Array|null] option keys that actually changed. Omit it and
  //   everything is rebuilt, which is what any caller that does not know gets.
  // @param body    [Object] the body to draw; Mappo passes its resolved one.
  update(changed = null, body = this._body) {
    this._cvCache = null;
    this._body = body;
    // Re-checked on every update, not only at build: a colour can BECOME a
    // var() long after construction — a themed attribute set from JS, a knob,
    // a framework binding — and a globe that installed no observer because it
    // started out with literals would then sit at whatever the palette was
    // when it was built, and never follow the theme again.
    this._watchTheme();

    // Rebuilding the point set and re-decoding the outlines costs about
    // 13 ms at cols=150. Pointing the globe somewhere costs nothing. Pages
    // that re-aim every frame — a sun's-eye view, a follow-that-satellite —
    // were paying the first price for the second thing.
    const cheap = changed?.length && changed.every((k) => GlobeRenderer.PAINT_ONLY.has(k));
    if (!cheap) {
      this._figureGeom = null;
      this._rebuildData();
    }
    if (!changed || changed.includes("focus")) this.#aim();
    this._dirty = true;
    this._draw();
  }

  // focus is live, not just an opening position: setting it again re-aims.
  // The rotation that brings a longitude to the front is its negation, since
  // latLonToXYZ puts λ=0 facing the viewer at angle 0.
  #aim() {
    if (!this.o.focus) return;
    this.angle = ((-this.o.focus.lon % 360) + 360) % 360;
  }

  // Colours given as CSS variables follow the host's theme. Watch the document
  // element for the class/style flips theme switches are made of, drop the
  // memo, repaint. Costs nothing when every colour is a literal — no observer
  // is installed unless a var is in play, and it is disconnected again if the
  // last one goes away.
  _watchTheme() {
    const wanted = typeof MutationObserver === "function" && usesCssVars(
      this.o.figureColor, this.o.figureStroke, this.o.graticuleColor, this.o.equatorColor,
      this.o.markerColor, this.o.groundColor, this.o.background, this.o.bordersColor,
      this.o.highlightColor, this.o.dotHoverColor);
    if (wanted === !!this._themeObserver) return;
    if (!wanted) { this._themeObserver.disconnect(); this._themeObserver = null; return; }
    this._themeObserver = new MutationObserver(() => { this._cvCache = null; this._dirty = true; this._draw(); });
    this._themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: [ "class", "style", "data-theme" ]
    });
  }

  // Resolve a colour option, memoized. `var(--x)` costs one
  // getComputedStyle the first time and nothing after, until the theme moves.
  _c(value) {
    if (typeof value !== "string" || !value.includes("var(--")) return value;
    this._cvCache ??= new Map();
    if (!this._cvCache.has(value)) this._cvCache.set(value, resolveColor(value, this.container));
    return this._cvCache.get(value);
  }

  // Remove everything this renderer put in the container. The overlay
  // elements are Mappo's to keep; only the layer around them goes.
  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._io?.disconnect();
    this._ro?.disconnect();
    this._themeObserver?.disconnect();
    this._overlayLayer?.remove();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this._onDown);
    c.removeEventListener("pointermove", this._onMove);
    c.removeEventListener("pointerup", this._onUp);
    c.removeEventListener("pointercancel", this._onUp);
    c.removeEventListener("pointerleave", this._onLeave);
    c.removeEventListener("click", this._onClick);
    c.remove();
  }

  // ── pointer layer: hover/click events + drag-to-spin ─────────────────────
  // Mirrors the flat renderer's contract exactly: onDotClick/onDotEnter/
  // onPlaceClick/onPlaceEnter callbacks + bubbling mappo:* CustomEvents,
  // gated by `interactive`. On top of that, the globe is grabbable: drag
  // spins it directly, a flick carries momentum, and the spin relaxes back
  // to rotateSpeed on an exponential (~0.8s) — seamless handoff, no snap.

  // One marker/highlight footprint, honouring the shape options — the canvas
  // twin of the flat renderer's <use href="#…marker-shape">.
  #drawShape(sx, sy, size, shape) {
    const ctx = this.ctx;
    if (shape === "square") {
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    } else if (shape === "triangle") {
      ctx.beginPath();
      ctx.moveTo(sx, sy - size / 2);
      ctx.lineTo(sx + size / 2, sy + size / 2);
      ctx.lineTo(sx - size / 2, sy + size / 2);
      ctx.fill();
    } else if (shape === "pin") {
      // The map-pin (Google-marker silhouette): round head, tapered
      // tail, ANCHORED AT THE TIP — (sx, sy) is the place, the head
      // floats above it. A punched hole keeps it reading as a pin at
      // small sizes.
      const r = size * 0.62;
      const hy = sy - r * 1.9;      // head centre
      ctx.beginPath();
      ctx.arc(sx, hy, r, Math.PI * 0.85, Math.PI * 0.15);
      ctx.quadraticCurveTo(sx + r * 0.55, hy + r * 1.1, sx, sy);
      ctx.quadraticCurveTo(sx - r * 0.55, hy + r * 1.1, sx - r * Math.cos(Math.PI * 0.15), hy + r * Math.sin(Math.PI * 0.15));
      ctx.closePath();
      ctx.fill();
      const punch = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(sx, hy, r * 0.42, 0, 6.2832);
      ctx.fill();
      ctx.globalCompositeOperation = punch;
    } else { // circle + custom-path fallback
      ctx.beginPath();
      ctx.arc(sx, sy, size / 2, 0, 6.2832);
      ctx.fill();
    }
  }

  #bindPointer() {
    this._drag = { active: false, moved: 0, lastX: 0, lastT: 0, v: 0 };
    this._hover = null;
    const c = this.canvas;
    this._onDown = (e) => {
      if (this.o.interactive === false) return;
      this._drag.active = true;
      this._drag.moved = 0;
      this._drag.lastX = e.clientX;
      this._drag.lastT = e.timeStamp;
      this._drag.v = 0;
      c.setPointerCapture?.(e.pointerId);
      c.style.cursor = "grabbing";
    };
    this._onMove = (e) => {
      if (this.o.interactive === false) return;
      if (this._drag.active) {
        const dx = e.clientX - this._drag.lastX;
        const dt = Math.max(1, e.timeStamp - this._drag.lastT);
        // Surface-true feel: dragging the equator by R px turns ~57°.
        const dDeg = (dx * 180) / (Math.PI * this.side * 0.40);
        this.angle = (this.angle + dDeg + 360) % 360;
        this._drag.v = 0.75 * this._drag.v + 0.25 * (dDeg / (dt / 1000));
        this._drag.moved += Math.abs(dx);
        this._drag.lastX = e.clientX;
        this._drag.lastT = e.timeStamp;
        if (this._static) this._draw();
      } else {
        this.#hover(e);
      }
    };
    this._onUp = (e) => {
      if (!this._drag.active) return;
      this._drag.active = false;
      c.releasePointerCapture?.(e.pointerId);
      c.style.cursor = "grab";
      // The flick: released velocity becomes the spin, clamped sane; the
      // loop's exponential relaxation walks it back to rotateSpeed.
      this._omega = Math.max(-360, Math.min(360, this._drag.v));
      if (this._static) this._omega = this.o.rotateSpeed; // no momentum without motion
    };
    this._onLeave = () => this.#clearHover();
    this._onClick = (e) => {
      if (this.o.interactive === false) return;
      if (this._drag.moved > 4) return; // that was a drag, not a click
      const hit = this.#hitTest(e);
      if (hit) this.#dispatch(hit.kind, "Click", hit.detail);
    };
    c.addEventListener("pointerdown", this._onDown);
    c.addEventListener("pointermove", this._onMove);
    c.addEventListener("pointerup", this._onUp);
    c.addEventListener("pointercancel", this._onUp);
    c.addEventListener("pointerleave", this._onLeave);
    c.addEventListener("click", this._onClick);
  }

  #hover(e) {
    const hit = this.#hitTest(e);
    const key = hit ? `${hit.kind}:${hit.detail.name ?? `${hit.detail.col},${hit.detail.row}`}` : null;
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    this._hover = hit;
    this._dirty = true;
    this.canvas.style.cursor = hit
      ? (hit.kind === "place" ? this.o.markerCursor : this.o.cursor)
      : "grab";
    if (hit) this.#dispatch(hit.kind, "Enter", hit.detail);
    if (this._static) this._draw();
  }

  #clearHover() {
    if (!this._hover) return;
    this._hover = null;
    this._hoverKey = null;
    this._dirty = true;
    this.canvas.style.cursor = this.o.interactive === false ? "" : "grab";
    if (this._static) this._draw();
  }

  // Screen point → sphere surface → lat/lon → dot (or place, checked first in
  // screen space since markers draw on top). The inverse of #project: un-roll
  // the pointer, then cast a ray — straight in for the orthographic view, from
  // the camera for a perspective one — and un-tilt and un-spin the hit.
  #hitTest(e) {
    const T = this._T;
    if (!T) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { cx, cy, R, F, D, persp } = T;
    // Un-roll the pointer first: roll is applied last when drawing, so it
    // is undone first when inverting. Everything below then works in the
    // unrolled frame exactly as it did before roll existed.
    const rdx = mx - cx, rdy = my - cy;
    const ux = cx + rdx * T.cosRo + rdy * T.sinRo;
    const uy = cy - rdx * T.sinRo + rdy * T.cosRo;
    const base = Math.max(0.75, (4 * R) / (this.o.cols ?? 170)) * this.o.dotSize * 1.6;

    const s = this._scratch;
    for (const place of this.placeData) {
      if (!this.#projectXYZ(place.p.x, place.p.y, place.p.z, T, s)) continue;
      if (Math.hypot(mx - s[0], my - s[1]) <= Math.max(10, base * this.o.markerScale * 0.9)) {
        const detail = { name: place.name, lat: place.lat, lon: place.lon, element: this.canvas };
        if (place.kind) detail.kind = place.kind;
        return { kind: "place", detail };
      }
    }

    // Past the markers, everything below is about the DOT FIELD, and a
    // figure style without dots has none. Hit-testing it anyway made an
    // outline globe paint a hover blob where no dot was drawn, change the
    // cursor for it, and fire dotenter/dotclick for a thing that is not on
    // the screen.
    if (!parseFigureStyle(this.o.figure).dots) return null;

    let X, Y, Z;
    if (persp) {
      // The ray from the camera through the screen point meets the sphere
      // where (px² + py²)/F² · (D − z)² + z² = 1; the nearer root is the
      // visible surface.
      const px = ux - cx, py = -(uy - cy);
      const q = (px * px + py * py) / (F * F);
      const disc = 1 - q * (D * D - 1);
      if (disc < 0) return null;
      Z = (q * D + Math.sqrt(disc)) / (q + 1);
      X = (px * (D - Z)) / F;
      Y = (py * (D - Z)) / F;
    } else {
      X = (ux - cx) / R;
      Y = -(uy - cy) / R;
      const rr = X * X + Y * Y;
      if (rr > 1) return null;
      Z = Math.sqrt(1 - rr);
    }
    // Inverse of the draw transform: un-tilt, then un-spin.
    const y = Y * T.cosT + Z * T.sinT;
    const z1 = -Y * T.sinT + Z * T.cosT;
    const x = X * T.cosR - z1 * T.sinR;
    const z = X * T.sinR + z1 * T.cosR;
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) * DEGREES;
    const lon = Math.atan2(x, z) * DEGREES;

    const [ latMin, latMax ] = this.o.latRange;
    if (lat < latMin || lat > latMax) return null;
    const cols = this.o.cols ?? 170; // auto: globes want density — foreshortening thins the limb
    const rows = Math.round((cols / 360) * (latMax - latMin));
    if (this._distribution === "uniform") {
      // No cell to look up: the dot under the pointer is the nearest sample,
      // if one lies within a dot's spacing of the surface point.
      const pts = this.points;
      let best = -1, bestDot = Math.cos((1.2 * Math.PI) / cols);
      for (let i = 0; i < pts.length; i += 3) {
        const d = pts[i] * x + pts[i + 1] * y + pts[i + 2] * z;
        if (d > bestDot) { bestDot = d; best = i; }
      }
      if (best < 0) return null;
      const dlat = Math.asin(Math.max(-1, Math.min(1, pts[best + 1]))) * DEGREES;
      const dlon = Math.atan2(pts[best], pts[best + 2]) * DEGREES;
      const col = Math.min(cols - 1, Math.max(0, Math.floor(((dlon + 180) / 360) * cols)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(((latMax - dlat) / (latMax - latMin)) * rows)));
      return { kind: "dot", detail: { lat: dlat, lon: dlon, col, row, element: this.canvas } };
    }
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((latMax - lat) / (latMax - latMin)) * rows)));
    const c = cellCenter(col, row, { cols, rows, latRange: this.o.latRange });
    if (!this._body.figure(c.lat, c.lon)) return null;
    return { kind: "dot", detail: { lat: c.lat, lon: c.lon, col, row, element: this.canvas } };
  }

  #dispatch(kind, phase, detail) {
    if (this.o.interactive === false) return;
    const cb = this.o[`on${kind === "place" ? "Place" : "Dot"}${phase}`];
    if (cb) cb(detail);
    this.container.dispatchEvent(new CustomEvent(
      `mappo:${kind}${phase.toLowerCase()}`,
      { detail, bubbles: true }
    ));
  }

  _rebuildData() {
    const o = this.o;
    const cols = o.cols ?? 170; // auto: globes want density — foreshortening thins the limb
    const distribution = o.distribution === "uniform" ? "uniform" : "grid";
    this._distribution = distribution;
    this.points = buildGlobePoints(cols, o.latRange, this._body, false, distribution);
    // Tiles lie on the surface: a side is dotSize of a cell, and a cell is
    // 2π/cols radians across at the equator for either distribution.
    const tiles = o.dotShape === "tile";
    const half = (o.dotSize * Math.PI) / cols;
    this.tiles = tiles ? buildGlobeTiles(cols, o.latRange, this._body, half, false, distribution) : null;
    // The graticule is pure lat/lon geometry — built once per option change,
    // projected per frame. Cheap enough to rebuild unconditionally.
    this._graticule = o.graticule
      ? buildGraticule({ meridians: o.meridians, parallels: o.parallels })
      : null;
    // Region highlight: flags parallel the figure points (never reorder
    // geometry — annotate it).
    if (o.highlightPolygon?.length) {
      const normalized = normalizeRings(o.highlightPolygon);
      this.highlightFlags = buildGlobeFlags(cols, o.latRange, (lat, lon) => pointInRings(lat, lon, normalized), this._body, distribution);
    } else {
      this.highlightFlags = null;
    }
    const ground = o.groundColor && o.groundColor !== "none";
    this.groundPoints = ground ? buildGlobePoints(cols, o.latRange, this._body, true, distribution) : null;
    this.groundTiles = ground && tiles ? buildGlobeTiles(cols, o.latRange, this._body, half * 0.62, true, distribution) : null;
    this.phases = o.animation && o.animation !== "none"
      ? buildGlobePhases(cols, o.latRange, o.animation, this._body, distribution)
      : null;
    this.placeData = resolvePlaces(o.places, this._body)
      .map((p) => ({ ...p, p: latLonToXYZ(p.lat, p.lon) }));
    this.canvas.style.cursor = o.interactive === false ? "" : "grab";
    if (o.dotShape !== "circle" && o.dotShape !== "square" && o.dotShape !== "triangle" &&
        o.dotShape !== "tile" && !this._shapeWarned) {
      this._shapeWarned = true;
      console.warn(`[mappo] mode="globe" draws circle/square/triangle/tile dots; custom SVG paths fall back to squares`);
    }
    this._dirty = true;
  }

  // @param width [Number] the canvas's layout width when the caller knows it
  //   (the ResizeObserver does); otherwise it is read from layout, never from
  //   the bounding box, which an ancestor's transform would have scaled.
  _resize(width) {
    const side = (width > 0 ? width : 0) || this.canvas.clientWidth || this.container.clientWidth || 300;
    // Cap the backing store. A 3× phone painting a 400px globe would other-
    // wise allocate 1200² and burn the fill rate for detail no eye resolves;
    // 2 is where the returns stop on a dot field. (Cloudflare's WebGL globe
    // caps at the same number, and pins mobile to 1.)
    const raw = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
    const dpr = Math.min(raw, this.o.maxDpr ?? 2);
    this.side = side;
    this.canvas.width = Math.max(1, Math.round(side * dpr));
    this.canvas.height = Math.max(1, Math.round(side * dpr));
    this._dpr = dpr;
    this._dirty = true;
    this._draw();
  }

  // The frame loop advances the spin and draws — but only a frame in which
  // something moved. A parked globe (rotate-speed 0, nothing animating, no
  // pointer, no option change) costs nothing per frame, which is what lets a
  // dashboard hold a dozen of them. Anything that changes the picture without
  // moving the angle sets _dirty; _draw clears it.
  _loop() {
    this._raf = requestAnimationFrame((t) => {
      this._raf = null;
      if (!this._visible) return; // the IntersectionObserver restarts us
      const dt = this._t == null ? 16 : Math.min(100, t - this._t);
      this._t = t;
      const before = this.angle;
      const animating = !!(this.o.animation && this.o.animation !== "none" && this.phases);
      if (animating) this._time = (this._time || 0) + dt / 1000;
      if (this._drag?.active) {
        // The pointer owns the angle while dragging.
      } else {
        if (this._omega == null) this._omega = this.o.rotateSpeed;
        // Momentum relaxes back to the base spin — exponential, ~0.8s to
        // settle, so the handoff from a flick to auto-rotation is seamless.
        this._omega += (this.o.rotateSpeed - this._omega) * (1 - Math.exp(-dt / 800));
        if (Math.abs(this._omega) < 1e-4) this._omega = this.o.rotateSpeed;
        if (this._omega !== 0) this.angle = (this.angle + (this._omega * dt) / 1000 + 360) % 360;
      }
      if (this.angle !== before || animating || this._dirty) this._draw();
      this._loop();
    });
  }

  // Everything one frame needs to know about the camera, computed once per
  // frame and kept as this._T so locate() and hit-testing answer about the
  // picture on screen. Spin (sinR/cosR), axial tilt (sinT/cosT) and roll
  // (sinRo/cosRo); the disc radius R; and the camera:
  //   D        distance from the centre in radii (Infinity = orthographic)
  //   F        pixels per radius at the centre plane, chosen so the limb of
  //            the sphere lands exactly at R whatever the distance
  //   horizon  the view depth at which the surface turns away (1/D, or 0)
  //   fog      [near, far] or null
  #frame() {
    const o = this.o, side = this.side;
    const cx = side / 2, cy = side / 2, R = side * 0.40;
    const rot = (this.angle * Math.PI) / 180;
    const tilt = ((o.tilt || 0) * Math.PI) / 180;
    const roll = ((o.roll || 0) * Math.PI) / 180;
    let D = o.distance;
    if (D != null && D !== Infinity && !(Number.isFinite(D) && D > 1)) {
      if (!this._distanceWarned) {
        this._distanceWarned = true;
        console.warn(`[mappo] distance must be a number of body radii greater than 1 (got ${JSON.stringify(D)}); drawing the orthographic view`);
      }
      D = Infinity;
    }
    if (D == null) D = Infinity;
    const persp = Number.isFinite(D);
    const fog = Array.isArray(o.fog) && o.fog.length === 2 && o.fog.every(Number.isFinite) && o.fog[0] < o.fog[1] ? o.fog : null;
    return {
      cx, cy, R,
      sinR: Math.sin(rot), cosR: Math.cos(rot),
      sinT: Math.sin(tilt), cosT: Math.cos(tilt),
      sinRo: Math.sin(roll), cosRo: Math.cos(roll),
      D, F: persp ? R * Math.sqrt(D * D - 1) : R, persp, horizon: persp ? 1 / D : 0, fog
    };
  }

  // How squarely a surface point at view depth z faces the camera: 1 straight
  // on, 0 at the limb, −1 at the antipode. The orthographic camera is at
  // infinity, so facing is simply the depth.
  #facing(z, T) {
    return T.persp ? (T.D * z - 1) / Math.sqrt(T.D * T.D - 2 * T.D * z + 1) : z;
  }

  // The alpha a point at view depth z (unit radii) is drawn with. Fog decides
  // for a glass globe, on both hemispheres; an opaque globe hides its far side
  // and fades the near one with facing, between `lo` at the limb and lo + hi
  // straight on.
  //
  // Fog is light lost on the way, so it is computed the way a renderer's fog
  // is: a smoothstep between near and far (a linear ramp has visible corners
  // where it starts and stops), mixed in LINEAR light. A canvas composites in
  // sRGB, so the transmittance is converted to the alpha that gives the same
  // brightness over a dark ground: transmittance^(1/2.2). Over a light ground
  // this reads a little stronger than a true linear-light fog would.
  #fadeOf(z, T, lo = 0.25, hi = 0.75) {
    if (T.fog) return fogAlpha(z, T.fog);
    if (z <= T.horizon + 0.01) return 0;
    return lo + hi * this.#facing(z, T);
  }

  // One place that knows how a unit-sphere point becomes a pixel on this
  // sphere: spin about the polar axis, lean by the axial tilt, project —
  // orthographically, or through a camera D radii away — then roll in the
  // screen plane. Writes [sx, sy, depth] into `out` and returns whether the
  // point faces the viewer. Allocation-free — this is the per-vertex hot path
  // for figure quads, contours, tiles and vector outlines. (The dot loop keeps
  // its own inlined copy; it runs tens of thousands of times a frame and every
  // property read shows up.)
  #projectXYZ(x, y, z, T, out) {
    const x1 = x * T.cosR + z * T.sinR;
    const z1 = -x * T.sinR + z * T.cosR;
    const y2 = y * T.cosT - z1 * T.sinT;
    const z2 = y * T.sinT + z1 * T.cosT;
    const k = T.persp ? T.F / (T.D - z2) : T.R;
    const dx = x1 * k, dy = -y2 * k;
    out[0] = T.cx + dx * T.cosRo - dy * T.sinRo;
    out[1] = T.cy + dx * T.sinRo + dy * T.cosRo;
    out[2] = z2;
    return z2 > T.horizon + 0.01;
  }

  // The same transform for a lat/lon, as an object — graticule, overlays,
  // locate(). @param radius [Number] distance from the body's centre, in body
  // radii: 1 is the surface, 1.086 is Starlink when the body is Earth.
  #project(lat, lon, T, radius = 1) {
    const p = latLonToXYZ(lat, lon);
    const px = p.x * radius, py = p.y * radius, pz = p.z * radius;
    const x1 = px * T.cosR + pz * T.sinR;
    const z1 = -px * T.sinR + pz * T.cosR;
    const y2 = py * T.cosT - z1 * T.sinT;
    const z2 = py * T.sinT + z1 * T.cosT;
    const k = T.persp ? T.F / (T.D - z2) : T.R;
    const dx = x1 * k, dy = -y2 * k;
    let front;
    if (radius === 1) {
      front = z2 > T.horizon + 0.01;
    } else if (T.persp) {
      // A point off the surface is hidden only when the body is in the way:
      // when the segment from the camera to the point enters the sphere
      // before reaching it.
      const vx = x1, vy = y2, vz = z2 - T.D;
      const a = vx * vx + vy * vy + vz * vz, b = 2 * T.D * vz, c = T.D * T.D - 1;
      const disc = b * b - 4 * a * c;
      front = disc < 0 || (-b - Math.sqrt(disc)) / (2 * a) >= 1 - 1e-6;
    } else {
      // A point ON the sphere is visible when it faces us. A point ABOVE it is
      // hidden only when the body is actually in the way, which it can only be
      // inside the disc — so something in orbit over the far side still shows,
      // standing off the limb, which is exactly where you would see it from here.
      front = z2 > 0.01 || (radius > 1 && Math.hypot(x1, y2) > 1);
    }
    return {
      sx: T.cx + dx * T.cosRo - dy * T.sinRo,
      sy: T.cy + dx * T.sinRo + dy * T.cosRo,
      z: z2,
      front,
      // Fog is spatial: a point off the surface is fogged at its own depth. The
      // opaque fade is about facing, so it reads the surface point beneath.
      fade: T.fog ? this.#fadeOf(z2, T) : this.#fadeOf(z2 / radius, T)
    };
  }

  // Precomputed xyz for a batch of rings, projected this frame into the
  // point lists #strokeBanded wants. Trig happened once, at build time.
  #projectRings(xyz, T) {
    const out = new Array(xyz.length);
    const s = this._scratch;
    for (let r = 0; r < xyz.length; r++) {
      const ring = xyz[r];
      const pts = new Array(ring.length / 3);
      for (let i = 0, j = 0; i < ring.length; i += 3, j++) {
        const front = this.#projectXYZ(ring[i], ring[i + 1], ring[i + 2], T, s);
        pts[j] = { sx: s[0], sy: s[1], z: s[2], front, fade: this.#fadeOf(s[2], T) };
      }
      out[r] = pts;
    }
    return out;
  }

  // Vector outlines on the sphere: real coastlines, stroked and broken at
  // the limb exactly like the graticule.
  //
  // FILLING them is deliberately not attempted. In an orthographic projection
  // the far side of the world folds onto the near side, so feeding a whole
  // ring to fill() paints a mirrored ghost across the disc, and culling the
  // back points leaves the ring open, which fills to a straight chord.
  // Closing each visible run along the limb is the correct construction, but
  // every cheap rule for choosing the arc was measured painting open ocean (a
  // pixel probe over 24 rotations scored the candidates at 38, 35 and 98
  // wrongly filled samples). Until a proper hemisphere clip exists, the globe
  // fills from the grid — see #drawFigure — which culls cell by cell and
  // cannot fail that way, and these rings draw the edge on top.
  #strokeVector(rings, T, { stroke, width, alphaScale = 1 }) {
    // Stitched: the pack's cut at ±180° is a closure edge for a flat map, and
    // stroking it on a sphere drew a line down the antimeridian.
    this.#strokeBanded(this.#projectRings(xyzRings(stitchRings(rings)), T), stroke, width, 1, alphaScale, T);
  }

  // Grid geometry for the figure — the same figure.js geometry the flat map
  // uses — as unit-sphere coordinates, built once per option change:
  //   quads  Float32Array, 12 floats (4 corners) per figure cell
  //   loops  one Float32Array per boundary contour
  #figureGeometry(grid) {
    if (this._figureGeom) return this._figureGeom;
    // wrapX: on a globe there is no edge at the antimeridian, only more world.
    const { cells, loops } = buildFigure(grid, { wrapX: true, body: this._body });
    const quads = new Float32Array(cells.length * 12);
    let k = 0;
    for (const [ col, row ] of cells) {
      for (const [ c, r ] of [ [ col, row ], [ col + 1, row ], [ col + 1, row + 1 ], [ col, row + 1 ] ]) {
        const g = cellCorner(c, r, grid);
        const p = latLonToXYZ(g.lat, g.lon);
        quads[k++] = p.x; quads[k++] = p.y; quads[k++] = p.z;
      }
    }
    const loopXYZ = loops.map((loop) => {
      const a = new Float32Array(loop.length * 3);
      for (let i = 0; i < loop.length; i++) {
        const g = cellCorner(loop[i][0], loop[i][1], grid);
        const p = latLonToXYZ(g.lat, g.lon);
        a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
      }
      return a;
    });
    return (this._figureGeom = { quads, loops: loopXYZ });
  }

  // The figure as shape on the sphere.
  //
  // The two halves are drawn differently ON PURPOSE, because a sphere is not a
  // plane:
  //
  //   fill    — per-cell quads. A closed contour that crosses the limb cannot
  //             be filled correctly (half of it is on the far side and the ring
  //             is no longer closed in screen space). Projected quads tile
  //             edge-to-edge into the same landmass and cull individually, so
  //             the limb is handled by simply not drawing what faces away.
  //   outline — the contour loops, stroked and broken at the limb, exactly like
  //             the graticule. An edge is a line, so it has no such problem.
  //
  // Same source geometry, same option names, same result to the eye.
  #drawFigure(T, style) {
    const o = this.o;
    const ctx = this.ctx;
    const vector = figureOutlines(o.figureSource, this._body);
    const strokeColor = this._c(o.figureStroke ?? o.figureColor);
    const drawBorders = () => {
      const borders = o.borders ? figureBorders(this._body) : null;
      if (borders?.length) {
        this.#strokeVector(borders, T, {
          stroke: this._c(o.bordersColor ?? o.figureStroke ?? o.figureColor),
          width: o.bordersWidth ?? 0.5,
          alphaScale: o.bordersOpacity ?? 0.55
        });
      }
    };

    // Vector source without a fill: real outlines, no grid involved. This is
    // the sharpest the globe gets.
    if (vector && !style.fill) {
      if (style.stroke) this.#strokeVector(vector, T, { stroke: strokeColor, width: o.figureStrokeWidth ?? 1 });
      drawBorders();
      return;
    }

    // A FILLED globe stays on the grid, even when vector data is asked for.
    //
    // Not a preference — a consistency requirement. The vector outline is
    // 1/32° detailed; the mask the fill comes from is 512×256. Drawing one
    // inside the other leaves white slivers all down the European coast,
    // because they are the same geography at twenty-five times the detail.
    // Until vector fills can be clipped to the hemisphere properly, a filled
    // globe draws BOTH fill and edge from the grid, where they agree by
    // construction. Borders are lines, so they clip cleanly and can ride any fill.
    // Resolution stays at `cols`, deliberately. Sampling the fill finer than
    // the dot grid does buy smoother coastlines, but it multiplies the quads
    // projected every frame — measured as visible stutter on a page carrying
    // several globes, which is a worse defect than a stepped coast. Turn the
    // knob with `cols` if a particular map wants the detail and can pay.
    const cols = o.cols ?? 170;
    const rows = Math.round((cols / 360) * (o.latRange[1] - o.latRange[0]));
    const geom = this.#figureGeometry({ cols, rows, latRange: o.latRange });

    if (style.fill) {
      // Batched by alpha band, NOT one fill() per cell.
      //
      // The figure is a few thousand quads; issuing a beginPath/fill for each
      // was measured at ~13 ms per globe, which turns a page carrying several
      // of them into a slideshow. Path construction is nearly free — it is the
      // fill calls that cost — so the quads are accumulated into a handful of
      // paths, one per slice of the depth fade, and each is filled once. Same
      // picture, BANDS draw calls instead of thousands.
      const paths = Array.from({ length: BANDS }, () => new Path2D());
      const q = geom.quads;
      const A = this._scratch, B = this._scratchB, C = this._scratchC, Dd = this._scratchD;
      const glass = !!T.fog;
      let any = false;
      for (let i = 0; i < q.length; i += 12) {
        const fa = this.#projectXYZ(q[i], q[i + 1], q[i + 2], T, A);
        const fb = this.#projectXYZ(q[i + 3], q[i + 4], q[i + 5], T, B);
        const fc = this.#projectXYZ(q[i + 6], q[i + 7], q[i + 8], T, C);
        const fd = this.#projectXYZ(q[i + 9], q[i + 10], q[i + 11], T, Dd);
        // Opaque: a cell is drawn only when it faces us whole. Glass: every
        // cell is drawn, at the fog's alpha for its depth.
        if (!glass && !(fa && fb && fc && fd)) continue;
        const fade = this.#fadeOf((A[2] + B[2] + C[2] + Dd[2]) / 4, T, 0.35, 0.65);
        if (fade < 0.003) continue;
        const path = paths[Math.min(BANDS - 1, Math.floor(fade * BANDS))];
        path.moveTo(A[0], A[1]);
        path.lineTo(B[0], B[1]);
        path.lineTo(C[0], C[1]);
        path.lineTo(Dd[0], Dd[1]);
        path.closePath();
        any = true;
      }
      if (any) {
        ctx.fillStyle = this._c(o.figureColor);
        for (let i = 0; i < BANDS; i++) {
          ctx.globalAlpha = (i + 0.5) / BANDS;
          ctx.fill(paths[i]);
        }
      }
    }

    if (style.stroke) {
      // Contours are stroked per alpha band like everything else: a single
      // stroke() can only carry one alpha.
      this.#strokeBanded(this.#projectRings(geom.loops, T), strokeColor, o.figureStrokeWidth ?? 1, 1, 1, T);
    }
    // Boundaries are an overlay: draw them after the figure for every source.
    // Drawing them before a fill covers them; tying them to vector coastlines
    // makes `borders` silently do nothing with figure-source="grid".
    drawBorders();
    ctx.globalAlpha = 1;
  }

  // The graticule, stroked as polylines that break at the limb.
  //
  // Depth is carried by ALPHA rather than by clipping alone: a meridian
  // fades as it turns away, which is what stops the front and back of the
  // same circle from reading as one flat ellipse. The equator is stroked
  // last and separately — it is the line a reader orients against, so it
  // gets its own colour and weight instead of being one of eleven.
  #drawGraticule(T) {
    const o = this.o;
    if (!o.graticule || !this._graticule) return;
    const color = this._c(o.graticuleColor ?? o.figureColor);
    const equator = this._c(o.equatorColor ?? o.graticuleColor ?? o.figureColor);
    const width = o.graticuleWidth ?? 1;

    const project = (lines) => lines.map((line) => line.map(([ lat, lon ]) => this.#project(lat, lon, T)));
    this.#strokeBanded(project(this._graticule.meridians), color, width, o.graticuleOpacity, 1, T);
    this.#strokeBanded(project(this._graticule.parallels), color, width, o.graticuleOpacity, 1, T);
    this.#strokeBanded(project([ this._graticule.equator ]), equator, width, o.equatorOpacity, 1, T);
  }

  // Stroke polylines with a depth fade that is actually per-segment.
  //
  // The obvious way is wrong in a way that is easy to miss: setting
  // ctx.globalAlpha inside the point loop and calling stroke() once at the end
  // does NOT fade the line, because canvas reads globalAlpha when you stroke,
  // not when you add a point. Every polyline came out flat-toned at whatever
  // alpha its LAST vertex happened to set — which is why one coastline looked
  // dark, its neighbour looked faint, and half the Pacific's meridians differed
  // from the other half. Arbitrary, and it moved as the globe turned.
  //
  // So segments are bucketed by alpha and each bucket is stroked once. Same
  // fade, honestly applied, and far fewer draw calls than stroking per segment.
  // Each point carries its `fade` (see #fadeOf): on an opaque globe a segment
  // needs both ends in front; on a glass one every segment the fog leaves
  // visible is drawn, the far side included.
  #strokeBanded(lines, color, width, peak, alphaScale = 1, T = this._T) {
    const ctx = this.ctx;
    const glass = !!T?.fog;
    const paths = Array.from({ length: BANDS }, () => new Path2D());
    let any = false;
    for (const pts of lines) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!glass && (!a.front || !b.front)) continue;     // the far side, or crossing it
        const fade = (a.fade + b.fade) / 2;
        if (fade < 0.003) continue;
        const band = Math.min(BANDS - 1, Math.floor(fade * BANDS));
        paths[band].moveTo(a.sx, a.sy);
        paths[band].lineTo(b.sx, b.sy);
        any = true;
      }
    }
    if (!any) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";                       // keeps segments reading as one line
    for (let i = 0; i < BANDS; i++) {
      ctx.globalAlpha = peak * ((i + 0.5) / BANDS) * alphaScale;
      ctx.stroke(paths[i]);
    }
    ctx.globalAlpha = 1;
  }

  // Where a point on — or above — the globe lands on screen, in CSS pixels
  // from the top-left of the element. This is the same projection the frame
  // was drawn with, so anything positioned by it is registered to the pixel.
  //
  // Returns null before the first frame. `front` is false only when the body
  // is between you and the point. `z` is the point's depth toward the viewer
  // in radii (1 facing you, 0 on the limb plane, −1 the antipode) and `fade`
  // the alpha the globe itself draws at that depth — under fog, the fog's.
  locate(lat, lon, radius = 1) {
    if (!this._T) return null;
    const p = this.#project(lat, lon, this._T, radius);
    return {
      x: p.sx, y: p.sy,
      depth: Math.max(0, Math.min(1, p.z / radius)),
      front: p.front,
      z: p.z / radius,
      fade: p.fade,
      cx: this._T.cx, cy: this._T.cy, r: this._T.R
    };
  }

  // Position host-supplied DOM against the sphere.
  //
  // mappo writes ONE thing per element — a translate3d on the element that
  // carries data-lat/data-lon — and publishes depth as a custom property.
  // It deliberately does not touch scale, opacity or transition: those belong
  // to the host's own stylesheet, and an element whose position is rewritten
  // every frame must not also carry an eased transform, or the two fight.
  // The documented pattern is therefore a positioned root with a freely
  // styled child inside it.
  #placeOverlays(T) {
    if (!this._overlayLayer) return;
    this._overlayLayer.hidden = this.o.overlays === false;
    if (this.o.overlays === false) return;
    for (const el of this._overlayEls) {
      const lat = Number(el.dataset.lat);
      const lon = Number(el.dataset.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = this.#project(lat, lon, T);
      // Park far offscreen rather than hiding: no reflow, no flash at the
      // origin before the first projection lands.
      el.style.transform = p.front
        ? `translate3d(${p.sx.toFixed(2)}px, ${p.sy.toFixed(2)}px, 0)`
        : "translate3d(-9999px, -9999px, 0)";
      el.style.setProperty("--mappo-depth", p.front ? Math.max(0, this.#facing(p.z, T)).toFixed(3) : "0");
      el.toggleAttribute("data-mappo-behind", !p.front);
    }
  }

  // The dot field, one screen-aligned mark per point. Sized by the visible
  // cell, foreshortened and faded by facing; behind a perspective camera the
  // near side is drawn larger than the far. Under fog both hemispheres are
  // drawn, the far one first so the near one lies over it.
  #drawPoints(pts, T, { base, shape, alphaLo, alphaHi, anim, flags, baseColor, hiColor }) {
    const ctx = this.ctx;
    const { cx, cy, R, sinR, cosR, sinT, cosT, sinRo, cosRo, D, F, persp, horizon, fog } = T;
    const passes = fog ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const farPass = fog && pass === 0;
      let currentHi = null;
      for (let i = 0; i < pts.length; i += 3) {
        // Spin around the polar axis, then lean by the axial tilt.
        const x1 = pts[i] * cosR + pts[i + 2] * sinR;
        const z1 = -pts[i] * sinR + pts[i + 2] * cosR;
        const y2 = pts[i + 1] * cosT - z1 * sinT;
        const z2 = pts[i + 1] * sinT + z1 * cosT;
        const front = z2 > horizon + 0.01;
        if (fog ? front === farPass : !front) continue;
        const facing = persp ? (D * z2 - 1) / Math.sqrt(D * D - 2 * D * z2 + 1) : z2;
        let alpha;
        if (fog) {
          alpha = fogAlpha(z2, fog);
          if (alpha < 0.003) continue;
        } else {
          alpha = alphaLo + alphaHi * facing;                 // …and a depth fade
        }
        // Region highlight: per-dot colour switch, batched (fillStyle only
        // changes when the flag flips — dots stream in row order, so runs
        // are long and the switch is cheap).
        if (flags) {
          const hi = flags[i / 3] === 1;
          if (hi !== currentHi) {
            ctx.fillStyle = hi ? hiColor : baseColor;
            currentHi = hi;
          }
        }

        let lift = 0, sizeMul = 1;
        if (anim) {
          const j = (i / 3) * 2;
          const d = (anim.cycle - anim.phases[j] + 1) % 1;
          if (d < anim.w) {
            const bump = Math.sin(Math.PI * (d / anim.w)) * anim.phases[j + 1];
            if (anim.mode === "sparkle") sizeMul = 1 + 0.45 * bump;
            else lift = (anim.heightPx * bump) / R;
          }
        }
        const k = 1 + lift;
        const scale = persp ? F / (D - z2 * k) : R;
        const dx = x1 * k * scale, dy = -y2 * k * scale;
        const sx = cx + dx * cosRo - dy * sinRo;
        const sy = cy + dx * sinRo + dy * cosRo;
        // Foreshortening at the limb; a perspective camera also shrinks what
        // is farther away.
        const s = base * (0.45 + 0.55 * Math.abs(facing)) * sizeMul * (persp ? scale / R : 1);
        ctx.globalAlpha = alpha;
        if (shape === "circle") {
          ctx.beginPath();
          ctx.arc(sx, sy, s / 2, 0, 6.2832);
          ctx.fill();
        } else if (shape === "triangle") {
          ctx.beginPath();
          ctx.moveTo(sx, sy - s / 2);
          ctx.lineTo(sx + s / 2, sy + s / 2);
          ctx.lineTo(sx - s / 2, sy + s / 2);
          ctx.fill();
        } else {
          ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
        }
      }
    }
  }

  // The dot field as TILES: squares lying on the surface. A tangent square
  // projects to (very nearly) a parallelogram, and a parallelogram is one
  // setTransform and one fillRect — so each tile is drawn on its own with its
  // own alpha, and the fog is a true gradient rather than bands. Behind a
  // perspective camera tiles grow toward the viewer; along the limb they
  // foreshorten into slivers, as a real tangent square does.
  //
  // Not a Path2D batch, deliberately: appending to one Path2D grows quadratic
  // in Chrome past a few hundred subpaths (measured: 3k quads 28 ms, 7k 128 ms,
  // 14k 500 ms to build, the fill itself under a millisecond). Two calls per
  // tile is the fast path here, at about a quarter of a microsecond each.
  // Under fog both hemispheres are drawn, the far one first.
  #drawTiles(tiles, T, { alphaLo, alphaHi, anim, flags, baseColor, hiColor }) {
    const ctx = this.ctx, dpr = this._dpr;
    const { cx, cy, R, sinR, cosR, sinT, cosT, sinRo, cosRo, D, F, persp, horizon, fog } = T;
    const passes = fog ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const farPass = fog && pass === 0;
      let currentHi = null;
      for (let i = 0; i < tiles.length; i += 9) {
        // The centre through the spin and the tilt.
        const cx1 = tiles[i] * cosR + tiles[i + 2] * sinR, cz1 = -tiles[i] * sinR + tiles[i + 2] * cosR;
        const cy2 = tiles[i + 1] * cosT - cz1 * sinT, cz2 = tiles[i + 1] * sinT + cz1 * cosT;
        const front = cz2 > horizon + 0.01;
        if (fog ? front === farPass : !front) continue;
        let alpha;
        if (fog) {
          alpha = fogAlpha(cz2, fog);
          if (alpha < 0.003) continue;
        } else {
          alpha = alphaLo + alphaHi * (persp ? (D * cz2 - 1) / Math.sqrt(D * D - 2 * D * cz2 + 1) : cz2);
        }
        if (flags) {
          const hi = flags[i / 9] === 1;
          if (hi !== currentHi) {
            ctx.fillStyle = hi ? hiColor : baseColor;
            currentHi = hi;
          }
        }
        // The east and north half-edges through the same rotation.
        const ex1 = tiles[i + 3] * cosR + tiles[i + 5] * sinR, ez1 = -tiles[i + 3] * sinR + tiles[i + 5] * cosR;
        const ey2 = tiles[i + 4] * cosT - ez1 * sinT, ez2 = tiles[i + 4] * sinT + ez1 * cosT;
        const nx1 = tiles[i + 6] * cosR + tiles[i + 8] * sinR, nz1 = -tiles[i + 6] * sinR + tiles[i + 8] * cosR;
        const ny2 = tiles[i + 7] * cosT - nz1 * sinT, nz2 = tiles[i + 7] * sinT + nz1 * cosT;

        let k = 1, m = 1;
        if (anim) {
          const j = (i / 9) * 2;
          const d = (anim.cycle - anim.phases[j] + 1) % 1;
          if (d < anim.w) {
            const bump = Math.sin(Math.PI * (d / anim.w)) * anim.phases[j + 1];
            if (anim.mode === "sparkle") m = 1 + 0.45 * bump;
            else k = 1 + (anim.heightPx * bump) / R;
          }
        }
        const depth = persp ? D - cz2 * k : 1;
        const scale = persp ? F / depth : R;
        const dx = cx1 * k * scale, dy = -cy2 * k * scale;
        const sx = cx + dx * cosRo - dy * sinRo, sy = cy + dx * sinRo + dy * cosRo;
        // The half-edges on screen. Under a camera an edge's screen length is
        // not just its sideways part scaled by depth: the part of it that runs
        // toward or away from the camera moves its end across the screen too,
        // by x·dz/(D − z). That term is what folds a tile to a sliver at the
        // camera's horizon (where the sideways part alone would still be 1/D of
        // the side); leaving it out piles full-width tiles on the limb.
        const pe = persp ? ez2 / depth : 0, pn = persp ? nz2 / depth : 0;
        const exs = (ex1 + cx1 * k * pe) * scale * m, eys = -(ey2 + cy2 * k * pe) * scale * m;
        const nxs = (nx1 + cx1 * k * pn) * scale * m, nys = -(ny2 + cy2 * k * pn) * scale * m;
        ctx.setTransform(
          (exs * cosRo - eys * sinRo) * 2 * dpr, (exs * sinRo + eys * cosRo) * 2 * dpr,
          (nxs * cosRo - nys * sinRo) * 2 * dpr, (nxs * sinRo + nys * cosRo) * 2 * dpr,
          sx * dpr, sy * dpr);
        ctx.globalAlpha = alpha;
        ctx.fillRect(-0.5, -0.5, 1, 1);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _scratch = new Float64Array(3);
  _scratchB = new Float64Array(3);
  _scratchC = new Float64Array(3);
  _scratchD = new Float64Array(3);

  _draw() {
    const { ctx, side } = this;
    if (!ctx || !side) return;
    const o = this.o;
    this._dirty = false;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);

    const T = this.#frame();
    const { cx, cy, R } = T;
    // Kept so locate() answers about the frame on screen right now, not
    // about where the sphere was when someone last asked.
    this._T = T;

    // Solid planet: a uniform disc behind the dots.
    if (o.background && o.background !== "none") {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2);
      ctx.fillStyle = this._c(o.background);
      ctx.fill();
    }

    // The halo: a hairline orbit just outside the sphere. Optional.
    if (o.globeRing !== false) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
      ctx.strokeStyle = this._c(o.figureColor);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Graticule under the dots: it is the grid the world sits on, not an
    // overlay drawn across it.
    this.#drawGraticule(T);

    // Dot footprint ≈ visible cell spacing: cols spans 360° of longitude,
    // so the front hemisphere shows cols/2 dots across 2R.
    const base = Math.max(0.75, (4 * R) / (o.cols ?? 170)) * o.dotSize * 1.6;
    const shape = o.dotShape === "circle" || o.dotShape === "triangle" ? o.dotShape : "square";
    const tiles = o.dotShape === "tile" && this.tiles;

    // The animation modes on a sphere: the phase/amp fields decide when and
    // how far each dot lifts RADIALLY off the surface (sparkle scales size
    // instead) — the canvas twin of the flat renderer's translateY.
    const anim = !this._static && o.animation && o.animation !== "none" && this.phases ? {
      mode: o.animation,
      cycle: ((this._time || 0) / o.animationPeriod) % 1,
      w: Math.min(0.9, Math.max(0.02, o.animationWidth *
        ({ ripple: 0.8, sweep: 0.5, sparkle: 0.55 }[o.animation] ?? 1))),
      heightPx: o.animationHeight * (4 * R) / (o.cols ?? 170),
      phases: this.phases
    } : null;

    // Ground first — smaller, dimmer, same transform — so the figure reads on
    // top. The ground never animates: it is ground, the figure is figure.
    if (this.groundPoints) {
      const ground = this._c(o.groundColor);
      ctx.fillStyle = ground;
      if (tiles && this.groundTiles) this.#drawTiles(this.groundTiles, T, { alphaLo: 0.15, alphaHi: 0.55, baseColor: ground });
      else this.#drawPoints(this.groundPoints, T, { base: base * 0.62, shape, alphaLo: 0.15, alphaHi: 0.55 });
    }

    const figureStyle = parseFigureStyle(o.figure);
    if (figureStyle.dots) {
      const color = this._c(o.figureColor);
      ctx.fillStyle = color;
      const paint = { alphaLo: 0.25, alphaHi: 0.75, anim, flags: this.highlightFlags, baseColor: color, hiColor: this._c(o.highlightColor) };
      if (tiles) this.#drawTiles(this.tiles, T, paint);
      else this.#drawPoints(this.points, T, { base, shape, ...paint });
    } else {
      this.#drawFigure(T, figureStyle);
    }

    // Hovered dot re-draws bigger in the hover colour (cheap overdraw).
    if (this._hover?.kind === "dot") {
      const hp = latLonToXYZ(this._hover.detail.lat, this._hover.detail.lon);
      const s = this._scratch;
      if (this.#projectXYZ(hp.x, hp.y, hp.z, T, s)) {
        ctx.fillStyle = this._c(o.dotHoverColor) ?? hoverShade(this._c(o.figureColor));
        ctx.globalAlpha = 1;
        const grow = T.persp ? Math.sqrt(T.D * T.D - 1) / (T.D - s[2]) : 1;
        this.#drawShape(s[0], s[1], base * (0.45 + 0.55 * this.#facing(s[2], T)) * o.dotHoverScale * grow, shape);
      }
    }

    // Place markers ride the same transform, drawn on top at full strength;
    // the hovered one swells by markerHoverScale.
    ctx.fillStyle = this._c(o.markerColor);
    const mshape = [ "circle", "square", "triangle", "pin" ].includes(o.markerShape) ? o.markerShape : "circle";
    const s = this._scratch;
    for (const place of this.placeData) {
      if (!this.#projectXYZ(place.p.x, place.p.y, place.p.z, T, s)) continue;
      const hovered = this._hover?.kind === "place" && this._hover.detail.name === place.name;
      ctx.globalAlpha = 1;
      if (place.color) ctx.fillStyle = this._c(place.color);
      const grow = T.persp ? Math.sqrt(T.D * T.D - 1) / (T.D - s[2]) : 1;
      const ms = base * o.markerScale * 0.6 * (hovered ? o.markerHoverScale : 1) * grow;
      this.#drawShape(s[0], s[1], ms * 2, mshape);
      if (place.color) ctx.fillStyle = this._c(o.markerColor);
    }
    ctx.globalAlpha = 1;

    // DOM last: the overlay reads the same transform the frame just drew,
    // so labels can never lag the sphere by a frame.
    this.#placeOverlays(T);
  }
}

// ══════════ src/renderer.js ══════════
// The renderer: one body in, one interactive <svg> out — or, in globe mode, a
// canvas sphere (globe.js). This class owns the options, the body, the
// projection, the overlay children and the differential update; the flat SVG
// scene is built here and the globe is delegated.
//
// Design decisions worth knowing before changing things:
//
// - The FLAT map is SVG on purpose: dots stay real elements — CSS hover,
//   focusable markers, restylable from outside. Sensible up to ~250 cols;
//   beyond that a canvas renderer (same options object) is the plan.
//
// - THE FLAT MAP HAS A PROJECTION (projections.js). The grid is "sample the
//   body at the inverse projection of every screen cell", so a polar
//   stereographic or Equal Earth map gets a uniform dot field, grid contours
//   and highlights from exactly the code that draws the equirectangular one.
//   Markers, overlays, locate() and vector outlines use the forward mapping.
//   The globe ignores the projection: it is a physical view, not a map.
//
// - POSITIONING: every dot/marker is `<g transform="translate(x,y)"><use/></g>`
//   and ALL animation (hover, pulse, shimmer) transforms the INNER element,
//   whose shapes are centred on the local origin. Never scale an element that
//   carries x/y geometry: the scale multiplies the translate and dots fly
//   diagonally instead of growing in place (transform-box: fill-box is not
//   reliable on <use> cross-browser).
//
// - EVERY INSTANCE IS SELF-CONTAINED. The stylesheet is scoped to the host
//   with a data-mappo attribute, @keyframes names carry the instance id, and
//   so do the SVG ids the <use> elements, the ground pattern and the frame
//   clip reference — `href="#id"` resolves against the whole document, so two
//   maps sharing an id would both draw the FIRST map's dot shape and size.
//   Many worlds on one page is a first-class case, not an edge case.
//
// - DIFFERENTIAL UPDATES — the crash lesson. Rebuilding the world per option
//   change froze and eventually OOM-killed tabs: each rebuild parses
//   thousands of nodes, recalcs style/layout for all of them, re-registers
//   every infinite animation, and discards ~1MB of DOM for GC — and a slider
//   drag asks for that 60×/second. So update() classifies changed keys and
//   does the CHEAPEST sufficient thing:
//     · style keys  (colours, strokes, tilt, cursors, animation…) → rewrite
//       ONE persistent <style> element. No DOM touched.
//     · def keys    (dotShape/dotSize/markerShape/markerScale/groundColor) →
//       replace the <defs>; every <use> updates for free.
//     · marker keys (places, markerPulse) → rebuild only the markers group.
//     · geometry    (cols, latRange, projection, figure, figureSource…) → full
//       rebuild, but leading+trailing debounced to ≥150ms spacing, with an
//       LRU cache of dot-markup strings per resolution.
//     · body        → full rebuild, immediately, with caches dropped.
//   Animation phases (--mappo-pw wave / --mappo-pn noise) are baked into every
//   dot at build time and consumed via calc() in CSS, so animation mode AND
//   duration are pure style patches too. Negative animation-delays start each
//   dot mid-cycle — no synchronized flash on load.
//
// - Events are DELEGATED from the svg root (three listeners total), never
//   per-dot. Payload coordinates come from data attributes on the wrapper.
//
// - The tilt lives on a WRAPPER div around the svg — the svg itself stays
//   untransformed so consumer getBoundingClientRect math keeps working.


const DEFAULTS = {
  // Shape of the world: "flat" (SVG plane) or "globe" (rotating canvas sphere).
  mode: "flat",
  // Which world. Earth unless a body pack has been registered and named; see
  // src/body.js. Takes a name or a body object.
  body: null,
  // Grid
  cols: null,                 // auto: 120 flat · 170 globe (hard max 260); set to override
  // Latitude bounds. null means "the body's own framing" (Earth cuts Antarctica
  // and the arctic emptiness; the Moon and Mars show their poles), or a
  // hemisphere on a polar projection. The effective range is always available
  // as options.latRange. On a polar map the far bound is the rim of the disc.
  latMin: null,
  latMax: null,
  // The flat map's projection: "equirectangular" (default), "equal-earth",
  // "stereographic-north", "stereographic-south", a { forward, inverse } object
  // or a d3-geo projection. See src/projections.js. The globe ignores it.
  projection: "equirectangular",
  // The central meridian of the flat map, degrees east: 150 gives a
  // Pacific-centred map. Cylindrical projections move their seam with it;
  // polar ones rotate.
  centerLon: 0,
  // The FIGURE — what the body classifies as drawn (land, maria, lowlands…) —
  // and how it is rendered. A space-separated token list, so combinations
  // read the way you would say them out loud. Identical on both renderers:
  //   "dots"           the dot field mappo is named for (default)
  //   "solid"          filled
  //   "outline"        the edge only
  //   "solid outline"  filled, with the edge drawn on top
  figure: "dots",
  figureColor: "#d3dce6",     // the figure's colour: the dots, or the fill
  figureStroke: null,         // the edge; defaults to figureColor
  figureStrokeWidth: 1,
  // Where the edge comes from: "grid" (traced from the body's figure() on the
  // dot grid — blocky, follows cols, free) or "vector" (the body's own
  // outlines — smooth at any size; a body without them falls back to grid).
  figureSource: "grid",
  // The GROUND — everything that is not figure — as filler dots in their own
  // shade, e.g. "#e8eef5"; "none" leaves it empty. Draws under any figure style.
  groundColor: "none",
  background: "none",         // a uniform fill behind everything (the world's outline on a flat map / the globe disc)
  // Region boundaries (Earth: country borders), where the body has them.
  borders: false,
  bordersColor: null,         // defaults to the figure stroke
  bordersWidth: 0.5,
  bordersOpacity: 0.55,
  // Dots
  dotShape: "circle",         // "circle" | "square" | "triangle" | "tile" (a square lying on the surface) | an SVG path string (24×24 units)
  dotSize: 0.55,              // fraction of a grid cell the dot fills
  dotHoverColor: null,        // auto: a contrast-aware shade of figureColor
  dotHoverScale: 2.6,
  // Places: gazetteer names of the current body ("London" on Earth, "Apollo 11"
  // on the Moon) and/or your own { name, lat, lon, color? } records.
  places: [],
  focus: null,                // { lat, lon } the globe faces (rotate-speed 0 holds it)
  highlightPolygon: null,     // rings of [lat, lon] — figure cells inside draw in highlightColor
  highlightColor: "#8fb0d8",
  markerShape: "circle",
  markerColor: "#2262fe",
  markerScale: 1.5,           // relative to a dot
  markerPulse: false,         // radar ping (expanding fading ring) — opt-in
  markerHoverScale: 1.8,
  // The globe
  rotateSpeed: 4,             // spin, degrees per second (0 = still)
  roll: 0,                    // LEAN, in the plane of the screen (deg)
  globeRing: false,           // opt-in hairline halo around the globe
  // Graticule — the meridian/parallel grid, on both renderers. The equator is
  // drawn separately so it can carry its own weight: it is the line a reader
  // orients against.
  graticule: false,
  meridians: 12,              // evenly spaced longitudes
  parallels: 11,              // evenly spaced latitudes; the equator is extra
  graticuleColor: null,       // defaults to figureColor
  equatorColor: null,         // defaults to graticuleColor
  graticuleOpacity: 0.28,
  // Only a touch above the other lines. The equator earns its own colour and
  // weight option so it CAN be emphasised, but emphasising it by default reads
  // as a bug — one parallel inexplicably darker than its neighbours.
  equatorOpacity: 0.36,
  graticuleWidth: 1,          // line width: CSS px on the globe; a multiplier of the flat map's hairline
  // Position host DOM carrying data-lat/data-lon over the map.
  overlays: true,
  // Cap the canvas backing store. 3× devices buy no visible detail on a dot
  // field and pay full fill-rate for it.
  maxDpr: 2,
  // The globe's camera: its distance from the centre in body radii. Infinity
  // (the default) is the orthographic view; a finite value is a perspective
  // camera that far away — the near side grows, the far side shrinks and the
  // visible cap is smaller than a hemisphere. 2 to 4 reads as a globe seen
  // from close by.
  distance: Infinity,
  // Fog, as [near, far] in body radii from the globe's centre plane, positive
  // away from the viewer. Set, it makes the globe GLASS: the far hemisphere is
  // drawn too, and everything fades from opaque at near to gone at far. null
  // keeps the opaque globe with its built-in facing fade.
  fog: null,
  // How the globe's dots sample the sphere: "grid" — the lat/lon grid the
  // flat map draws, cells bunching toward the poles — or "uniform", a
  // Fibonacci lattice with equal area per dot and round(cols²/π) candidates,
  // so `cols` still means the spacing at the equator.
  distribution: "grid",
  // Plane transform (degrees; the classic hero skew)
  tilt: 0,
  rotate: 0,
  perspective: 1000,
  // Animation over the whole matrix. Three plain-language knobs:
  animation: "none",          // "none" | "wave" | "noise" | "ripple" | "sweep" | "sparkle"
  animationPeriod: 6,         // seconds per full cycle (bigger = slower)
  animationHeight: 0.8,       // crest height, in CELLS (1 = one grid cell)
  animationWidth: 0.13,       // crest window as a fraction of the cycle (smaller = thinner front)
  // Interaction
  cursor: "default",
  markerCursor: "pointer",
  interactive: true,
  // Callbacks (each also fires as a bubbling CustomEvent "mappo:*")
  onDotClick: null,           // ({ lat, lon, col, row, element })
  onDotEnter: null,
  onPlaceClick: null,         // ({ name, lat, lon, kind?, element })
  onPlaceEnter: null
};

// Which update path each option needs. Callback keys appear in none of these
// on purpose: they're read at dispatch time, changing them costs nothing.
// Anything unlisted defaults to the safe full rebuild.
const STYLE_KEYS = new Set([
  "figureColor", "figureStroke", "figureStrokeWidth", "dotHoverColor", "dotHoverScale",
  "bordersColor", "bordersWidth", "bordersOpacity", "highlightColor",
  "graticuleColor", "equatorColor", "graticuleOpacity", "equatorOpacity", "graticuleWidth",
  "markerColor", "markerHoverScale", "tilt", "rotate", "perspective",
  "animation", "animationPeriod", "animationHeight", "animationWidth", "cursor", "markerCursor",
  // Backdrop knobs are pure stylesheet in flat mode: the bg shape and the
  // pattern-filled ground always exist; only their fills change.
  "background", "globeRing",
  // Globe-only camera knobs: the flat map ignores them, so there is nothing to rebuild.
  "distance", "fog"
]);
const DEF_KEYS = new Set([ "dotShape", "dotSize", "markerShape", "markerScale", "groundColor" ]);
const MARKER_KEYS = new Set([ "places", "markerPulse", "interactive" ]);
const CALLBACK_KEYS = new Set([ "onDotClick", "onDotEnter", "onPlaceClick", "onPlaceEnter" ]);

const SVG_NS = "http://www.w3.org/2000/svg";
const CELL = 10;        // internal SVG units per grid cell — never exposed

// Every instance scopes its stylesheet and its SVG ids with this.
let instanceSeq = 0;
const MAX_COLS = 260;   // above this, SVG node count degrades interaction
const REBUILD_MS = 150; // min spacing between geometry rebuilds
// Animation noise field frequencies. PHASE picks when a dot moves, AMP how
// far — two octaves at different scales is what makes the surface read as
// organic material instead of a screensaver. 0.22 ≈ patches a few dots
// wide (the 0.09 v1 field produced continent-sized blobs — "too big").
const NOISE_PHASE_SCALE = 0.22;
const NOISE_AMP_SCALE = 0.31;

// Deep instrumentation, two layers:
// - performance.mark/measure spans ship ALWAYS (they cost ~nothing and make
//   any DevTools Performance trace self-documenting: look for "wm:*" blocks
//   in the flame chart).
// - console output is opt-in via `Mappo.debug = true` (the perf harness
//   turns it on) so production consumers get a silent component.
function span(name, fn) {
  const m0 = `${name}:start`;
  performance.mark(m0);
  const out = fn();
  performance.measure(name, m0);
  const entries = performance.getEntriesByName(name);
  const ms = entries[entries.length - 1]?.duration ?? 0;
  performance.clearMarks(m0);
  return [ out, ms ];
}
function dbg(...args) {
  if (Mappo.debug) console.debug("[mappo]", ...args);
}

class Mappo {
  // Opt-in deep console output ("[mappo] …"). The perf harness sets this.
  static debug = false;
  // @param container [HTMLElement] emptied and rendered into; sizing is the
  //   consumer's (the svg scales to the container via viewBox).
  // @param options   [Object] see DEFAULTS.
  constructor(container, options = {}) {
    this.container = container;
    this.options = { ...DEFAULTS, ...options };
    this._uid = ++instanceSeq;
    // Preserve which latitude bounds the caller actually owns. The effective
    // range lives in options.latRange; null bounds inherit from each body, so
    // a late-arriving Moon can change Earth's +84 default to its own +90 while
    // keeping an explicit lat-min untouched.
    this._latRangeOverride = "latRange" in options
      ? [ options.latRange?.[0] ?? null, options.latRange?.[1] ?? null ]
      : [ options.latMin ?? null, options.latMax ?? null ];
    // Which world. Resolved once here and once per body update, never per cell.
    this._body = resolveBody(this.options.body);
    // Host DOM carrying data-lat/data-lon is harvested ONCE, here, before any
    // renderer touches the container's children, and lent to whichever
    // renderer is active. Keep the original child tree too: overlays may be
    // nested in consumer wrappers, and destroy() must restore that structure
    // and its non-overlay siblings rather than flattening everything.
    this._hostChildren = typeof container.childNodes === "object"
      ? Array.from(container.childNodes)
      : [];
    this._overlays = typeof container.querySelectorAll === "function"
      ? Array.from(container.querySelectorAll("[data-lat][data-lon]"))
      : [];
    this._overlayState = new Map(this._overlays.map((el) => [ el, captureOverlay(el) ]));
    this._dotsCache = new Map();    // projection|cols → { markup, dots }
    this._figureCache = new Map();  // figure paths have a different value shape
    this.#applyLatRange();
    this.render();
    // Do not retain a half-constructed map if a host DOM or custom body throws
    // during its first render.
    trackMap(this);
  }

  // The resolved body this map is drawing — a registered pack, the object you
  // passed, or a pending placeholder while a named pack has not arrived.
  get body() {
    return this._body;
  }

  // The projection instance the flat map is drawing with (null on the globe):
  // forward(lat, lon), inverse(x, y), aspect, outline() in unit-frame coordinates.
  get projection() {
    return this.grid?.projection ?? null;
  }

  // Swap the world under a map that has already drawn. Two things have to
  // happen together: the band the body asked for is re-applied (the Moon
  // wants its poles), and the geometry is rebuilt from scratch with the
  // instance caches dropped, so "rebuild" really does recompute.
  adoptBody(body) {
    if (this.#setBody(body)) this.render();
  }

  // Where a point lands on screen, in CSS pixels from the top-left of the
  // element — the projection the renderer itself uses, handed back so you can
  // draw your own layer over the map and have it register to the pixel.
  //
  //   const p = map.locate(51.5, -0.1);        // London, on the surface
  //   const s = map.locate(lat, lon, 1.086);   // and something in orbit
  //
  // `radius` is distance from the body's centre in body radii, and only means
  // anything on the globe: a flat map has no third dimension to leave.
  // Returns null before the first frame, null for a point the flat map's
  // projection has no place for, and { front: false } for a point the globe
  // is currently hiding. On the flat map `front` is always true, and the
  // answer ignores tilt/rotate/perspective — those are a CSS transform on top
  // of the box this reports in.
  locate(lat, lon, radius = 1) {
    if (this._globe) return this._globe.locate(lat, lon, radius);
    // The LAYOUT box, computed rather than measured: the svg fills the
    // element's width and takes its height from the grid's aspect, and
    // getBoundingClientRect would fold the tilt transform into the answer.
    const w = this.container?.clientWidth ?? 0;
    if (!w || !this.grid) return null;
    const p = this.grid.projection.forward(lat, lon);
    if (!p) return null;
    const h = w * this.grid.rows / this.grid.cols;
    return { x: p.x * w, y: p.y * h, depth: 1, front: true };
  }

  // Differential update — see the header. Public contract: call with any
  // subset of options, as often as you like; the component picks the
  // cheapest sufficient refresh and never lets bursts stack up.
  update(options = {}) {
    // Bodies compare by identity (a replacement pack with the same id is a
    // different world); everything else structurally.
    const changed = Object.keys(options).filter((k) =>
      k === "body" || k === "projection"
        ? options[k] !== this.options[k]
        : !sameOption(options[k], this.options[k]));
    let nextOverride = [ ...this._latRangeOverride ];
    if ("latRange" in options) {
      nextOverride = [ options.latRange?.[0] ?? null, options.latRange?.[1] ?? null ];
    } else {
      if ("latMin" in options) nextOverride[0] = options.latMin;
      if ("latMax" in options) nextOverride[1] = options.latMax;
    }
    const oldRange = this.options.latRange;
    // A named pack may have registered since this map's last update. Resolve
    // names again even when the body option itself did not change, so a map
    // whose first late adoption failed (for example, incompatible partial
    // latitude bounds) recovers as soon as the consumer corrects its options.
    const nextBody = changed.includes("body")
      ? resolveBody(options.body)
      : typeof this.options.body === "string" ? resolveBody(this.options.body) : this._body;
    const bodyResolved = nextBody !== this._body;
    // Validate the whole frame before mutating live state: the range, and the
    // projection built on it (a north polar map cannot reach the south pole).
    const nextProjection = "projection" in options ? options.projection : this.options.projection;
    const nextCenter = "centerLon" in options ? options.centerLon : this.options.centerLon;
    const nextMode = "mode" in options ? options.mode : this.options.mode;
    const nextRange = this.#rangeFor(nextBody, nextOverride, nextProjection, nextMode);
    // Projection has no meaning on a globe. In flat mode, resolving up front
    // makes the update atomic and also fingerprints mutable d3 projection
    // state, so a rotate()/clipAngle()/parallels() mutation cannot reuse stale
    // geometry merely because the function identity stayed the same.
    const resolvedNext = nextMode === "flat"
      ? resolveProjection(nextProjection, { latRange: nextRange, centerLon: nextCenter })
      : null;
    if (resolvedNext && this.grid?.projection && resolvedNext.key !== this.grid.projection.key && !changed.includes("projection")) {
      changed.push("projection");
    }
    this._latRangeOverride = nextOverride;
    Object.assign(this.options, options);
    this.options.latRange = nextRange;
    // Like mode: a different world is different geometry, so it skips the
    // patch tiers entirely rather than hoping `body` appears in one of them.
    if (changed.includes("body") || bodyResolved) {
      dbg("update: body →", this.options.body, "→ full rebuild");
      this.#setBody(nextBody);
      // A body representation can change ("moon" → the same MOON object)
      // alongside another option. Render the whole merged update even when
      // the resolved body identity itself did not change.
      this.render();
      return;
    }
    if (!sameOption(oldRange, this.options.latRange) && !changed.includes("latRange")) {
      changed.push("latRange");
    }
    if (changed.length === 0) return;

    if (changed.every((k) => CALLBACK_KEYS.has(k))) {
      dbg("update: callbacks only", changed, "→ no work");
      return; // read at dispatch time
    }

    // Globe mode sidesteps the SVG patch tiers entirely: the canvas redraws
    // every frame anyway, so any change is a cheap buffer/style refresh —
    // except a mode switch, which swaps renderers via the geometry path.
    if (changed.includes("mode")) {
      dbg("update: mode →", this.options.mode, "→ renderer swap");
      this.#scheduleRebuild();
      return;
    }
    if (this.options.mode === "globe") {
      if (this._globe) {
        this._globe.update(changed, this._body);
        // Canvas has no accessible descendants: keep its text alternative in
        // sync with runtime marker/body changes just as the flat SVG does.
        this._globe.canvas.setAttribute("aria-label", this.#ariaLabel());
        dbg("update:", changed, "→ globe refresh");
      }
      else this.#scheduleRebuild();
      return;
    }

    const styleOnly = changed.every((k) =>
      STYLE_KEYS.has(k) || DEF_KEYS.has(k) || MARKER_KEYS.has(k) || CALLBACK_KEYS.has(k));

    if (!styleOnly) {
      dbg("update:", changed, "→ GEOMETRY rebuild (debounced)");
      this.#scheduleRebuild();
      return;
    }
    const patches = [];
    if (changed.some((k) => DEF_KEYS.has(k))) {
      const [ , defsMs ] = span("wm:patch-defs", () => this.#patchDefs());
      patches.push(`defs ${defsMs.toFixed(1)}ms`);
    }
    if (changed.some((k) => MARKER_KEYS.has(k))) {
      const [ , markersMs ] = span("wm:patch-markers", () => this.#patchMarkers());
      patches.push(`markers ${markersMs.toFixed(1)}ms`);
    }
    const [ , styleMs ] = span("wm:patch-style", () => this.#patchStyle());
    patches.push(`style ${styleMs.toFixed(1)}ms`);
    dbg("update:", changed, "→", patches.join(" · "));
  }

  // Tear down, and hand the host's overlay children back exactly as they
  // were: a moved or re-connected element must find them again.
  destroy() {
    untrackMap(this);
    clearTimeout(this._rebuildTimer);
    this._globe?.destroy();
    this._globe = null;
    this.svg = null;
    this.styleEl = null;
    this._tiltWrap = null;
    this._overlayLayer = null;
    for (const el of this._overlays) releaseOverlay(el, this._overlayState.get(el));
    // Restore descendants from last to first so each original nextSibling is
    // already back when insertBefore needs it. Direct children are placed by
    // the original root-node snapshot below.
    for (let i = this._overlays.length - 1; i >= 0; i--) {
      restoreOverlay(this._overlays[i], this._overlayState.get(this._overlays[i]), this.container);
    }
    this.container.replaceChildren(...this._hostChildren);
    this.container.removeAttribute?.("data-mappo");
  }

  #applyLatRange() {
    this.options.latRange = this.#rangeFor(this._body, this._latRangeOverride, this.options.projection, this.options.mode);
  }

  // The band drawn: explicit bounds win; the rest comes from the body's own
  // framing, or from the projection when it has an opinion (a polar map wants
  // a hemisphere, not Earth's −58…84).
  #rangeFor(body, override, projection, mode = this.options.mode) {
    const inherited = mode === "globe" ? bodyLatRange(body) : projectionDefaultRange(projection, bodyLatRange(body));
    const range = [ override[0] ?? inherited[0], override[1] ?? inherited[1] ];
    const [ min, max ] = range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < -90 || max > 90 || min >= max) {
      throw new RangeError("latRange must stay within [-90, 90] with min < max");
    }
    return range;
  }

  #setBody(body) {
    const bodyChanged = body !== this._body;
    const oldRange = this.options.latRange;
    const nextRange = this.#rangeFor(body, this._latRangeOverride, this.options.projection, this.options.mode);
    this._body = body;
    this.options.latRange = nextRange;
    if (bodyChanged) {
      // The caches are keyed on geometry only; the body is implied by the
      // instance, so a new body means a clean slate.
      this._dotsCache.clear();
      this._figureCache.clear();
      this._cacheBytes = 0;
    }
    return bodyChanged || !sameOption(oldRange, this.options.latRange);
  }

  // -- the full build (geometry path only) -------------------------------------

  // Leading + trailing debounce: an isolated change renders immediately; a
  // drag renders at most every REBUILD_MS with a guaranteed final render at
  // the resting value. This is the backpressure valve — without it, drag
  // input outruns render capacity and the tab drowns.
  #scheduleRebuild() {
    // ADAPTIVE spacing (perf-harness lesson): a fixed 150ms floor against
    // 70-146ms renders is a ~50% main-thread duty cycle — the storm scenario
    // measured 49% blocked. Spacing self-tunes to ~8× the last measured
    // render cost (capped at 1.2s), so heavy resolutions rebuild ~1×/s
    // during a drag while cheap ones stay at the 150ms floor. Blocked time
    // lands near 12% on any machine, fast or slow.
    const spacing = Math.min(1200, Math.max(REBUILD_MS, (this._lastRenderMs ?? 0) * 8));
    const since = performance.now() - (this._lastRebuild ?? -Infinity);
    const wait = Math.max(0, spacing - since);
    dbg(`rebuild scheduled: ${wait === 0 ? "immediate (leading)" : `in ${wait.toFixed(0)}ms (trailing)`}`);
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      if (this.container.isConnected) this.render();
    }, wait);
  }

  render() {
    this._lastRebuild = performance.now();
    const o = this.options;

    // <mappo-world> is an unknown element to the parser, so it is INLINE
    // unless the page says otherwise — and an inline box has clientWidth 0.
    // One guarantee, made once, before either renderer runs.
    if (typeof getComputedStyle === "function" && this.container?.style &&
        getComputedStyle(this.container).display === "inline") {
      this.container.style.display = "block";
    }

    if (o.mode === "globe") {
      // Leaving the SVG scene: the canvas replaces the container's children,
      // so the persistent svg/style handles must not survive to be patched
      // while detached. Rebuilt from scratch on return to flat.
      if (this.svg) { this.svg = null; this.styleEl = null; this._tiltWrap = null; this._overlayLayer = null; }
      this.grid = null;
      if (this._globe) this._globe.update(null, this._body);
      else this._globe = new GlobeRenderer(this.container, this.options, this._body, this._overlays);
      this._globe.canvas.setAttribute("role", "img");
      this._globe.canvas.setAttribute("aria-label", this.#ariaLabel());
      return;
    }
    if (this._globe) { this._globe.destroy(); this._globe = null; }

    const projection = resolveProjection(o.projection, { latRange: o.latRange, centerLon: o.centerLon });
    const colsWanted = o.cols ?? 120; // auto default for the flat map
    if (!Number.isFinite(colsWanted) || colsWanted <= 0) throw new RangeError("cols must be a positive finite number");
    const cols = Math.min(Math.max(1, Math.round(colsWanted)), MAX_COLS);
    if (colsWanted > MAX_COLS) console.warn(`[mappo] cols capped at ${MAX_COLS} (asked for ${colsWanted}) — beyond that SVG interaction degrades (mode="globe" already renders on canvas; a flat canvas renderer is on the roadmap)`);
    // Cells are square on screen; the frame's aspect sets the row count. For
    // equirectangular that is round(cols · Δφ / 360), as it always was.
    const rows = Math.max(1, Math.round(cols / projection.aspect));
    this.grid = { cols, rows, latRange: o.latRange, projection };

    // PERSISTENT scene (heap-growth lesson): svg, tilt wrapper, style element
    // and listeners are created ONCE and reused — a rebuild swaps viewBox +
    // innerHTML in place. v2 recreated all three per rebuild and re-bound
    // listeners each time; across a slider storm that churned tens of MB of
    // discarded containers on top of the node garbage.
    const renderT0 = performance.now();
    if (!this.svg) {
      this.svg = document.createElementNS(SVG_NS, "svg");
      this.svg.setAttribute("class", "mappo-svg");
      this.svg.setAttribute("role", "img");
      this._tiltWrap = document.createElement("div");
      this._tiltWrap.className = "mappo-tilt";
      this._tiltWrap.appendChild(this.svg);
      this.styleEl = document.createElement("style");
      // Same contract as the globe: host DOM carrying data-lat/data-lon is
      // adopted and positioned. On a flat map the position is static, so it
      // is written once per build rather than per frame — but the markup,
      // the attributes and the CSS hooks are identical, which is the point
      // of having one overlay API rather than two.
      this._overlayLayer = null;
      if (this._overlays.length) {
        this._overlayLayer = document.createElement("div");
        this._overlayLayer.className = "mappo-overlay";
        Object.assign(this._overlayLayer.style, { position: "absolute", inset: "0", pointerEvents: "none" });
        for (const el of this._overlays) {
          Object.assign(el.style, { position: "absolute", left: "0", top: "0", transform: "", willChange: "" });
          this._overlayLayer.appendChild(el);
        }
      }
      this.container.replaceChildren(this.styleEl, this._tiltWrap);
      if (this._overlayLayer) {
        if (getComputedStyle(this.container).position === "static") this.container.style.position = "relative";
        this.container.appendChild(this._overlayLayer);
      }
      this.#bindEvents(this.svg); // once — handlers guard on options.interactive
    }
    const svg = this.svg;
    svg.setAttribute("viewBox", `0 0 ${cols * CELL} ${rows * CELL}`);
    svg.setAttribute("aria-label", this.#ariaLabel());
    // One parse for the whole scene — the fast path for full builds.
    const [ markup, buildMs ] = span("wm:build-markup", () =>
      this.#defsMarkup(o, this.grid) + this.#backdropMarkup(this.grid) + this.#graticuleMarkup(this.grid, o) +
      (parseFigureStyle(o.figure).dots ? this.#dotsMarkup(this.grid) : this.#figureMarkup(this.grid, o)) +
      this.#markersMarkup(this.grid, o));
    const [ , parseMs ] = span("wm:parse-innerHTML", () => { svg.innerHTML = markup; });
    this.#applyStyle(this.#css(o));
    // Calibration (perf-harness lesson #2): the JS-side cost is only ~25%
    // of a rebuild — the style recalc, layout and paint land AFTER this
    // function returns. Double-rAF closes the window after the browser has
    // actually produced the frame, so the adaptive spacing sees the TRUE
    // per-rebuild cost (~4× larger) and spaces drags honestly. The sync
    // value below is the headless/SSR fallback.
    this._lastRenderMs = performance.now() - renderT0;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this._lastRenderMs = performance.now() - renderT0;
        dbg(`render calibrated: full frame cost ${this._lastRenderMs.toFixed(0)}ms → next spacing ${Math.min(1200, Math.max(REBUILD_MS, this._lastRenderMs * 8)).toFixed(0)}ms`);
      }));
    }
    dbg(`render: cols=${cols} rows=${rows} · ${projection.id} · build ${buildMs.toFixed(1)}ms · parse ${parseMs.toFixed(1)}ms · total ${this._lastRenderMs.toFixed(1)}ms · ${svg.querySelectorAll("*").length} nodes`);
    if (this._overlayLayer) this._overlayLayer.hidden = o.overlays === false;
    this.#placeOverlays();
  }

  // Position adopted overlay children against the flat projection.
  //
  // Percentages, not pixels: the SVG scales with its container, so a percent
  // stays correct through every resize without mappo having to watch for one.
  // Depth is published as 1 — a flat map has no limb — so a stylesheet
  // written against --mappo-depth for the globe works here unchanged. A point
  // the projection has no place for is parked off-screen and marked
  // data-mappo-behind, exactly as the globe treats its far side.
  #placeOverlays() {
    if (this.options.overlays === false) return;
    const projection = this.grid.projection;
    for (const el of this._overlays) {
      const lat = Number(el.dataset.lat);
      const lon = Number(el.dataset.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = projection.forward(lat, lon);
      if (p) {
        el.style.left = `${(p.x * 100).toFixed(3)}%`;
        el.style.top = `${(p.y * 100).toFixed(3)}%`;
        el.style.setProperty("--mappo-depth", "1");
        el.removeAttribute("data-mappo-behind");
      } else {
        el.style.left = "-9999px";
        el.style.top = "-9999px";
        el.style.setProperty("--mappo-depth", "0");
        el.setAttribute("data-mappo-behind", "");
      }
    }
  }

  // -- cheap patches -----------------------------------------------------------

  #patchStyle() {
    this.#applyStyle(this.#css(this.options));
  }

  #patchDefs() {
    // Wholesale swap via the one true builder — a hand-maintained subset
    // here is how the ground pattern got silently wiped by dot-shape patches.
    const defs = this.svg?.querySelector("defs");
    if (defs) defs.outerHTML = this.#defsMarkup(this.options, this.grid);
  }

  #patchMarkers() {
    const group = this.svg?.querySelector(".mappo-markers");
    if (!group) return;
    group.remove();
    this.svg.insertAdjacentHTML("beforeend", this.#markersMarkup(this.grid, this.options));
    this.svg.setAttribute("aria-label", this.#ariaLabel());
  }

  // -- markup builders ---------------------------------------------------------

  // SVG ids are document-global, so every one of ours carries the instance id.
  #id(name) {
    return `${name}-i${this._uid}`;
  }

  #defsMarkup(o, grid) {
    // The ground is ONE pattern-filled rect, not thousands of nodes: the
    // pattern tiles the dot shape (at 0.62×) across every grid cell, and the
    // stylesheet shows or hides it — so groundColor stays a defs-tier knob
    // even at max resolution. The frame clip is the world's outline: the
    // whole rectangle for equirectangular, a disc for a polar map, so nothing
    // paints in the corners where there is no world.
    return `<defs>${
      this.#shapeMarkup(this.#id("mappo-dot-shape"), o.dotShape, o.dotSize)}${
      this.#shapeMarkup(this.#id("mappo-marker-shape"), o.markerShape, o.dotSize * o.markerScale)
    }<pattern id="${this.#id("mappo-ground-pat")}" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse">${this.#groundDotMarkup(o)}</pattern>` +
    `<clipPath id="${this.#id("mappo-frame")}"><path clip-rule="evenodd" d="${this.#outlinePath(grid)}"/></clipPath></defs>`;
  }

  // A DIRECT shape with an inline fill — not <use>: CSS can't reliably reach
  // into a pattern's use-shadow tree across browsers (the original
  // implementation rendered nothing in some engines). The cost: groundColor
  // is a defs-tier knob instead of style-tier. Still no geometry rebuild.
  #groundDotMarkup(o) {
    if (!o.groundColor || o.groundColor === "none") return "";
    const r = (CELL * o.dotSize * 0.62) / 2;
    const c = CELL / 2;
    const fill = `fill="${escapeAttr(o.groundColor)}"`;
    switch (o.dotShape) {
      case "square":
      case "tile":
        return `<rect x="${c - r}" y="${c - r}" width="${r * 2}" height="${r * 2}" rx="${(r * 0.25).toFixed(2)}" ${fill}/>`;
      case "triangle":
        return `<path d="M${c} ${c - r} L${c + r} ${c + r} L${c - r} ${c + r} Z" ${fill}/>`;
      default: // circle + custom-path fallback
        return `<circle cx="${c}" cy="${c}" r="${r}" ${fill}/>`;
    }
  }

  // The world's edge in this map's units, as path data; `fill-rule`/`clip-rule`
  // evenodd so an annulus keeps its hole.
  #outlinePath(grid) {
    return grid.projection.outline().map((ring) => this.#pathFrom(ring, grid, true)).join("");
  }

  // Backdrop layers, always present so background/groundColor patch as pure
  // style. Both sit under the dots and ignore the pointer. The background is
  // the world's outline (a rectangle, a disc), the way the globe's is a disc.
  #backdropMarkup(grid) {
    const w = grid.cols * CELL, h = grid.rows * CELL;
    return `<path class="mappo-bg" fill-rule="evenodd" d="${this.#outlinePath(grid)}"/>` +
           `<rect class="mappo-ground" x="0" y="0" width="${w}" height="${h}" fill="url(#${this.#id("mappo-ground-pat")})" clip-path="url(#${this.#id("mappo-frame")})"/>`;
  }

  // One reusable shape per role, centred on the local origin so inner-
  // element transforms scale in place.
  #shapeMarkup(id, shape, size) {
    const r = (CELL * size) / 2;
    switch (shape) {
      case "square":
      case "tile": {   // a tile lies flat on a flat map: a square
        return `<rect id="${id}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${(r * 0.25).toFixed(2)}"/>`;
      }
      case "triangle":
        return `<path id="${id}" d="M0 ${-r} L${r} ${r} L${-r} ${r} Z"/>`;
      case "circle":
        return `<circle id="${id}" r="${r}"/>`;
      case "pin": {
        // Map-pin silhouette anchored at the TIP (origin = the place),
        // head floating above, punched hole — the canvas globe's twin.
        const pr = r * 1.24;
        const hy = (-pr * 1.9).toFixed(2);
        return `<path id="${id}" fill-rule="evenodd" d="M0 0 Q${(pr * 0.55).toFixed(2)} ${(Number(hy) + pr * 1.1).toFixed(2)} ${(pr * 0.966).toFixed(2)} ${(Number(hy) + pr * 0.259).toFixed(2)} A${pr.toFixed(2)} ${pr.toFixed(2)} 0 1 0 ${(-pr * 0.966).toFixed(2)} ${(Number(hy) + pr * 0.259).toFixed(2)} Q${(-pr * 0.55).toFixed(2)} ${(Number(hy) + pr * 1.1).toFixed(2)} 0 0 Z M0 ${hy} m${(-pr * 0.42).toFixed(2)} 0 a${(pr * 0.42).toFixed(2)} ${(pr * 0.42).toFixed(2)} 0 1 0 ${(pr * 0.84).toFixed(2)} 0 a${(pr * 0.42).toFixed(2)} ${(pr * 0.42).toFixed(2)} 0 1 0 ${(-pr * 0.84).toFixed(2)} 0"/>`;
      }
      default:
        // Custom SVG path, 24×24 box centred on origin (icon convention).
        return `<path id="${id}" d="${escapeAttr(shape)}" transform="scale(${((r * 2) / 24).toFixed(4)})"/>`;
    }
  }

  // Unit-frame points → SVG path data in this map's units.
  #pathFrom(points, grid, close) {
    const w = grid.cols * CELL, h = grid.rows * CELL;
    let d = "";
    for (let i = 0; i < points.length; i++) {
      d += `${i ? "L" : "M"}${(points[i][0] * w).toFixed(1)} ${(points[i][1] * h).toFixed(1)}`;
    }
    return d ? `${d}${close ? "Z" : ""}` : "";
  }

  // The figure as shape. `solid`, `outline` and `solid outline` are three
  // renderings of ONE geometry: for the grid source, the closed contours from
  // figure.js; for the vector source, the body's rings stitched into whole
  // rings and then cut at THIS projection's seam. The fill takes the closed
  // pieces; the edge takes the same vertices as open arcs, so a seam is never
  // stroked — not the frame edge of a cylindrical map, and not the ±180°
  // meridian of a polar one. Colours live in the stylesheet, so they patch
  // without touching this markup.
  #figureMarkup(grid, o) {
    const vector = figureOutlines(o.figureSource, this._body);
    // `borders` belongs in the key: the cached markup CONTAINS the borders
    // path, so leaving it out means turning borders off replays a cached scene
    // that still has them. The body is NOT in the key: the caches are dropped
    // whenever the body changes, so a key can only ever hit its own world.
    const key = `${grid.projection.key}|${o.figureSource}|${o.borders ? "b" : ""}|${grid.cols}`;
    let geom = this._figureCache.get(key);
    if (!geom) {
      const { cells, loops } = buildFigure(grid, { body: this._body });
      const borders = o.borders ? figureBorders(this._body) : null;
      geom = { cells, fill: "", complements: [], edge: "", borders: "" };
      if (vector) {
        const projected = projectRings(stitchRings(vector), grid.projection);
        if (projected.complete !== false) {
          geom.fill = projected.fill.filter((p) => !p.complement).map((p) => this.#pathFrom(p.points, grid, true)).join("");
          // A ring whose interior holds the far pole of an azimuthal map is the
          // OUTSIDE of its projected curve: fill it as the frame minus the ring,
          // in its own path so the winding cannot interact with the others.
          geom.complements = projected.fill.filter((p) => p.complement).map((p) => {
            const frame = signedArea(p.points) > 0
              ? [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, 0 ] ]
              : [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ];
            return this.#pathFrom(frame, grid, true) + this.#pathFrom(p.points, grid, true);
          });
          geom.edge = projected.edge.map((arc) => this.#pathFrom(arc, grid, false)).join("");
        }
      }
      if (!vector || (!geom.fill && !geom.complements.length && !geom.edge)) {
        // Grid contours are traced in screen space, so they have no seam.
        const d = loops.map((loop) => `M${loop.map(([ x, y ]) => `${x * CELL} ${y * CELL}`).join("L")}Z`).join("");
        geom.fill = d;
        geom.edge = d;
      }
      if (borders?.length) {
        const projected = projectRings(stitchRings(borders), grid.projection);
        if (projected.complete !== false) geom.borders = projected.edge.map((arc) => this.#pathFrom(arc, grid, false)).join("");
      }
      this._figureCache.set(key, geom);
      if (this._figureCache.size > 8) this._figureCache.delete(this._figureCache.keys().next().value);
    }
    this._dotCount = geom.cells.length;
    const clip = `clip-path="url(#${this.#id("mappo-frame")})"`;
    return `<g class="mappo-figure" ${clip}>` +
      `<path class="mappo-figure-fill" d="${geom.fill}"/>` +
      geom.complements.map((d) => `<path class="mappo-figure-fill mappo-figure-complement" d="${d}"/>`).join("") +
      `<path class="mappo-figure-edge" d="${geom.edge}"/>` +
      (geom.borders ? `<path class="mappo-borders" d="${geom.borders}"/>` : "") +
      this.#figureHighlightMarkup(grid, o) + `</g>`;
  }

  // The graticule on the flat map: the same lat/lon lines the globe draws,
  // projected and broken wherever they leave the map or cross the seam.
  #graticuleMarkup(grid, o) {
    if (!o.graticule) return "";
    const g = buildGraticule({ meridians: o.meridians, parallels: o.parallels });
    const draw = (lines) => lines.flatMap((line) => projectPolyline(line, grid.projection))
      .map((pts) => this.#pathFrom(pts, grid, false)).join("");
    return `<g class="mappo-graticule-group" clip-path="url(#${this.#id("mappo-frame")})">` +
      `<path class="mappo-graticule" d="${draw(g.meridians) + draw(g.parallels)}"/>` +
      `<path class="mappo-equator" d="${draw([ g.equator ])}"/></g>`;
  }

  // The highlight polygon in FLAT mode — the same ray-cast highlight.js does
  // for the globe. A highlight is a FILL, so it paints the figure cells inside
  // the region rather than tracing them: it reads as a lit area, and it reuses
  // the very cell list the contours were traced from.
  #figureHighlightMarkup(grid, o) {
    if (!o.highlightPolygon?.length) return "";
    const normalized = normalizeRings(o.highlightPolygon);
    const { cells } = buildFigure(grid, { body: this._body });
    const parts = [];
    for (const [ col, row ] of cells) {
      const c = cellCenter(col, row, grid);
      if (!c || !pointInRings(c.lat, c.lon, normalized)) continue;
      parts.push(`M${col * CELL} ${row * CELL}h${CELL}v${CELL}h-${CELL}Z`);
    }
    if (!parts.length) return "";
    return `<path class="mappo-figure-highlight" d="${parts.join("")}"/>`;
  }

  // Dot geometry depends ONLY on (projection, cols) for a given body — colours,
  // shapes and animation all live elsewhere — so the markup string caches
  // perfectly per resolution. Both animation phases ship on every dot (~30
  // bytes each): that's what makes animation a style-only knob.
  #dotsMarkup(grid) {
    const key = `${grid.projection.key}|${grid.cols}`;
    const cached = this._dotsCache.get(key);
    if (cached) { dbg(`dots cache HIT ${key}`); this._dotCount = cached.dots; return cached.markup; }
    dbg(`dots cache MISS ${key} — computing`);

    let dots = 0;
    const shape = this.#id("mappo-dot-shape");
    const parts = [ `<g class="mappo-dots" clip-path="url(#${this.#id("mappo-frame")})">` ];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const c = cellCenter(col, row, grid);
        if (!c || !this._body.figure(c.lat, c.lon)) continue;   // off the world, or ground
        dots++;

        // Every animation mode is a PHASE FIELD baked per dot; the stylesheet
        // picks which field feeds the animation delay. All pure functions of
        // (col,row) — that's what keeps this markup resolution-cacheable.
        const pw = ((col + row) / (grid.cols + grid.rows)).toFixed(3);          // diagonal front
        const pn = (((noise2(col * NOISE_PHASE_SCALE, row * NOISE_PHASE_SCALE) + 1) / 2)).toFixed(3); // organic patches
        const pr = (Math.hypot(col - grid.cols / 2, row - grid.rows / 2) /
          Math.hypot(grid.cols / 2, grid.rows / 2)).toFixed(3);                 // radial rings
        const ps = (col / grid.cols).toFixed(3);                                // west→east scanline
        const pk = (((noise2(col * 3.7 + 9, row * 3.7 + 9) + 1) / 2)).toFixed(3); // uncorrelated twinkle
        // Amplitude octave: 0.55–1.0 so every dot moves, none identically.
        const a = (0.55 + 0.45 * ((noise2(col * NOISE_AMP_SCALE + 47, row * NOISE_AMP_SCALE + 47) + 1) / 2)).toFixed(2);
        // Density classes for the animation LOAD GATE: at high resolutions the
        // stylesheet animates only .mappo-h (~1/2) or .mappo-t (~1/3) of dots —
        // SVG transforms are main-thread, and 8k continuous animators melt
        // frames; a baked checkerboard subset reads identically at density.
        const density = `${(col + row) % 2 === 0 ? " mappo-h" : ""}${(2 * col + 3 * row) % 3 === 0 ? " mappo-t" : ""}`;
        parts.push(
          `<g class="mappo-pos" transform="translate(${col * CELL + CELL / 2} ${row * CELL + CELL / 2})" data-col="${col}" data-row="${row}">` +
          `<use class="mappo-dot${density}" href="#${shape}" style="--mappo-pw:${pw};--mappo-pn:${pn};--mappo-pr:${pr};--mappo-ps:${ps};--mappo-pk:${pk};--mappo-a:${a}"/></g>`
        );
      }
    }
    parts.push("</g>");
    const markup = parts.join("");
    this._dotCount = dots;

    this._dotsCache.set(key, { markup, dots });
    // Cap by BYTES, not entries: a resolution sweep can visit dozens of
    // grids and high-res strings run ~1MB each — an entry-count cap
    // measured as tens of MB of retained heap in the perf harness.
    this._cacheBytes = (this._cacheBytes ?? 0) + markup.length;
    while (this._cacheBytes > 4_000_000 && this._dotsCache.size > 1) {
      const oldest = this._dotsCache.keys().next().value;
      this._cacheBytes -= this._dotsCache.get(oldest).markup.length;
      this._dotsCache.delete(oldest);
    }
    return markup;
  }

  #markersMarkup(grid, o) {
    const shape = this.#id("mappo-marker-shape");
    const parts = [ `<g class="mappo-markers">` ];
    for (const place of resolvePlaces(o.places, this._body)) {
      const cell = snapToFigure(place.lat, place.lon, grid, this._body);
      if (!cell) continue;   // no place for it on this projection (the far hemisphere of a polar map)
      const { col, row } = cell;
      const fill = place.color ? ` style="fill:${escapeAttr(place.color)}"` : "";
      const kind = place.kind ? ` data-kind="${escapeAttr(place.kind)}"` : "";
      const label = place.name || `${place.lat}, ${place.lon}`;
      const focus = o.interactive ? ` tabindex="0" role="button" aria-label="${escapeAttr(label)}"` : "";
      // The ping ring renders BEHIND the core and animates independently —
      // the core barely breathes, the ring expands and fades. Scaling one
      // element for "pulse" read as throbbing, not pinging.
      parts.push(
        `<g class="mappo-pos" transform="translate(${col * CELL + CELL / 2} ${row * CELL + CELL / 2})" data-place="${escapeAttr(place.name)}" data-lat="${place.lat}" data-lon="${place.lon}"${kind}${focus}>` +
        (o.markerPulse ? `<use class="mappo-marker-ring" href="#${shape}"${fill}/>` : "") +
        `<use class="mappo-marker" href="#${shape}"${fill}/></g>`
      );
    }
    parts.push("</g>");
    return parts.join("");
  }

  // Write the instance stylesheet, SCOPED TO THIS MAP.
  //
  // The rules are generated per instance but their selectors are generic
  // (.mappo-dot, .mappo-marker …) and a <style> in the document applies to the
  // whole document — so on a page with two maps the LAST one to render would
  // silently repaint every other one. Two things leak and both are handled:
  // selectors get an attribute scope, and @keyframes NAMES get the same
  // suffix, since two maps animating at different periods would otherwise
  // define the same animation twice.
  //
  // Selectors are rewritten through the CSSOM rather than by regex on the
  // text: the browser has already parsed the structure, so keyframe stops
  // (`0%, 100%`) and at-rule preludes cannot be mistaken for selectors.
  // :where() keeps the whole built-in selector at zero specificity. These
  // rules are defaults; a consumer's ordinary `.mappo-dot` rule must win even
  // when it was loaded earlier in <head>.
  #applyStyle(css) {
    const uid = this._uid;
    // Node-safe, like the rest of this class's seams: the update-tier tests
    // drive the renderer with a stub container.
    this.container.setAttribute?.("data-mappo", uid);
    this.styleEl.textContent = css
      .replace(/@keyframes\s+(mappo-[\w-]+)/g, (_m, name) => `@keyframes ${name}-i${uid}`)
      .replace(/animation:\s*(mappo-[\w-]+)/g, (_m, name) => `animation: ${name}-i${uid}`);

    const sheet = this.styleEl.sheet;
    if (!sheet) return;                      // not yet in the document; next render scopes it
    const scope = `[data-mappo="${uid}"]`;
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText) {
          rule.selectorText = rule.selectorText.split(",")
            .map((sel) => `:where(${scope} ${sel.trim()})`).join(", ");
        } else if (rule.cssRules && !rule.name) {   // @media etc; @keyframes has .name
          walk(rule.cssRules);
        }
      }
    };
    try { walk(sheet.cssRules); } catch { /* cross-origin or unparsed: leave global */ }
  }

  // The component stylesheet — defaults, not law; outside CSS wins.
  #css(o) {
    const style = parseFigureStyle(o.figure);
    const stroke = o.figureStroke ?? o.figureColor;
    const graticule = o.graticuleColor ?? o.figureColor;
    return `
      .mappo-bg { fill: ${o.background}; pointer-events: none; }
      .mappo-ground { display: ${o.groundColor === "none" ? "none" : "inline"}; pointer-events: none; }
      .mappo-tilt { perspective: ${o.perspective}px; }
      .mappo-tilt .mappo-svg {
        width: 100%; height: auto; display: block;
        transform: rotateX(${o.tilt}deg) rotateZ(${o.rotate}deg);
        transform-style: preserve-3d;
      }
      .mappo-dot {
        fill: ${o.figureColor};
        cursor: ${o.cursor};
        /* The hover wake: growing is INSTANT (transition:none below), the
           shrink-back runs slow and delayed — sweeping the cursor leaves a
           trail of settling dots. */
        transition: transform .3s ease .2s, fill .3s ease .2s;
      }
      ${o.interactive && style.dots ? `
      .mappo-pos:hover > .mappo-dot {
        fill: ${o.dotHoverColor ?? hoverShade(o.figureColor)};
        transform: scale(${o.dotHoverScale});
        transition: none;
        animation: none; /* a running animation transform would win otherwise */
      }` : ""}
      .mappo-figure-fill { fill: ${style.fill ? o.figureColor : "none"}; stroke: none; fill-rule: nonzero; }
      .mappo-figure-edge {
        fill: none; stroke: ${style.stroke ? stroke : "none"};
        stroke-width: ${o.figureStrokeWidth}; stroke-linejoin: round; stroke-linecap: round;
      }
      .mappo-borders {
        fill: none; stroke: ${o.bordersColor ?? stroke};
        stroke-width: ${o.bordersWidth}; stroke-linejoin: round; stroke-linecap: round; opacity: ${o.bordersOpacity};
      }
      .mappo-figure-highlight { fill: ${o.highlightColor}; }
      .mappo-graticule { fill: none; stroke: ${graticule}; stroke-width: ${0.6 * o.graticuleWidth}; opacity: ${o.graticuleOpacity}; pointer-events: none; }
      .mappo-equator { fill: none; stroke: ${o.equatorColor ?? graticule}; stroke-width: ${0.6 * o.graticuleWidth}; opacity: ${o.equatorOpacity}; pointer-events: none; }
      .mappo-marker {
        fill: ${o.markerColor};
        cursor: ${o.markerCursor};
        ${o.markerPulse ? "animation: mappo-breathe 2.8s ease-in-out infinite;" : ""}
        transition: transform .2s ease;
      }
      .mappo-marker-ring {
        fill: ${o.markerColor};
        pointer-events: none;
        animation: mappo-ping 2.8s cubic-bezier(0, 0, 0.2, 1) infinite;
      }
      ${o.interactive ? `
      .mappo-pos:hover > .mappo-marker, .mappo-pos:focus-visible > .mappo-marker {
        animation: none;
        transform: scale(${o.markerHoverScale});
      }
      .mappo-pos:hover > .mappo-marker-ring, .mappo-pos:focus-visible > .mappo-marker-ring {
        animation: none;
        opacity: 0;
      }
      .mappo-markers .mappo-pos { outline: none; }` : ""}
      @keyframes mappo-ping {
        0%   { transform: scale(1);    opacity: .55; }
        70%  { transform: scale(2.75); opacity: 0; }
        100% { transform: scale(2.75); opacity: 0; }
      }
      @keyframes mappo-breathe {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.12); }
      }
      ${o.animation !== "none" ? (() => {
        // THE LOAD GATE: SVG transforms animate on the main thread, so the
        // number of continuous animators is the frame budget. Above ~4.5k
        // dots animate the baked half-density subset, above ~7k the third —
        // at those densities a subset moving reads identically, at half or
        // a third of the per-frame style cost. Decided per render from the
        // real dot count; logged so nobody wonders why some dots sit still.
        const dots = this._dotCount ?? 0;
        const sel = dots > 7000 ? ".mappo-t" : dots > 4500 ? ".mappo-h" : ".mappo-dot";
        if (sel !== ".mappo-dot") dbg(`animation load gate: ${dots} dots → animating ${sel} subset`);
        // Above the top gate, even the third-subset can drop frames on
        // mid-range hardware — SVG animation cost scales with animator
        // count and there is no compositor escape hatch. Say so out loud,
        // once: animation is DISRECOMMENDED at extreme resolutions.
        if (dots > 7000 && !this._animationWarned) {
          this._animationWarned = true;
          console.warn(`[mappo] animation="${o.animation}" with ${dots} dots: expect dropped frames on mid-range hardware. For animated maps keep cols <= 180 (~4.5k dots); reserve high resolutions for static maps. (Canvas renderer for extreme grids is on the roadmap.)`);
        }
        const dur = o.animationPeriod;
        const amp = o.animationHeight * CELL; // cells → SVG units
        // Window math: each mode's front is a multiple of animationWidth.
        // rise ≈ 38% into the window (fast up), settle at its end (slow down).
        const win = (mult) => {
          const w = Math.min(0.9, Math.max(0.02, o.animationWidth * mult));
          return { rise: (w * 38).toFixed(1), settle: (w * 100).toFixed(1) };
        };
        const wWave = win(1), wRipple = win(0.8), wSweep = win(0.5), wSparkle = win(0.55);
        const modes = {
          // A thin rolling crest along the diagonal — event, not texture.
          wave: `
      .mappo-dots ${sel} {
        animation: mappo-swell ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-pw) * ${dur}s * -1);
      }
      @keyframes mappo-swell {
        0%   { transform: translateY(0) scale(1); }
        ${wWave.rise}%  { transform: translateY(calc(var(--mappo-a, 1) * -${amp}px)) scale(1.22); }
        ${wWave.settle}% { transform: translateY(0) scale(1); }
        100% { transform: translateY(0) scale(1); }
      }`,
          // Organic two-octave breathing — texture, not event.
          noise: `
      .mappo-dots ${sel} {
        animation: mappo-drift ${dur}s ease-in-out infinite;
        animation-delay: calc(var(--mappo-pn) * ${dur}s * -1);
      }
      @keyframes mappo-drift {
        0%, 100% { transform: translateY(0) scale(1); }
        50%      { transform: translateY(calc(var(--mappo-a, 1) * -${(amp * 0.75).toFixed(1)}px)) scale(1.1); }
      }`,
          // Concentric rings expanding from the map's centre.
          ripple: `
      .mappo-dots ${sel} {
        animation: mappo-ripple ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-pr) * ${dur}s * -1);
      }
      @keyframes mappo-ripple {
        0%   { transform: translateY(0) scale(1); }
        ${wRipple.rise}%  { transform: translateY(calc(var(--mappo-a, 1) * -${(amp * 0.8).toFixed(1)}px)) scale(1.18); }
        ${wRipple.settle}% { transform: translateY(0) scale(1); }
        100% { transform: translateY(0) scale(1); }
      }`,
          // A sonar scanline crossing west→east — the thinnest front.
          sweep: `
      .mappo-dots ${sel} {
        animation: mappo-sweep ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-ps) * ${dur}s * -1);
      }
      @keyframes mappo-sweep {
        0%   { transform: translateY(0) scale(1); }
        ${wSweep.rise}% { transform: translateY(calc(var(--mappo-a, 1) * -${(amp * 0.7).toFixed(1)}px)) scale(1.28); }
        ${wSweep.settle}% { transform: translateY(0) scale(1); }
        100% { transform: translateY(0) scale(1); }
      }`,
          // Uncorrelated twinkle — quick scale pops scattered by high-freq noise.
          sparkle: `
      .mappo-dots ${sel} {
        animation: mappo-sparkle ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-pk) * ${dur}s * -1);
      }
      @keyframes mappo-sparkle {
        0%   { transform: scale(1); }
        ${wSparkle.rise}% { transform: scale(calc(1 + var(--mappo-a, 1) * 0.45)); }
        ${wSparkle.settle}% { transform: scale(1); }
        100% { transform: scale(1); }
      }`
        };
        return modes[o.animation] ?? "";
      })() : ""}
      @media (prefers-reduced-motion: reduce) {
        .mappo-dot, .mappo-marker, .mappo-marker-ring { animation: none !important; transition: none !important; }
        .mappo-marker-ring { opacity: 0; }
      }
    `;
  }

  // -- events ------------------------------------------------------------------

  #bindEvents(svg) {
    const detailFor = (target) => {
      const pos = target.closest?.(".mappo-pos");
      if (!pos) return null;
      if (pos.dataset.place !== undefined) {
        const detail = { name: pos.dataset.place, lat: Number(pos.dataset.lat), lon: Number(pos.dataset.lon), element: pos };
        if (pos.dataset.kind !== undefined) detail.kind = pos.dataset.kind;
        return { kind: "place", detail };
      }
      const col = Number(pos.dataset.col), row = Number(pos.dataset.row);
      const c = cellCenter(col, row, this.grid);
      if (!c) return null;
      return { kind: "dot", detail: { lat: c.lat, lon: c.lon, col, row, element: pos } };
    };

    const dispatch = (kind, phase, detail) => {
      if (!this.options.interactive) return;
      const cb = this.options[`on${kind === "place" ? "Place" : "Dot"}${phase}`];
      if (cb) cb(detail);
      this.container.dispatchEvent(new CustomEvent(
        `mappo:${kind}${phase.toLowerCase()}`,
        { detail, bubbles: true }
      ));
    };

    svg.addEventListener("click", (e) => {
      const hit = detailFor(e.target);
      if (hit) dispatch(hit.kind, "Click", hit.detail);
    });
    svg.addEventListener("mouseover", (e) => {
      // mouseover + a same-group guard ≈ mouseenter with one listener.
      const hit = detailFor(e.target);
      if (!hit) return;
      if (e.relatedTarget && hit.detail.element.contains(e.relatedTarget)) return;
      dispatch(hit.kind, "Enter", hit.detail);
    });
    svg.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const hit = detailFor(e.target);
      if (hit?.kind === "place") { e.preventDefault(); dispatch("place", "Click", hit.detail); }
    });
  }

  #ariaLabel() {
    const body = this._body;
    if (body.pending) return `Map of ${body.id}, waiting for its body pack`;
    const names = resolvePlaces(this.options.places, body).map((p) => p.name).filter(Boolean);
    const dotted = parseFigureStyle(this.options.figure).dots ? "Dotted " : "";
    const terms = body.terms ? ` showing ${body.terms.figure} against ${body.terms.ground}` : "";
    const highlights = names.length ? `, highlighting ${names.join(", ")}` : "";
    return `${dotted}${body.name} map${terms}${highlights}`;
  }
}

// Snap a lat/lon to the nearest FIGURE cell in the grid, searching outward a
// few rings — coastal cities often sit in a sea cell at coarse resolutions
// (harbours do that), and a marker floating just off the coast looks broken.
// Returns null when the point has no place on the grid's projection. Pure
// function (exported for consumers doing their own math).
function snapToFigure(lat, lon, grid, body) {
  if (!body) throw new TypeError("snapToFigure needs a body — pass EARTH or another registered body");
  const p = project(lat, lon, grid);
  if (!p) return null;
  const { x, y } = p;
  const col0 = Math.min(grid.cols - 1, Math.max(0, Math.floor(x)));
  const row0 = Math.min(grid.rows - 1, Math.max(0, Math.floor(y)));

  let nearestWorld = null;
  for (let radius = 0; radius <= 3; radius++) {
    let best = null;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only
        const col = col0 + dc, row = row0 + dr;
        if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue;
        const c = cellCenter(col, row, grid);
        if (!c) continue;
        const d = (col + 0.5 - x) ** 2 + (row + 0.5 - y) ** 2;
        const tie = Math.abs(col - col0) + Math.abs(row - row0);
        if (!nearestWorld || d < nearestWorld.d - 1e-12 || (Math.abs(d - nearestWorld.d) <= 1e-12 && tie < nearestWorld._tie)) {
          nearestWorld = { col, row, d, _tie: tie };
        }
        if (!body.figure(c.lat, c.lon)) continue;
        if (!best || d < best.d - 1e-12 || (Math.abs(d - best.d) <= 1e-12 && tie < best._tie)) best = { col, row, d, _tie: tie };
      }
    }
    if (best) return { col: best.col, row: best.row, d: best.d };
  }
  // Deep-ocean coordinates render where they are — honest, and it makes
  // custom places like ships or islands-below-resolution still work.
  return nearestWorld && { col: nearestWorld.col, row: nearestWorld.row, d: nearestWorld.d };
}

// Option equality for the differential update. Structural for arrays and
// plain option objects (places, latRange, highlightPolygon, focus — the
// element parses a fresh object from its attribute every time, and a fresh
// `focus` that says the same thing must not re-aim the globe); identity for
// everything else, functions included.
function sameOption(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

const OVERLAY_STYLE_PROPS = [ "position", "left", "top", "transform", "will-change", "--mappo-depth" ];

// Remember only the properties mappo owns. Restoring the whole style attribute
// would erase unrelated host changes made while the map was mounted.
function captureOverlay(el) {
  return {
    parent: el.parentNode,
    nextSibling: el.nextSibling,
    styles: OVERLAY_STYLE_PROPS.map((prop) => [
      prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)
    ]),
    behind: el.hasAttribute("data-mappo-behind")
      ? el.getAttribute("data-mappo-behind")
      : null
  };
}

function restoreOverlay(el, state, container) {
  if (!state?.parent || state.parent === container) return;
  const before = state.nextSibling?.parentNode === state.parent ? state.nextSibling : null;
  state.parent.insertBefore(el, before);
}

// Undo exactly what the renderer wrote, restoring host-owned inline values.
function releaseOverlay(el, state) {
  if (!state) return;
  for (const [ prop, value, priority ] of state.styles) {
    if (value) el.style.setProperty(prop, value, priority);
    else el.style.removeProperty(prop);
  }
  if (state.behind !== null) el.setAttribute("data-mappo-behind", state.behind);
  else el.removeAttribute("data-mappo-behind");
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ══════════ src/element.js ══════════
// <mappo-world> — the zero-JS way in. Every renderer option that makes sense
// as markup is an attribute; change an attribute, the map re-renders.
//
//   <mappo-world places="London, Lagos, Singapore" tilt="40"
//                dot-shape="circle" marker-color="#2262fe"></mappo-world>
//
// Every registered body also gets its own tag — <mappo-earth>, <mappo-moon>,
// <mappo-mars> — which is the same element with that body as its default.
//
// Callbacks aren't attributes (functions don't serialize) — listen for the
// bubbling CustomEvents instead: mappo:placeclick, :placeenter, :dotclick,
// :dotenter. For full control, use the Mappo class.


const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
const flag = (v) => v !== "false";

const ATTR_MAP = {
  // attribute        → [option, parser]
  "mode":               [ "mode", String ],
  "body":               [ "body", String ],
  "cols":               [ "cols", Number ],
  "lat-min":            [ "latMin", Number ],
  "lat-max":            [ "latMax", Number ],
  // The flat map's projection and central meridian; the globe ignores both.
  "projection":         [ "projection", (v) => v.trim().toLowerCase() ],
  "center-lon":         [ "centerLon", Number ],
  // The figure and the ground
  "figure":             [ "figure", String ],
  "figure-color":       [ "figureColor", String ],
  "figure-stroke":      [ "figureStroke", String ],
  "figure-stroke-width":[ "figureStrokeWidth", Number ],
  "figure-source":      [ "figureSource", String ],
  "ground-color":       [ "groundColor", String ],
  "background":         [ "background", String ],
  "borders":            [ "borders", flag ],
  "borders-color":      [ "bordersColor", String ],
  "borders-width":      [ "bordersWidth", Number ],
  "borders-opacity":    [ "bordersOpacity", Number ],
  // Dots
  "dot-shape":          [ "dotShape", String ],
  "dot-size":           [ "dotSize", Number ],
  "dot-hover-color":    [ "dotHoverColor", String ],
  "dot-hover-scale":    [ "dotHoverScale", Number ],
  // Places: gazetteer names, comma-separated. Coordinates without the
  // gazetteer go in `markers`: "48.2,16.4;Vienna@48.2,16.4" — semicolon-
  // separated because the coordinates need the comma, optional Name@ prefix.
  // Both land in the one `places` option and fire the same events.
  "places":             [ "places", list ],
  "markers":            [ "markers", (v) => v.split(";").map((tok) => {
                          const m = tok.trim().match(/^(?:(.*)@)?(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
                          return m ? { name: m[1] || "", lat: Number(m[2]), lon: Number(m[3]) } : null;
                        }).filter(Boolean) ],
  "marker-shape":       [ "markerShape", String ],
  "marker-color":       [ "markerColor", String ],
  "marker-scale":       [ "markerScale", Number ],
  "marker-pulse":       [ "markerPulse", flag ],
  "marker-cursor":      [ "markerCursor", String ],
  // "lat,lon" the globe starts FACING (and keeps facing at rotate-speed 0).
  "focus":              [ "focus", (v) => {
                          const m = v.trim().match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
                          return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
                        } ],
  // Region highlight: JSON rings of [lat, lon] pairs — one ring or an array of
  // rings. The CONSUMER supplies the shape; mappo ships no boundary data for it.
  "highlight-polygon":  [ "highlightPolygon", (v) => {
                          try {
                            const parsed = JSON.parse(v);
                            if (!Array.isArray(parsed) || !parsed.length) return null;
                            return Array.isArray(parsed[0][0]) ? parsed : [ parsed ];
                          } catch { return null; }
                        } ],
  "highlight-color":    [ "highlightColor", String ],
  // The globe
  "rotate-speed":       [ "rotateSpeed", Number ],
  "roll":               [ "roll", Number ],
  "globe-ring":         [ "globeRing", flag ],
  "graticule":          [ "graticule", flag ],
  "meridians":          [ "meridians", Number ],
  "parallels":          [ "parallels", Number ],
  "graticule-color":    [ "graticuleColor", String ],
  "equator-color":      [ "equatorColor", String ],
  "graticule-opacity":  [ "graticuleOpacity", Number ],
  "equator-opacity":    [ "equatorOpacity", Number ],
  "graticule-width":    [ "graticuleWidth", Number ],
  "overlays":           [ "overlays", flag ],
  "max-dpr":            [ "maxDpr", Number ],
  // The globe's camera and atmosphere (the flat map ignores both): the camera's
  // distance in body radii, and fog as "near far" in radii from the centre plane.
  "distance":           [ "distance", Number ],
  "fog":                [ "fog", (v) => {
                          const m = v.trim().split(/[\s,]+/).map(Number);
                          return m.length === 2 && m.every(Number.isFinite) && m[0] < m[1] ? m : null;
                        } ],
  // How the globe's dots sample the sphere: "grid" (default) or "uniform".
  "distribution":       [ "distribution", String ],
  // The hero look and motion
  "tilt":               [ "tilt", Number ],
  "rotate":             [ "rotate", Number ],
  "perspective":        [ "perspective", Number ],
  "animation":          [ "animation", String ],
  "animation-period":   [ "animationPeriod", Number ],
  "animation-height":   [ "animationHeight", Number ],
  "animation-width":    [ "animationWidth", Number ],
  // Interaction
  "cursor":             [ "cursor", String ],
  "interactive":        [ "interactive", flag ]
};

// Conditional class expression, not a declaration: `extends HTMLElement`
// evaluates at definition time, and this module must stay importable where
// no DOM exists (Node tests, SSR pipelines). There, the element export is
// null and register() no-ops — the data/geometry APIs still work.
const MappoElement = typeof HTMLElement === "undefined" ? null :
  class MappoElement extends HTMLElement {
  static observedAttributes = Object.keys(ATTR_MAP);
  // Set by the subclasses defineBodyElement() makes. The tag becomes a
  // DEFAULT, never an override: <mappo-moon body="mars"> is a strange thing
  // to write but it should mean Mars, because the attribute is the truth and
  // the tag is only a nicer way to say the usual case.
  static defaultBody = null;

  connectedCallback() {
    // Light DOM on purpose: consumers restyle .mappo-dot/.mappo-marker with
    // plain CSS — a shadow root would wall that off for zero benefit here.
    this.map = new Mappo(this, this.#optionsFromAttributes());
  }

  disconnectedCallback() {
    // destroy() hands overlay children back untouched, so an element that is
    // moved in the DOM (Turbo, a framework re-parenting it) finds them again
    // when connectedCallback runs a second time.
    this.map?.destroy();
    this.map = null;
  }

  attributeChangedCallback() {
    // Fires before connect for initial attributes; only re-render when live.
    this.map?.update(this.#optionsFromAttributes());
  }

  #optionsFromAttributes() {
    const options = {};
    for (const [ attr, [ key, parse ] ] of Object.entries(ATTR_MAP)) {
      const raw = this.getAttribute(attr);
      // An ABSENT attribute must mean "the default", not "whatever it was set
      // to last time". update() merges, so without this branch removing an
      // attribute never un-sets its option — `graticule`, `borders`,
      // `globe-ring` and every other boolean would latch on forever once
      // switched on. (Found by clicking the demo page toggles, which is
      // exactly the bug a unit test on a fresh instance cannot see.)
      if (raw !== null) options[key] = parse(raw);
      else if (key in DEFAULTS) options[key] = DEFAULTS[key];
    }
    // `markers` is attribute sugar for coordinates; the option is `places`.
    options.places = [ ...(options.places ?? []), ...(options.markers ?? []) ];
    delete options.markers;
    // Partial latitude bounds stay partial: Mappo combines each null bound
    // with the selected body's own range, including when that body registers
    // after this element upgraded.
    // Not `=== undefined`: an absent attribute is reset to its DEFAULT here,
    // and the default body is null. The tag fills in for "nobody said".
    if (!options.body && this.constructor.defaultBody) options.body = this.constructor.defaultBody;
    return options;
  }
};

// A tag whose default body is `body` — an id, or a body object, which is
// registered for you. Every registerBody() already defines <mappo-{id}>; this
// is for a page that wants a name of its own:
//
//   defineBodyElement("moon-map", MOON);     <moon-map mode="globe">
function defineBodyElement(tag, body) {
  const id = typeof body === "object" ? registerBody(body).id : String(body);
  if (!MappoElement || typeof customElements === "undefined" || customElements.get(tag)) return;
  hideOverlaysUntilDefined(tag);
  // A subclass per tag, because a constructor can only be handed to the
  // registry once — registering a second tag with the same class throws and
  // takes the first down with it. Same component, different constructors.
  customElements.define(tag, class extends MappoElement { static defaultBody = id; });
}

let bodyTagsWired = false;

// Define <mappo-world> (or a tag of your choosing) and one tag per body, now
// and for every body registered from here on. Called automatically on import.
function register(tag = "mappo-world") {
  if (!MappoElement || typeof customElements === "undefined") return;
  if (!customElements.get(tag)) {
    hideOverlaysUntilDefined(tag);
    customElements.define(tag, class extends MappoElement {});
  }
  if (bodyTagsWired) return;
  bodyTagsWired = true;
  for (const body of knownBodies()) defineBodyElement(`mappo-${body.id}`, body.id);
  onBodyRegistered((body) => defineBodyElement(`mappo-${body.id}`, body.id));
}

// Overlay children are ordinary markup, which means the browser lays them out
// the moment it parses them — before this module has loaded and long before
// the map knows where they belong. Without this they appear stacked in the
// corner of the element for a frame or two and then jump to their coordinates,
// which reads as broken. `:not(:defined)` holds them until the element
// upgrades; after that mappo owns their position and the rule stops matching.
// One <style> for all tags, one rule per tag.
function hideOverlaysUntilDefined(tag) {
  if (typeof document === "undefined") return;
  let style = document.getElementById("mappo-upgrade-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "mappo-upgrade-style";
    (document.head ?? document.documentElement).prepend(style);
  }
  const rule = `${tag}:not(:defined) [data-lat][data-lon]{visibility:hidden}`;
  if (!style.textContent.includes(rule)) style.append(rule);
}

// ══════════ src/index.js ══════════
// mappo — maps of any world as a zero-dependency web component.
//
//   import "mappo";           // side effect: registers <mappo-world> and <mappo-earth>
//   <mappo-world places="London, Lagos"></mappo-world>
//
//   // other worlds are opt-in packs
//   import { registerBody } from "mappo";
//   import { MOON } from "mappo/bodies/moon";
//   registerBody(MOON);       // <mappo-moon> and <mappo-world body="moon"> now work
//
//   // or the programmatic API:
//   import { Mappo } from "mappo";
//   new Mappo(el, { places: ["Tokyo"], tilt: 40, animation: "wave" });
//
// This file is the single source of truth for the package's public surface:
// only what is re-exported here leaves the bundle.

export { Mappo, DEFAULTS, snapToFigure };
export { MappoElement, register, defineBodyElement };
export { EARTH };
export { registerBody, resolveBody, knownBodies, onBodyRegistered, resolvePlace };
export { project, cellCenter, cellCorner, projectNormalized };
export { resolveProjection, knownProjections };
export { buildGraticule };
export { buildFigure, parseFigureStyle };
export { noise2 };
export { hoverShade, resolveColor, usesCssVars };

// Auto-register when a DOM exists (browser); harmless no-op under Node.
if (typeof customElements !== "undefined") register();
