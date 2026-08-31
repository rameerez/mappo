// Globe mode: the same land grid wrapped on a sphere and spun — on canvas,
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
// Node-safe: the point-buffer builders are pure and testable; GlobeRenderer
// touches the DOM only in its constructor, which only runs in a browser.

import { isLand } from "./mask.js";
import { cellCenter } from "./projection.js";
import { resolveCity } from "./cities.js";
import { normalizeRings, pointInRings } from "./highlight.js";
import { noise2 } from "./noise.js";
import { hoverShade, resolveColor, usesCssVars } from "./color.js";
import { buildGraticule } from "./graticule.js";
import { buildLand, parseLandStyle, landRings, borderRings } from "./land.js";
import { cellCorner } from "./projection.js";

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

// Land dots as a flat Float32Array [x,y,z, x,y,z, …] — same grid sampling
// as the flat renderer (cellCenter + isLand), so flat and globe agree on
// what the world looks like at a given resolution.
// Per-point highlight flags, aligned index-for-index with
// buildGlobePoints (same loop, same skip rule) — the phase-array
// discipline, reused: geometry arrays never reorder, parallel arrays
// annotate.
export function buildGlobeFlags(cols, latRange, test, water = false) {
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const grid = { cols, rows, latRange };
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = cellCenter(col, row, grid);
      if (isLand(c.lat, c.lon) === water) continue;
      out.push(test(c.lat, c.lon) ? 1 : 0);
    }
  }
  return new Uint8Array(out);
}

export function buildGlobePoints(cols, latRange, water = false) {
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const grid = { cols, rows, latRange };
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = cellCenter(col, row, grid);
      if (isLand(c.lat, c.lon) === water) continue;
      const p = latLonToXYZ(c.lat, c.lon);
      out.push(p.x, p.y, p.z);
    }
  }
  return new Float32Array(out);
}

// Per-point animation phase + amplitude, aligned index-for-index with
// buildGlobePoints (same loop, same skip rule). Phase picks WHEN a dot
// moves in the cycle, amp how far — the exact fields the flat renderer
// bakes into its dot markup, so the six modes read the same on a sphere.
export function buildGlobePhases(cols, latRange, mode, water = false) {
  const rows = Math.round((cols / 360) * (latRange[1] - latRange[0]));
  const grid = { cols, rows, latRange };
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = cellCenter(col, row, grid);
      if (isLand(c.lat, c.lon) === water) continue;
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

export class GlobeRenderer {
  // @param container [HTMLElement] emptied; a square canvas fills its width.
  // @param options   [Object] the owning WorldMap's options (shared ref).
  constructor(container, options) {
    this.container = container;
    this.o = options;
    // focus: start the spin facing a point — the rotation that brings
    // the focus longitude to the front (z-max at rot = -λ, since
    // latLonToXYZ puts λ=0 facing the viewer at angle 0).
    this.angle = options.focus ? ((-options.focus.lon % 360) + 360) % 360 : 0;
    this._raf = null;
    this._t = null;

    // <world-map> is inline by default — an inline container has
    // clientWidth 0, which turned v0.3.0's first cut into a stretched
    // ribbon (square backing store, rectangular CSS box). Two guarantees
    // fix it for good: the host becomes a block, and the canvas box is
    // aspect-locked square via CSS so display and backing store can never
    // disagree on shape.
    if (typeof getComputedStyle === "function" &&
        getComputedStyle(container).display === "inline") {
      container.style.display = "block";
    }
    // Harvest host overlay markup BEFORE the canvas replaces the
    // container's children, or replaceChildren would delete the very
    // labels the caller asked us to position. mappo adopts them: they are
    // re-parented into an absolutely-positioned layer over the canvas and
    // given a transform every frame. The host keeps ownership of
    // everything else — markup, styling, and whether they are links.
    this._overlayEls = this.o.overlays === false ? []
      : Array.from(container.querySelectorAll("[data-lat][data-lon]"));

    this.canvas = document.createElement("canvas");
    this.canvas.className = "wm-globe";
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.aspectRatio = "1 / 1";
    container.replaceChildren(this.canvas);
    if (this._overlayEls.length) {
      if (getComputedStyle(container).position === "static") container.style.position = "relative";
      this._overlayLayer = document.createElement("div");
      this._overlayLayer.className = "wm-overlay";
      // pointer-events:none on the LAYER, not the children: the layer must
      // not swallow drag-to-spin, but a label that wants to be clickable
      // only has to set pointer-events:auto on itself.
      Object.assign(this._overlayLayer.style, {
        position: "absolute", inset: "0", pointerEvents: "none"
      });
      for (const el of this._overlayEls) {
        Object.assign(el.style, { position: "absolute", left: "0", top: "0", willChange: "transform" });
        this._overlayLayer.appendChild(el);
      }
      container.appendChild(this._overlayLayer);
    }
    this.ctx = this.canvas.getContext("2d");

    // Colours given as CSS variables follow the host's theme. Watch the
    // document element for the class/style flips theme switches are made
    // of, drop the memo, repaint. Costs nothing when every colour is a
    // literal — the observer is only installed if a var is in play.
    if (usesCssVars(this.o.dotColor, this.o.graticuleColor, this.o.equatorColor,
                    this.o.markerColor, this.o.oceanColor, this.o.background) &&
        typeof MutationObserver === "function") {
      this._themeObserver = new MutationObserver(() => { this._cvCache = null; this._draw(); });
      this._themeObserver.observe(document.documentElement, {
        attributes: true, attributeFilter: [ "class", "style", "data-theme" ]
      });
    }

    this._rebuildData();

    // Reduced motion: one static frame, no loop. Checked once at build —
    // the OS-level setting rarely flips mid-visit.
    this._static = typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Offscreen globes must not burn frames — pause when scrolled away.
    this._visible = true;
    if (typeof IntersectionObserver === "function") {
      this._io = new IntersectionObserver(([entry]) => {
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

  // Any option may have changed (the options object is shared with the
  // owning WorldMap, so no diffing is possible here). Rebuilding the point
  // buffer is a few ms even at max resolution — just do it. The rotation
  // angle deliberately survives.
  update() {
    this._cvCache = null;
    this._land = null;
    this._rebuildData();
    this._draw();
  }

  // Resolve a colour option, memoized. `var(--x)` costs one
  // getComputedStyle the first time and nothing after, until the theme moves.
  _c(value) {
    if (typeof value !== "string" || !value.includes("var(--")) return value;
    this._cvCache ??= new Map();
    if (!this._cvCache.has(value)) this._cvCache.set(value, resolveColor(value, this.container));
    return this._cvCache.get(value);
  }

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
  // onCityClick/onCityEnter callbacks + bubbling worldmap:* CustomEvents,
  // gated by `interactive`. On top of that, the globe is grabbable: drag
  // spins it directly, a flick carries momentum, and the spin relaxes back
  // to rotateSpeed on an exponential (~0.8s) — seamless handoff, no snap.

  // One marker/highlight footprint, honoring the shape options — the canvas
  // twin of the flat renderer's <use href="#wm-marker-shape">.
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
      const hy = sy - r * 1.9;      // head center
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
      ? (hit.kind === "city" ? this.o.markerCursor : this.o.cursor)
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

  // Screen point → sphere surface → lat/lon → grid cell (or city, checked
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

    for (const city of this.cityData) {
      const x1 = city.p.x * cosR + city.p.z * sinR;
      const z1 = -city.p.x * sinR + city.p.z * cosR;
      const y2 = city.p.y * cosT - z1 * sinT;
      const z2 = city.p.y * sinT + z1 * cosT;
      if (z2 <= 0.01) continue;
      if (Math.hypot(ux - (cx + x1 * R), uy - (cy - y2 * R)) <= Math.max(10, base * this.o.markerScale * 0.9)) {
        return { kind: "city", detail: { name: city.name, lat: city.lat, lon: city.lon, element: this.canvas } };
      }
    }

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

    const [latMin, latMax] = this.o.latRange;
    if (lat < latMin || lat > latMax) return null;
    const cols = this.o.cols ?? 170; // auto: globes want density — foreshortening thins the limb
    const rows = Math.round((cols / 360) * (latMax - latMin));
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((latMax - lat) / (latMax - latMin)) * rows)));
    const c = cellCenter(col, row, { cols, rows, latRange: this.o.latRange });
    if (!isLand(c.lat, c.lon)) return null;
    return { kind: "dot", detail: { lat: c.lat, lon: c.lon, col, row, element: this.canvas } };
  }

  #dispatch(kind, phase, detail) {
    if (this.o.interactive === false) return;
    const cb = this.o[`on${kind === "city" ? "City" : "Dot"}${phase}`];
    if (cb) cb(detail);
    this.container.dispatchEvent(new CustomEvent(
      `worldmap:${kind}${phase.toLowerCase()}`,
      { detail, bubbles: true }
    ));
  }

  _rebuildData() {
    const cols = this.o.cols ?? 170; // auto: globes want density — foreshortening thins the limb
    this.points = buildGlobePoints(cols, this.o.latRange);
    // The graticule is pure lat/lon geometry — built once per option change,
    // projected per frame. Cheap enough to rebuild unconditionally.
    this._graticule = this.o.graticule
      ? buildGraticule({ meridians: this.o.meridians, parallels: this.o.parallels })
      : null;
    // Region highlight: flags parallel the land points (never reorder
    // geometry — annotate it).
    if (this.o.highlightPolygon?.length) {
      const normalized = normalizeRings(this.o.highlightPolygon);
      this.highlightFlags = buildGlobeFlags(cols, this.o.latRange, (lat, lon) => pointInRings(lat, lon, normalized));
    } else {
      this.highlightFlags = null;
    }
    this.waterPoints = this.o.oceanColor && this.o.oceanColor !== "none"
      ? buildGlobePoints(cols, this.o.latRange, true)
      : null;
    this.phases = this.o.animation && this.o.animation !== "none"
      ? buildGlobePhases(cols, this.o.latRange, this.o.animation)
      : null;
    const resolved = [ ...(this.o.cities || []), ...(this.o.markers || []) ]
      .map((c) => (typeof c === "string" ? resolveCity(c) : resolveCity(c)))
      .filter(Boolean);
    this.cityData = resolved.map((c) => ({ name: c.name, lat: c.lat, lon: c.lon, p: latLonToXYZ(c.lat, c.lon) }));
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

  // One transformed, culled, depth-faded pass over a point buffer — land
  // and water share it; only color, size and alpha band differ.
  // One place that knows how a lat/lon becomes a pixel on this sphere.
  // The dot loop keeps its own inlined copy (it runs tens of thousands of
  // times a frame and every property read shows up); everything else —
  // graticule, DOM overlays, future arcs — goes through here so there is a
  // single definition of the transform to keep correct.
  #project(lat, lon, { cx, cy, R, sinR, cosR, sinT, cosT, sinRo = 0, cosRo = 1 }) {
    const p = latLonToXYZ(lat, lon);
    const x1 = p.x * cosR + p.z * sinR;
    const z1 = -p.x * sinR + p.z * cosR;
    const y2 = p.y * cosT - z1 * sinT;
    const z2 = p.y * sinT + z1 * cosT;
    const dx = x1 * R, dy = -y2 * R;
    return {
  sx: cx + dx * cosRo - dy * sinRo,
  sy: cy + dx * sinRo + dy * cosRo,
  z: z2, front: z2 > 0.01
    };
  }

  // Vector land on the sphere: real coastlines, clipped to the visible hemisphere.
  //
  // Stroking is easy — break the polyline whenever it turns away, exactly like
  // the graticule. FILLING is the hard part, and the reason a naive version
  // looks broken: in an orthographic projection the far side of the world folds
  // onto the near side, so feeding a whole ring to fill() paints a mirrored
  // ghost across the disc. Culling the back points instead leaves the ring open,
  // and an open ring fills to a straight chord — slicing a bite out of every
  // continent that touches the limb.
  //
  // The fix is to CLOSE each ring along the limb: walk the ring, keep the runs
  // that face us, and join consecutive runs with an arc of the sphere's own
  // silhouette. That is what the eye expects, because it is what the horizon
  // actually is.
  #drawVectorLand(T, style, rings, { fill, stroke, width, alphaScale = 1 }) {
    const ctx = this.ctx;
    const { cx, cy, R } = T;

    if (fill) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();                       // nothing may paint outside the planet
      ctx.fillStyle = fill;
    }

    for (const ring of rings) {
      const pts = ring.map(([ lat, lon ]) => this.#project(lat, lon, T));
      // Fill is deliberately NOT drawn from these rings. Clipping a spherical
      // polygon to the visible hemisphere analytically is a genuinely hard
      // problem, and every cheap rule for rejoining the clipped runs along the
      // limb was measured painting open ocean: the shorter arc closes a wide
      // run around the wrong side; the exit tangent sends a single-run ring the
      // long way round the disc; one constant direction per ring inverts the
      // whole thing. (A pixel probe over 24 rotations scored them: 38, 35 and
      // 98 ocean samples wrongly filled.) The globe therefore fills from the
      // mask — see #drawLand — which culls cell by cell and cannot fail that
      // way, and these rings draw the coastline on top.

      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        let drawing = false;
        for (const p of pts) {
          if (!p.front) { if (drawing) { ctx.stroke(); drawing = false; } continue; }
          if (!drawing) { ctx.beginPath(); ctx.moveTo(p.sx, p.sy); drawing = true; }
          else ctx.lineTo(p.sx, p.sy);
          ctx.globalAlpha = (0.3 + 0.7 * p.z) * alphaScale;
        }
        if (drawing) ctx.stroke();
      }
    }

    if (fill) ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Fill one ring, clipped to the visible hemisphere.
  //
  // The rule that makes this correct: when you clip a polygon to a disc and
  // keep the INSIDE, the disc's boundary is always traversed in ONE direction
  // for that polygon — the same direction the polygon itself is wound. Deciding
  // it per crossing (from the exit tangent) is what sent single-run rings the
  // long way round and filled open ocean; so the direction is settled once, for
  // the whole ring, from the ring's own orientation, and every bridge obeys it.
  //
  // Runs are then joined exit → NEXT ENTRY BY ANGLE in that direction, never in
  // array order: Afro-Eurasia crosses the silhouette fourteen times in a single
  // ring, and those crossings do not arrive in the order they sit around the
  // limb.
  #fillClippedRing(ring, pts, T, alphaScale) {
    const ctx = this.ctx;
    const { cx, cy, R } = T;
    const n = pts.length;
    const TAU = Math.PI * 2;
    if (!pts.some((p) => p.front)) return;

    const paint = (depth) => {
      ctx.globalAlpha = (0.4 + 0.6 * depth) * alphaScale;
      ctx.fill();
    };

    if (pts.every((p) => p.front)) {
      ctx.beginPath();
      ctx.moveTo(pts[0].sx, pts[0].sy);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
      ctx.closePath();
      paint(pts[0].z);
      return;
    }

    const crossing = (i, j) => {
      const t = pts[i].z / (pts[i].z - pts[j].z);
      let lon0 = ring[i][1], lon1 = ring[j][1];
      if (lon1 - lon0 > 180) lon1 -= 360; else if (lon0 - lon1 > 180) lon1 += 360;
      return this.#project(ring[i][0] + (ring[j][0] - ring[i][0]) * t,
                           lon0 + (lon1 - lon0) * t, T);
    };

    let startAt = 0;
    for (let i = 0; i < n; i++) {
      if (pts[i].front && !pts[(i - 1 + n) % n].front) { startAt = i; break; }
    }

    const runs = [];
    let current = null;
    let signed = 0;                      // shoelace over the VISIBLE geometry
    for (let k = 0; k < n; k++) {
      const i = (startAt + k) % n;
      const prev = (i - 1 + n) % n;
      if (pts[i].front) {
        if (!current) current = [ crossing(i, prev) ];
        current.push(pts[i]);
      } else if (current) {
        current.push(crossing(prev, i));
        for (let m = 0; m < current.length - 1; m++) {
          signed += (current[m].sx - cx) * (current[m + 1].sy - cy)
                  - (current[m + 1].sx - cx) * (current[m].sy - cy);
        }
        runs.push(current);
        current = null;
      }
    }
    if (current) runs.push(current);
    if (!runs.length) return;

    // One direction for the whole ring, taken from its own winding on screen.
    const dir = signed >= 0 ? 1 : -1;
    const angleOf = (p) => Math.atan2(p.sy - cy, p.sx - cx);
    for (const r of runs) {
      r.inAngle = angleOf(r[0]);
      r.outAngle = angleOf(r[r.length - 1]);
      r.used = false;
    }
    const sweep = (from, to) => {
      let d = dir > 0 ? to - from : from - to;
      d = ((d % TAU) + TAU) % TAU;
      return dir > 0 ? d : -d;
    };

    for (const seed of runs) {
      if (seed.used) continue;
      ctx.beginPath();
      ctx.moveTo(seed[0].sx, seed[0].sy);
      let run = seed, guard = 0;
      while (run && !run.used && guard++ <= runs.length) {
        run.used = true;
        for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].sx, run[i].sy);
        let next = null, bestGap = Infinity;
        for (const r of runs) {
          if (r.used) continue;
          const gap = Math.abs(sweep(run.outAngle, r.inAngle));
          if (gap < bestGap) { bestGap = gap; next = r; }
        }
        const target = next ?? seed;
        ctx.arc(cx, cy, R, run.outAngle, run.outAngle + sweep(run.outAngle, target.inAngle),
                sweep(run.outAngle, target.inAngle) < 0);
        if (!next) break;
        run = next;
      }
      ctx.closePath();
      paint(seed[0].z);
    }
  }


  // Land as shape on the sphere — the same land.js geometry the flat map uses.
  //
  // The two halves are drawn differently ON PURPOSE, because a sphere is not a
  // plane:
  //
  //   fill    — per-cell quads. A closed coastline loop that crosses the limb
  //             cannot be filled correctly (half of it is on the far side and
  //             the ring is no longer closed in screen space). Projected quads
  //             tile edge-to-edge into the same landmass and cull individually,
  //             so the limb is handled by simply not drawing what faces away.
  //   outline — the contour loops, stroked and broken at the limb, exactly like
  //             the graticule. A coastline is a line, so it has no such problem.
  //
  // Same source geometry, same option names, same result to the eye.
  #drawLand(T, style) {
    const o = this.o;
    const ctx = this.ctx;
    // Vector source: real outlines, no grid involved.
    const vector = landRings(o.landSource);
    // A FILLED globe stays on the grid, even when vector data is asked for.
    //
    // Not a preference — a consistency requirement. The vector coastline is
    // 1/32° detailed; the mask the fill comes from is 512×256. Drawing one
    // inside the other leaves white slivers all down the European coast,
    // because they are the same geography at twenty-five times the detail.
    // Until vector fills can be clipped to the hemisphere properly (see
    // #drawVectorLand), a filled globe draws BOTH fill and coast from the
    // grid, where they agree by construction. `land="outline"` with vector is
    // unaffected and is the sharpest the globe gets.
    if (vector && !style.fill) {
      this.#drawVectorLand(T, style, vector, {
        fill: null,
        stroke: style.stroke ? this._c(o.landStroke ?? o.landColor ?? o.dotColor) : null,
        width: o.landStrokeWidth ?? 1
      });
      if (o.borders) {
        this.#drawVectorLand(T, { fill: false, stroke: true }, borderRings(), {
          fill: null,
          stroke: this._c(o.bordersColor ?? o.landStroke ?? o.dotColor),
          width: o.bordersWidth ?? 0.5,
          alphaScale: o.bordersOpacity ?? 0.55
        });
      }
      return;
    }
    // Borders are lines, so they clip cleanly and can ride any fill.
    if (o.borders && vector) {
      this.#drawVectorLand(T, { fill: false, stroke: true }, borderRings(), {
        fill: null,
        stroke: this._c(o.bordersColor ?? o.landStroke ?? o.dotColor),
        width: o.bordersWidth ?? 0.5,
        alphaScale: o.bordersOpacity ?? 0.55
      });
    }
    // Resolution stays at `cols`, deliberately. Sampling the fill finer than
    // the dot grid does buy smoother coastlines, but it multiplies the quads
    // projected every frame — measured as visible stutter on a page carrying
    // several globes, which is a worse defect than a stepped coast. Turn the
    // knob with `cols` if a particular map wants the detail and can pay.
    const cols = o.cols ?? 170;
    const rows = Math.round((cols / 360) * (o.latRange[1] - o.latRange[0]));
    const grid = { cols, rows, latRange: o.latRange };
    // wrapX: on a globe there is no edge at the antimeridian, only more world.
    this._land ??= buildLand(grid, { wrapX: true });

    if (style.fill) {
      // Batched by depth band, NOT one fill() per cell.
      //
      // The land is a few thousand quads; issuing a beginPath/fill for each
      // was measured at ~13 ms per globe, which turns a page carrying several
      // of them into a slideshow. Path construction is nearly free — it is the
      // fill calls that cost — so the quads are accumulated into a handful of
      // paths, one per slice of the depth fade, and each is filled once. Same
      // picture, BANDS draw calls instead of thousands.
      const BANDS = 6;
      const paths = Array.from({ length: BANDS }, () => new Path2D());
      let any = false;
      for (const [ col, row ] of this._land.cells) {
        const a = cellCorner(col, row, grid);
        const pa = this.#project(a.lat, a.lon, T);
        if (!pa.front) continue;
        const b = cellCorner(col + 1, row, grid);
        const c = cellCorner(col + 1, row + 1, grid);
        const d = cellCorner(col, row + 1, grid);
        const pb = this.#project(b.lat, b.lon, T);
        const pc = this.#project(c.lat, c.lon, T);
        const pd = this.#project(d.lat, d.lon, T);
        if (!pb.front || !pc.front || !pd.front) continue;
        const band = Math.min(BANDS - 1, Math.floor(pa.z * BANDS));
        const path = paths[band];
        path.moveTo(pa.sx, pa.sy);
        path.lineTo(pb.sx, pb.sy);
        path.lineTo(pc.sx, pc.sy);
        path.lineTo(pd.sx, pd.sy);
        path.closePath();
        any = true;
      }
      if (any) {
        ctx.fillStyle = this._c(o.landColor ?? o.dotColor);
        for (let i = 0; i < BANDS; i++) {
          ctx.globalAlpha = 0.35 + 0.65 * ((i + 0.5) / BANDS);   // the fade the dots wear
          ctx.fill(paths[i]);
        }
      }
    }

    if (style.stroke) {
      ctx.strokeStyle = this._c(o.landStroke ?? o.landColor ?? o.dotColor);
      ctx.lineWidth = o.landStrokeWidth ?? 1;
      ctx.lineJoin = "round";
      for (const loop of this._land.loops) {
        let drawing = false;
        for (const [ col, row ] of loop) {
          const g = cellCorner(col, row, grid);
          const p = this.#project(g.lat, g.lon, T);
          if (!p.front) {
            if (drawing) { ctx.stroke(); drawing = false; }
            continue;
          }
          if (!drawing) { ctx.beginPath(); ctx.moveTo(p.sx, p.sy); drawing = true; }
          else ctx.lineTo(p.sx, p.sy);
          ctx.globalAlpha = 0.3 + 0.7 * p.z;
        }
        if (drawing) ctx.stroke();
      }
    }
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
    const ctx = this.ctx;
    const color = this._c(o.graticuleColor ?? o.dotColor);
    const equator = this._c(o.equatorColor ?? o.graticuleColor ?? o.dotColor);

    const stroke = (lines, strokeColor, peak) => {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      for (const line of lines) {
        let drawing = false;
        for (const [ lat, lon ] of line) {
          const p = this.#project(lat, lon, T);
          if (!p.front) {                       // crossed to the far side
            if (drawing) { ctx.stroke(); drawing = false; }
            continue;
          }
          if (!drawing) { ctx.beginPath(); ctx.moveTo(p.sx, p.sy); drawing = true; }
          else ctx.lineTo(p.sx, p.sy);
          ctx.globalAlpha = peak * (0.25 + 0.75 * p.z);
        }
        if (drawing) ctx.stroke();
      }
    };

    stroke(this._graticule.meridians, color, o.graticuleOpacity);
    stroke(this._graticule.parallels, color, o.graticuleOpacity);
    stroke([ this._graticule.equator ], equator, o.equatorOpacity);
    ctx.globalAlpha = 1;
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
    if (this.o.overlays === false || !this._overlayEls) return;
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
      ctx.strokeStyle = this._c(o.dotColor);
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

    // Graticule under the dots: it is the grid the world sits on, not an
    // overlay drawn across it.
    this.#drawGraticule(T);

    // Dot footprint ≈ visible cell spacing: cols spans 360° of longitude,
    // so the front hemisphere shows cols/2 dots across 2R.
    const base = Math.max(0.75, (4 * R) / (o.cols ?? 170)) * o.dotSize * 1.6;
    const shape = o.dotShape === "circle" || o.dotShape === "triangle" ? o.dotShape : "square";

    // Water first — smaller, dimmer, same transform — so land reads on top.
    // Water never animates: the ocean is ground, the land is figure.
    if (this.waterPoints) {
      ctx.fillStyle = this._c(o.oceanColor);
      this.#drawPoints(this.waterPoints, { cx, cy, R, sinR, cosR, sinT, cosT, sinRo, cosRo, base: base * 0.62, shape, alphaLo: 0.15, alphaHi: 0.55 });
    }

    // The six animation modes on a sphere: the phase/amp fields decide when
    // and how far each dot lifts RADIALLY off the surface (sparkle scales
    // size instead) — the canvas twin of the flat renderer's translateY.
    const anim = !this._static && o.animation && o.animation !== "none" && this.phases ? {
      mode: o.animation,
      cycle: ((this._time || 0) / o.animationPeriod) % 1,
      w: Math.min(0.9, Math.max(0.02, o.animationWidth *
        ({ ripple: 0.8, sweep: 0.5, sparkle: 0.55 }[o.animation] ?? 1))),
      heightPx: o.animationHeight * (4 * R) / (o.cols ?? 170),
      phases: this.phases
    } : null;

    const landStyle = parseLandStyle(o.land);
    if (landStyle.dots) {
      ctx.fillStyle = this._c(o.dotColor);
      this.#drawPoints(this.points, { cx, cy, R, sinR, cosR, sinT, cosT, sinRo, cosRo, base, shape, alphaLo: 0.25, alphaHi: 0.75, anim,
        flags: this.highlightFlags, baseColor: this._c(o.dotColor), hiColor: this._c(o.highlightColor) });
    } else {
      this.#drawLand(T, landStyle);
    }

    // Hovered dot re-draws bigger in the hover color (cheap overdraw).
    if (this._hover?.kind === "dot") {
      const hp = latLonToXYZ(this._hover.detail.lat, this._hover.detail.lon);
      const x1 = hp.x * cosR + hp.z * sinR;
      const z1 = -hp.x * sinR + hp.z * cosR;
      const y2 = hp.y * cosT - z1 * sinT;
      const z2 = hp.y * sinT + z1 * cosT;
      if (z2 > 0.01) {
        ctx.fillStyle = this._c(o.dotHoverColor) ?? hoverShade(this._c(o.dotColor));
        ctx.globalAlpha = 1;
    const s = base * (0.45 + 0.55 * z2) * o.dotHoverScale;
    const hdx = x1 * R, hdy = -y2 * R;
    this.#drawShape(cx + hdx * cosRo - hdy * sinRo, cy + hdx * sinRo + hdy * cosRo, s, shape);
      }
    }

    // City markers ride the same transform, drawn on top at full strength;
    // the hovered one swells by markerHoverScale.
    ctx.fillStyle = this._c(o.markerColor);
    for (const city of this.cityData) {
      const x1 = city.p.x * cosR + city.p.z * sinR;
      const z1 = -city.p.x * sinR + city.p.z * cosR;
      const y2 = city.p.y * cosT - z1 * sinT;
      const z2 = city.p.y * sinT + z1 * cosT;
      if (z2 <= 0.01) continue;
      const hovered = this._hover?.kind === "city" && this._hover.detail.name === city.name;
      ctx.globalAlpha = 1;
      const ms = base * o.markerScale * 0.6 * (hovered ? o.markerHoverScale : 1);
    const mshape = ["circle", "square", "triangle", "pin"].includes(o.markerShape) ? o.markerShape : "circle";
    const mdx = x1 * R, mdy = -y2 * R;
    this.#drawShape(cx + mdx * cosRo - mdy * sinRo, cy + mdx * sinRo + mdy * cosRo, ms * 2, mshape);
    }
    ctx.globalAlpha = 1;

    // DOM last: the overlay reads the same transform the frame just drew,
    // so labels can never lag the sphere by a frame.
    this.#placeOverlays(T);
  }
}
