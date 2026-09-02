// Projections that are not built in: a { forward, inverse } object of your
// own, or a d3-geo projection. Part of the opt-in module mappo/projections,
// registered with the core through registerProjectionAdapter(); until then
// the core answers only its registry of names.

import { EPS, inRange, finitePoint, finiteLocation, frameLon, wrapLon, unwrap, meanLat, signedArea } from "./projections.js";

const CUSTOM_KEYS = new WeakMap();
let customSeq = 0;

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
export function adaptCustom(value, latRange) {
  const aspect = value.aspect ?? 2;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError("a custom projection needs a positive finite aspect ratio");
  const outline = validateOutline(value);
  const rawForward = value.forward.bind(value);
  const rawInverse = value.inverse.bind(value);
  const forward = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRange(lat, latRange[0], latRange[1])) return null;
    const p = rawForward(lat, frameLon(lon));
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
    shift: frameLon,
    forwardShifted: (lat, lon) => forward(lat, lon),
    forward,
    inverse,
    outline: () => outline
  });
}

// ── d3-geo ──────────────────────────────────────────────────────────────────

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

// Mutable d3 state (rotate, clipAngle, a d3-geo-projection's own setters) is
// fingerprinted, so a mutation cannot reuse stale geometry merely because the
// function identity stayed the same.
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

// A real d3-geo projection is adapted through projection.stream, not by direct
// point calls. The stream is where d3 applies spherical clipping, rotation,
// antimeridian cutting and adaptive resampling.
export function adaptD3(proj, latRange) {
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

// The adapter the core asks: an instance for a value it recognises, null for
// anything else (the core then reports what a projection may be).
export function adaptProjection(value, latRange) {
  if (typeof value === "function" && typeof value.invert === "function") return adaptD3(value, latRange);
  if (value && typeof value === "object" && typeof value.forward === "function" && typeof value.inverse === "function") {
    return adaptCustom(value, latRange);
  }
  return null;
}
