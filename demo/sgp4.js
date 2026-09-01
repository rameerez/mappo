// SGP4 — the propagator the whole satellite catalogue is published for.
//
// A TLE is not a position. It is a set of MEAN elements that only mean
// anything when fed back through the same model that produced them, so
// "just do Kepler on it" is wrong by tens of kilometres within hours. This
// is the near-Earth branch of SGP4 (Spacetrack Report #3, in Vallado's
// corrected formulation), which is all a catalogue of low orbits needs:
// the deep-space half only engages above a 225-minute period, and nothing
// in Starlink or on the ISS comes close.
//
// WGS-72 on purpose. The constants are not a detail you get to modernise —
// the elements were FITTED with these, and WGS-84 numbers here would put
// the satellites in slightly wrong places while looking more correct.
//
// The only import is our own clock: sidereal time is not an SGP4 idea, and
// the orbit page needs the same one.

import { gmst } from "./astro.js";

const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;

const RE     = 6378.135;                 // km, WGS-72 equatorial radius
const MU     = 398600.8;                 // km^3/s^2
const XKE    = 60 / Math.sqrt(RE * RE * RE / MU);
const J2     = 0.001082616;
const J3     = -0.00000253881;
const J4     = -0.00000165597;
const J3OJ2  = J3 / J2;
const X2O3   = 2 / 3;

const mod2pi = (x) => { const r = x % TAU; return r < 0 ? r + TAU : r; };

// ── the file format ─────────────────────────────────────────────────────────

// Line 1 columns 54-61 hold a float with the decimal point and the exponent's
// "e" both left out: " 10605-2" is 0.10605e-2. It is the oldest surviving
// piece of punched-card thrift in daily use.
function packedFloat(s) {
  const t = s.trim();
  if (!t || t === "0" || /^[+-]?0+$/.test(t)) return 0;
  const m = t.match(/^([+-]?)(\d+)([+-]\d)$/);
  if (!m) return Number(t) || 0;
  return Number(`${m[1]}0.${m[2]}e${m[3]}`);
}

// Two digits of year, then the day of that year with a fraction. 57 is the
// hinge because Sputnik went up in 1957 and the catalogue starts there.
function epochToDate(yy, doy) {
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const ms = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
  return new Date(ms);
}

export function parseTle(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    // Anchor on the line pair, not on the name: a two-line element set is
    // sometimes published without one.
    if (!/^1 /.test(lines[i]) || !/^2 /.test(lines[i + 1])) continue;
    const l1 = lines[i], l2 = lines[i + 1];
    const name = i > 0 && !/^[12] /.test(lines[i - 1]) ? lines[i - 1].trim() : `NORAD ${l1.slice(2, 7).trim()}`;
    const sat = {
      name,
      satnum: l1.slice(2, 7).trim(),
      epoch: epochToDate(Number(l1.slice(18, 20)), Number(l1.slice(20, 32))),
      bstar: packedFloat(l1.slice(53, 61)),
      inclo: Number(l2.slice(8, 16)) * DEG,
      nodeo: Number(l2.slice(17, 25)) * DEG,
      ecco: Number(`0.${l2.slice(26, 33).trim()}`),
      argpo: Number(l2.slice(34, 42)) * DEG,
      mo: Number(l2.slice(43, 51)) * DEG,
      no_kozai: Number(l2.slice(52, 63)) * TAU / 1440   // rev/day → rad/min
    };
    if (Number.isFinite(sat.no_kozai) && sat.no_kozai > 0 && Number.isFinite(sat.ecco)) {
      out.push(init(sat));
      i++;                                              // consume line 2
    }
  }
  return out;
}

// ── initialisation ──────────────────────────────────────────────────────────

// Everything here depends only on the elements, so it is paid once per
// satellite and never again — which is what makes propagating ten thousand
// of them per frame affordable.
export function init(s) {
  const { ecco, inclo, no_kozai, argpo, mo } = s;

  const cosio = Math.cos(inclo), cosio2 = cosio * cosio;
  const omeosq = 1 - ecco * ecco;
  const rteosq = Math.sqrt(omeosq);

  // The published mean motion is the Kozai one; SGP4 wants the Brouwer one.
  const ak = Math.pow(XKE / no_kozai, X2O3);
  const d1 = 0.75 * J2 * (3 * cosio2 - 1) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + 134 * del * del / 81));
  del = d1 / (adel * adel);
  const no = no_kozai / (1 + del);

  const ao = Math.pow(XKE / no, X2O3);
  const sinio = Math.sin(inclo);
  const po = ao * omeosq, posq = po * po;
  const con42 = 1 - 5 * cosio2;
  const con41 = 3 * cosio2 - 1;
  const rp = ao * (1 - ecco);

  // Atmospheric drag model: the fitted "s" altitude drops for low perigees.
  let sfour = 78 / RE + 1;
  let qzms24 = Math.pow((120 - 78) / RE, 4);
  const perige = (rp - 1) * RE;
  if (perige < 156) {
    sfour = perige < 98 ? 20 : perige - 78;
    qzms24 = Math.pow((120 - sfour) / RE, 4);
    sfour = sfour / RE + 1;
  }

  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  const eta = ao * ecco * tsi, etasq = eta * eta, eeta = ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * Math.pow(tsi, 4);
  const coef1 = coef / Math.pow(psisq, 3.5);
  const cc2 = coef1 * no * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
    0.375 * J2 * tsi / psisq * con41 * (8 + 3 * etasq * (8 + etasq)));

  const x1mth2 = 1 - cosio2;
  const cc1 = s.bstar * cc2;
  const cc3 = ecco > 1e-4 ? -2 * coef * tsi * J3OJ2 * no * sinio / ecco : 0;
  const cc4 = 2 * no * coef1 * ao * omeosq * (
    eta * (2 + 0.5 * etasq) + ecco * (0.5 + 2 * etasq) -
    J2 * tsi / (ao * psisq) * (
      -3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
      0.75 * x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argpo)));
  const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);

  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * no;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;

  const mdot = no + 0.5 * temp1 * rteosq * con41 +
    0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  const argpdot = -0.5 * temp1 * con42 +
    0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
    temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot = xhdot1 +
    (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;

  Object.assign(s, {
    no, ao, cosio, sinio, con41, x1mth2, x7thm1: 7 * cosio2 - 1,
    eta, sfour, tsi, cc1, cc4, cc5,
    mdot, argpdot, nodedot,
    omgcof: s.bstar * cc3 * Math.cos(argpo),
    xmcof: ecco > 1e-4 ? -X2O3 * coef * s.bstar / eeta : 0,
    nodecf: 3.5 * omeosq * xhdot1 * cc1,
    t2cof: 1.5 * cc1,
    // Guard the pole: at exactly 180° inclination the (1+cos i) denominator
    // vanishes. Nothing real flies there, but a NaN would poison the frame.
    xlcof: -0.25 * J3OJ2 * sinio * (3 + 5 * cosio) / (Math.abs(1 + cosio) > 1.5e-12 ? 1 + cosio : 1.5e-12),
    aycof: -0.5 * J3OJ2 * sinio,
    delmo: Math.pow(1 + eta * Math.cos(mo), 3),
    sinmao: Math.sin(mo),
    // Below 220 km the higher-order drag terms are dropped: the fit does not
    // support them and they misbehave.
    isimp: rp < 220 / RE + 1
  });

  if (!s.isimp) {
    const cc1sq = cc1 * cc1;
    const d2 = 4 * ao * tsi * cc1sq;
    const temp = d2 * tsi * cc1 / 3;
    const d3 = (17 * ao + s.sfour) * temp;
    const d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * s.sfour) * cc1;
    Object.assign(s, {
      d2, d3, d4,
      t3cof: d2 + 2 * cc1sq,
      t4cof: 0.25 * (3 * d3 + cc1 * (12 * d2 + 10 * cc1sq)),
      t5cof: 0.2 * (3 * d4 + 12 * cc1 * d3 + 6 * d2 * d2 + 15 * cc1sq * (2 * d2 + cc1sq))
    });
  }
  return s;
}

// ── propagation ─────────────────────────────────────────────────────────────

// @param t [Number] minutes since the element set's epoch (negative is fine).
// @return  [Object|null] { x, y, z } in km, TEME — null if the orbit has
//   decayed out of the model's domain, which happens to real satellites.
export function propagate(s, t) {
  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  const t2 = t * t;

  let argpm = argpdf, mm = xmdf;
  const nodem = nodedf + s.nodecf * t2;
  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;

  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delm = s.xmcof * (Math.pow(1 + s.eta * Math.cos(xmdf), 3) - s.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * t, t4 = t3 * t;
    tempa -= s.d2 * t2 + s.d3 * t3 + s.d4 * t4;
    tempe += s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ += s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }

  const am = Math.pow(XKE / s.no, X2O3) * tempa * tempa;
  const nm = XKE / Math.pow(am, 1.5);
  const em = Math.max(1e-6, s.ecco - tempe);
  if (em >= 1 || am < 0.95) return null;               // decayed or diverged

  mm += s.no * templ;
  const xlm = mod2pi(mm + argpm + nodem);
  const nodeM = mod2pi(nodem);
  argpm = mod2pi(argpm);
  mm = mod2pi(xlm - argpm - nodeM);

  // Long-period periodics.
  const axnl = em * Math.cos(argpm);
  const temp = 1 / (am * (1 - em * em));
  const aynl = em * Math.sin(argpm) + temp * s.aycof;
  const xl = mm + argpm + nodeM + temp * s.xlcof * axnl;

  // Kepler's equation, in the (E + ω) form SGP4 uses. Ten iterations is what
  // the reference implementation allows; the step is clamped because an
  // unclamped Newton step can throw a near-parabolic case across the orbit.
  const u = mod2pi(xl - nodeM);
  let eo1 = u, tem5 = 9999.9, sineo1 = 0, coseo1 = 0;
  for (let ktr = 0; ktr < 10 && Math.abs(tem5) >= 1e-12; ktr++) {
    sineo1 = Math.sin(eo1); coseo1 = Math.cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
  }

  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) return null;

  const rl = am * (1 - ecose);
  const betal = Math.sqrt(1 - el2);
  const tmp = esine / (1 + betal);
  const sinu = am / rl * (sineo1 - aynl - axnl * tmp);
  const cosu = am / rl * (coseo1 - axnl + aynl * tmp);
  let su = Math.atan2(sinu, cosu);

  // sin 2u and cos 2u, from the half-angle values we already hold.
  const sin2u = 2 * cosu * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  const tp = 1 / pl;
  const t1 = 0.5 * J2 * tp;
  const t2p = t1 * tp;

  // Short-period periodics: the wobble within a single revolution.
  const mrt = rl * (1 - 1.5 * t2p * betal * s.con41) + 0.5 * t1 * s.x1mth2 * cos2u;
  su -= 0.25 * t2p * s.x7thm1 * sin2u;
  const xnode = nodeM + 1.5 * t2p * s.cosio * sin2u;
  const xinc = s.inclo + 1.5 * t2p * s.cosio * s.sinio * cos2u;

  const sinsu = Math.sin(su), cossu = Math.cos(su);
  const snod = Math.sin(xnode), cnod = Math.cos(xnode);
  const sini = Math.sin(xinc), cosi = Math.cos(xinc);
  const xmx = -snod * cosi, xmy = cnod * cosi;

  const r = mrt * RE;
  return {
    x: (xmx * sinsu + cnod * cossu) * r,
    y: (xmy * sinsu + snod * cossu) * r,
    z: (sini * sinsu) * r
  };
}

// ── frames and time ─────────────────────────────────────────────────────────

// Sidereal time and the Julian day live in astro.js: the orbit page needs the
// same two functions, and two copies of a time scale is one copy too many.
export { julian, gmst } from "./astro.js";

// TEME → geodetic latitude/longitude/altitude on the WGS-84 ellipsoid. The
// latitude is iterated because the ellipsoid makes it implicit; five passes
// is already past double precision for anything in orbit.
const A84 = 6378.137, F84 = 1 / 298.257223563, E2 = F84 * (2 - F84);

export function geodetic(p, theta) {
  const rxy = Math.hypot(p.x, p.y);
  let lon = Math.atan2(p.y, p.x) - theta;
  lon = ((lon + PI) % TAU + TAU) % TAU - PI;
  let lat = Math.atan2(p.z, rxy), C = 1;
  for (let i = 0; i < 5; i++) {
    const sinLat = Math.sin(lat);
    C = 1 / Math.sqrt(1 - E2 * sinLat * sinLat);
    lat = Math.atan2(p.z + A84 * C * E2 * sinLat, rxy);
  }
  return {
    lat: lat / DEG,
    lon: lon / DEG,
    alt: rxy / Math.cos(lat) - A84 * C
  };
}

// The whole chain, for when you just want a dot on a map.
export function subpoint(sat, date) {
  const p = propagate(sat, (date - sat.epoch) / 60000);
  return p && geodetic(p, gmst(date));
}
