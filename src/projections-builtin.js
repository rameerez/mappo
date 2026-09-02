// The projections beyond equirectangular — part of the opt-in module
// mappo/projections, which registers them with the core's registry.
//
// Each spec is what registerProjection() takes: a `kind` the seam logic keys
// on, a `defaultLatRange(bodyRange)` used when the caller has not set bounds,
// and `create({ latRange, centerLon })` returning the mapping functions in
// unit-frame coordinates. Longitudes arrive already shifted by the central
// meridian (λ' = lon − centerLon) so a piece cut at the seam can sit exactly
// on ±180 without being wrapped to the other edge.

import { EPS } from "./projections.js";

const DEG = Math.PI / 180;

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

export const EQUAL_EARTH = {
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
};

// ── polar stereographic ─────────────────────────────────────────────────────
// On the unit sphere: ρ = 2·tan(c/2) for colatitude c from the centre pole.
// Conformal; the scale factor is 2/(1 + cos c), so a screen cell at the
// equator of a hemispheric map spans half the ground distance (a quarter of
// the ground area) of one at the pole. Convention (USGS/NASA planetary maps):
// 90°E to the right in both aspects, which puts the central meridian at the
// bottom of a north polar map and at the top of a south polar one.
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

export const STEREOGRAPHIC_NORTH = { kind: "azimuthal", pole: 1, defaultLatRange: () => [ 0, 90 ], create: (o) => polar(1, o) };
export const STEREOGRAPHIC_SOUTH = { kind: "azimuthal", pole: -1, defaultLatRange: () => [ -90, 0 ], create: (o) => polar(-1, o) };

// In registration order: knownProjections() lists them after equirectangular.
export const BUILTIN_PROJECTIONS = {
  "equal-earth": EQUAL_EARTH,
  "stereographic-north": STEREOGRAPHIC_NORTH,
  "stereographic-south": STEREOGRAPHIC_SOUTH
};
