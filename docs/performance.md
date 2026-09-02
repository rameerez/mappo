# Performance: cost model, measured limits, and the road to more

This document is for people who want to know what a mappo map costs, how many
of them a page can carry, where the limits are, which parameters to choose,
and what it would take to go an order of magnitude further. Every number is
measured; the method is in §9 so it can be re-run. Absolute milliseconds are
one machine's truth (§1); the scaling laws and ratios are the durable part.

The one-paragraph version: **build cost is negligible and per-frame cost is
linear and predictable.** A flat map costs at render time in proportion to its
DOM node count (about 8 µs per node, all of it the browser's style, layout
and paint) and nothing per frame unless animated. A globe costs per frame in
proportion to what it draws: 0.2–0.3 µs per dot, about 1 ms for vector
outlines with borders and a graticule at any resolution, and 1.4–2.8 µs per
filled grid cell, which makes the filled grid globe the one style to budget
for. Nothing crashed at any size tried; degradation is graceful and linear.

## 1. Environment

| | |
|---|---|
| Machine | Apple M1 Max, 10 cores, 32 GB |
| Engine | Chrome 152 (headless, new mode), `devicePixelRatio` 1. Running with and without the GPU flag gave the same numbers: headless canvas rasterises on the CPU, so **canvas fills here are pessimistic** relative to a desktop browser with GPU rasterisation, and JavaScript costs are representative. |
| Pure computation | Node 22.22, same V8 family |
| Sizes | globes 500 px (single) and 300 px (grids of many); flat maps 800 px wide |
| Date | 2026-09-02, mappo 0.7.0 at `5c639d5` |

## 2. The cost model

Let `cols` be the grid resolution and `Δφ` the latitude span in degrees
(142° for Earth's default framing, 180° for a full sphere).

```
rows        = round(cols · Δφ / 360)
cells       = cols · rows                       ≈ 0.394 · cols²   (Earth framing)
figure dots ≈ 0.303 · cells                     ≈ 0.119 · cols²   (Earth: 30.3% of the frame is land)
ground dots = cells − figure dots               ≈ 0.275 · cols²
```

| Cost | Scales with | Measured coefficient |
|---|---|---|
| Classifier `figure(lat, lon)` | per call | 20 ns (Earth mask lookup) |
| Point buffers, phase buffers (globe build) | cells | 15 ms at cols 1000 (394k cells); 1.2 ms at cols 260 |
| Grid contour trace (`buildFigure`, first time per body and grid) | cells | 3.1 ms at cols 260; 25 ms at cols 1000 |
| Decoding a body's vector outlines (once per body per page) | points | Earth coast 1.7 ms (4 275 pts), borders 1.2 ms (8 357 pts), Moon 1.4 ms (5 375 pts) |
| Flat SVG markup | dots | 262 bytes per dot |
| Flat SVG parse (`innerHTML`) | nodes (2 per dot) | ≈ 2.0 µs per node |
| Flat first frame (style + layout + paint) | nodes | ≈ 7.7 µs per node |
| Globe frame, dots | points in the buffer | 0.19 µs per point at cols ≤ 400, 0.32 µs at cols 1000 |
| Globe frame, ground dots | ground points | same per point; ground has 2.3× the figure's points |
| Globe frame, graticule (12 + 11 lines) | constant | ≈ 0.4 ms |
| Globe frame, vector outlines + borders + graticule | constant (12.6k points) | ≈ 1.0 ms at every `cols` |
| Globe frame, filled grid (`figure="solid"` or `solid outline`) | figure cells | 1.35 µs per cell at cols 260, 2.8 µs at cols 400 (superlinear: Path2D fills grow with area) |

Build costs are paid once per resolution per body and memoised: the grid
contour per body object, decoded outlines per body, and the dot markup per
instance in a cache capped at 4 MB. Everything below is therefore about frames
and DOM, not about mathematics.

## 3. Measured: the flat map

One map, 800 px wide, Earth, default framing, three places.

| `cols` | dots | SVG nodes | markup | build JS | parse | first frame (style+layout+paint) | cold rebuild frame | warm rebuild frame |
|---|---|---|---|---|---|---|---|---|
| 60 | 449 | 912 | 109 KB | 4.4 ms | 1.9 ms | 18 ms | 14 ms | 34 ms |
| 120 | 1 699 | 3 412 | 413 KB | 4.7 ms | 6.4 ms | 31 ms | 32 ms | 20 ms |
| 170 | 3 466 | 6 946 | 847 KB | 4.2 ms | 11.5 ms | 47 ms | 59 ms | 49 ms |
| 260 (cap) | 8 148 | 16 310 | 2.0 MB | 8.1 ms | 33 ms | 126 ms | 126 ms | 120 ms |

Reading this: the JavaScript is a small, flat 4–8 ms; the browser's parse,
style, layout and paint of the node tree is the cost, at roughly 8 µs per
node. A warm rebuild (cached markup) saves only the build milliseconds, so the
cache is not what makes a slider bearable; the adaptive debounce is.

**Patch tiers, JavaScript side** (what `update()` spends before the browser
takes over):

| `cols` | style patch | defs patch (`dot-shape`) | markers patch (`places`) |
|---|---|---|---|
| 120 | 0.6 ms | 0.3 ms | 0.1 ms |
| 260 | 2.5 ms | 2.7 ms | 0.3 ms |

**Patch tiers, to paint** (from `setAttribute("figure-color", …)` to the
frame that shows it, which includes the browser's style recalculation of every
node under the rewritten stylesheet):

| `cols` | nodes | style patch → painted |
|---|---|---|
| 120 | 3 406 | 33 ms |
| 260 | 16 304 | 128 ms |

A colour change on a dense flat map therefore costs about the same as a
rebuild frame. The tiers save the JavaScript and the garbage, not the
recalculation: at 16k nodes any stylesheet change is a 100 ms frame. This is
the flat renderer's true ceiling, and it is the browser's, not mappo's.

**Shape styles** are cheap on the flat map because they are a handful of nodes
however many `cols`:

| `cols` | style | nodes | path data | first frame |
|---|---|---|---|---|
| 120 | `solid outline` (grid) | 9 | 8 KB | 16 ms |
| 120 | `solid outline` vector + borders | 10 | 51 KB | 32 ms |
| 260 | `solid outline` (grid) | 9 | 24 KB | 32 ms |
| 260 | `solid outline` vector + borders | 10 | 54 KB | 33 ms |

**Animated flat maps.** CSS transform animations on thousands of SVG `<use>`
elements run on the main thread (SVG transforms are not compositor layers).
One map, in this CPU-raster environment:

| `cols` | animated dots | frame interval mean | p95 |
|---|---|---|---|
| 120 | 1 699 | 20.8 ms | 67 ms |
| 170 | 3 466 | 36 ms | 50 ms |
| 260 | 8 148 (load gate animates ⅓) | 36 ms | 67 ms |

The load gate holds cols 260 to the same cost as cols 170 by animating a baked
subset, as designed. Four animated maps at cols 120 on one page ran at 86 ms
per frame (12 fps); sixteen did not complete a dozen frames in ninety
seconds. **Animate one flat map per viewport, at cols ≤ 120–170, or animate
on the globe, where it costs 0.2 µs per dot.**

## 4. Measured: one globe

500 px canvas, `rotate-speed="30"`, Earth, default framing. Per-frame draw
time is the time inside mappo's own frame routine; the frame interval is what
the browser delivered.

| `cols` | points | `dots` | `dots` + ground + graticule | `solid outline` (grid fill) | `outline` vector + borders + graticule |
|---|---|---|---|---|---|
| 120 | 1 699 | 0.16 ms | 0.69 ms | 0.77 ms | 1.0 ms |
| 170 | 3 466 | 0.30 ms | 1.34 ms | 2.25 ms | 1.0 ms |
| 260 | 8 148 | 1.13 ms | 3.7 ms | 11.0 ms | 1.0 ms |
| 400 | 19 210 | 3.7 ms | 9.3 ms | 54 ms (18 fps) | 1.0 ms |
| 600 | 43 066 | 8.5 ms (60 fps held) | | | |
| 1000 | 119 235 | 38 ms (25 fps) | | | |

Construction (buffers plus first frame) was 1.6–7 ms up to cols 400, 23 ms at
cols 600, 50 ms at cols 1000. JavaScript heap after the cols 1000 globe: 17 MB.

Three things this table says:

- **Vector outlines are free.** The 1.0 ms is the same at every `cols`
  because the outline is fixed data (12.6k points), and it is the richest look
  the globe has. For a globe that has to look good and cost nothing, this is
  the style.
- **The filled grid globe is the hot spot.** It projects four corners per
  figure cell per frame and fills thousands of quads; it is the only style
  that leaves the frame budget before cols 400. Keep filled globes at
  cols ≤ 170 when there are several, ≤ 260 when there is one.
- **Dots scale to scientific densities.** 43k points at 60 fps and 119k at
  25 fps, on CPU rasterisation. There is no `cols` cap on the globe; cost is
  linear and you choose the point on the line.

## 5. Measured: many instances

Sixteen rich globes (300 px, cols 170, `solid outline` with vector borders and
a graticule, all spinning, all in the viewport):

| globes | draw per globe | draw per frame, total | frame interval | frame rate | heap delta |
|---|---|---|---|---|---|
| 1 | 3.0 ms | 3 ms | 16.7 ms | 60 fps | +3 MB |
| 4 | 2.9 ms | 11.5 ms | 16.7 ms | 60 fps | (GC noise) |
| 8 | 2.9 ms | 23 ms | 23.8 ms | 42 fps | +20 MB |
| 16 | 2.9 ms | 47 ms | 48.8 ms | 20 fps | (GC noise) |

Per-globe cost is constant; the page's frame time is the sum. Instances share
what can be shared (a body's decoded outlines, its projected outline
coordinates, its grid contour per resolution) and own what must be owned (the
canvas, the point buffers, the caches, the frame loop). Each globe runs its own
`requestAnimationFrame`; offscreen globes pause through an
`IntersectionObserver`, so only visible ones count.

Sixteen **static** flat maps at cols 120: 54 496 SVG nodes, 478 ms to mount
all sixteen, +10.5 MB heap, and a 16.67 ms frame interval afterwards. A static
SVG map costs nothing per frame; the page pays once.

## 6. Limits, and the recommended parameters

Nothing tried here crashed. The failure mode is a falling frame rate, linear
in the total work, and the historical tab-killer (rebuilding geometry on every
slider tick) is closed by the adaptive debounce and the byte-capped markup
cache. The hard limits that exist:

| Limit | Value | Why |
|---|---|---|
| Flat `cols` | 260, enforced; higher values are clamped with a warning | SVG node count: 16k nodes is already a 126 ms first frame and a 128 ms colour change |
| Globe `cols` | none; the cost is linear | 43k dots at 60 fps, 119k at 25 fps here |
| Dot markup cache | 4 MB per instance, oldest evicted | a resolution sweep otherwise retained tens of MB |
| Figure geometry cache | 8 entries per instance | same |
| Canvas backing store | `side² · min(dpr, maxDpr)² · 4` bytes | a 500 px globe at dpr 2 is 4 MB of pixels; `max-dpr` defaults to 2 because 3× buys no visible detail on a dot field |

**Frame budget arithmetic.** At 60 fps a frame is 16.7 ms and the page should
spend at most about 12 ms of it drawing. Using the per-globe costs above at
cols 170:

| Globe style | per globe | globes at 60 fps | at 30 fps |
|---|---|---|---|
| `dots` | 0.3 ms | ~40 | ~100 |
| `dots` + ground + graticule | 1.3 ms | ~9 | ~24 |
| `outline` vector + borders + graticule | 1.0 ms | ~12 | ~30 |
| `solid outline` (grid fill) | 2.3 ms | ~5 | ~13 |

Halve those on a mid-range laptop; halve again on a phone, where the default
`max-dpr` of 2 already saves 5/9 of the fill rate compared with 3×.

**Recommended parameters**

| You want | Use |
|---|---|
| A hero globe | `mode="globe" cols="170"`, any style; `figure="outline" figure-source="vector"` for the crispest edge at the lowest cost |
| Several globes on one page | dots or vector outlines at cols 120–170; avoid filled grid globes beyond about five, and pause the ones that do not need to spin (`rotate-speed="0"`) |
| A dense scientific point field | the globe, `figure="dots"`, cols 400–600; put your own data on top through `locate()`, whose cost is one projection per call (the Starlink demo makes 10 725 of them per frame) |
| A flat map that updates live (sliders, themes) | cols ≤ 120: every rebuild or colour change is a full-node recalculation |
| A flat map at maximum detail | cols 260, static, `animation="none"` |
| An animated flat map | one per viewport, cols ≤ 120–170, or animate on the globe instead |
| Many flat maps | static ones are free after mount (16 maps, 54k nodes, 0 ms per frame); mount cost is about 30 ms each at cols 120 |
| Mobile | defaults; globes at cols ≤ 170; no more than 2–3 spinning at once |

## 7. Where the time goes, and what is already done

Profile of a rich globe frame (cols 170, `solid outline` + borders +
graticule, 2.9 ms): about 2.2 ms filling grid quads, 0.4 ms graticule strokes,
0.3 ms borders, the rest overlays and bookkeeping. Of a dots frame at
cols 260 (1.1 ms): the loop over 8 148 points with two rotations each and a
canvas `arc` + `fill` for the ~4 000 that face the viewer.

Already in place, so they need not be proposed again:

- Unit-sphere coordinates for dots, figure quads, contours and vector outlines
  are precomputed into typed arrays; a frame only rotates them. No per-frame
  trigonometry, no per-frame allocation for geometry.
- Fills and strokes are batched by depth band into a handful of `Path2D`
  objects: seven `fill()` calls for thousands of quads, not one each.
- Colour resolution through `var()` is memoised until the theme changes.
- Offscreen globes pause; `prefers-reduced-motion` draws one frame and stops.
- Flat updates are tiered (style, defs, markers, geometry) and geometry
  rebuilds are debounced to 8× the last measured frame cost.
- `figure-color` and its siblings are stylesheet-tier; the geometry is never
  rebuilt for a colour.

## 8. Toward high-performance computing

In order of leverage, with the measured or estimated gain.

1. **Do not redraw a globe that has not changed.** The frame loop currently
   calls the draw routine every frame even at `rotate-speed="0"` with no
   animation and no pointer interaction, so a parked globe costs its full
   per-frame price (0.3–3 ms) forever. Skipping the draw when the angle,
   options, hover state and overlay set are unchanged makes idle globes cost
   zero and lifts the multi-instance budget in §6 to "as many parked globes
   as you like". Cheap to implement; the largest practical win for dashboards.
2. **Run-length quads for the filled grid globe.** A row of `k` contiguous
   figure cells is one quad, not `k`; continents are mostly long runs. This
   cuts projections and path segments several-fold on the one style that
   leaves the budget early (11 ms at cols 260 → an estimated 2–4 ms), with no
   visible change because adjacent quads already tile edge to edge.
3. **A WebGL or WebGPU point renderer for the globe.** Instanced point
   sprites move the per-dot work to the GPU: the CPU uploads the point buffer
   once and sends one rotation matrix per frame. This is the step from 10⁵ to
   10⁶–10⁷ points per frame, and it makes per-dot animation free. It is also
   the only path that makes the filled globe cheap at high `cols` (a triangle
   mesh of the figure, drawn in one call). Estimated 10–50× on dots; the
   consumer-facing API does not change (`figure`, `locate()`, events).
4. **`OffscreenCanvas` in a worker.** Moves the 2D rasterisation off the main
   thread so a heavy globe cannot stall the page's interaction, at the price
   of message-passing for options and pointer events. Worth it for pages
   whose main thread is already busy; it does not reduce total CPU.
5. **Batching square dots.** Measured on 8 000 dots at random depths: per-dot
   `fillRect` 4.9 ms; the same rectangles gathered into seven depth-banded
   `Path2D` objects 0.5 ms (10×). For the default circles the same experiment
   went the other way (per-dot `arc`+`fill` 0.95 ms; banded `Path2D` arcs
   1.47 ms), so the current per-dot circle path is already the fast one and
   should stay. Batch squares and triangles; leave circles.
6. **A flat canvas renderer for extreme grids and many maps.** The flat
   ceiling is the browser's per-node cost (§3). A canvas flat mode behind the
   same options would draw cols 500 in a millisecond, at the cost of the SVG
   virtues (real elements, CSS hover, restyling) that are the reason the flat
   map is SVG. Offer it as an opt-in for the dense and the many, not as a
   replacement.
7. **Level of detail by pixel size.** A 200 px thumbnail globe does not need
   cols 170; choosing `cols` so a dot is at least two device pixels wide would
   cut thumbnail cost 3–4× with no visible loss.
8. **Trim the flat markup when not animating.** Six baked animation
   variables per dot are 40% of the 262 bytes; emitting them only when
   `animation` is on shortens parse time proportionally (the node count, and
   so the layout cost, stays the same).
9. **WebAssembly and Rust are not the bottleneck.** Every pure-JavaScript
   computation mappo does is either one-time and small (25 ms to build cols
   1000) or already 0.2–0.3 µs per point in a JIT-compiled typed-array loop.
   A WASM port of that arithmetic might gain 1.5–3×, and SIMD perhaps 4×, on
   a cost that is not where the frame goes: the canvas draw calls are, and
   WASM cannot make them cheaper. Rust/WASM earns its place in the
   **consumer's** layer, for heavy per-frame numerics such as propagating
   10⁵ satellites with SGP4, and even there a WebGPU compute pass is the
   larger lever. The renderer's own path to another order of magnitude is
   item 3, not a language change.

## 9. Method

Pure computation was timed in Node 22.22 with `performance.now()`, best of
five runs, on fresh body objects so no cache was hit. Browser measurements ran
in headless Chrome against the built `dist/mappo.js` served with no caching:
the flat renderer's own `performance.measure` spans (`wm:build-markup`,
`wm:parse-innerHTML`, `wm:patch-*`) and its double-`requestAnimationFrame`
frame calibration gave the flat numbers; for globes each instance's draw
routine was wrapped to time it per frame while a parallel
`requestAnimationFrame` loop recorded frame intervals over 12–45 frames;
heap came from `performance.memory` with precise memory info enabled. The
page held its `load` event with a deliberately slow image so the DOM dump
happened after the measurements. The batching experiment drew 8 000 random
dots on a 1000² canvas with each strategy eight times and reported the mean of
the last six. Reproduce with the perf harness at `demo/perf.html` for the
budgets, or a page built the same way for the tables.
