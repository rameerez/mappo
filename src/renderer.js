// The renderer: one body in, one interactive <svg> out — or, in globe mode, a
// canvas sphere (globe.js). This class owns the options, the body, the
// projection, the overlay children and the differential update; the flat SVG
// scene is built here and the globe is delegated.
//
// Design decisions worth knowing before changing things:
//
// - The FLAT map is SVG on purpose: dots stay real elements — CSS hover,
//   focusable markers, restylable from outside. Sensible up to ~250 cols;
//   beyond that a canvas renderer (same options object) is the plan.
//
// - THE FLAT MAP HAS A PROJECTION (projections.js). The grid is "sample the
//   body at the inverse projection of every screen cell", so a polar
//   stereographic or Equal Earth map gets a uniform dot field, grid contours
//   and highlights from exactly the code that draws the equirectangular one.
//   Markers, overlays, locate() and vector outlines use the forward mapping.
//   The globe ignores the projection: it is a physical view, not a map.
//
// - POSITIONING: every dot/marker is `<g transform="translate(x,y)"><use/></g>`
//   and ALL animation (hover, pulse, shimmer) transforms the INNER element,
//   whose shapes are centred on the local origin. Never scale an element that
//   carries x/y geometry: the scale multiplies the translate and dots fly
//   diagonally instead of growing in place (transform-box: fill-box is not
//   reliable on <use> cross-browser).
//
// - EVERY INSTANCE IS SELF-CONTAINED. The stylesheet is scoped to the host
//   with a data-mappo attribute, @keyframes names carry the instance id, and
//   so do the SVG ids the <use> elements, the ground pattern and the frame
//   clip reference — `href="#id"` resolves against the whole document, so two
//   maps sharing an id would both draw the FIRST map's dot shape and size.
//   Many worlds on one page is a first-class case, not an edge case.
//
// - DIFFERENTIAL UPDATES — the crash lesson. Rebuilding the world per option
//   change froze and eventually OOM-killed tabs: each rebuild parses
//   thousands of nodes, recalcs style/layout for all of them, re-registers
//   every infinite animation, and discards ~1MB of DOM for GC — and a slider
//   drag asks for that 60×/second. So update() classifies changed keys and
//   does the CHEAPEST sufficient thing:
//     · style keys  (colours, strokes, tilt, cursors, animation…) → rewrite
//       ONE persistent <style> element. No DOM touched.
//     · def keys    (dotShape/dotSize/markerShape/markerScale/groundColor) →
//       replace the <defs>; every <use> updates for free.
//     · marker keys (places, markerPulse) → rebuild only the markers group.
//     · geometry    (cols, latRange, projection, figure, figureSource…) → full
//       rebuild, but leading+trailing debounced to ≥150ms spacing, with an
//       LRU cache of dot-markup strings per resolution.
//     · body        → full rebuild, immediately, with caches dropped.
//   Animation phases (--mappo-pw wave / --mappo-pn noise) are baked into every
//   dot at build time and consumed via calc() in CSS, so animation mode AND
//   duration are pure style patches too. Negative animation-delays start each
//   dot mid-cycle — no synchronized flash on load.
//
// - Events are DELEGATED from the svg root (three listeners total), never
//   per-dot. Payload coordinates come from data attributes on the wrapper.
//
// - The tilt lives on a WRAPPER div around the svg — the svg itself stays
//   untransformed so consumer getBoundingClientRect math keeps working.

import { resolveBody, resolvePlaces, bodyLatRange, trackMap, untrackMap, rerenderLive, warnIfStillPending } from "./body.js";
import { project, cellCenter } from "./projection.js";
import { resolveProjection, hasProjection, projectionDefaultRange, projectPolyline, signedArea } from "./projections.js";
import { normalizeRings, pointInRings } from "./highlight.js";
import { buildFigure, parseFigureStyle, figureOutlines, figureBorders, vectorFeature } from "./figure.js";
import { buildGraticule } from "./graticule.js";
import { noise2 } from "./noise.js";
import { hoverShade } from "./color.js";

export const DEFAULTS = {
  // Shape of the world: "flat" (SVG plane) or "globe" (rotating canvas sphere,
  // the opt-in module mappo/globe). Other renderers register by name.
  mode: "flat",
  // Which world. Earth unless a body pack has been registered and named; see
  // src/body.js. Takes a name or a body object.
  body: null,
  // Grid
  cols: null,                 // auto: 120 flat · 170 globe (hard max 260); set to override
  // Latitude bounds. null means "the body's own framing" (Earth cuts Antarctica
  // and the arctic emptiness; the Moon and Mars show their poles), or a
  // hemisphere on a polar projection. The effective range is always available
  // as options.latRange. On a polar map the far bound is the rim of the disc.
  latMin: null,
  latMax: null,
  // The flat map's projection: "equirectangular" (default), "equal-earth",
  // "stereographic-north", "stereographic-south", a { forward, inverse } object
  // or a d3-geo projection. See src/projections.js. The globe ignores it.
  projection: "equirectangular",
  // The central meridian of the flat map, degrees east: 150 gives a
  // Pacific-centred map. Cylindrical projections move their seam with it;
  // polar ones rotate.
  centerLon: 0,
  // The FIGURE — what the body classifies as drawn (land, maria, lowlands…) —
  // and how it is rendered. A space-separated token list, so combinations
  // read the way you would say them out loud. Identical on both renderers:
  //   "dots"           the dot field mappo is named for (default)
  //   "solid"          filled
  //   "outline"        the edge only
  //   "solid outline"  filled, with the edge drawn on top
  figure: "dots",
  figureColor: "#d3dce6",     // the figure's colour: the dots, or the fill
  figureStroke: null,         // the edge; defaults to figureColor
  figureStrokeWidth: 1,
  // Where the edge comes from: "grid" (traced from the body's figure() on the
  // dot grid — blocky, follows cols, free) or "vector" (the body's own
  // outlines — smooth at any size; a body without them falls back to grid).
  figureSource: "grid",
  // The GROUND — everything that is not figure — as filler dots in their own
  // shade, e.g. "#e8eef5"; "none" leaves it empty. Draws under any figure style.
  groundColor: "none",
  background: "none",         // a uniform fill behind everything (the world's outline on a flat map / the globe disc)
  // Region boundaries (Earth: country borders), where the body has them.
  borders: false,
  bordersColor: null,         // defaults to the figure stroke
  bordersWidth: 0.5,
  bordersOpacity: 0.55,
  // Dots
  dotShape: "circle",         // "circle" | "square" | "triangle" | "tile" (a square lying on the surface) | an SVG path string (24×24 units)
  dotSize: 0.55,              // fraction of a grid cell the dot fills
  dotHoverColor: null,        // auto: a contrast-aware shade of figureColor
  dotHoverScale: 2.6,
  // Places: gazetteer names of the current body ("London" on Earth, "Apollo 11"
  // on the Moon) and/or your own { name, lat, lon, color? } records.
  places: [],
  focus: null,                // { lat, lon } the globe faces (rotate-speed 0 holds it)
  highlightPolygon: null,     // rings of [lat, lon] — figure cells inside draw in highlightColor
  highlightColor: "#8fb0d8",
  markerShape: "circle",
  markerColor: "#2262fe",
  markerScale: 1.5,           // relative to a dot
  markerPulse: false,         // radar ping (expanding fading ring) — opt-in
  markerHoverScale: 1.8,
  // The globe
  rotateSpeed: 4,             // spin, degrees per second (0 = still)
  roll: 0,                    // LEAN, in the plane of the screen (deg)
  globeRing: false,           // opt-in hairline halo around the globe
  // Graticule — the meridian/parallel grid, on both renderers. The equator is
  // drawn separately so it can carry its own weight: it is the line a reader
  // orients against.
  graticule: false,
  meridians: 12,              // evenly spaced longitudes
  parallels: 11,              // evenly spaced latitudes; the equator is extra
  graticuleColor: null,       // defaults to figureColor
  equatorColor: null,         // defaults to graticuleColor
  graticuleOpacity: 0.28,
  // Only a touch above the other lines. The equator earns its own colour and
  // weight option so it CAN be emphasised, but emphasising it by default reads
  // as a bug — one parallel inexplicably darker than its neighbours.
  equatorOpacity: 0.36,
  graticuleWidth: 1,          // line width: CSS px on the globe; a multiplier of the flat map's hairline
  // Position host DOM carrying data-lat/data-lon over the map.
  overlays: true,
  // Cap the canvas backing store. 3× devices buy no visible detail on a dot
  // field and pay full fill-rate for it.
  maxDpr: 2,
  // The globe's camera: its distance from the centre in body radii. Infinity
  // (the default) is the orthographic view; a finite value is a perspective
  // camera that far away — the near side grows, the far side shrinks and the
  // visible cap is smaller than a hemisphere. 2 to 4 reads as a globe seen
  // from close by.
  distance: Infinity,
  // Fog, as [near, far] in body radii from the globe's centre plane, positive
  // away from the viewer. Set, it makes the globe GLASS: the far hemisphere is
  // drawn too, and everything fades from opaque at near to gone at far. null
  // keeps the opaque globe with its built-in facing fade.
  fog: null,
  // The fog's colour. null fades what is in the fog to transparent; a colour
  // MIXES toward it at full alpha instead, the way a WebGL fog does — on a
  // light page over a dark fog the far side darkens rather than pales.
  fogColor: null,
  // How the globe's dots sample the sphere: "grid" — the lat/lon grid the
  // flat map draws, cells bunching toward the poles — or "uniform", a
  // Fibonacci lattice with equal area per dot and round(cols²/π) candidates,
  // so `cols` still means the spacing at the equator.
  distribution: "grid",
  // Plane transform (degrees; the classic hero skew)
  tilt: 0,
  rotate: 0,
  perspective: 1000,
  // Animation over the whole matrix. Three plain-language knobs:
  animation: "none",          // "none" | "wave" | "noise" | "ripple" | "sweep" | "sparkle"
  animationPeriod: 6,         // seconds per full cycle (bigger = slower)
  animationHeight: 0.8,       // crest height, in CELLS (1 = one grid cell)
  animationWidth: 0.13,       // crest window as a fraction of the cycle (smaller = thinner front)
  // Interaction
  cursor: "default",
  markerCursor: "pointer",
  interactive: true,
  // Callbacks (each also fires as a bubbling CustomEvent "mappo:*")
  onDotClick: null,           // ({ lat, lon, col, row, element })
  onDotEnter: null,
  onPlaceClick: null,         // ({ name, lat, lon, kind?, element })
  onPlaceEnter: null
};

// Which update path each option needs. Callback keys appear in none of these
// on purpose: they're read at dispatch time, changing them costs nothing.
// Anything unlisted defaults to the safe full rebuild.
const STYLE_KEYS = new Set([
  "figureColor", "figureStroke", "figureStrokeWidth", "dotHoverColor", "dotHoverScale",
  "bordersColor", "bordersWidth", "bordersOpacity", "highlightColor",
  "graticuleColor", "equatorColor", "graticuleOpacity", "equatorOpacity", "graticuleWidth",
  "markerColor", "markerHoverScale", "tilt", "rotate", "perspective",
  "animation", "animationPeriod", "animationHeight", "animationWidth", "cursor", "markerCursor",
  // Backdrop knobs are pure stylesheet in flat mode: the bg shape and the
  // pattern-filled ground always exist; only their fills change.
  "background", "globeRing",
  // Globe-only camera knobs: the flat map ignores them, so there is nothing to rebuild.
  "distance", "fog", "fogColor"
]);
const DEF_KEYS = new Set([ "dotShape", "dotSize", "markerShape", "markerScale", "groundColor" ]);
const MARKER_KEYS = new Set([ "places", "markerPulse", "interactive" ]);
const CALLBACK_KEYS = new Set([ "onDotClick", "onDotEnter", "onPlaceClick", "onPlaceEnter" ]);

// Renderers other than the flat SVG map are opt-in modules (mappo/globe). A
// mode with no renderer yet draws nothing, warns after a grace period, and is
// drawn the moment its module registers — the doctrine of a body pack that
// arrives after the page's maps did, applied to renderers. A renderer is a
// class constructed as (container, options, body, overlays) with update(changed,
// body), destroy(), locate(lat, lon, radius) and an `element`.
const RENDERERS = new Map();
export function registerRenderer(mode, Renderer) {
  if (typeof mode !== "string" || !mode.trim() || mode === "flat") throw new TypeError('registerRenderer needs a mode name other than "flat"');
  if (typeof Renderer !== "function") throw new TypeError(`registerRenderer("${mode}") needs a renderer class`);
  RENDERERS.set(mode, Renderer);
  rerenderLive((m) => m.options.mode === mode);
  return Renderer;
}
export const knownRenderers = () => [ "flat", ...RENDERERS.keys() ];

const SVG_NS = "http://www.w3.org/2000/svg";
const CELL = 10;        // internal SVG units per grid cell — never exposed

// Every instance scopes its stylesheet and its SVG ids with this.
let instanceSeq = 0;
const MAX_COLS = 260;   // above this, SVG node count degrades interaction
const REBUILD_MS = 150; // min spacing between geometry rebuilds
// Animation noise field frequencies. PHASE picks when a dot moves, AMP how
// far — two octaves at different scales is what makes the surface read as
// organic material instead of a screensaver. 0.22 ≈ patches a few dots
// wide (the 0.09 v1 field produced continent-sized blobs — "too big").
const NOISE_PHASE_SCALE = 0.22;
const NOISE_AMP_SCALE = 0.31;

// Deep instrumentation, two layers:
// - performance.mark/measure spans ship ALWAYS (they cost ~nothing and make
//   any DevTools Performance trace self-documenting: look for "wm:*" blocks
//   in the flame chart).
// - console output is opt-in via `Mappo.debug = true` (the perf harness
//   turns it on) so production consumers get a silent component.
function span(name, fn) {
  const m0 = `${name}:start`;
  performance.mark(m0);
  const out = fn();
  performance.measure(name, m0);
  const entries = performance.getEntriesByName(name);
  const ms = entries[entries.length - 1]?.duration ?? 0;
  performance.clearMarks(m0);
  return [ out, ms ];
}
function dbg(...args) {
  if (Mappo.debug) console.debug("[mappo]", ...args);
}

export class Mappo {
  // Opt-in deep console output ("[mappo] …"). The perf harness sets this.
  static debug = false;
  // @param container [HTMLElement] emptied and rendered into; sizing is the
  //   consumer's (the svg scales to the container via viewBox).
  // @param options   [Object] see DEFAULTS.
  constructor(container, options = {}) {
    this.container = container;
    this.options = { ...DEFAULTS, ...options };
    this._uid = ++instanceSeq;
    // Preserve which latitude bounds the caller actually owns. The effective
    // range lives in options.latRange; null bounds inherit from each body, so
    // a late-arriving Moon can change Earth's +84 default to its own +90 while
    // keeping an explicit lat-min untouched.
    this._latRangeOverride = "latRange" in options
      ? [ options.latRange?.[0] ?? null, options.latRange?.[1] ?? null ]
      : [ options.latMin ?? null, options.latMax ?? null ];
    // Which world. Resolved once here and once per body update, never per cell.
    this._body = resolveBody(this.options.body);
    // Host DOM carrying data-lat/data-lon is harvested ONCE, here, before any
    // renderer touches the container's children, and lent to whichever
    // renderer is active. Keep the original child tree too: overlays may be
    // nested in consumer wrappers, and destroy() must restore that structure
    // and its non-overlay siblings rather than flattening everything.
    this._hostChildren = typeof container.childNodes === "object"
      ? Array.from(container.childNodes)
      : [];
    this._overlays = typeof container.querySelectorAll === "function"
      ? Array.from(container.querySelectorAll("[data-lat][data-lon]"))
      : [];
    this._overlayState = new Map(this._overlays.map((el) => [ el, captureOverlay(el) ]));
    this._dotsCache = new Map();    // projection|cols → { markup, dots }
    this._figureCache = new Map();  // figure paths have a different value shape
    this._renderer = null;          // the non-flat renderer in charge, if any
    this._pending = null;           // what this map is waiting for, if anything
    this.#applyLatRange();
    this.render();
    // Do not retain a half-constructed map if a host DOM or custom body throws
    // during its first render.
    trackMap(this);
  }

  // The resolved body this map is drawing — a registered pack, the object you
  // passed, or a pending placeholder while a named pack has not arrived.
  get body() {
    return this._body;
  }

  // The projection instance the flat map is drawing with (null on the globe):
  // forward(lat, lon), inverse(x, y), aspect, outline() in unit-frame coordinates.
  get projection() {
    return this.grid?.projection ?? null;
  }

  // What this map is waiting for before it can draw — a body pack, a renderer
  // module, a projection module — as a short description, or null. A waiting
  // map draws nothing, on purpose.
  get pending() {
    return this._pending ?? (this._body.pending ? `body "${this._body.id}"` : null);
  }

  // Forget every geometry cache and draw again. What a module arriving late
  // calls through rerenderLive(): the world may have gained rings, a renderer
  // or a projection since this map last looked.
  refresh() {
    this._dotsCache.clear();
    this._figureCache.clear();
    this._cacheBytes = 0;
    this.render();
  }

  // Swap the world under a map that has already drawn. Two things have to
  // happen together: the band the body asked for is re-applied (the Moon
  // wants its poles), and the geometry is rebuilt from scratch with the
  // instance caches dropped, so "rebuild" really does recompute.
  adoptBody(body) {
    if (this.#setBody(body)) this.render();
  }

  // Where a point lands on screen, in CSS pixels from the top-left of the
  // element — the projection the renderer itself uses, handed back so you can
  // draw your own layer over the map and have it register to the pixel.
  //
  //   const p = map.locate(51.5, -0.1);        // London, on the surface
  //   const s = map.locate(lat, lon, 1.086);   // and something in orbit
  //
  // `radius` is distance from the body's centre in body radii, and only means
  // anything on the globe: a flat map has no third dimension to leave.
  // Returns null before the first frame, null for a point the flat map's
  // projection has no place for, and { front: false } for a point the globe
  // is currently hiding. On the flat map `front` is always true, and the
  // answer ignores tilt/rotate/perspective — those are a CSS transform on top
  // of the box this reports in.
  locate(lat, lon, radius = 1) {
    if (this._renderer) return this._renderer.locate(lat, lon, radius);
    // The LAYOUT box, computed rather than measured: the svg fills the
    // element's width and takes its height from the grid's aspect, and
    // getBoundingClientRect would fold the tilt transform into the answer.
    const w = this.container?.clientWidth ?? 0;
    if (!w || !this.grid) return null;
    const p = this.grid.projection.forward(lat, lon);
    if (!p) return null;
    const h = w * this.grid.rows / this.grid.cols;
    return { x: p.x * w, y: p.y * h, depth: 1, front: true };
  }

  // Differential update — see the header. Public contract: call with any
  // subset of options, as often as you like; the component picks the
  // cheapest sufficient refresh and never lets bursts stack up.
  update(options = {}) {
    // Bodies compare by identity (a replacement pack with the same id is a
    // different world); everything else structurally.
    const changed = Object.keys(options).filter((k) =>
      k === "body" || k === "projection"
        ? options[k] !== this.options[k]
        : !sameOption(options[k], this.options[k]));
    let nextOverride = [ ...this._latRangeOverride ];
    if ("latRange" in options) {
      nextOverride = [ options.latRange?.[0] ?? null, options.latRange?.[1] ?? null ];
    } else {
      if ("latMin" in options) nextOverride[0] = options.latMin;
      if ("latMax" in options) nextOverride[1] = options.latMax;
    }
    const oldRange = this.options.latRange;
    // A named pack may have registered since this map's last update. Resolve
    // names again even when the body option itself did not change, so a map
    // whose first late adoption failed (for example, incompatible partial
    // latitude bounds) recovers as soon as the consumer corrects its options.
    const nextBody = changed.includes("body")
      ? resolveBody(options.body)
      : typeof this.options.body === "string" ? resolveBody(this.options.body) : this._body;
    const bodyResolved = nextBody !== this._body;
    // Validate the whole frame before mutating live state: the range, and the
    // projection built on it (a north polar map cannot reach the south pole).
    const nextProjection = "projection" in options ? options.projection : this.options.projection;
    const nextCenter = "centerLon" in options ? options.centerLon : this.options.centerLon;
    const nextMode = "mode" in options ? options.mode : this.options.mode;
    const nextRange = this.#rangeFor(nextBody, nextOverride, nextProjection, nextMode);
    // Projection has no meaning on a globe. In flat mode, resolving up front
    // makes the update atomic and also fingerprints mutable d3 projection
    // state, so a rotate()/clipAngle()/parallels() mutation cannot reuse stale
    // geometry merely because the function identity stayed the same.
    const resolvedNext = nextMode === "flat" && hasProjection(nextProjection)
      ? resolveProjection(nextProjection, { latRange: nextRange, centerLon: nextCenter })
      : null;
    if (resolvedNext && this.grid?.projection && resolvedNext.key !== this.grid.projection.key && !changed.includes("projection")) {
      changed.push("projection");
    }
    this._latRangeOverride = nextOverride;
    Object.assign(this.options, options);
    this.options.latRange = nextRange;
    // Like mode: a different world is different geometry, so it skips the
    // patch tiers entirely rather than hoping `body` appears in one of them.
    if (changed.includes("body") || bodyResolved) {
      dbg("update: body →", this.options.body, "→ full rebuild");
      this.#setBody(nextBody);
      // A body representation can change ("moon" → the same MOON object)
      // alongside another option. Render the whole merged update even when
      // the resolved body identity itself did not change.
      this.render();
      return;
    }
    if (!sameOption(oldRange, this.options.latRange) && !changed.includes("latRange")) {
      changed.push("latRange");
    }
    if (changed.length === 0) return;

    if (changed.every((k) => CALLBACK_KEYS.has(k))) {
      dbg("update: callbacks only", changed, "→ no work");
      return; // read at dispatch time
    }
    // A waiting map has no scene to patch; whatever changed, look again.
    if (this._pending) {
      this.#scheduleRebuild();
      return;
    }

    // Globe mode sidesteps the SVG patch tiers entirely: the canvas redraws
    // every frame anyway, so any change is a cheap buffer/style refresh —
    // except a mode switch, which swaps renderers via the geometry path.
    if (changed.includes("mode")) {
      dbg("update: mode →", this.options.mode, "→ renderer swap");
      this.#scheduleRebuild();
      return;
    }
    if (this.options.mode !== "flat") {
      if (this._renderer) {
        this._renderer.update(changed, this._body);
        // Canvas has no accessible descendants: keep its text alternative in
        // sync with runtime marker/body changes just as the flat SVG does.
        this._renderer.element?.setAttribute("aria-label", this.#ariaLabel());
        dbg("update:", changed, `→ ${this.options.mode} refresh`);
      }
      else this.#scheduleRebuild();
      return;
    }

    const styleOnly = changed.every((k) =>
      STYLE_KEYS.has(k) || DEF_KEYS.has(k) || MARKER_KEYS.has(k) || CALLBACK_KEYS.has(k));

    if (!styleOnly) {
      dbg("update:", changed, "→ GEOMETRY rebuild (debounced)");
      this.#scheduleRebuild();
      return;
    }
    const patches = [];
    if (changed.some((k) => DEF_KEYS.has(k))) {
      const [ , defsMs ] = span("wm:patch-defs", () => this.#patchDefs());
      patches.push(`defs ${defsMs.toFixed(1)}ms`);
    }
    if (changed.some((k) => MARKER_KEYS.has(k))) {
      const [ , markersMs ] = span("wm:patch-markers", () => this.#patchMarkers());
      patches.push(`markers ${markersMs.toFixed(1)}ms`);
    }
    const [ , styleMs ] = span("wm:patch-style", () => this.#patchStyle());
    patches.push(`style ${styleMs.toFixed(1)}ms`);
    dbg("update:", changed, "→", patches.join(" · "));
  }

  // Tear down, and hand the host's overlay children back exactly as they
  // were: a moved or re-connected element must find them again.
  destroy() {
    untrackMap(this);
    clearTimeout(this._rebuildTimer);
    this._renderer?.destroy();
    this._renderer = null;
    this.svg = null;
    this.styleEl = null;
    this._tiltWrap = null;
    this._overlayLayer = null;
    for (const el of this._overlays) releaseOverlay(el, this._overlayState.get(el));
    // Restore descendants from last to first so each original nextSibling is
    // already back when insertBefore needs it. Direct children are placed by
    // the original root-node snapshot below.
    for (let i = this._overlays.length - 1; i >= 0; i--) {
      restoreOverlay(this._overlays[i], this._overlayState.get(this._overlays[i]), this.container);
    }
    this.container.replaceChildren(...this._hostChildren);
    this.container.removeAttribute?.("data-mappo");
  }

  #applyLatRange() {
    this.options.latRange = this.#rangeFor(this._body, this._latRangeOverride, this.options.projection, this.options.mode);
  }

  // The band drawn: explicit bounds win; the rest comes from the body's own
  // framing, or from the projection when it has an opinion (a polar map wants
  // a hemisphere, not Earth's −58…84).
  #rangeFor(body, override, projection, mode = this.options.mode) {
    const inherited = mode !== "flat" ? bodyLatRange(body) : projectionDefaultRange(projection, bodyLatRange(body));
    const range = [ override[0] ?? inherited[0], override[1] ?? inherited[1] ];
    const [ min, max ] = range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < -90 || max > 90 || min >= max) {
      throw new RangeError("latRange must stay within [-90, 90] with min < max");
    }
    return range;
  }

  #setBody(body) {
    const bodyChanged = body !== this._body;
    const oldRange = this.options.latRange;
    const nextRange = this.#rangeFor(body, this._latRangeOverride, this.options.projection, this.options.mode);
    this._body = body;
    this.options.latRange = nextRange;
    if (bodyChanged) {
      // The caches are keyed on geometry only; the body is implied by the
      // instance, so a new body means a clean slate.
      this._dotsCache.clear();
      this._figureCache.clear();
      this._cacheBytes = 0;
    }
    return bodyChanged || !sameOption(oldRange, this.options.latRange);
  }

  // -- the full build (geometry path only) -------------------------------------

  // Leading + trailing debounce: an isolated change renders immediately; a
  // drag renders at most every REBUILD_MS with a guaranteed final render at
  // the resting value. This is the backpressure valve — without it, drag
  // input outruns render capacity and the tab drowns.
  #scheduleRebuild() {
    // ADAPTIVE spacing (perf-harness lesson): a fixed 150ms floor against
    // 70-146ms renders is a ~50% main-thread duty cycle — the storm scenario
    // measured 49% blocked. Spacing self-tunes to ~8× the last measured
    // render cost (capped at 1.2s), so heavy resolutions rebuild ~1×/s
    // during a drag while cheap ones stay at the 150ms floor. Blocked time
    // lands near 12% on any machine, fast or slow.
    const spacing = Math.min(1200, Math.max(REBUILD_MS, (this._lastRenderMs ?? 0) * 8));
    const since = performance.now() - (this._lastRebuild ?? -Infinity);
    const wait = Math.max(0, spacing - since);
    dbg(`rebuild scheduled: ${wait === 0 ? "immediate (leading)" : `in ${wait.toFixed(0)}ms (trailing)`}`);
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      if (this.container.isConnected) this.render();
    }, wait);
  }

  render() {
    this._lastRebuild = performance.now();
    const o = this.options;

    // <mappo-world> is an unknown element to the parser, so it is INLINE
    // unless the page says otherwise — and an inline box has clientWidth 0.
    // One guarantee, made once, before either renderer runs.
    if (typeof getComputedStyle === "function" && this.container?.style &&
        getComputedStyle(this.container).display === "inline") {
      this.container.style.display = "block";
    }

    if (o.mode !== "flat") {
      const Renderer = RENDERERS.get(o.mode);
      if (!Renderer) {
        this.#drawPending(`renderer "${o.mode}"`,
          `mode="${o.mode}": no renderer registered — import "mappo/${o.mode}". Waiting maps draw nothing.`);
        return;
      }
      this._pending = null;
      // Leaving the SVG scene: the renderer replaces the container's children,
      // so the persistent svg/style handles must not survive to be patched
      // while detached. Rebuilt from scratch on return to flat.
      if (this.svg) { this.svg = null; this.styleEl = null; this._tiltWrap = null; this._overlayLayer = null; }
      this.grid = null;
      if (this._renderer) this._renderer.update(null, this._body);
      else this._renderer = new Renderer(this.container, this.options, this._body, this._overlays);
      this._renderer.element?.setAttribute("role", "img");
      this._renderer.element?.setAttribute("aria-label", this.#ariaLabel());
      return;
    }
    if (this._renderer) { this._renderer.destroy(); this._renderer = null; }
    if (!hasProjection(o.projection)) {
      const named = typeof o.projection === "string" ? `projection "${o.projection}"` : "a custom projection";
      this.#drawPending(named, typeof o.projection === "string"
        ? `projection "${o.projection}" is not registered — import "mappo/projections". Waiting maps draw nothing.`
        : 'custom and d3-geo projections need "mappo/projections". Waiting maps draw nothing.');
      return;
    }
    this._pending = null;

    const projection = resolveProjection(o.projection, { latRange: o.latRange, centerLon: o.centerLon });
    const colsWanted = o.cols ?? 120; // auto default for the flat map
    if (!Number.isFinite(colsWanted) || colsWanted <= 0) throw new RangeError("cols must be a positive finite number");
    const cols = Math.min(Math.max(1, Math.round(colsWanted)), MAX_COLS);
    if (colsWanted > MAX_COLS) console.warn(`[mappo] cols capped at ${MAX_COLS} (asked for ${colsWanted}) — beyond that SVG interaction degrades (mode="globe" already renders on canvas; a flat canvas renderer is on the roadmap)`);
    // Cells are square on screen; the frame's aspect sets the row count. For
    // equirectangular that is round(cols · Δφ / 360), as it always was.
    const rows = Math.max(1, Math.round(cols / projection.aspect));
    this.grid = { cols, rows, latRange: o.latRange, projection };

    // PERSISTENT scene (heap-growth lesson): svg, tilt wrapper, style element
    // and listeners are created ONCE and reused — a rebuild swaps viewBox +
    // innerHTML in place. v2 recreated all three per rebuild and re-bound
    // listeners each time; across a slider storm that churned tens of MB of
    // discarded containers on top of the node garbage.
    const renderT0 = performance.now();
    if (!this.svg) {
      this.svg = document.createElementNS(SVG_NS, "svg");
      this.svg.setAttribute("class", "mappo-svg");
      this.svg.setAttribute("role", "img");
      this._tiltWrap = document.createElement("div");
      this._tiltWrap.className = "mappo-tilt";
      this._tiltWrap.appendChild(this.svg);
      this.styleEl = document.createElement("style");
      // Same contract as the globe: host DOM carrying data-lat/data-lon is
      // adopted and positioned. On a flat map the position is static, so it
      // is written once per build rather than per frame — but the markup,
      // the attributes and the CSS hooks are identical, which is the point
      // of having one overlay API rather than two.
      this._overlayLayer = null;
      if (this._overlays.length) {
        this._overlayLayer = document.createElement("div");
        this._overlayLayer.className = "mappo-overlay";
        Object.assign(this._overlayLayer.style, { position: "absolute", inset: "0", pointerEvents: "none" });
        for (const el of this._overlays) {
          Object.assign(el.style, { position: "absolute", left: "0", top: "0", transform: "", willChange: "" });
          this._overlayLayer.appendChild(el);
        }
      }
      this.container.replaceChildren(this.styleEl, this._tiltWrap);
      if (this._overlayLayer) {
        if (getComputedStyle(this.container).position === "static") this.container.style.position = "relative";
        this.container.appendChild(this._overlayLayer);
      }
      this.#bindEvents(this.svg); // once — handlers guard on options.interactive
    }
    const svg = this.svg;
    svg.setAttribute("viewBox", `0 0 ${cols * CELL} ${rows * CELL}`);
    svg.setAttribute("aria-label", this.#ariaLabel());
    // One parse for the whole scene — the fast path for full builds.
    const [ markup, buildMs ] = span("wm:build-markup", () =>
      this.#defsMarkup(o, this.grid) + this.#backdropMarkup(this.grid) + this.#graticuleMarkup(this.grid, o) +
      (parseFigureStyle(o.figure).dots ? this.#dotsMarkup(this.grid) : this.#figureMarkup(this.grid, o)) +
      this.#markersMarkup(this.grid, o));
    const [ , parseMs ] = span("wm:parse-innerHTML", () => { svg.innerHTML = markup; });
    this.#applyStyle(this.#css(o));
    // Calibration (perf-harness lesson #2): the JS-side cost is only ~25%
    // of a rebuild — the style recalc, layout and paint land AFTER this
    // function returns. Double-rAF closes the window after the browser has
    // actually produced the frame, so the adaptive spacing sees the TRUE
    // per-rebuild cost (~4× larger) and spaces drags honestly. The sync
    // value below is the headless/SSR fallback.
    this._lastRenderMs = performance.now() - renderT0;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this._lastRenderMs = performance.now() - renderT0;
        dbg(`render calibrated: full frame cost ${this._lastRenderMs.toFixed(0)}ms → next spacing ${Math.min(1200, Math.max(REBUILD_MS, this._lastRenderMs * 8)).toFixed(0)}ms`);
      }));
    }
    dbg(`render: cols=${cols} rows=${rows} · ${projection.id} · build ${buildMs.toFixed(1)}ms · parse ${parseMs.toFixed(1)}ms · total ${this._lastRenderMs.toFixed(1)}ms · ${svg.querySelectorAll("*").length} nodes`);
    if (this._overlayLayer) this._overlayLayer.hidden = o.overlays === false;
    this.#placeOverlays();
  }

  // Draw nothing, on purpose, until what the map waits for registers; warn once
  // after a grace period if it never does. Whatever renderer was in charge is
  // torn down, so a later render starts clean. The host's overlay children are
  // re-adopted on that first real render, as after any renderer switch.
  #drawPending(what, hint) {
    this._pending = what;
    this._renderer?.destroy();
    this._renderer = null;
    this.svg = null; this.styleEl = null; this._tiltWrap = null; this._overlayLayer = null;
    this.grid = null;
    this.container.replaceChildren();
    this.container.setAttribute?.("data-mappo-pending", what);
    warnIfStillPending(what, () => this._pending === what, hint);
  }

  // Position adopted overlay children against the flat projection.
  //
  // Percentages, not pixels: the SVG scales with its container, so a percent
  // stays correct through every resize without mappo having to watch for one.
  // Depth is published as 1 — a flat map has no limb — so a stylesheet
  // written against --mappo-depth for the globe works here unchanged. A point
  // the projection has no place for is parked off-screen and marked
  // data-mappo-behind, exactly as the globe treats its far side.
  #placeOverlays() {
    if (this.options.overlays === false) return;
    const projection = this.grid.projection;
    for (const el of this._overlays) {
      const lat = Number(el.dataset.lat);
      const lon = Number(el.dataset.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = projection.forward(lat, lon);
      if (p) {
        el.style.left = `${(p.x * 100).toFixed(3)}%`;
        el.style.top = `${(p.y * 100).toFixed(3)}%`;
        el.style.setProperty("--mappo-depth", "1");
        el.removeAttribute("data-mappo-behind");
      } else {
        el.style.left = "-9999px";
        el.style.top = "-9999px";
        el.style.setProperty("--mappo-depth", "0");
        el.setAttribute("data-mappo-behind", "");
      }
    }
  }

  // -- cheap patches -----------------------------------------------------------

  #patchStyle() {
    this.#applyStyle(this.#css(this.options));
  }

  #patchDefs() {
    // Wholesale swap via the one true builder — a hand-maintained subset
    // here is how the ground pattern got silently wiped by dot-shape patches.
    const defs = this.svg?.querySelector("defs");
    if (defs) defs.outerHTML = this.#defsMarkup(this.options, this.grid);
  }

  #patchMarkers() {
    const group = this.svg?.querySelector(".mappo-markers");
    if (!group) return;
    group.remove();
    this.svg.insertAdjacentHTML("beforeend", this.#markersMarkup(this.grid, this.options));
    this.svg.setAttribute("aria-label", this.#ariaLabel());
  }

  // -- markup builders ---------------------------------------------------------

  // SVG ids are document-global, so every one of ours carries the instance id.
  #id(name) {
    return `${name}-i${this._uid}`;
  }

  #defsMarkup(o, grid) {
    // The ground is ONE pattern-filled rect, not thousands of nodes: the
    // pattern tiles the dot shape (at 0.62×) across every grid cell, and the
    // stylesheet shows or hides it — so groundColor stays a defs-tier knob
    // even at max resolution. The frame clip is the world's outline: the
    // whole rectangle for equirectangular, a disc for a polar map, so nothing
    // paints in the corners where there is no world.
    return `<defs>${
      this.#shapeMarkup(this.#id("mappo-dot-shape"), o.dotShape, o.dotSize)}${
      this.#shapeMarkup(this.#id("mappo-marker-shape"), o.markerShape, o.dotSize * o.markerScale)
    }<pattern id="${this.#id("mappo-ground-pat")}" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse">${this.#groundDotMarkup(o)}</pattern>` +
    `<clipPath id="${this.#id("mappo-frame")}"><path clip-rule="evenodd" d="${this.#outlinePath(grid)}"/></clipPath></defs>`;
  }

  // A DIRECT shape with an inline fill — not <use>: CSS can't reliably reach
  // into a pattern's use-shadow tree across browsers (the original
  // implementation rendered nothing in some engines). The cost: groundColor
  // is a defs-tier knob instead of style-tier. Still no geometry rebuild.
  #groundDotMarkup(o) {
    if (!o.groundColor || o.groundColor === "none") return "";
    const r = (CELL * o.dotSize * 0.62) / 2;
    const c = CELL / 2;
    const fill = `fill="${escapeAttr(o.groundColor)}"`;
    switch (o.dotShape) {
      case "square":
      case "tile":
        return `<rect x="${c - r}" y="${c - r}" width="${r * 2}" height="${r * 2}" rx="${(r * 0.25).toFixed(2)}" ${fill}/>`;
      case "triangle":
        return `<path d="M${c} ${c - r} L${c + r} ${c + r} L${c - r} ${c + r} Z" ${fill}/>`;
      default: // circle + custom-path fallback
        return `<circle cx="${c}" cy="${c}" r="${r}" ${fill}/>`;
    }
  }

  // The world's edge in this map's units, as path data; `fill-rule`/`clip-rule`
  // evenodd so an annulus keeps its hole.
  #outlinePath(grid) {
    return grid.projection.outline().map((ring) => this.#pathFrom(ring, grid, true)).join("");
  }

  // Backdrop layers, always present so background/groundColor patch as pure
  // style. Both sit under the dots and ignore the pointer. The background is
  // the world's outline (a rectangle, a disc), the way the globe's is a disc.
  #backdropMarkup(grid) {
    const w = grid.cols * CELL, h = grid.rows * CELL;
    return `<path class="mappo-bg" fill-rule="evenodd" d="${this.#outlinePath(grid)}"/>` +
           `<rect class="mappo-ground" x="0" y="0" width="${w}" height="${h}" fill="url(#${this.#id("mappo-ground-pat")})" clip-path="url(#${this.#id("mappo-frame")})"/>`;
  }

  // One reusable shape per role, centred on the local origin so inner-
  // element transforms scale in place.
  #shapeMarkup(id, shape, size) {
    const r = (CELL * size) / 2;
    switch (shape) {
      case "square":
      case "tile": {   // a tile lies flat on a flat map: a square
        return `<rect id="${id}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${(r * 0.25).toFixed(2)}"/>`;
      }
      case "triangle":
        return `<path id="${id}" d="M0 ${-r} L${r} ${r} L${-r} ${r} Z"/>`;
      case "circle":
        return `<circle id="${id}" r="${r}"/>`;
      case "pin": {
        // Map-pin silhouette anchored at the TIP (origin = the place),
        // head floating above, punched hole — the canvas globe's twin.
        const pr = r * 1.24;
        const hy = (-pr * 1.9).toFixed(2);
        return `<path id="${id}" fill-rule="evenodd" d="M0 0 Q${(pr * 0.55).toFixed(2)} ${(Number(hy) + pr * 1.1).toFixed(2)} ${(pr * 0.966).toFixed(2)} ${(Number(hy) + pr * 0.259).toFixed(2)} A${pr.toFixed(2)} ${pr.toFixed(2)} 0 1 0 ${(-pr * 0.966).toFixed(2)} ${(Number(hy) + pr * 0.259).toFixed(2)} Q${(-pr * 0.55).toFixed(2)} ${(Number(hy) + pr * 1.1).toFixed(2)} 0 0 Z M0 ${hy} m${(-pr * 0.42).toFixed(2)} 0 a${(pr * 0.42).toFixed(2)} ${(pr * 0.42).toFixed(2)} 0 1 0 ${(pr * 0.84).toFixed(2)} 0 a${(pr * 0.42).toFixed(2)} ${(pr * 0.42).toFixed(2)} 0 1 0 ${(-pr * 0.84).toFixed(2)} 0"/>`;
      }
      default:
        // Custom SVG path, 24×24 box centred on origin (icon convention).
        return `<path id="${id}" d="${escapeAttr(shape)}" transform="scale(${((r * 2) / 24).toFixed(4)})"/>`;
    }
  }

  // Unit-frame points → SVG path data in this map's units.
  #pathFrom(points, grid, close) {
    const w = grid.cols * CELL, h = grid.rows * CELL;
    let d = "";
    for (let i = 0; i < points.length; i++) {
      d += `${i ? "L" : "M"}${(points[i][0] * w).toFixed(1)} ${(points[i][1] * h).toFixed(1)}`;
    }
    return d ? `${d}${close ? "Z" : ""}` : "";
  }

  // The figure as shape. `solid`, `outline` and `solid outline` are three
  // renderings of ONE geometry: for the grid source, the closed contours from
  // figure.js; for the vector source, the body's rings stitched into whole
  // rings and then cut at THIS projection's seam. The fill takes the closed
  // pieces; the edge takes the same vertices as open arcs, so a seam is never
  // stroked — not the frame edge of a cylindrical map, and not the ±180°
  // meridian of a polar one. Colours live in the stylesheet, so they patch
  // without touching this markup.
  #figureMarkup(grid, o) {
    const vector = figureOutlines(o.figureSource, this._body);
    // Rings asked for and not available: grid contours are drawn meanwhile, and
    // one warning names the module that would supply them.
    if (o.figureSource === "vector" && !vector) this.#hintVector("figure-source=\"vector\"");
    // `borders` belongs in the key: the cached markup CONTAINS the borders
    // path, so leaving it out means turning borders off replays a cached scene
    // that still has them. The body is NOT in the key: the caches are dropped
    // whenever the body changes, so a key can only ever hit its own world.
    const key = `${grid.projection.key}|${o.figureSource}|${o.borders ? "b" : ""}|${grid.cols}`;
    let geom = this._figureCache.get(key);
    if (!geom) {
      const { cells, loops } = buildFigure(grid, { body: this._body });
      const borders = o.borders ? figureBorders(this._body) : null;
      if (o.borders && !borders) this.#hintVector("borders");
      geom = { cells, fill: "", complements: [], edge: "", borders: "" };
      if (vector) {
        const projected = vectorFeature().projectRings(vectorFeature().stitchRings(vector), grid.projection);
        if (projected.complete !== false) {
          geom.fill = projected.fill.filter((p) => !p.complement).map((p) => this.#pathFrom(p.points, grid, true)).join("");
          // A ring whose interior holds the far pole of an azimuthal map is the
          // OUTSIDE of its projected curve: fill it as the frame minus the ring,
          // in its own path so the winding cannot interact with the others.
          geom.complements = projected.fill.filter((p) => p.complement).map((p) => {
            const frame = signedArea(p.points) > 0
              ? [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, 0 ] ]
              : [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ];
            return this.#pathFrom(frame, grid, true) + this.#pathFrom(p.points, grid, true);
          });
          geom.edge = projected.edge.map((arc) => this.#pathFrom(arc, grid, false)).join("");
        }
      }
      if (!vector || (!geom.fill && !geom.complements.length && !geom.edge)) {
        // Grid contours are traced in screen space, so they have no seam.
        const d = loops.map((loop) => `M${loop.map(([ x, y ]) => `${x * CELL} ${y * CELL}`).join("L")}Z`).join("");
        geom.fill = d;
        geom.edge = d;
      }
      if (borders?.length) {
        const projected = vectorFeature().projectRings(vectorFeature().stitchRings(borders), grid.projection);
        if (projected.complete !== false) geom.borders = projected.edge.map((arc) => this.#pathFrom(arc, grid, false)).join("");
      }
      this._figureCache.set(key, geom);
      if (this._figureCache.size > 8) this._figureCache.delete(this._figureCache.keys().next().value);
    }
    this._dotCount = geom.cells.length;
    const clip = `clip-path="url(#${this.#id("mappo-frame")})"`;
    return `<g class="mappo-figure" ${clip}>` +
      `<path class="mappo-figure-fill" d="${geom.fill}"/>` +
      geom.complements.map((d) => `<path class="mappo-figure-fill mappo-figure-complement" d="${d}"/>`).join("") +
      `<path class="mappo-figure-edge" d="${geom.edge}"/>` +
      (geom.borders ? `<path class="mappo-borders" d="${geom.borders}"/>` : "") +
      this.#figureHighlightMarkup(grid, o) + `</g>`;
  }

  // The module that would supply the rings a map asked for: the vector feature
  // itself, or Earth's own rings. A body that simply has no rings gets no
  // warning; that is what the grid fallback is for.
  #hintVector(what) {
    const module = !vectorFeature() ? "mappo/vector" : this._body.id === "earth" ? "mappo/bodies/earth-vector" : null;
    if (!module) return;
    warnIfStillPending(`vector:${module}:${this._body.id}`,
      () => !vectorFeature() || (this._body.id === "earth" && !this._body.outlines?.()),
      `${what} on ${this._body.name}: rings are not loaded — import "${module}" (grid contours are drawn meanwhile)`);
  }

  // The graticule on the flat map: the same lat/lon lines the globe draws,
  // projected and broken wherever they leave the map or cross the seam.
  #graticuleMarkup(grid, o) {
    if (!o.graticule) return "";
    const g = buildGraticule({ meridians: o.meridians, parallels: o.parallels });
    const draw = (lines) => lines.flatMap((line) => projectPolyline(line, grid.projection))
      .map((pts) => this.#pathFrom(pts, grid, false)).join("");
    return `<g class="mappo-graticule-group" clip-path="url(#${this.#id("mappo-frame")})">` +
      `<path class="mappo-graticule" d="${draw(g.meridians) + draw(g.parallels)}"/>` +
      `<path class="mappo-equator" d="${draw([ g.equator ])}"/></g>`;
  }

  // The highlight polygon in FLAT mode — the same ray-cast highlight.js does
  // for the globe. A highlight is a FILL, so it paints the figure cells inside
  // the region rather than tracing them: it reads as a lit area, and it reuses
  // the very cell list the contours were traced from.
  #figureHighlightMarkup(grid, o) {
    if (!o.highlightPolygon?.length) return "";
    const normalized = normalizeRings(o.highlightPolygon);
    const { cells } = buildFigure(grid, { body: this._body });
    const parts = [];
    for (const [ col, row ] of cells) {
      const c = cellCenter(col, row, grid);
      if (!c || !pointInRings(c.lat, c.lon, normalized)) continue;
      parts.push(`M${col * CELL} ${row * CELL}h${CELL}v${CELL}h-${CELL}Z`);
    }
    if (!parts.length) return "";
    return `<path class="mappo-figure-highlight" d="${parts.join("")}"/>`;
  }

  // Dot geometry depends ONLY on (projection, cols) for a given body — colours,
  // shapes and animation all live elsewhere — so the markup string caches
  // perfectly per resolution. Both animation phases ship on every dot (~30
  // bytes each): that's what makes animation a style-only knob.
  #dotsMarkup(grid) {
    const key = `${grid.projection.key}|${grid.cols}`;
    const cached = this._dotsCache.get(key);
    if (cached) { dbg(`dots cache HIT ${key}`); this._dotCount = cached.dots; return cached.markup; }
    dbg(`dots cache MISS ${key} — computing`);

    let dots = 0;
    const shape = this.#id("mappo-dot-shape");
    const parts = [ `<g class="mappo-dots" clip-path="url(#${this.#id("mappo-frame")})">` ];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const c = cellCenter(col, row, grid);
        if (!c || !this._body.figure(c.lat, c.lon)) continue;   // off the world, or ground
        dots++;

        // Every animation mode is a PHASE FIELD baked per dot; the stylesheet
        // picks which field feeds the animation delay. All pure functions of
        // (col,row) — that's what keeps this markup resolution-cacheable.
        const pw = ((col + row) / (grid.cols + grid.rows)).toFixed(3);          // diagonal front
        const pn = (((noise2(col * NOISE_PHASE_SCALE, row * NOISE_PHASE_SCALE) + 1) / 2)).toFixed(3); // organic patches
        const pr = (Math.hypot(col - grid.cols / 2, row - grid.rows / 2) /
          Math.hypot(grid.cols / 2, grid.rows / 2)).toFixed(3);                 // radial rings
        const ps = (col / grid.cols).toFixed(3);                                // west→east scanline
        const pk = (((noise2(col * 3.7 + 9, row * 3.7 + 9) + 1) / 2)).toFixed(3); // uncorrelated twinkle
        // Amplitude octave: 0.55–1.0 so every dot moves, none identically.
        const a = (0.55 + 0.45 * ((noise2(col * NOISE_AMP_SCALE + 47, row * NOISE_AMP_SCALE + 47) + 1) / 2)).toFixed(2);
        // Density classes for the animation LOAD GATE: at high resolutions the
        // stylesheet animates only .mappo-h (~1/2) or .mappo-t (~1/3) of dots —
        // SVG transforms are main-thread, and 8k continuous animators melt
        // frames; a baked checkerboard subset reads identically at density.
        const density = `${(col + row) % 2 === 0 ? " mappo-h" : ""}${(2 * col + 3 * row) % 3 === 0 ? " mappo-t" : ""}`;
        parts.push(
          `<g class="mappo-pos" transform="translate(${col * CELL + CELL / 2} ${row * CELL + CELL / 2})" data-col="${col}" data-row="${row}">` +
          `<use class="mappo-dot${density}" href="#${shape}" style="--mappo-pw:${pw};--mappo-pn:${pn};--mappo-pr:${pr};--mappo-ps:${ps};--mappo-pk:${pk};--mappo-a:${a}"/></g>`
        );
      }
    }
    parts.push("</g>");
    const markup = parts.join("");
    this._dotCount = dots;

    this._dotsCache.set(key, { markup, dots });
    // Cap by BYTES, not entries: a resolution sweep can visit dozens of
    // grids and high-res strings run ~1MB each — an entry-count cap
    // measured as tens of MB of retained heap in the perf harness.
    this._cacheBytes = (this._cacheBytes ?? 0) + markup.length;
    while (this._cacheBytes > 4_000_000 && this._dotsCache.size > 1) {
      const oldest = this._dotsCache.keys().next().value;
      this._cacheBytes -= this._dotsCache.get(oldest).markup.length;
      this._dotsCache.delete(oldest);
    }
    return markup;
  }

  #markersMarkup(grid, o) {
    const shape = this.#id("mappo-marker-shape");
    const parts = [ `<g class="mappo-markers">` ];
    for (const place of resolvePlaces(o.places, this._body)) {
      const cell = snapToFigure(place.lat, place.lon, grid, this._body);
      if (!cell) continue;   // no place for it on this projection (the far hemisphere of a polar map)
      const { col, row } = cell;
      const fill = place.color ? ` style="fill:${escapeAttr(place.color)}"` : "";
      const kind = place.kind ? ` data-kind="${escapeAttr(place.kind)}"` : "";
      const label = place.name || `${place.lat}, ${place.lon}`;
      const focus = o.interactive ? ` tabindex="0" role="button" aria-label="${escapeAttr(label)}"` : "";
      // The ping ring renders BEHIND the core and animates independently —
      // the core barely breathes, the ring expands and fades. Scaling one
      // element for "pulse" read as throbbing, not pinging.
      parts.push(
        `<g class="mappo-pos" transform="translate(${col * CELL + CELL / 2} ${row * CELL + CELL / 2})" data-place="${escapeAttr(place.name)}" data-lat="${place.lat}" data-lon="${place.lon}"${kind}${focus}>` +
        (o.markerPulse ? `<use class="mappo-marker-ring" href="#${shape}"${fill}/>` : "") +
        `<use class="mappo-marker" href="#${shape}"${fill}/></g>`
      );
    }
    parts.push("</g>");
    return parts.join("");
  }

  // Write the instance stylesheet, SCOPED TO THIS MAP.
  //
  // The rules are generated per instance but their selectors are generic
  // (.mappo-dot, .mappo-marker …) and a <style> in the document applies to the
  // whole document — so on a page with two maps the LAST one to render would
  // silently repaint every other one. Two things leak and both are handled:
  // selectors get an attribute scope, and @keyframes NAMES get the same
  // suffix, since two maps animating at different periods would otherwise
  // define the same animation twice.
  //
  // Selectors are rewritten through the CSSOM rather than by regex on the
  // text: the browser has already parsed the structure, so keyframe stops
  // (`0%, 100%`) and at-rule preludes cannot be mistaken for selectors.
  // :where() keeps the whole built-in selector at zero specificity. These
  // rules are defaults; a consumer's ordinary `.mappo-dot` rule must win even
  // when it was loaded earlier in <head>.
  #applyStyle(css) {
    const uid = this._uid;
    // Node-safe, like the rest of this class's seams: the update-tier tests
    // drive the renderer with a stub container.
    this.container.setAttribute?.("data-mappo", uid);
    this.styleEl.textContent = css
      .replace(/@keyframes\s+(mappo-[\w-]+)/g, (_m, name) => `@keyframes ${name}-i${uid}`)
      .replace(/animation:\s*(mappo-[\w-]+)/g, (_m, name) => `animation: ${name}-i${uid}`);

    const sheet = this.styleEl.sheet;
    if (!sheet) return;                      // not yet in the document; next render scopes it
    const scope = `[data-mappo="${uid}"]`;
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText) {
          rule.selectorText = rule.selectorText.split(",")
            .map((sel) => `:where(${scope} ${sel.trim()})`).join(", ");
        } else if (rule.cssRules && !rule.name) {   // @media etc; @keyframes has .name
          walk(rule.cssRules);
        }
      }
    };
    try { walk(sheet.cssRules); } catch { /* cross-origin or unparsed: leave global */ }
  }

  // The component stylesheet — defaults, not law; outside CSS wins.
  #css(o) {
    const style = parseFigureStyle(o.figure);
    const stroke = o.figureStroke ?? o.figureColor;
    const graticule = o.graticuleColor ?? o.figureColor;
    return `
      .mappo-bg { fill: ${o.background}; pointer-events: none; }
      .mappo-ground { display: ${o.groundColor === "none" ? "none" : "inline"}; pointer-events: none; }
      .mappo-tilt { perspective: ${o.perspective}px; }
      .mappo-tilt .mappo-svg {
        width: 100%; height: auto; display: block;
        transform: rotateX(${o.tilt}deg) rotateZ(${o.rotate}deg);
        transform-style: preserve-3d;
      }
      .mappo-dot {
        fill: ${o.figureColor};
        cursor: ${o.cursor};
        /* The hover wake: growing is INSTANT (transition:none below), the
           shrink-back runs slow and delayed — sweeping the cursor leaves a
           trail of settling dots. */
        transition: transform .3s ease .2s, fill .3s ease .2s;
      }
      ${o.interactive && style.dots ? `
      .mappo-pos:hover > .mappo-dot {
        fill: ${o.dotHoverColor ?? hoverShade(o.figureColor)};
        transform: scale(${o.dotHoverScale});
        transition: none;
        animation: none; /* a running animation transform would win otherwise */
      }` : ""}
      .mappo-figure-fill { fill: ${style.fill ? o.figureColor : "none"}; stroke: none; fill-rule: nonzero; }
      .mappo-figure-edge {
        fill: none; stroke: ${style.stroke ? stroke : "none"};
        stroke-width: ${o.figureStrokeWidth}; stroke-linejoin: round; stroke-linecap: round;
      }
      .mappo-borders {
        fill: none; stroke: ${o.bordersColor ?? stroke};
        stroke-width: ${o.bordersWidth}; stroke-linejoin: round; stroke-linecap: round; opacity: ${o.bordersOpacity};
      }
      .mappo-figure-highlight { fill: ${o.highlightColor}; }
      .mappo-graticule { fill: none; stroke: ${graticule}; stroke-width: ${0.6 * o.graticuleWidth}; opacity: ${o.graticuleOpacity}; pointer-events: none; }
      .mappo-equator { fill: none; stroke: ${o.equatorColor ?? graticule}; stroke-width: ${0.6 * o.graticuleWidth}; opacity: ${o.equatorOpacity}; pointer-events: none; }
      .mappo-marker {
        fill: ${o.markerColor};
        cursor: ${o.markerCursor};
        ${o.markerPulse ? "animation: mappo-breathe 2.8s ease-in-out infinite;" : ""}
        transition: transform .2s ease;
      }
      .mappo-marker-ring {
        fill: ${o.markerColor};
        pointer-events: none;
        animation: mappo-ping 2.8s cubic-bezier(0, 0, 0.2, 1) infinite;
      }
      ${o.interactive ? `
      .mappo-pos:hover > .mappo-marker, .mappo-pos:focus-visible > .mappo-marker {
        animation: none;
        transform: scale(${o.markerHoverScale});
      }
      .mappo-pos:hover > .mappo-marker-ring, .mappo-pos:focus-visible > .mappo-marker-ring {
        animation: none;
        opacity: 0;
      }
      .mappo-markers .mappo-pos { outline: none; }` : ""}
      @keyframes mappo-ping {
        0%   { transform: scale(1);    opacity: .55; }
        70%  { transform: scale(2.75); opacity: 0; }
        100% { transform: scale(2.75); opacity: 0; }
      }
      @keyframes mappo-breathe {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.12); }
      }
      ${o.animation !== "none" ? (() => {
        // THE LOAD GATE: SVG transforms animate on the main thread, so the
        // number of continuous animators is the frame budget. Above ~4.5k
        // dots animate the baked half-density subset, above ~7k the third —
        // at those densities a subset moving reads identically, at half or
        // a third of the per-frame style cost. Decided per render from the
        // real dot count; logged so nobody wonders why some dots sit still.
        const dots = this._dotCount ?? 0;
        const sel = dots > 7000 ? ".mappo-t" : dots > 4500 ? ".mappo-h" : ".mappo-dot";
        if (sel !== ".mappo-dot") dbg(`animation load gate: ${dots} dots → animating ${sel} subset`);
        // Above the top gate, even the third-subset can drop frames on
        // mid-range hardware — SVG animation cost scales with animator
        // count and there is no compositor escape hatch. Say so out loud,
        // once: animation is DISRECOMMENDED at extreme resolutions.
        if (dots > 7000 && !this._animationWarned) {
          this._animationWarned = true;
          console.warn(`[mappo] animation="${o.animation}" with ${dots} dots: expect dropped frames on mid-range hardware. For animated maps keep cols <= 180 (~4.5k dots); reserve high resolutions for static maps. (Canvas renderer for extreme grids is on the roadmap.)`);
        }
        const dur = o.animationPeriod;
        const amp = o.animationHeight * CELL; // cells → SVG units
        // Window math: each mode's front is a multiple of animationWidth.
        // rise ≈ 38% into the window (fast up), settle at its end (slow down).
        const win = (mult) => {
          const w = Math.min(0.9, Math.max(0.02, o.animationWidth * mult));
          return { rise: (w * 38).toFixed(1), settle: (w * 100).toFixed(1) };
        };
        const wWave = win(1), wRipple = win(0.8), wSweep = win(0.5), wSparkle = win(0.55);
        const modes = {
          // A thin rolling crest along the diagonal — event, not texture.
          wave: `
      .mappo-dots ${sel} {
        animation: mappo-swell ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-pw) * ${dur}s * -1);
      }
      @keyframes mappo-swell {
        0%   { transform: translateY(0) scale(1); }
        ${wWave.rise}%  { transform: translateY(calc(var(--mappo-a, 1) * -${amp}px)) scale(1.22); }
        ${wWave.settle}% { transform: translateY(0) scale(1); }
        100% { transform: translateY(0) scale(1); }
      }`,
          // Organic two-octave breathing — texture, not event.
          noise: `
      .mappo-dots ${sel} {
        animation: mappo-drift ${dur}s ease-in-out infinite;
        animation-delay: calc(var(--mappo-pn) * ${dur}s * -1);
      }
      @keyframes mappo-drift {
        0%, 100% { transform: translateY(0) scale(1); }
        50%      { transform: translateY(calc(var(--mappo-a, 1) * -${(amp * 0.75).toFixed(1)}px)) scale(1.1); }
      }`,
          // Concentric rings expanding from the map's centre.
          ripple: `
      .mappo-dots ${sel} {
        animation: mappo-ripple ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-pr) * ${dur}s * -1);
      }
      @keyframes mappo-ripple {
        0%   { transform: translateY(0) scale(1); }
        ${wRipple.rise}%  { transform: translateY(calc(var(--mappo-a, 1) * -${(amp * 0.8).toFixed(1)}px)) scale(1.18); }
        ${wRipple.settle}% { transform: translateY(0) scale(1); }
        100% { transform: translateY(0) scale(1); }
      }`,
          // A sonar scanline crossing west→east — the thinnest front.
          sweep: `
      .mappo-dots ${sel} {
        animation: mappo-sweep ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-ps) * ${dur}s * -1);
      }
      @keyframes mappo-sweep {
        0%   { transform: translateY(0) scale(1); }
        ${wSweep.rise}% { transform: translateY(calc(var(--mappo-a, 1) * -${(amp * 0.7).toFixed(1)}px)) scale(1.28); }
        ${wSweep.settle}% { transform: translateY(0) scale(1); }
        100% { transform: translateY(0) scale(1); }
      }`,
          // Uncorrelated twinkle — quick scale pops scattered by high-freq noise.
          sparkle: `
      .mappo-dots ${sel} {
        animation: mappo-sparkle ${dur}s linear infinite;
        animation-delay: calc(var(--mappo-pk) * ${dur}s * -1);
      }
      @keyframes mappo-sparkle {
        0%   { transform: scale(1); }
        ${wSparkle.rise}% { transform: scale(calc(1 + var(--mappo-a, 1) * 0.45)); }
        ${wSparkle.settle}% { transform: scale(1); }
        100% { transform: scale(1); }
      }`
        };
        return modes[o.animation] ?? "";
      })() : ""}
      @media (prefers-reduced-motion: reduce) {
        .mappo-dot, .mappo-marker, .mappo-marker-ring { animation: none !important; transition: none !important; }
        .mappo-marker-ring { opacity: 0; }
      }
    `;
  }

  // -- events ------------------------------------------------------------------

  #bindEvents(svg) {
    const detailFor = (target) => {
      const pos = target.closest?.(".mappo-pos");
      if (!pos) return null;
      if (pos.dataset.place !== undefined) {
        const detail = { name: pos.dataset.place, lat: Number(pos.dataset.lat), lon: Number(pos.dataset.lon), element: pos };
        if (pos.dataset.kind !== undefined) detail.kind = pos.dataset.kind;
        return { kind: "place", detail };
      }
      const col = Number(pos.dataset.col), row = Number(pos.dataset.row);
      const c = cellCenter(col, row, this.grid);
      if (!c) return null;
      return { kind: "dot", detail: { lat: c.lat, lon: c.lon, col, row, element: pos } };
    };

    const dispatch = (kind, phase, detail) => {
      if (!this.options.interactive) return;
      const cb = this.options[`on${kind === "place" ? "Place" : "Dot"}${phase}`];
      if (cb) cb(detail);
      this.container.dispatchEvent(new CustomEvent(
        `mappo:${kind}${phase.toLowerCase()}`,
        { detail, bubbles: true }
      ));
    };

    svg.addEventListener("click", (e) => {
      const hit = detailFor(e.target);
      if (hit) dispatch(hit.kind, "Click", hit.detail);
    });
    svg.addEventListener("mouseover", (e) => {
      // mouseover + a same-group guard ≈ mouseenter with one listener.
      const hit = detailFor(e.target);
      if (!hit) return;
      if (e.relatedTarget && hit.detail.element.contains(e.relatedTarget)) return;
      dispatch(hit.kind, "Enter", hit.detail);
    });
    svg.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const hit = detailFor(e.target);
      if (hit?.kind === "place") { e.preventDefault(); dispatch("place", "Click", hit.detail); }
    });
  }

  #ariaLabel() {
    const body = this._body;
    if (body.pending) return `Map of ${body.id}, waiting for its body pack`;
    const names = resolvePlaces(this.options.places, body).map((p) => p.name).filter(Boolean);
    const dotted = parseFigureStyle(this.options.figure).dots ? "Dotted " : "";
    const terms = body.terms ? ` showing ${body.terms.figure} against ${body.terms.ground}` : "";
    const highlights = names.length ? `, highlighting ${names.join(", ")}` : "";
    return `${dotted}${body.name} map${terms}${highlights}`;
  }
}

// Snap a lat/lon to the nearest FIGURE cell in the grid, searching outward a
// few rings — coastal cities often sit in a sea cell at coarse resolutions
// (harbours do that), and a marker floating just off the coast looks broken.
// Returns null when the point has no place on the grid's projection. Pure
// function (exported for consumers doing their own math).
export function snapToFigure(lat, lon, grid, body) {
  if (!body) throw new TypeError("snapToFigure needs a body — pass EARTH or another registered body");
  const p = project(lat, lon, grid);
  if (!p) return null;
  const { x, y } = p;
  const col0 = Math.min(grid.cols - 1, Math.max(0, Math.floor(x)));
  const row0 = Math.min(grid.rows - 1, Math.max(0, Math.floor(y)));

  let nearestWorld = null;
  for (let radius = 0; radius <= 3; radius++) {
    let best = null;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only
        const col = col0 + dc, row = row0 + dr;
        if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue;
        const c = cellCenter(col, row, grid);
        if (!c) continue;
        const d = (col + 0.5 - x) ** 2 + (row + 0.5 - y) ** 2;
        const tie = Math.abs(col - col0) + Math.abs(row - row0);
        if (!nearestWorld || d < nearestWorld.d - 1e-12 || (Math.abs(d - nearestWorld.d) <= 1e-12 && tie < nearestWorld._tie)) {
          nearestWorld = { col, row, d, _tie: tie };
        }
        if (!body.figure(c.lat, c.lon)) continue;
        if (!best || d < best.d - 1e-12 || (Math.abs(d - best.d) <= 1e-12 && tie < best._tie)) best = { col, row, d, _tie: tie };
      }
    }
    if (best) return { col: best.col, row: best.row, d: best.d };
  }
  // Deep-ocean coordinates render where they are — honest, and it makes
  // custom places like ships or islands-below-resolution still work.
  return nearestWorld && { col: nearestWorld.col, row: nearestWorld.row, d: nearestWorld.d };
}

// Option equality for the differential update. Structural for arrays and
// plain option objects (places, latRange, highlightPolygon, focus — the
// element parses a fresh object from its attribute every time, and a fresh
// `focus` that says the same thing must not re-aim the globe); identity for
// everything else, functions included.
function sameOption(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

const OVERLAY_STYLE_PROPS = [ "position", "left", "top", "transform", "will-change", "--mappo-depth" ];

// Remember only the properties mappo owns. Restoring the whole style attribute
// would erase unrelated host changes made while the map was mounted.
function captureOverlay(el) {
  return {
    parent: el.parentNode,
    nextSibling: el.nextSibling,
    styles: OVERLAY_STYLE_PROPS.map((prop) => [
      prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)
    ]),
    behind: el.hasAttribute("data-mappo-behind")
      ? el.getAttribute("data-mappo-behind")
      : null
  };
}

function restoreOverlay(el, state, container) {
  if (!state?.parent || state.parent === container) return;
  const before = state.nextSibling?.parentNode === state.parent ? state.nextSibling : null;
  state.parent.insertBefore(el, before);
}

// Undo exactly what the renderer wrote, restoring host-owned inline values.
function releaseOverlay(el, state) {
  if (!state) return;
  for (const [ prop, value, priority ] of state.styles) {
    if (value) el.style.setProperty(prop, value, priority);
    else el.style.removeProperty(prop);
  }
  if (state.behind !== null) el.setAttribute("data-mappo-behind", state.behind);
  else el.removeAttribute("data-mappo-behind");
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
