// mappo/links — arcs between places and spikes at them, drawn over the map.
//
//   import "mappo/globe";
//   import { links } from "mappo/links";
//   const layer = links(map, { color: "#f46bbe", width: 1.5 });
//   const arc = layer.add({ from: "London", to: "Tokyo" });           // a great-circle arc, lifted
//   const pin = layer.add({ at: "Lagos", height: 0.1, tip: 2 });      // a spike with a dot on top
//   arc.range = [ 0, 0.4 ]; layer.redraw();                           // the first 40% of it
//   layer.at(event);                                                  // the link under the pointer
//
// Everything a curve needs is decided once, when a link is added or changed:
// the great circle from `from` to `to`, sampled evenly in angle and lifted off
// the surface by height·sin(πt) — a hump that leaves and lands steeply, peaks
// in the middle and never sags below the surface. A frame only projects those
// points with locate(), so a link costs one locate per vertex per frame and the
// globe's own camera, tilt and roll come for free: the far side is cut where
// the body is in the way, widths grow toward a perspective camera, and
// `fade: true` fades a link the way the globe fades its own lines (under fog,
// with the fog). On the flat map the same points go through the projection and
// are cut at its seam, and `height` arches the curve up the page — toward the
// north pole, by the same angle it would rise off the globe — so a hero map's
// arcs bow the way they always have; a spike stands up the page.
//
// A link is a plain object you keep and mutate. A change to `from`, `to`, `at`,
// `height`, `segments` or `points` rebuilds its curve on the next draw; the rest
// — `color`, `width`, `opacity`, `blend`, `fade`, `range`, `tip`, `data` — is
// read every frame. The map redraws the layer with every frame it draws; call
// layer.redraw() when what you changed did not move the map.
//
// Built on Mappo#addLayer and locate(): nothing here reaches into a renderer.

import { resolvePlace } from "./body.js";
import { resolveColor } from "./color.js";
import { projectPolyline } from "./projections.js";

const DEG = 180 / Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Unit-sphere position of a lat/lon: +y north, lon 0 at +z, east +x — the
// globe's own convention (see globe.js latLonToXYZ).
export function toXYZ(lat, lon) {
  const p = lat / DEG, l = lon / DEG, c = Math.cos(p);
  return [ c * Math.sin(l), Math.sin(p), c * Math.cos(l) ];
}

// The inverse, for a point at any radius: [lat, lon, r].
export function toLatLon(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  return [ Math.asin(clamp(y / r, -1, 1)) * DEG, Math.atan2(x, z) * DEG, r ];
}

// The angle between two surface points, in radians: the great-circle distance
// on a unit sphere.
export function arcAngle(from, to) {
  const A = toXYZ(from.lat, from.lon), B = toXYZ(to.lat, to.lon);
  return Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1));
}

// The height an arc gets unless told: 0.3 of the half-chord — 0.3 radii for
// antipodes, next to nothing for neighbours — so short hops hug the ground and
// long ones arc.
export function arcHeight(from, to) {
  return 0.3 * Math.sin(arcAngle(from, to) / 2);
}

// The curve between two surface points as [lat, lon, r] samples: the great
// circle, evenly spaced in angle, lifted by height·sin(πt) radii. Antipodes
// have every great circle in common; the one over the pole is taken.
export function arcPoints(from, to, { height, segments } = {}) {
  const A = toXYZ(from.lat, from.lon), B = toXYZ(to.lat, to.lon);
  const dot = clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1);
  const theta = Math.acos(dot);
  // The unit tangent at A toward B.
  let d = [ B[0] - A[0] * dot, B[1] - A[1] * dot, B[2] - A[2] * dot ];
  let len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) {
    const up = Math.abs(A[1]) > 0.999 ? [ 1, 0, 0 ] : [ 0, 1, 0 ];
    const k = A[0] * up[0] + A[1] * up[1] + A[2] * up[2];
    d = [ up[0] - A[0] * k, up[1] - A[1] * k, up[2] - A[2] * k ];
    len = Math.hypot(d[0], d[1], d[2]);
  }
  d = [ d[0] / len, d[1] / len, d[2] / len ];
  const h = height ?? arcHeight(from, to);
  const n = segments ?? clamp(Math.round(theta * 36), 8, 72);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, ang = t * theta, r = 1 + h * Math.sin(Math.PI * t);
    const c = Math.cos(ang), s = Math.sin(ang);
    out.push(toLatLon((A[0] * c + d[0] * s) * r, (A[1] * c + d[1] * s) * r, (A[2] * c + d[2] * s) * r));
  }
  return out;
}

// Distance from a point to a segment, in the same units.
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The visible part of a link as [a, b] fractions of its length, in order.
function rangeOf(range) {
  const a = clamp(Number(range?.[0] ?? 0) || 0, 0, 1), b = clamp(Number(range?.[1] ?? 1) || 0, 0, 1);
  return a <= b ? [ a, b ] : [ b, a ];
}

export class Links {
  constructor(map, defaults = {}) {
    if (!map || typeof map.addLayer !== "function") throw new TypeError("links() needs a Mappo instance (an element's .map)");
    this.map = map;
    this.defaults = { color: null, width: 1.5, opacity: 1, blend: null, fade: false, ...defaults };
    this.items = [];
    this._layer = map.addLayer((ctx, view) => this.#draw(ctx, view));
  }

  // Add a link and get it back: the object you mutate from here on.
  add(spec) {
    const link = { ...spec };
    this.items.push(link);
    this.redraw();
    return link;
  }

  remove(link) {
    const i = this.items.indexOf(link);
    if (i >= 0) { this.items.splice(i, 1); this.redraw(); }
    return this;
  }

  clear() {
    this.items.length = 0;
    this.redraw();
    return this;
  }

  // Draw again with the next frame — for a change that did not move the map.
  redraw() {
    this._layer.redraw();
    return this;
  }

  // Take the layer off the map. The link objects are yours to keep.
  destroy() {
    this._layer.remove();
    this.items.length = 0;
  }

  // The topmost link within `tolerance` CSS pixels of a point in the map's
  // box, or null. Takes (x, y) or a pointer event. A link's `_hits` are the
  // screen segments it was last drawn as, null when none of it was on screen.
  at(x, y, tolerance = 6) {
    if (x && typeof x === "object") {
      const r = this.map.container.getBoundingClientRect();
      tolerance = y ?? 6;
      y = x.clientY - r.top;
      x = x.clientX - r.left;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const link = this.items[i], h = link._hits;
      if (!h) continue;
      const tol = tolerance + (link.width ?? this.defaults.width) / 2;
      for (let k = 0; k + 3 < h.length; k += 4) {
        if (segmentDistance(x, y, h[k], h[k + 1], h[k + 2], h[k + 3]) <= tol) return link;
      }
    }
    return null;
  }

  // A name from the body's gazetteer, [lat, lon] or { lat, lon } → { lat, lon }.
  #place(v) {
    if (Array.isArray(v)) return Number.isFinite(v[0]) && Number.isFinite(v[1]) ? { lat: v[0], lon: v[1] } : null;
    const p = resolvePlace(v, this.map.body);
    if (!p && typeof v === "string" && !this.map.body?.pending && !(this._warned ??= new Set()).has(v)) {
      this._warned.add(v);
      console.warn(`[mappo/links] unknown place "${v}" on ${this.map.body?.name ?? "this body"}`);
    }
    return p;
  }

  // The curve, built once per change of what defines it: [lat, lon, r] samples
  // and the same as xyz for interpolation (lat/lon cannot be interpolated
  // across the antimeridian; a chord can).
  #geometry(link) {
    const spike = link.at != null && link.to == null;
    const key = JSON.stringify([ link.points ?? null, link.from ?? link.at ?? null, link.to ?? null, link.height ?? null, link.segments ?? null ]);
    if (link._key === key) return link._geom;
    let pts = null, lift = 0;
    if (Array.isArray(link.points) && link.points.length > 1) {
      pts = link.points.map(([ lat, lon, r = 1 ]) => [ lat, lon, r ]);
    } else {
      const a = this.#place(link.from ?? link.at), b = spike ? null : this.#place(link.to);
      if (a && (spike || b)) {
        if (spike) pts = [ [ a.lat, a.lon, 1 ], [ a.lat, a.lon, 1 + (Number(link.height) || 0.1) ] ];
        else {
          // The height in radii is also the arch on the flat map, in radians of latitude.
          lift = Number.isFinite(Number(link.height)) && link.height != null ? Number(link.height) : arcHeight(a, b);
          pts = arcPoints(a, b, { height: lift, segments: link.segments });
        }
      }
    }
    // A name a pending body cannot resolve yet is asked again next frame.
    link._key = pts || !this.map.body?.pending ? key : null;
    if (!pts) return (link._geom = null);
    const xyz = new Float64Array(pts.length * 3);
    pts.forEach(([ lat, lon, r ], i) => {
      const p = toXYZ(lat, lon);
      xyz[i * 3] = p[0] * r; xyz[i * 3 + 1] = p[1] * r; xyz[i * 3 + 2] = p[2] * r;
    });
    return (link._geom = { pts, xyz, spike, lift });
  }

  // The [lat, lon, r] at fractional vertex index u.
  #sample(geom, u) {
    const n = geom.pts.length - 1;
    const i = clamp(Math.floor(u), 0, n - 1), f = u - i;
    if (f === 0) return geom.pts[i];
    const x = geom.xyz, k = i * 3;
    return toLatLon(x[k] + (x[k + 3] - x[k]) * f, x[k + 1] + (x[k + 4] - x[k + 1]) * f, x[k + 2] + (x[k + 5] - x[k + 2]) * f);
  }

  #draw(ctx, view) {
    const map = this.map, d = this.defaults;
    const flat = !!map.projection;
    const glass = !flat && Array.isArray(map.options.fog);
    const resolved = new Map();
    const colorOf = (c) => {
      const key = c ?? d.color ?? map.options.markerColor;
      if (!resolved.has(key)) resolved.set(key, resolveColor(key, map.container));
      return resolved.get(key);
    };
    ctx.lineCap = ctx.lineJoin = "round";
    for (const link of this.items) {
      link._hits = null;
      const geom = this.#geometry(link);
      if (!geom) continue;
      const [ a, b ] = rangeOf(link.range);
      if (b <= a) continue;
      const style = {
        color: colorOf(link.color), width: Number(link.width ?? d.width) || 0, opacity: clamp(Number(link.opacity ?? d.opacity ?? 1), 0, 1),
        fade: link.fade ?? d.fade, tip: link.tip == null ? null : typeof link.tip === "object" ? link.tip : { radius: Number(link.tip) }
      };
      if (!(style.width > 0) && !style.tip) continue;
      ctx.globalCompositeOperation = link.blend ?? d.blend ?? "source-over";
      ctx.strokeStyle = ctx.fillStyle = style.color;
      if (flat) this.#drawFlat(ctx, view, link, geom, a, b, style);
      else this.#drawGlobe(ctx, link, geom, a, b, style, glass);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // On the globe: every vertex through locate(); runs of visible segments are
  // stroked in pieces of constant width and alpha (a canvas path carries one
  // of each), quantised to a quarter pixel and 1/24 so the pieces stay few.
  #drawGlobe(ctx, link, geom, a, b, style, glass) {
    const map = this.map, n = geom.pts.length - 1, from = a * n, to = b * n;
    const hits = link._hits = [];
    let prev = null, open = false, curW = -1, curA = -1, last = null;
    const flush = () => { if (open) { ctx.stroke(); open = false; } };
    for (let u = from; ; u = Math.min(to, Math.floor(u) + 1)) {
      const [ lat, lon, r ] = this.#sample(geom, u);
      const L = map.locate(lat, lon, r);
      const cur = L && (glass || L.front) ? L : null;
      if (cur) last = cur;
      if (prev && cur && style.width > 0) {
        const w = Math.round((style.width * (prev.scale + cur.scale)) / (2 * cur.r) * 4) / 4;
        const al = style.fade ? Math.round(style.opacity * ((prev.fade + cur.fade) / 2) * 24) / 24 : style.opacity;
        if (!open || w !== curW || al !== curA) {
          flush();
          ctx.lineWidth = curW = w;
          ctx.globalAlpha = curA = al;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          open = true;
        }
        ctx.lineTo(cur.x, cur.y);
        hits.push(prev.x, prev.y, cur.x, cur.y);
      } else flush();
      prev = cur;
      if (u >= to) break;
    }
    flush();
    // The dot at the far end, once the link reaches it.
    if (style.tip && b >= 1 && last) {
      const rad = (Number(style.tip.radius) || 0) * (last.scale / last.r);
      if (rad > 0) {
        ctx.globalAlpha = style.fade ? style.opacity * last.fade : style.opacity;
        if (style.tip.color) ctx.fillStyle = resolveColor(style.tip.color, map.container);
        ctx.beginPath();
        ctx.arc(last.x, last.y, rad, 0, 6.2832);
        ctx.fill();
        hits.push(last.x, last.y, last.x, last.y);
      }
    }
    if (!hits.length) link._hits = null;   // nothing of it is on screen
  }

  // On the flat map: the lat/lon samples through the projection, cut at its
  // seam by the same code the graticule uses. An arc's height becomes the
  // arch: each sample is moved toward the north pole by height·sin(πt)
  // radians of latitude — up the page on a cylindrical map — which survives
  // the seam cut because it happens before the projection. A spike stands up
  // the page, its height in the map's own scale (the equator is the map's width).
  #drawFlat(ctx, view, link, geom, a, b, style) {
    const map = this.map, hits = link._hits = [];
    ctx.lineWidth = style.width;
    ctx.globalAlpha = style.opacity;
    let end = null;
    if (geom.spike) {
      const p = map.locate(geom.pts[0][0], geom.pts[0][1]);
      if (!p) return;
      const len = ((geom.pts[1][2] - 1) * view.width) / (2 * Math.PI);
      const y0 = p.y - a * len, y1 = p.y - b * len;
      if (style.width > 0) { ctx.beginPath(); ctx.moveTo(p.x, y0); ctx.lineTo(p.x, y1); ctx.stroke(); hits.push(p.x, y0, p.x, y1); }
      end = [ p.x, y1 ];
    } else {
      const n = geom.pts.length - 1, line = [], arch = (geom.lift || 0) * DEG;
      for (let u = a * n; ; u = Math.min(b * n, Math.floor(u) + 1)) {
        const s = this.#sample(geom, u);
        line.push([ arch ? Math.min(90, s[0] + arch * Math.sin(Math.PI * (u / n))) : s[0], s[1] ]);
        if (u >= b * n) break;
      }
      for (const piece of projectPolyline(line, map.projection)) {
        let px, py;
        if (style.width > 0) ctx.beginPath();
        piece.forEach(([ x, y ], i) => {
          const sx = x * view.width, sy = y * view.height;
          if (style.width > 0) { if (i) { ctx.lineTo(sx, sy); hits.push(px, py, sx, sy); } else ctx.moveTo(sx, sy); }
          px = sx; py = sy;
          end = [ sx, sy ];
        });
        if (style.width > 0) ctx.stroke();
      }
    }
    if (style.tip && b >= 1 && end) {
      const rad = Number(style.tip.radius) || 0;
      if (rad > 0) {
        if (style.tip.color) ctx.fillStyle = resolveColor(style.tip.color, map.container);
        ctx.beginPath();
        ctx.arc(end[0], end[1], rad, 0, 6.2832);
        ctx.fill();
        hits.push(end[0], end[1], end[0], end[1]);
      }
    }
    if (!hits.length) link._hits = null;
  }
}

// The layer, for a map: links(el.map, { color, width, opacity, blend, fade }).
export function links(map, defaults) {
  return new Links(map, defaults);
}
