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
// paths. Several globes on one page is a first-class case.

import { resolvePlaces } from "./body.js";
import { cellCenter, cellCorner } from "./projection.js";
import { normalizeRings, pointInRings } from "./highlight.js";
import { noise2 } from "./noise.js";
import { hoverShade, resolveColor, usesCssVars } from "./color.js";
import { buildGraticule } from "./graticule.js";
import { buildFigure, parseFigureStyle, figureOutlines, figureBorders } from "./figure.js";

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

// Figure dots as a flat Float32Array [x,y,z, x,y,z, …] — same grid sampling
// as the flat renderer (cellCenter + the body's figure()), so flat and globe
// agree on what the world looks like at a given resolution. `ground` flips
// the selection to the complement (the filler dots).
export function buildGlobePoints(cols, latRange, body, ground = false) {
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const grid = { cols, rows, latRange };
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = cellCenter(col, row, grid);
      if (Boolean(body.figure(c.lat, c.lon)) === ground) continue;
      const p = latLonToXYZ(c.lat, c.lon);
      out.push(p.x, p.y, p.z);
    }
  }
  return new Float32Array(out);
}

// Per-point highlight flags, aligned index-for-index with buildGlobePoints
// (same loop, same skip rule) — the phase-array discipline, reused: geometry
// arrays never reorder, parallel arrays annotate.
export function buildGlobeFlags(cols, latRange, test, body) {
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const grid = { cols, rows, latRange };
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = cellCenter(col, row, grid);
      if (!body.figure(c.lat, c.lon)) continue;
      out.push(test(c.lat, c.lon) ? 1 : 0);
    }
  }
  return new Uint8Array(out);
}

// Per-point animation phase + amplitude, aligned index-for-index with
// buildGlobePoints. Phase picks WHEN a dot moves in the cycle, amp how far —
// the exact fields the flat renderer bakes into its dot markup, so the modes
// read the same on a sphere.
export function buildGlobePhases(cols, latRange, mode, body) {
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const grid = { cols, rows, latRange };
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = cellCenter(col, row, grid);
      if (!body.figure(c.lat, c.lon)) continue;
      let p;
      switch (mode) {
        case "noise":   p = (noise2(col * 0.22, row * 0.22) + 1) / 2; break;
        case "ripple":  p = Math.hypot(col - cols / 2, row - rows / 2) / Math.hypot(cols / 2, rows / 2); break;
        case "sweep":   p = col / cols; break;
        case "sparkle": p = (noise2(col * 3.7 + 9, row * 3.7 + 9) + 1) / 2; break;
        default:        p = (col + row) / (cols + rows); // wave
      }
      out.push(p, 0.55 + 0.45 * ((noise2(col * 0.31 + 47, row * 0.31 + 47) + 1) / 2));
    }
  }
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
          this._loop();
        }
      });
      this._io.observe(this.canvas);
    }
    if (typeof ResizeObserver === "function") {
      // Observe the canvas itself: its CSS box (100% wide, aspect-locked
      // square) is the ground truth the backing store must match.
      this._ro = new ResizeObserver(() => this._resize());
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
    "graticuleColor", "equatorColor", "graticuleOpacity", "equatorOpacity",
    "markerColor", "markerScale", "markerHoverScale", "highlightColor", "overlays"
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
    this._themeObserver = new MutationObserver(() => { this._cvCache = null; this._draw(); });
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
    this.canvas.style.cursor = this.o.interactive === false ? "" : "grab";
    if (this._static) this._draw();
  }

  // Screen point → sphere surface → lat/lon → grid cell (or place, checked
  // first in screen space since markers draw on top).
  #hitTest(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const side = this.side;
    const cx = side / 2, cy = side / 2, R = side * 0.40;
    const rot = (this.angle * Math.PI) / 180;
    const tilt = ((this.o.tilt || 0) * Math.PI) / 180;
    const sinR = Math.sin(rot), cosR = Math.cos(rot);
    const sinT = Math.sin(tilt), cosT = Math.cos(tilt);
    // Un-roll the pointer first: roll is applied last when drawing, so it
    // is undone first when inverting. Everything below then works in the
    // unrolled frame exactly as it did before roll existed.
    const roll = ((this.o.roll || 0) * Math.PI) / 180;
    const sinRo = Math.sin(-roll), cosRo = Math.cos(-roll);
    const rdx = mx - cx, rdy = my - cy;
    const ux = cx + rdx * cosRo - rdy * sinRo;
    const uy = cy + rdx * sinRo + rdy * cosRo;
    const base = Math.max(0.75, (4 * R) / (this.o.cols ?? 170)) * this.o.dotSize * 1.6;

    for (const place of this.placeData) {
      const x1 = place.p.x * cosR + place.p.z * sinR;
      const z1 = -place.p.x * sinR + place.p.z * cosR;
      const y2 = place.p.y * cosT - z1 * sinT;
      const z2 = place.p.y * sinT + z1 * cosT;
      if (z2 <= 0.01) continue;
      if (Math.hypot(ux - (cx + x1 * R), uy - (cy - y2 * R)) <= Math.max(10, base * this.o.markerScale * 0.9)) {
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

    const X = (ux - cx) / R;
    const Y = -(uy - cy) / R;
    const rr = X * X + Y * Y;
    if (rr > 1) return null;
    const Z = Math.sqrt(1 - rr);
    // Inverse of the draw transform: un-tilt, then un-spin.
    const y = Y * cosT + Z * sinT;
    const z1 = -Y * sinT + Z * cosT;
    const x = X * cosR - z1 * sinR;
    const z = X * sinR + z1 * cosR;
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lon = (Math.atan2(x, z) * 180) / Math.PI;

    const [ latMin, latMax ] = this.o.latRange;
    if (lat < latMin || lat > latMax) return null;
    const cols = this.o.cols ?? 170; // auto: globes want density — foreshortening thins the limb
    const rows = Math.round((cols / 360) * (latMax - latMin));
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
    const cols = this.o.cols ?? 170; // auto: globes want density — foreshortening thins the limb
    this.points = buildGlobePoints(cols, this.o.latRange, this._body);
    // The graticule is pure lat/lon geometry — built once per option change,
    // projected per frame. Cheap enough to rebuild unconditionally.
    this._graticule = this.o.graticule
      ? buildGraticule({ meridians: this.o.meridians, parallels: this.o.parallels })
      : null;
    // Region highlight: flags parallel the figure points (never reorder
    // geometry — annotate it).
    if (this.o.highlightPolygon?.length) {
      const normalized = normalizeRings(this.o.highlightPolygon);
      this.highlightFlags = buildGlobeFlags(cols, this.o.latRange, (lat, lon) => pointInRings(lat, lon, normalized), this._body);
    } else {
      this.highlightFlags = null;
    }
    this.groundPoints = this.o.groundColor && this.o.groundColor !== "none"
      ? buildGlobePoints(cols, this.o.latRange, this._body, true)
      : null;
    this.phases = this.o.animation && this.o.animation !== "none"
      ? buildGlobePhases(cols, this.o.latRange, this.o.animation, this._body)
      : null;
    this.placeData = resolvePlaces(this.o.places, this._body)
      .map((p) => ({ ...p, p: latLonToXYZ(p.lat, p.lon) }));
    this.canvas.style.cursor = this.o.interactive === false ? "" : "grab";
    if (this.o.dotShape !== "circle" && this.o.dotShape !== "square" &&
        this.o.dotShape !== "triangle" && !this._shapeWarned) {
      this._shapeWarned = true;
      console.warn(`[mappo] mode="globe" draws circle/square/triangle dots; custom SVG paths fall back to squares`);
    }
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const side = rect.width || this.container.clientWidth || 300;
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
    this._draw();
  }

  _loop() {
    this._raf = requestAnimationFrame((t) => {
      this._raf = null;
      if (!this._visible) return; // the IntersectionObserver restarts us
      const dt = this._t == null ? 16 : Math.min(100, t - this._t);
      this._t = t;
      this._time = (this._time || 0) + dt / 1000;
      if (this._drag?.active) {
        // The pointer owns the angle while dragging.
      } else {
        if (this._omega == null) this._omega = this.o.rotateSpeed;
        // Momentum relaxes back to the base spin — exponential, ~0.8s to
        // settle, so the handoff from a flick to auto-rotation is seamless.
        this._omega += (this.o.rotateSpeed - this._omega) * (1 - Math.exp(-dt / 800));
        this.angle = (this.angle + (this._omega * dt) / 1000 + 360) % 360;
      }
      this._draw();
      this._loop();
    });
  }

  // One place that knows how a unit-sphere point becomes a pixel on this
  // sphere: spin about the polar axis, lean by the axial tilt, then roll in
  // the screen plane. Writes [sx, sy, depth] into `out` and returns whether
  // the point faces the viewer. Allocation-free — this is the per-vertex
  // hot path for figure quads, contours and vector outlines. (The dot loop
  // keeps its own inlined copy; it runs tens of thousands of times a frame
  // and every property read shows up.)
  #projectXYZ(x, y, z, T, out) {
    const x1 = x * T.cosR + z * T.sinR;
    const z1 = -x * T.sinR + z * T.cosR;
    const y2 = y * T.cosT - z1 * T.sinT;
    const z2 = y * T.sinT + z1 * T.cosT;
    const dx = x1 * T.R, dy = -y2 * T.R;
    out[0] = T.cx + dx * T.cosRo - dy * T.sinRo;
    out[1] = T.cy + dx * T.sinRo + dy * T.cosRo;
    out[2] = z2;
    return z2 > 0.01;
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
    const dx = x1 * T.R, dy = -y2 * T.R;
    return {
      sx: T.cx + dx * T.cosRo - dy * T.sinRo,
      sy: T.cy + dx * T.sinRo + dy * T.cosRo,
      z: z2,
      // A point ON the sphere is visible when it faces us. A point ABOVE it is
      // hidden only when the body is actually in the way, which it can only be
      // inside the disc — so something in orbit over the far side still shows,
      // standing off the limb, which is exactly where you would see it from here.
      front: z2 > 0.01 || (radius > 1 && Math.hypot(x1, y2) > 1)
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
        pts[j] = { sx: s[0], sy: s[1], z: s[2], front };
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
    this.#strokeBanded(this.#projectRings(xyzRings(rings), T), stroke, width, 1, alphaScale);
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
      // Batched by depth band, NOT one fill() per cell.
      //
      // The figure is a few thousand quads; issuing a beginPath/fill for each
      // was measured at ~13 ms per globe, which turns a page carrying several
      // of them into a slideshow. Path construction is nearly free — it is the
      // fill calls that cost — so the quads are accumulated into a handful of
      // paths, one per slice of the depth fade, and each is filled once. Same
      // picture, BANDS draw calls instead of thousands.
      const BANDS = 6;
      const paths = Array.from({ length: BANDS }, () => new Path2D());
      const q = geom.quads;
      const A = this._scratch, B = this._scratchB, C = this._scratchC, D = this._scratchD;
      let any = false;
      for (let i = 0; i < q.length; i += 12) {
        if (!this.#projectXYZ(q[i], q[i + 1], q[i + 2], T, A)) continue;
        if (!this.#projectXYZ(q[i + 3], q[i + 4], q[i + 5], T, B)) continue;
        if (!this.#projectXYZ(q[i + 6], q[i + 7], q[i + 8], T, C)) continue;
        if (!this.#projectXYZ(q[i + 9], q[i + 10], q[i + 11], T, D)) continue;
        const path = paths[Math.min(BANDS - 1, Math.floor(A[2] * BANDS))];
        path.moveTo(A[0], A[1]);
        path.lineTo(B[0], B[1]);
        path.lineTo(C[0], C[1]);
        path.lineTo(D[0], D[1]);
        path.closePath();
        any = true;
      }
      if (any) {
        ctx.fillStyle = this._c(o.figureColor);
        for (let i = 0; i < BANDS; i++) {
          ctx.globalAlpha = 0.35 + 0.65 * ((i + 0.5) / BANDS);   // the fade the dots wear
          ctx.fill(paths[i]);
        }
      }
    }

    if (style.stroke) {
      // Contours are stroked per depth band like everything else: a single
      // stroke() can only carry one alpha.
      this.#strokeBanded(this.#projectRings(geom.loops, T), strokeColor, o.figureStrokeWidth ?? 1, 1);
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

    const project = (lines) => lines.map((line) => line.map(([ lat, lon ]) => this.#project(lat, lon, T)));
    this.#strokeBanded(project(this._graticule.meridians), color, 1, o.graticuleOpacity);
    this.#strokeBanded(project(this._graticule.parallels), color, 1, o.graticuleOpacity);
    this.#strokeBanded(project([ this._graticule.equator ]), equator, 1, o.equatorOpacity);
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
  // So segments are bucketed by depth and each bucket is stroked once. Same
  // fade, honestly applied, and far fewer draw calls than stroking per segment.
  #strokeBanded(lines, color, width, peak, alphaScale = 1) {
    const ctx = this.ctx;
    const BANDS = 7;
    const paths = Array.from({ length: BANDS }, () => new Path2D());
    let any = false;
    for (const pts of lines) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!a.front || !b.front) continue;     // the far side, or crossing it
        const band = Math.min(BANDS - 1, Math.max(0, Math.floor(((a.z + b.z) / 2) * BANDS)));
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
      ctx.globalAlpha = peak * (0.25 + 0.75 * ((i + 0.5) / BANDS)) * alphaScale;
      ctx.stroke(paths[i]);
    }
    ctx.globalAlpha = 1;
  }

  // Where a point on — or above — the globe lands on screen, in CSS pixels
  // from the top-left of the element. This is the same projection the frame
  // was drawn with, so anything positioned by it is registered to the pixel.
  //
  // Returns null before the first frame. `front` is false only when the body
  // is between you and the point.
  locate(lat, lon, radius = 1) {
    if (!this._T) return null;
    const p = this.#project(lat, lon, this._T, radius);
    return {
      x: p.sx, y: p.sy,
      depth: Math.max(0, Math.min(1, p.z / radius)),
      front: p.front,
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
      el.style.setProperty("--mappo-depth", p.front ? p.z.toFixed(3) : "0");
      el.toggleAttribute("data-mappo-behind", !p.front);
    }
  }

  #drawPoints(pts, { cx, cy, R, sinR, cosR, sinT, cosT, sinRo = 0, cosRo = 1, base, shape, alphaLo, alphaHi, anim, flags, baseColor, hiColor }) {
    const ctx = this.ctx;
    let currentHi = null;
    for (let i = 0; i < pts.length; i += 3) {
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
      // Spin around the polar axis, then lean by the axial tilt.
      const x1 = pts[i] * cosR + pts[i + 2] * sinR;
      const z1 = -pts[i] * sinR + pts[i + 2] * cosR;
      const y2 = pts[i + 1] * cosT - z1 * sinT;
      const z2 = pts[i + 1] * sinT + z1 * cosT;
      if (z2 <= 0.01) continue; // back hemisphere

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
      const dx = x1 * R * k, dy = -y2 * R * k;
      const sx = cx + dx * cosRo - dy * sinRo;
      const sy = cy + dx * sinRo + dy * cosRo;
      const s = base * (0.45 + 0.55 * z2) * sizeMul; // foreshortening at the limb
      ctx.globalAlpha = alphaLo + alphaHi * z2; // …and a depth fade
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

  _scratch = new Float64Array(3);
  _scratchB = new Float64Array(3);
  _scratchC = new Float64Array(3);
  _scratchD = new Float64Array(3);

  _draw() {
    const { ctx, side } = this;
    if (!ctx || !side) return;
    const o = this.o;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);

    const cx = side / 2;
    const cy = side / 2;
    const R = side * 0.40; // breathing room — the halo must not kiss the edges

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

    const rot = (this.angle * Math.PI) / 180;
    const tilt = ((o.tilt || 0) * Math.PI) / 180;
    const sinR = Math.sin(rot), cosR = Math.cos(rot);
    const sinT = Math.sin(tilt), cosT = Math.cos(tilt);
    // roll: the LEAN. tilt leans the axis away from the viewer (a
    // foreshortening, in 3D); roll turns the finished disc in the plane of
    // the screen, which is the "globe sitting at an angle" look. They are
    // different gestures and compose — so roll is applied last, to the
    // projected point, where it is a plain 2D rotation about the centre.
    const roll = ((o.roll || 0) * Math.PI) / 180;
    const sinRo = Math.sin(roll), cosRo = Math.cos(roll);

    const T = { cx, cy, R, sinR, cosR, sinT, cosT, sinRo, cosRo };
    // Kept so locate() answers about the frame on screen right now, not
    // about where the sphere was when someone last asked.
    this._T = T;

    // Graticule under the dots: it is the grid the world sits on, not an
    // overlay drawn across it.
    this.#drawGraticule(T);

    // Dot footprint ≈ visible cell spacing: cols spans 360° of longitude,
    // so the front hemisphere shows cols/2 dots across 2R.
    const base = Math.max(0.75, (4 * R) / (o.cols ?? 170)) * o.dotSize * 1.6;
    const shape = o.dotShape === "circle" || o.dotShape === "triangle" ? o.dotShape : "square";

    // Ground first — smaller, dimmer, same transform — so the figure reads on
    // top. The ground never animates: it is ground, the figure is figure.
    if (this.groundPoints) {
      ctx.fillStyle = this._c(o.groundColor);
      this.#drawPoints(this.groundPoints, { cx, cy, R, sinR, cosR, sinT, cosT, sinRo, cosRo, base: base * 0.62, shape, alphaLo: 0.15, alphaHi: 0.55 });
    }

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

    const figureStyle = parseFigureStyle(o.figure);
    if (figureStyle.dots) {
      ctx.fillStyle = this._c(o.figureColor);
      this.#drawPoints(this.points, { cx, cy, R, sinR, cosR, sinT, cosT, sinRo, cosRo, base, shape, alphaLo: 0.25, alphaHi: 0.75, anim,
        flags: this.highlightFlags, baseColor: this._c(o.figureColor), hiColor: this._c(o.highlightColor) });
    } else {
      this.#drawFigure(T, figureStyle);
    }

    // Hovered dot re-draws bigger in the hover colour (cheap overdraw).
    if (this._hover?.kind === "dot") {
      const hp = latLonToXYZ(this._hover.detail.lat, this._hover.detail.lon);
      const x1 = hp.x * cosR + hp.z * sinR;
      const z1 = -hp.x * sinR + hp.z * cosR;
      const y2 = hp.y * cosT - z1 * sinT;
      const z2 = hp.y * sinT + z1 * cosT;
      if (z2 > 0.01) {
        ctx.fillStyle = this._c(o.dotHoverColor) ?? hoverShade(this._c(o.figureColor));
        ctx.globalAlpha = 1;
        const s = base * (0.45 + 0.55 * z2) * o.dotHoverScale;
        const hdx = x1 * R, hdy = -y2 * R;
        this.#drawShape(cx + hdx * cosRo - hdy * sinRo, cy + hdx * sinRo + hdy * cosRo, s, shape);
      }
    }

    // Place markers ride the same transform, drawn on top at full strength;
    // the hovered one swells by markerHoverScale.
    ctx.fillStyle = this._c(o.markerColor);
    const mshape = [ "circle", "square", "triangle", "pin" ].includes(o.markerShape) ? o.markerShape : "circle";
    for (const place of this.placeData) {
      const x1 = place.p.x * cosR + place.p.z * sinR;
      const z1 = -place.p.x * sinR + place.p.z * cosR;
      const y2 = place.p.y * cosT - z1 * sinT;
      const z2 = place.p.y * sinT + z1 * cosT;
      if (z2 <= 0.01) continue;
      const hovered = this._hover?.kind === "place" && this._hover.detail.name === place.name;
      ctx.globalAlpha = 1;
      if (place.color) ctx.fillStyle = this._c(place.color);
      const ms = base * o.markerScale * 0.6 * (hovered ? o.markerHoverScale : 1);
      const mdx = x1 * R, mdy = -y2 * R;
      this.#drawShape(cx + mdx * cosRo - mdy * sinRo, cy + mdx * sinRo + mdy * cosRo, ms * 2, mshape);
      if (place.color) ctx.fillStyle = this._c(o.markerColor);
    }
    ctx.globalAlpha = 1;

    // DOM last: the overlay reads the same transform the frame just drew,
    // so labels can never lag the sphere by a frame.
    this.#placeOverlays(T);
  }
}
