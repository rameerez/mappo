// The standby face: one definition of the picture, for every page that draws it.
//
// It existed twice. The full-screen demo framed it -58..84 with 0.53 dots at
// #d40000 and revealed night through a clipped second map; the landing page
// framed it -58..78 with 0.55 dots at #e60000 and washed night on with black.
// Same picture, two sets of numbers, and they drifted the moment either was
// touched. Everything either page needs to agree about now lives here.
//
// The numbers are sampled from a screenshot of the original, not chosen: the
// clock is full red and the lit dots deliberately are not, which is the gap
// that keeps the digits in front of the map.

import { nightRings, terminatorCurves } from "./terminator.js";

// Re-exported: a page drawing the curve in its own units still shares the band
// it is computed over, which is the thing that drifted.
export { nightRings, terminatorCurves };

export const FACE = {
  latRange: [ -58, 84 ],
  dotShape: "circle",
  dotSize: 0.53,
  day: "#d40000",        // lit dots never reach the clock's red
  night: "#260000",      // the same hue at about an eighth
  clock: "#ff0000",      // and the clock, alone, is full red
  // The terminator fades as it falls, and not linearly: sampled down the
  // original it reads 160 at the arc, 90 by mid frame, 25 by three quarters
  // down and 20 under the map.
  lineStops: [ [ 0, "#c00000" ], [ 0.16, "#a00000" ], [ 0.5, "#5a0000" ],
               [ 0.72, "#1a0000" ], [ 1, "#140000" ] ]
};

// The projection both pages share, in 0..1 of the map's own box. Same numbers
// mappo's locate() answers with, which is why a layer built on this cannot
// drift from the dots under it.
export const fx = (lon) => (lon + 180) / 360;
export const fy = (lat) => (FACE.latRange[1] - lat) / (FACE.latRange[1] - FACE.latRange[0]);

// Attributes for a face map, so neither page can spell the geometry its own way.
export const faceAttrs = (cols, color = FACE.day) => ({
  mode: "flat", cols: String(cols),
  "lat-min": String(FACE.latRange[0]), "lat-max": String(FACE.latRange[1]),
  figure: "dots", "dot-shape": FACE.dotShape, "dot-size": String(FACE.dotSize),
  "figure-color": color, "ground-color": "none", background: "none",
  interactive: "false"
});

// Night as closed rings in 0..1, for a clip path (objectBoundingBox) or a fill.
export function nightPath(sky, { h0 = 0, scale = 1 } = {}) {
  const { dec, subLon } = sky;
  return nightRings(dec, subLon, h0, FACE.latRange)
    .map((ring) => "M" + ring
      .map(([ lon, lat ]) => `${(fx(lon) * scale).toFixed(scale === 1 ? 5 : 1)} ${(fy(lat) * scale).toFixed(scale === 1 ? 5 : 1)}`)
      .join("L") + "Z").join("");
}

// The lit edge as an open curve, in the same units.
export function terminatorPath(sky, { scale = 1 } = {}) {
  const { dec, subLon } = sky;
  return terminatorCurves(dec, subLon, 0, FACE.latRange)
    .map((curve) => "M" + curve
      .map(([ lon, lat ]) => `${(fx(lon) * scale).toFixed(scale === 1 ? 5 : 1)} ${(fy(lat) * scale).toFixed(scale === 1 ? 5 : 1)}`)
      .join("L")).join("");
}

// The whole face onto a canvas layer, for a panel that wants one map instead of
// two: night as nested washes so dusk deepens the way dusk does, then the
// boundary stroked over them. A flat single wash is a dark half and a light
// half with no sun line between them, which is the one thing the picture is of.
export function paintFace(ctx, width, height, sky) {
  const X = (lon) => fx(lon) * width;
  const Y = (lat) => fy(lat) * height;
  const trace = (pts) => pts.forEach(([ lon, lat ], i) => {
    const x = X(lon), y = Y(lat);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });

  for (const [ h0, alpha ] of [ [ 0, 0.42 ], [ -6, 0.34 ], [ -18, 0.34 ] ]) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    for (const ring of nightRings(sky.dec, sky.subLon, h0, FACE.latRange)) {
      ctx.beginPath();
      trace(ring);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.strokeStyle = FACE.lineStops[1][1];
  ctx.lineWidth = 1.4;
  ctx.lineJoin = ctx.lineCap = "round";
  for (const curve of terminatorCurves(sky.dec, sky.subLon, 0, FACE.latRange)) {
    ctx.beginPath();
    trace(curve);
    ctx.stroke();
  }
}

// "1:24", never "1:24 AM": the face shows the period nowhere, so the parts get
// assembled by hand rather than trusting a locale to leave it out.
export function clockFor(zone) {
  const p = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", timeZone: zone });
  return (d) => p.formatToParts(d)
    .filter((x) => x.type === "hour" || x.type === "literal" || x.type === "minute")
    .map((x) => (x.type === "literal" ? ":" : x.value)).join("").replace(/:+$/, "");
}
