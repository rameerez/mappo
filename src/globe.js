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

import { resolvePlaces } from "./body.js";
import { stitchRings } from "./projections.js";
import { cellCenter, cellCorner } from "./projection.js";
import { normalizeRings, pointInRings } from "./highlight.js";
import { noise2 } from "./noise.js";
import { hoverShade, resolveColor, usesCssVars } from "./color.js";
import { buildGraticule } from "./graticule.js";
import { buildFigure, parseFigureStyle, figureOutlines, figureBorders } from "./figure.js";

const DEGREES = 180 / Math.PI;
const GOLDEN = (1 + Math.sqrt(5)) / 2;

// Unit-sphere position for a lat/lon. At rotation 0, lon 0 faces the
// viewer (+z out of the screen), +y is north.
export function latLonToXYZ(lat, lon) {
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
export function uniformCount(cols) {
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
export function forEachSample(cols, latRange, distribution, fn) {
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
export function buildGlobePoints(cols, latRange, body, ground = false, distribution = "grid") {
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
export function buildGlobeFlags(cols, latRange, test, body, distribution = "grid") {
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
export function buildGlobePhases(cols, latRange, mode, body, distribution = "grid") {
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
export function buildGlobeTiles(cols, latRange, body, halfSide, ground = false, distribution = "grid") {
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

export class GlobeRenderer {
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
