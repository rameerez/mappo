// Where the sun is not — as geometry, once, for every page that draws night.
//
// Lifted verbatim from demo/index.html's day/night card, which is where this
// was paid for. The comments come with it because the reasoning is the whole
// value: the naive formulation ("solve for the terminator latitude, fill to
// the pole") put vertical strips across the map twice, and the fix is not
// obvious from the wrong version.
//
// The one entry point most callers want is nightRings(dec, subLon, h0): the
// region where the sun sits below h0, as closed rings of [lon, lat]. Feed it
// to a projection of your choosing — this module does not know about pixels.

const RAD = Math.PI / 180;

const LON_STEP = 1.5;   // between meridians; finer than a blurred edge can show
const LON_PAD  = 30;    // sampled past the antimeridian, so a blur has room
const LAT_PAD  = 8;     // and past the top and bottom of it, for the same reason
export const OFF_LAT = 300;  // a latitude far outside any frame, to hide an edge

// Is the sun up where they stand? The same spherical triangle the terminator
// is drawn from, kept beside it so the two can never disagree.
export const solarElevation = (lat, lon, dec, subLon) =>
  Math.asin(
    Math.sin(lat * RAD) * Math.sin(dec * RAD) +
    Math.cos(lat * RAD) * Math.cos(dec * RAD) * Math.cos((lon - subLon) * RAD)
  ) / RAD;

// Everywhere the sun is lower than h0 is a spherical CAP: the disc of angular
// radius 90 + h0 around the antisolar point. Getting this wrong is what put
// vertical strips on the map twice. A cap only reaches the pole while it is
// wide enough to — the h = 0 one always is, which is why the plain terminator
// really is one curve with night below it — but by −9°, near an equinox, the
// cap has pulled away from the pole and closed into a blob. Filling those
// bands "down to the edge of the map" therefore blacked out whole columns
// wherever the single-curve maths ran out of solutions, and the sides of
// those columns are the strips.
//
// So a band is asked, one meridian at a time, which LATITUDES it covers there
// — an interval, because a convex cap meets a meridian in exactly one arc.
export function capSpan(lon, cLat, cLon, cosR) {
  const A = Math.sin(cLat * RAD);
  const B = Math.cos(cLat * RAD) * Math.cos((lon - cLon) * RAD);
  const R = Math.hypot(A, B);
  if (R < 1e-9) return cosR <= 0 ? [ -OFF_LAT, OFF_LAT ] : null;
  const ratio = cosR / R;
  if (ratio > 1) return null;                    // the cap misses this meridian
  if (ratio <= -1) return [ -OFF_LAT, OFF_LAT ]; // and here it swallows it whole
  // sin(lat + phi) >= ratio holds on one interval per turn, and at most one of
  // them can land inside a meridian's 180 degrees of latitude.
  const phi = Math.atan2(B, A) / RAD, a = Math.asin(ratio) / RAD;
  for (const k of [ 0, -1, 1 ]) {
    const lo = a - phi + 360 * k, hi = 180 - a - phi + 360 * k;
    if (hi > -90 && lo < 90) return [ lo, hi ];
  }
  return null;
}

// A cap very nearly tangent to a pole dips in and out of existence along a
// whole hemisphere of meridians, in slivers a few metres wide at latitude 90.
// None of that is on the map. Asking only about the part of the world the
// frame shows turns that speckle back into one clean run.
const seen = (sp, latRange) =>
  sp && sp[1] > latRange[0] - LAT_PAD && sp[0] < latRange[1] + LAT_PAD ? sp : null;

// Where a run ends the cap is tangent to the meridian and the span closes to a
// point, so the region tapers rather than stopping on a vertical edge — but
// only if we sample the tangency. Bisection finds it to well under a pixel.
function tangentLon(inLon, outLon, cLat, cLon, cosR, latRange) {
  let a = inLon, b = outLon;
  for (let i = 0; i < 16; i++) {
    const m = (a + b) / 2;
    if (seen(capSpan(m, cLat, cLon, cosR), latRange)) a = m; else b = m;
  }
  return a;
}

// Night as closed rings of [lon, lat]: out along the top of each span, back
// along the bottom. A region that wraps the antimeridian simply comes back as
// two rings. Latitudes past the poles are clamped to ±OFF_LAT, which is how an
// edge that has no business being visible gets pushed out of frame.
export function nightRings(dec, subLon, h0 = 0, latRange = [ -90, 90 ]) {
  const cLat = -dec;                                   // the antisolar point
  const cLon = ((subLon + 180 + 540) % 360) - 180;
  const cosR = Math.cos((90 + h0) * RAD);
  const rings = [];
  let run = null, prev = null;

  const clamp = (lat) => (lat >= 90 ? OFF_LAT : lat <= -90 ? -OFF_LAT : lat);
  const at = (lon) => {
    const sp = seen(capSpan(lon, cLat, cLon, cosR), latRange);
    if (sp) run.push([ lon, sp[0], sp[1] ]);
  };
  const close = () => {
    if (run && run.length > 1) {
      const ring = [
        ...run.map(([ lon, , hi ]) => [ lon, clamp(hi) ]),
        ...run.map(([ lon, lo ]) => [ lon, clamp(lo) ]).reverse()
      ];
      ring.push([ ...ring[0] ]);
      rings.push(ring);
    }
    run = null;
  };

  for (let lon = -180 - LON_PAD; lon <= 180 + LON_PAD; lon += LON_STEP) {
    if (seen(capSpan(lon, cLat, cLon, cosR), latRange)) {
      if (!run) {
        run = [];
        if (prev !== null) at(tangentLon(lon, prev, cLat, cLon, cosR, latRange));
      }
      at(lon);
    } else if (run) {
      at(tangentLon(prev, lon, cLat, cLon, cosR, latRange));
      close();
    }
    prev = lon;
  }
  close();
  return rings;
}

// The terminator as an OPEN curve — the lit edge of the night region, without
// the off-frame sides that closing it requires. This is the line Apple draws.
// Only the boundary that is actually on the sphere is kept: a vertex parked at
// ±OFF_LAT is a bookkeeping device, not a place, and joining through one draws
// a spike across the map.
export function terminatorCurves(dec, subLon, h0 = 0, latRange = [ -90, 90 ]) {
  // At an exact equinox the cap boundary is degenerate in the span
  // formulation: whole night-side meridians are inside while the two edge
  // meridians touch only at the poles. State the known limit explicitly so
  // floating-point noise cannot turn it into short arcs along those poles.
  if (Math.abs(dec) < 1e-9 && Math.abs(h0) < 1e-9) {
    const normalize = (lon) => ((lon + 540) % 360) - 180;
    return [ normalize(subLon - 90), normalize(subLon + 90) ]
      .map((lon) => [ [ lon, -90 ], [ lon, 90 ] ]);
  }
  const out = [];
  for (const ring of nightRings(dec, subLon, h0, latRange)) {
    let run = [];
    for (const [ lon, lat ] of ring) {
      if (Math.abs(lat) >= 90) { if (run.length > 1) out.push(run); run = []; }
      else run.push([ lon, lat ]);
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}
