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
export function buildGraticule({ meridians = 12, parallels = 11, skipDeg = 5 } = {}) {
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
