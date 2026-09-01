// Where the Earth is — in its orbit, and on its axis.
//
// Two questions, one clock. Kepler answers the first: real orbital elements
// with their rates, Kepler's equation solved rather than series-approximated,
// so the Earth genuinely moves faster in January than in July. Sidereal time
// answers the second: which meridian is facing the Sun right now.
//
// Elements are JPL's "Keplerian elements and their rates" for the
// Earth/Moon barycentre, valid 1800–2050 to about an arcminute — far finer
// than any pixel on a screen showing a whole orbit.
//
// No dependencies, like everything else here.

const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
const norm = (x) => { const r = x % TAU; return r < 0 ? r + TAU : r; };
const wrap180 = (deg) => ((deg + 180) % 360 + 360) % 360 - 180;

export const AU_KM = 149597870.7;
export const EARTH_R_KM = 6371;
export const SUN_R_KM = 695700;

export const julian = (date) => date.getTime() / 86400000 + 2440587.5;
const centuries = (date) => (julian(date) - 2451545) / 36525;

// Greenwich Mean Sidereal Time, IAU-82. The one number that turns an inertial
// direction into a place on a turning Earth — and the reason a page like this
// needs no API: the sky is where the arithmetic says it is.
export function gmst(date) {
  const t = centuries(date);
  const s = -6.2e-6 * t * t * t + 0.093104 * t * t +
    (876600 * 3600 + 8640184.812866) * t + 67310.54841;      // seconds of arc-time
  return norm(s * DEG / 240);
}

// Earth's orbit, J2000 elements with their per-century rates.
const ELEMENTS = {
  a:     [ 1.00000261,    0.00000562   ],   // AU
  e:     [ 0.01671123,   -0.00004392   ],
  L:     [ 100.46457166,  35999.37244981 ], // mean longitude, deg
  varpi: [ 102.93768193,  0.32327364   ]    // longitude of perihelion, deg
};

// Kepler's equation, M = E - e sin E, by Newton. Earth's eccentricity is
// 0.0167, so this converges in three or four passes; the loop is generous
// because being right costs nothing here and being wrong is a wobble.
function eccentricAnomaly(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

// The whole state of the system at one instant.
//
//   nu       true anomaly — how far past perihelion, in angle
//   r        distance to the Sun, AU
//   lonHelio Earth's heliocentric ecliptic longitude (where it IS)
//   lonSun   the Sun's geocentric ecliptic longitude (where we SEE it)
//   dec      subsolar latitude — the season, in one number
//   subLon   subsolar longitude — local noon, in one number
//   eot      equation of time, minutes: sundial minus clock
export function earthAt(date) {
  const T = centuries(date);
  const a = ELEMENTS.a[0] + ELEMENTS.a[1] * T;
  const e = ELEMENTS.e[0] + ELEMENTS.e[1] * T;
  const L = ELEMENTS.L[0] + ELEMENTS.L[1] * T;
  const varpi = ELEMENTS.varpi[0] + ELEMENTS.varpi[1] * T;

  const M = norm(wrap180(L - varpi) * DEG);
  const E = eccentricAnomaly(M, e);
  // The half-angle form, which stays well-conditioned near both apsides where
  // the plain arccos loses its sign and its precision at once.
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2),
                            Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));

  // The Earth's inclination to the ecliptic is zero by definition, so the
  // orbit is a plane problem and the longitude is just perihelion plus nu.
  //
  // But these elements are referred to the equinox of J2000, and an equinox
  // is not a fixed direction: it walks backwards around the ecliptic at about
  // 50 arcseconds a year. Twenty-six years of that is 0.37°, which is nine
  // hours of Earth's orbital motion — enough to put every solstice on the
  // wrong evening. So the frame is carried forward to the date before any of
  // it is called a season.
  const prec = (5028.796195 * T + 1.1054348 * T * T) / 3600 * DEG;
  const lonHelio = norm(varpi * DEG + nu + prec);
  const lonSunGeom = norm(lonHelio + PI);

  // And the Sun we SEE is not quite the Sun that is there: light takes eight
  // minutes to arrive, during which we have moved (aberration), and the
  // Earth's axis nods (nutation). Both are arcseconds, and both are the
  // difference between an almanac agreeing with you and nearly agreeing.
  const omega = (125.04452 - 1934.136261 * T) * DEG;
  const dPsi = (-17.20 * Math.sin(omega) - 1.32 * Math.sin(2 * lonSunGeom)) / 3600 * DEG;
  const dEps = (9.20 * Math.cos(omega) + 0.57 * Math.cos(2 * lonSunGeom)) / 3600 * DEG;
  const aberr = -20.4898 / r / 3600 * DEG;
  const lonSun = norm(lonSunGeom + dPsi + aberr);

  const eps = (23.439291 - 0.0130042 * T) * DEG + dEps;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lonSun));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lonSun), Math.cos(lonSun));

  // Sundial minus clock: the mean sun keeps our time, the real one does not.
  // L is the EARTHs mean longitude; the mean Suns is half a turn from it.
  const meanSun = L + 180 + (5028.796195 * T + 1.1054348 * T * T) / 3600;
  const eot = wrap180(meanSun - ra / DEG) * 4;                 // degrees → minutes

  return {
    a, e, T,
    M: M / DEG, E: E / DEG, nu: nu / DEG,
    r, rKm: r * AU_KM,
    lonHelio: lonHelio / DEG,
    lonSun: lonSun / DEG,
    // Precessed like lonHelio, or the apsides would sit 0.37° away from the
    // orbit they belong to — small, but the kind of small that is a bug.
    perihelionLon: norm(varpi * DEG + prec) / DEG,
    obliquity: eps / DEG,
    dec: dec / DEG,
    subLon: wrap180((ra - gmst(date)) / DEG),
    eot,
    // Kepler's second law, made visible: equal areas in equal times means the
    // angular rate goes as 1/r². Three per cent faster in January than in July.
    degPerDay: (360 / 365.256363) * Math.sqrt(1 - e * e) / (r * r)
  };
}

// The season, as a name. Solar longitude is the definition: 0° is the March
// equinox, and the quarters follow. Northern-hemisphere naming, said out loud
// as such rather than pretended to be universal.
export function seasonOf(lonSunDeg) {
  const l = ((lonSunDeg % 360) + 360) % 360;
  if (l < 90) return { name: "March equinox → June solstice", since: "March equinox" };
  if (l < 180) return { name: "June solstice → September equinox", since: "June solstice" };
  if (l < 270) return { name: "September equinox → December solstice", since: "September equinox" };
  return { name: "December solstice → March equinox", since: "December solstice" };
}

// When the Sun next reaches a given ecliptic longitude — the equinoxes and
// solstices at 0/90/180/270, the apsides found separately. Bisection on a
// continuous angle difference, which is exact to the second in a few passes
// and needs no table.
export function solarLongitudeCrossing(target, fromDate, forward = true) {
  const diff = (d) => wrap180(earthAt(d).lonSun - target);
  const step = (forward ? 1 : -1) * 86400000;
  let t0 = +fromDate;
  let d0 = diff(new Date(t0));
  for (let i = 0; i < 400; i++) {
    const t1 = t0 + step;
    const d1 = diff(new Date(t1));
    // A difference taken modulo 360 flips sign twice a year: once where the
    // Sun really crosses the target, and once on the far side where the
    // wrap does it. Only one of those is an equinox, and it is the one that
    // does not jump most of a turn in a single day.
    if (Math.abs(d1 - d0) < 180 && (d0 <= 0 && d1 > 0 || d0 >= 0 && d1 < 0)) {
      let lo = t0, hi = t1;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        (diff(new Date(mid)) <= 0) === (d0 <= 0) ? lo = mid : hi = mid;
      }
      return new Date((lo + hi) / 2);
    }
    t0 = t1; d0 = d1;
  }
  return null;
}

// Perihelion and aphelion, found the same way: the distance turns around.
export function apsis(year, near) {
  const start = Date.UTC(year, near === "perihelion" ? 0 : 5, 1);
  let best = start, bestR = earthAt(new Date(start)).r;
  for (let d = 0; d < 60; d++) {
    const t = start + d * 86400000;
    const r = earthAt(new Date(t)).r;
    if (near === "perihelion" ? r < bestR : r > bestR) { bestR = r; best = t; }
  }
  // Refine to the hour around the daily minimum.
  let refined = best;
  for (let h = -36; h <= 36; h++) {
    const t = best + h * 3600000;
    const r = earthAt(new Date(t)).r;
    if (near === "perihelion" ? r < bestR : r > bestR) { bestR = r; refined = t; }
  }
  return { date: new Date(refined), r: bestR };
}
