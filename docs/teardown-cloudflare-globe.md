# Teardown: the Cloudflare "Region: Earth" globe

**Subject:** `#home-region-earth` on cloudflare.com, component `RegionEarth`
from `/_astro/_globe.1L8qjYxV.js`, engine in `/_astro/_poi.GfvrsH0c.js`.
**Inspected:** 2026-08-31, static bundle analysis + live DOM/JS introspection.
**Purpose:** decide what mappo should learn from it. This is an inventory of
*techniques and parameters*, written so mappo can implement them in its own
idiom. No Cloudflare code is copied — mappo ships MIT and their bundle is
theirs; the ideas below (tilt, graticules, DOM overlays, arc reveals) are
cartographic and DOM technique, not ownable expression.

---

## 1. Their stack, and why we are NOT porting it

| Layer | What they use |
|---|---|
| Renderer | **three.js r185** via react-three-fiber, WebGL |
| Shading | Custom GLSL — 108 `varying vec` declarations across the bundle |
| Camera | `PerspectiveCamera`, fov 45, position `[0,-0.5,2.75]` desktop / `[0,-0.5,4]` mobile |
| Controls | `OrbitControls`, pan/zoom off, rotate on |
| Depth cue | `<fog>` coloured from a live CSS variable |
| Arcs | `TubeGeometry` + `setDrawRange` |
| Bundle | `_poi.js` is **912 KB** |

mappo's premise is the opposite: one ESM file, zero dependencies, no build
step, a ~22 KB packed mask, SVG for flat and canvas-2D for the globe. Adopting
three.js would not improve mappo, it would replace it. **Everything below is
therefore a re-implementation target for the canvas globe, not a port.**

What is explicitly out of scope: three.js, WebGL, GLSL, fog, perspective
camera, orbit controls, tube geometry.

---

## 2. Composition, decoded

```
<Canvas dpr={mobile ? [1,1] : [1,2]} frameloop={active ? "always" : "demand"}
        shadows={false} flat gl={{antialias, alpha:true, powerPreference:"high-performance"}}>
  <fog args={[cssVar("--color-background-100"), close, far]} />
  <OrbitControls enablePan={false} enableZoom={false} enableRotate
                 minPolarAngle={PI/2} maxPolarAngle={PI/2}
                 autoRotate={active && !prefersReduced} autoRotateSpeed={mobile ? 0.15 : 0.3} />
  <group scale={1.2} rotation={[0, 0, -0.25]} position={[0, -0.3, 0]}>
    <Earth onReady={markReady} />
    <Graticule meridians={24} parallels={23} />
    <Connections />                     // conditional
    {pois.map(poi => <Poi {...poi} />)}
    <PoiOverlay pois={pois} active={isReady} />
  </group>
</Canvas>
```

### Parameters worth stealing verbatim

- **Tilt is a z-roll of `-0.25 rad` (≈ −14.32°)**, applied to the whole group —
  not an axial tilt of the sphere. The globe *leans*, the spin axis stays
  vertical in world space.
- **`minPolarAngle === maxPolarAngle === π/2`** locks the orbit to the
  equatorial plane: dragging changes longitude only, never latitude. mappo's
  drag-to-spin already behaves this way; this confirms the choice.
- **`autoRotateSpeed`: 0.3 desktop, 0.15 mobile.** Half speed on small screens.
- **Graticule: 24 meridians, 23 parallels.**
- **Globe transform: `scale 1.2`, `y −0.3`** — oversized and pushed down, so the
  sphere bleeds past the viewport bottom instead of sitting in it.
- **DPR capped at 2** (and pinned to 1 on mobile). Measured live: canvas
  3978×1000 backing store for a 1989×500 CSS box.

---

## 3. The graticule (their `CN` component)

```
meridians: for b in 0…n-1 → lon = -180 + (360/n)*b        // great circle per longitude
equator:   its own geometry AND ITS OWN MATERIAL           // separately emphasizable
parallels: for b in 0…m-1 → lat = -90 + (180/(m+1))*(b+1)
           if (abs(lat) < 5) continue                      // never double-draw near the equator
```

Details that matter:

1. **The equator is drawn separately with a second material.** It is the one
   line a reader uses to orient, so it gets its own colour/opacity budget.
2. **The ±5° skip rule** stops an evenly-spaced parallel from landing on top of
   the equator and doubling its weight.
3. **Colour comes from a CSS custom property** (`--color-border-100`), read via
   `getComputedStyle(document.documentElement)` and **re-read on a subscription**
   so a dark-mode toggle repaints the graticule with no JS from the host.
4. `raycast: () => null` on every graticule line — it never eats a pointer event.
5. All geometries are `dispose()`d on rebuild and unmount.
6. Opacity drops to **0.04** in one theme — near-invisible texture rather than
   drawn lines.

---

## 4. POIs are HTML, not geometry — the big one

The pins and captions are **DOM elements in two overlay layers**, positioned
from the 3D projection every frame:

```
<div class="pointer-events-none absolute inset-0 z-10 scale-80 md:scale-100">  // pins    (18 children)
<div class="pointer-events-none absolute inset-0 z-20 scale-80 md:scale-100">  // captions (5 children)
<div class="pointer-events-none absolute inset-0 z-10 select-none">            // 4 solid edge-mask strips
```

**The two-element split per marker is the technique to copy.** Each POI is a
*root* wrapper plus an *inner* visual:

- **root** — written every frame with `transform: translate3d(Xpx, Ypx, 0)`.
  Measured across consecutive frames: `translate3d(1186.06px, 171.326px, 0)` →
  `translate3d(1184.69px, 171.664px, 0)`. No CSS transition on this element.
- **inner** — carries `transform: translate(-50%,-50%) scale(s)` and `opacity`,
  *with* a CSS transition.

That split is why it looks smooth: the per-frame position write and the
eased appearance change live on different elements and never fight. Markers
start parked at `translate3d(-9999px,-9999px,0)`, `opacity:0`, `scale(0)` until
the first projection — so nothing flashes at the origin on load.

Registration is a map (`registerRoot`, `registerPin`, `registerCaption`,
`registerCaptionText`) so the frame loop can find each element by id without
querying the DOM.

Accessibility: the interactive wrapper takes `role="button"`, `tabIndex={0}` and
Enter/Space handlers; the decorative inner is `aria-hidden`.

**This is independent convergence on the overlay design already proposed for
mappo v0.5** (host owns the markup, mappo owns the geometry) — and it is what
lets their labels be real, translatable, focusable DOM instead of canvas paint.

---

## 5. Arc / connection reveal

Arcs are tubes along a curve between two POIs, revealed by animating the
geometry's **draw range** rather than by redrawing geometry:

```
start = ease(startProgress); end = ease(endProgress); len = max(0, end - start)
setDrawRange(indexOf(start), max(6, indexOf(end) - indexOf(start)))
material.opacity = len * 0.8
visible = drawCount > 0
```

- The head runs ahead, the tail follows, and **opacity tracks the arc's current
  length** — so it reads as a comet that fades as it contracts.
- `max(6, …)` keeps a minimum sliver so the arc never flickers out mid-flight.
- `renderOrder: 5000` + `raycast: null` — always on top, never interactive.
- Geometry and material are disposed per removed arc.

In canvas-2D this is just a polyline with an animated `[i0, i1]` slice and a
matching alpha — no library needed.

---

## 6. Degradation ladder (three tiers)

1. `performance === "low"` → **static PNG** (`/static/globe.png`, or
   `globe-dark.png` in dark mode), `loading="lazy"`, `decoding="async"`.
2. `shouldDisable3D` — a WebGL probe that reads `WEBGL_debug_renderer_info` and
   treats `swiftshader` / `llvmpipe` / `software` / `mesa` as *no hardware
   acceleration* → same static PNG, plus a console warning.
3. Otherwise → live 3D.

They also probe with `failIfMajorPerformanceCaveat: true` first and retry
without it, which distinguishes "no WebGL" from "WebGL but software".

The equivalent for mappo's canvas globe is cheaper — there is no WebGL to
probe — but the *shape* is worth keeping: a declared static fallback and a
`prefers-reduced-motion` still frame (mappo already does the latter).

---

## 7. Entrance choreography

```
READY_FAILSAFE = 1800ms      // markReady fires anyway if the scene never reports
WILL_CHANGE_RELEASE = 900ms  // after ready, drop will-change back to "auto"
transition: opacity, transform 900ms cubic-bezier(0.22, 1, 0.36, 1)
from: scale(0.97) opacity(0)   to: scale(1) opacity(1)
motion-reduce: no scale, no transition
```

Two details worth keeping: the **failsafe timer** (the section can never be
stuck invisible because a ready event never arrived) and **releasing
`will-change` after the transition** instead of leaving a layer promoted
forever.

---

## 8. What mappo should take

| # | Idea | Where it lands in mappo |
|---|---|---|
| 1 | Graticule: meridians + parallels + separately-styled equator, ±5° skip | new `graticule.js`, both renderers |
| 2 | Colours from live CSS custom properties | option resolver in `renderer.js` / `globe.js` |
| 3 | DOM overlay children positioned per frame, root/inner split | the v0.5 overlay API |
| 4 | Lean/roll distinct from spin | globe transform |
| 5 | Arc reveal by animated draw-range + length-tracked alpha | new `arcs.js` |
| 6 | DPR cap | globe canvas sizing |
| 7 | Entrance ready + failsafe + will-change release | element/renderer |
| 8 | Speed halved on small screens | option default |

Not taken: three.js, WebGL, GLSL, fog, perspective camera, orbit controls,
tube geometry, their static-PNG asset pipeline.
