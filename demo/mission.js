// Earth to Mars, solved rather than asserted.
//
// The interesting question about a Mars mission is not how the rocket looks,
// it is WHEN. Earth laps Mars every 779.9 days, and for a few weeks either
// side of that the trip is cheap; the rest of the time it is impossible with
// any realistic vehicle. This module computes that window instead of quoting
// it, by solving Lambert's problem across a grid of departure dates and
// flight times — the porkchop plot, which is where every real mission's launch
// date comes from.
//
// Frame: heliocentric ecliptic J2000, in AU and days for the geometry, in km
// and seconds inside the Lambert solver where the constants live.

const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const MU_SUN = 1.32712440018e11;      // km³/s²
export const MU_EARTH = 398600.4418;
export const MU_MARS = 42828.37;
export const R_EARTH = 6378.137;
export const R_MARS = 3389.5;
export const SYNODIC_DAYS = 779.94;          // Earth laps Mars this often

// JPL's Keplerian elements and their rates, valid 1800–2050. Earth's are the
// same ones demo/astro.js uses — deliberately, so the two pages cannot put the
// Earth in two different places — with the inclination and node it leaves out
// because a flat map does not need them. A Mars transfer does: the 1.85° their
// orbits differ by is the whole reason a transfer is not a 2D problem.
const ELEMENTS = {
  earth: { a: [ 1.00000261, 0.00000562 ], e: [ 0.01671123, -0.00004392 ],
           I: [ -0.00001531, -0.01294668 ], L: [ 100.46457166, 35999.37244981 ],
           varpi: [ 102.93768193, 0.32327364 ], Omega: [ 0, 0 ] },
  mars:  { a: [ 1.52371034, 0.00001847 ], e: [ 0.09339410, 0.00007882 ],
           I: [ 1.84969142, -0.00813131 ], L: [ -4.55343205, 19140.30268499 ],
           varpi: [ -23.94362959, 0.44441088 ], Omega: [ 49.55953891, -0.29257343 ] }
};

export const julian = (date) => date.getTime() / 86400000 + 2440587.5;
const centuries = (date) => (julian(date) - 2451545) / 36525;
const norm = (a) => ((a % 360) + 360) % 360;

// Kepler's equation by Newton. Mars is eccentric enough (0.093) that the
// first guess is not good enough on its own.
function eccentricAnomaly(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

// Position AND velocity, because a transfer needs to know how fast the planet
// it is leaving was already going — most of the speed of any interplanetary
// trajectory is Earth's own 29.8 km/s, borrowed.
export function stateAt(which, date) {
  const el = ELEMENTS[which];
  const T = centuries(date);
  const a = el.a[0] + el.a[1] * T;                 // AU
  const e = el.e[0] + el.e[1] * T;
  const I = (el.I[0] + el.I[1] * T) * DEG;
  const L = el.L[0] + el.L[1] * T;
  const varpi = el.varpi[0] + el.varpi[1] * T;
  const Omega = (el.Omega[0] + el.Omega[1] * T) * DEG;
  const omega = (varpi - (el.Omega[0] + el.Omega[1] * T)) * DEG;   // argument of perihelion

  const M = norm(L - varpi) * DEG;
  const E = eccentricAnomaly(M > Math.PI ? M - 2 * Math.PI : M, e);

  // In the orbital plane, perifocal frame.
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const r = a * (1 - e * Math.cos(E));
  const n = Math.sqrt(MU_SUN / Math.pow(a * AU_KM, 3));            // rad/s
  const vxp = -(a * AU_KM) * n * Math.sin(E) / (1 - e * Math.cos(E));
  const vyp = (a * AU_KM) * n * Math.sqrt(1 - e * e) * Math.cos(E) / (1 - e * Math.cos(E));

  // Perifocal → ecliptic: rotate by ω, then I, then Ω.
  const rot = (x, y) => {
    const co = Math.cos(omega), so = Math.sin(omega);
    const ci = Math.cos(I), si = Math.sin(I);
    const cO = Math.cos(Omega), sO = Math.sin(Omega);
    const x1 = x * co - y * so, y1 = x * so + y * co;
    const y2 = y1 * ci, z2 = y1 * si;
    return [ x1 * cO - y2 * sO, x1 * sO + y2 * cO, z2 ];
  };
  const [ x, y, z ] = rot(xp, yp);
  const [ vx, vy, vz ] = rot(vxp, vyp);
  return {
    r: [ x, y, z ],                       // AU
    rKm: [ x * AU_KM, y * AU_KM, z * AU_KM ],
    v: [ vx, vy, vz ],                    // km/s
    dist: r, a, e, I: I / DEG,
    lonHelio: norm(Math.atan2(y, x) / DEG)
  };
}

// ── Lambert's problem ───────────────────────────────────────────────────────
// Given where you are, where you want to be, and how long you will take, there
// is (essentially) one conic that does it. Universal variables, so the same
// code covers the elliptic and hyperbolic cases without branching — a fast
// transfer to Mars really is hyperbolic relative to the departure planet.

const stumpffC = (z) => z > 1e-6 ? (1 - Math.cos(Math.sqrt(z))) / z
  : z < -1e-6 ? (Math.cosh(Math.sqrt(-z)) - 1) / -z
  : 1 / 2 - z / 24 + z * z / 720;
const stumpffS = (z) => {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + z * z / 5040;
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mag = (a) => Math.sqrt(dot(a, a));
const sub = (a, b) => [ a[0] - b[0], a[1] - b[1], a[2] - b[2] ];
const cross = (a, b) => [ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] ];

// r1, r2 in km; dt in seconds. Returns the two velocity vectors, or null when
// no prograde conic fits the time given.
export function lambert(r1, r2, dt, mu = MU_SUN) {
  const R1 = mag(r1), R2 = mag(r2);
  let dnu = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (R1 * R2))));
  // Prograde: if the transfer would go the wrong way round the Sun, it is the
  // long way, not the short way.
  if (cross(r1, r2)[2] < 0) dnu = 2 * Math.PI - dnu;

  const A = Math.sin(dnu) * Math.sqrt(R1 * R2 / (1 - Math.cos(dnu)));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-9) return null;

  const yOf = (z) => {
    const C = stumpffC(z);
    return R1 + R2 + A * (z * stumpffS(z) - 1) / Math.sqrt(C);
  };
  const tOf = (z) => {
    const y = yOf(z);
    if (y < 0) return NaN;
    const x = Math.sqrt(y / stumpffC(z));
    return (x * x * x * stumpffS(z) + A * Math.sqrt(y)) / Math.sqrt(mu);
  };

  // Bracket then bisect: Newton on z is famously fragile near the parabolic
  // boundary, and this runs thousands of times inside the porkchop scan where
  // one silent divergence would poison a whole column.
  let lo = -4 * Math.PI * Math.PI + 1e-6, hi = 4 * Math.PI * Math.PI;
  while (!Number.isFinite(tOf(lo)) && lo < hi) lo += 0.1;
  if (!Number.isFinite(tOf(lo))) return null;
  if (tOf(lo) > dt) return null;                    // faster than any conic allows
  while (Number.isFinite(tOf(hi)) && tOf(hi) < dt && hi < 1e6) hi *= 2;

  let z = 0;
  for (let i = 0; i < 200; i++) {
    z = (lo + hi) / 2;
    const t = tOf(z);
    if (!Number.isFinite(t)) { lo = z; continue; }
    if (t < dt) lo = z; else hi = z;
    if (Math.abs(hi - lo) < 1e-12) break;
  }
  const y = yOf(z);
  if (!Number.isFinite(y) || y < 0) return null;

  const f = 1 - y / R1;
  const g = A * Math.sqrt(y / mu);
  const gdot = 1 - y / R2;
  return {
    v1: [ (r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g, (r2[2] - f * r1[2]) / g ],
    v2: [ (gdot * r2[0] - r1[0]) / g, (gdot * r2[1] - r1[1]) / g, (gdot * r2[2] - r1[2]) / g ]
  };
}

// ── one candidate trip ──────────────────────────────────────────────────────
// What a given departure date and flight time actually costs.
export function trip(departure, days) {
  const arrival = new Date(departure.getTime() + days * 86400000);
  const e = stateAt("earth", departure);
  const m = stateAt("mars", arrival);
  const sol = lambert(e.rKm, m.rKm, days * 86400);
  if (!sol) return null;

  const vInfDep = mag(sub(sol.v1, e.v));
  const vInfArr = mag(sub(sol.v2, m.v));
  const c3 = vInfDep * vInfDep;

  // Departure burn from a 200 km parking orbit, which is where a refuelled
  // Starship actually leaves from — not from the ground, and not from rest.
  const rPark = R_EARTH + 200;
  const dvDepart = Math.sqrt(vInfDep * vInfDep + 2 * MU_EARTH / rPark) - Math.sqrt(MU_EARTH / rPark);
  // Arrival speed at the top of Mars' atmosphere (125 km), which Starship
  // bleeds off aerodynamically rather than with propellant.
  const rEntry = R_MARS + 125;
  const vEntry = Math.sqrt(vInfArr * vInfArr + 2 * MU_MARS / rEntry);

  return {
    departure, arrival, days,
    c3, vInfDep, vInfArr, dvDepart, vEntry,
    v1: sol.v1, v2: sol.v2,
    earth: e, mars: m,
    // The angle Mars leads Earth by at departure. For a minimum-energy trip
    // this lands near 44°, and it is the number the whole launch window is.
    phaseAngle: ((stateAt("mars", departure).lonHelio - e.lonHelio) % 360 + 360) % 360
  };
}

// ── the porkchop ────────────────────────────────────────────────────────────
// Sweep departure dates against flight times and keep the cheapest. This is
// the launch window, derived: nobody tells the mission when to go, the shape
// of the two orbits does.
export function porkchop({ from, toDays = 500, stepDays = 4, tofMin = 120, tofMax = 400, tofStep = 4 }) {
  const grid = [];
  let best = null;
  for (let d = 0; d <= toDays; d += stepDays) {
    const departure = new Date(from.getTime() + d * 86400000);
    const column = [];
    for (let tof = tofMin; tof <= tofMax; tof += tofStep) {
      const t = trip(departure, tof);
      const cost = t ? t.dvDepart : NaN;
      column.push(cost);
      if (t && (!best || cost < best.dvDepart)) best = t;
    }
    grid.push({ departure, column });
  }
  return { grid, best, tofMin, tofMax, tofStep };
}

// ── propagation ─────────────────────────────────────────────────────────────
// Where the ship is partway through the transfer. Universal-variable Kepler,
// the same formulation as the Lambert solver above, so an arc sampled here
// cannot disagree with the arc solved there.
export function propagate(r0, v0, dt, mu = MU_SUN) {
  const R0 = mag(r0), V0 = mag(v0);
  const vr0 = dot(r0, v0) / R0;
  const alpha = 2 / R0 - V0 * V0 / mu;              // 1/a; ≤ 0 means hyperbolic
  const sq = Math.sqrt(mu);

  let chi = alpha > 1e-9 ? sq * dt * alpha : sq * dt / R0;
  for (let i = 0; i < 80; i++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z), S = stumpffS(z);
    const F = R0 * vr0 / sq * chi * chi * C + (1 - alpha * R0) * chi * chi * chi * S + R0 * chi - sq * dt;
    const dF = R0 * vr0 / sq * chi * (1 - alpha * chi * chi * S) + (1 - alpha * R0) * chi * chi * C + R0;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  const z = alpha * chi * chi;
  const C = stumpffC(z), S = stumpffS(z);
  const f = 1 - chi * chi / R0 * C;
  const g = dt - chi * chi * chi * S / sq;
  const r = [ f * r0[0] + g * v0[0], f * r0[1] + g * v0[1], f * r0[2] + g * v0[2] ];
  const R = mag(r);
  const fd = sq / (R0 * R) * (alpha * chi * chi * chi * S - chi);
  const gd = 1 - chi * chi / R * C;
  return {
    r,
    v: [ fd * r0[0] + gd * v0[0], fd * r0[1] + gd * v0[1], fd * r0[2] + gd * v0[2] ]
  };
}

// The transfer as a polyline, for drawing. `n` points from departure to
// arrival inclusive.
export function transferPath(t, n = 240) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const dt = (i / n) * t.days * 86400;
    out.push(propagate(t.earth.rKm, t.v1, dt).r);
  }
  return out;
}

// One planet's orbit as a polyline, sampled over its own period.
export function orbitPath(which, around, n = 256) {
  const period = which === "earth" ? 365.256 : 686.98;
  const out = [];
  for (let i = 0; i <= n; i++) {
    out.push(stateAt(which, new Date(around.getTime() + (i / n) * period * 86400000)).rKm);
  }
  return out;
}
