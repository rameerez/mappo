# Roadmap

What comes after 0.7.0, in six tracks, each item with why, the evidence it
rests on, its first concrete step and a size. Sizes: **S** an afternoon, **M**
a few days, **L** a release of its own. Items are ordered by leverage within
each track. Nothing here changes the body seam except where it says so.

The evidence lives in three documents this roadmap links into:
[`docs/precision.md`](precision.md) (what is exact, what is approximate, by
how much), [`docs/performance.md`](performance.md) (what costs what, measured),
and [`CHANGELOG.md`](../CHANGELOG.md) (what changed and what to write instead).

## 1. Release track: 0.7.0

| # | Item | Size | Status |
|---|---|---|---|
| R1 | Verify Safari and Firefox. Chrome has had headless and visual sweeps of every page ([performance.md §9](performance.md#9-method)); the other two engines have had none. A web component's risks are engine-specific: custom-element upgrade order, CSSOM selector rewriting, `Path2D`, `OffscreenCanvas` absence, `:where()` support. | S | open |
| R2 | A browser smoke matrix in CI: Chromium, Firefox and WebKit through [Playwright](https://playwright.dev/), running the flows the DOM tests cover (pending body → registered, tag upgrade, overlay survival across mode switch and reconnection, per-instance ids, focused-globe stability) against `dist/`. | M | open |
| R3 | Publish 0.7.0: `npm publish` runs `prepublishOnly` (build + tests); tag `v0.7.0`; deploy the landing page. | S | open |
| R4 | Migrate soupfestivals from the vendored 0.5: `<world-map>` → `<mappo-world>`, `dot-color` → `figure-color`, bump the vendored bundle and the import-map pin. Two edits plus the bundle. | S | open |
| R5 | Fold the benchmark scenarios into `demo/perf.html` as budgets: per-globe frame cost by style, the many-globes budget, the flat colour-change cost, so the numbers in [performance.md](performance.md) are re-measured rather than remembered. | M | open |
| R6 | **Packaging**: a 22.0 KB gzipped core with the whole Earth inside, and opt-in modules (`mappo/globe`, `mappo/projections`, `mappo/vector`, `mappo/bodies/earth-vector`, `mappo/all`) that register themselves; esbuild, minified, source maps; the mask as run lengths. Measured in [weight.md](weight.md), held by the test suite. | M | done |
| R7 | **Lazy chunks for the bare import**: let the core `import()` the globe, the projections and Earth's rings the first time a page asks for them, so a single CDN URL stays 21 KB up front and needs no second import. The registries make it a few lines, and it also removes the one trap of hand-loaded modules — a core reached through a short or redirecting URL is a different module URL from the `./mappo.js` a module resolves, so two cores run (README, Install) — because the core would resolve the chunks relative to its own URL. The open question is chunk URLs behind import maps and asset digests. | S | open |
| R8 | **Borders on a shared-arc topology**, the data change [weight.md §3](weight.md) measured: 24% of border segments are second copies of a shared boundary and 43% repeat the coastline; regions (choropleths) become an arc index instead of another 23 KB of rings. | M | open |

## 2. Performance track

Measured baseline: [performance.md §3–5](performance.md#3-measured-the-flat-map).
The frame-budget arithmetic every item below moves is in
[§6](performance.md#6-limits-and-the-recommended-parameters).

| # | Item | Expected gain | Evidence | First step | Size |
|---|---|---|---|---|---|
| P1 | **Done in 0.7.0.** ~~Skip the globe draw when nothing changed.~~ The loop redraws a parked globe (`rotate-speed="0"`, no animation, no pointer, no overlay change) at 60 fps. | idle globes from 0.3–3 ms per frame to 0; dashboards with many parked globes become free | [§8 item 1](performance.md#8-toward-high-performance-computing); `_loop` in `src/globe.js` calls `_draw()` unconditionally | a dirty flag set by angle change, `update()`, hover change, resize and theme change; draw only when set | S |
| P2 | **Run-length quads** for the filled grid globe: one quad per row run of contiguous figure cells. | filled globe at cols 260 from 11 ms toward 2–4 ms; at cols 400 from 54 ms toward ~15 | [§4](performance.md#4-measured-one-globe) shows 1.35–2.8 µs per cell, superlinear | in `#figureGeometry`, emit `[col0, col1, row]` runs; project two corners per run end instead of four per cell | S |
| P3 | **WebGL / WebGPU point renderer** for `mode="globe"`: instanced point sprites, one buffer upload per geometry build, one rotation matrix per frame; a triangle mesh for the filled figure. | 10⁵ → 10⁶–10⁷ dots per frame; per-dot animation free; filled globe cheap at any `cols` | [§8 item 3](performance.md#8-toward-high-performance-computing); dots cost 0.19–0.32 µs each on the CPU raster today | a `renderer="webgl"` opt-in behind the same options; [WebGL2 on MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext), [WebGPU specification](https://gpuweb.github.io/gpuweb/) | L |
| P4 | **`OffscreenCanvas` in a worker** for heavy globes. | main thread freed; total CPU unchanged | [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) | transfer the canvas, post options and pointer events, keep overlays on the main thread | M |
| P5 | **Batch square and triangle dots** into depth-banded `Path2D` objects; leave circles per-dot. | squares 10× (4.9 → 0.5 ms per 8 000 dots); circles unchanged | measured in [§8 item 5](performance.md#8-toward-high-performance-computing) | branch on `dotShape` in `#drawPoints` | S |
| P6 | **Level of detail by pixel size**: choose `cols` so a dot is ≥ 2 device pixels when `cols` is not set. | thumbnails 3–4× cheaper | [§6](performance.md#6-limits-and-the-recommended-parameters) | derive the auto `cols` from the measured canvas width and `maxDpr` | S |
| P7 | **Trim flat markup when not animating**: emit the six baked animation variables only when `animation` is on. | parse time ≈ −40% per dot; layout unchanged | 262 bytes per dot measured in [§2](performance.md#2-the-cost-model) | conditional in `#dotsMarkup`; the animation tier then becomes a geometry rebuild only when turning animation on | S |
| P8 | **A flat canvas renderer** (opt-in) for cols > 260 and for pages with many flat maps. | cols 500 in about a millisecond; loses the SVG virtues, so opt-in only | the browser's ≈ 8 µs per SVG node is the flat ceiling, [§3](performance.md#3-measured-the-flat-map) | `renderer="canvas"` behind the same options, sharing `buildFigure` and the dot phases | L |
| P9 | **A shared frame scheduler**: one `requestAnimationFrame` for all globes, priority for the visible and moving. | fewer wakeups; enables frame skipping under load | each instance runs its own loop today | a module-level scheduler that instances subscribe to | S |
| — | **Measured 2026-09-02, for P2 and P5: appending to one `Path2D` is quadratic in Chrome.** 3 000 quads take 28 ms to build, 7 000 128 ms, 14 000 500 ms; the `fill()` itself is under a millisecond at every size. Any batch must stay under a few hundred subpaths, or take the tile renderer's route: one explicit four-point path per quad (about 0.3 µs; NOT a transformed `fillRect`, which paints a needle-thin parallelogram at up to twice its area), with a per-quad alpha for free. The filled grid globe's "superlinear" cost in [§4](performance.md#4-measured-one-globe) is this, not the fill. | filled globe at cols 400 from 54 ms toward a few ms | `scratchpad` probe, headless Chrome 152, M1 Max | chunk `#drawFigure`'s and `#strokeBanded`'s paths at ~256 subpaths | S |
| — | **Not planned: WebAssembly or Rust in the renderer.** Every pure-JS computation is either one-time and small (25 ms at cols 1000) or already 0.2–0.3 µs per point in a JIT-compiled typed-array loop; the canvas draw calls are the cost and WASM cannot make them cheaper. Rust/WASM belongs in a consumer's numerics (propagating 10⁵ satellites), and WebGPU compute is the larger lever even there. | | [§8 item 9](performance.md#8-toward-high-performance-computing) | | |

## 3. Precision track

Baseline: [precision.md §1](precision.md#1-summary). Item X1 is the only one
that touches the body seam.

| # | Item | Removes | Sources | First step | Size |
|---|---|---|---|---|---|
| X1 | **An ellipsoid on the body**: `radiusEquatorial`, `radiusPolar`, a declared latitude convention per body (`geodetic` or `planetocentric`), and conversion helpers. | the 0.19° (Earth) and 0.34° (Mars) latitude-type offsets and the 14 km sphere-vs-ellipsoid gap in [precision.md §5](precision.md#5-sphere-versus-ellipsoid) | WGS 84; IAU WGCCRE 2015 report, Archinal et al. 2018, [doi:10.1007/s10569-017-9805-5](https://doi.org/10.1007/s10569-017-9805-5) | optional fields validated in `validateBody`; `latLonToXYZ` gains a geodetic→geocentric step when the body declares geodetic latitude | M |
| X2 | **Measured elevation for Mars and the Moon** instead of a colour ramp and a brightness threshold: thresholds in metres, and more than one class if wanted (basins, plains, highlands). | the "interpretation of a picture" caveat in [precision.md §4.2](precision.md#42-provenance-and-classification-method-per-body) | [MOLA MEGDR](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) (4–128 px/deg gridded topography); [LRO LOLA](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) gridded elevation | a generator that reads the 16 px/deg MEGDR IMG (2.8 MB) and LDEM, with the same `classifyRaster` seam taking a `valueAt` that is a height | M |
| X3 | **Real lunar geologic units** for the maria boundary. | the gradational-edge caveat | [USGS Unified Geologic Map of the Moon, 1:5M, 2020](https://astrogeology.usgs.gov/search/map/Moon/Geology/Unified_Geologic_Map_of_the_Moon_GIS_v2) (GIS vectors) | a vector-body generator reusing `vector-body.js` with the mare units selected | M |
| X4 | **Finer Earth**: Natural Earth 10m coastlines as an opt-in pack, and a finer or tiled mask so `figure()` stops being a 78 km question. | the 110m generalisation and the 0.703° cell in [§4.1](precision.md#41-resolution-of-the-figure) | [Natural Earth downloads](https://www.naturalearthdata.com/downloads/) | a `mappo/bodies/earth-10m` pack from the same template; a mask width option in the pack format | M |
| X5 | **Sourced gazetteers**: a citation, frame and epoch per place. | the "labels, not survey points" caveat in [§4.3](precision.md#43-gazetteers) | [IAU Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/) for the Moon and Mars | add `source` to the place records in `scripts/data/*-places.js` | S |
| X6 | **IAU rotational elements** on a body (pole RA/Dec, `W(t)`), so a globe can be oriented for an epoch and `focus` computed rather than set. | the "time and rotation are not modelled" line in [§6](precision.md#6-what-mappo-does-not-model), for consumers who want it | Archinal et al. 2018, as X1 | an optional `rotation` block and a helper `orientation(body, date)`; the renderer itself stays time-free | M |
| X7 | **A validation suite against independent references**: known coastline vertices, IAU nomenclature coordinates, and an independent orthographic implementation agreeing with `locate()` to 10⁻⁹. | the "not yet validated" gap in [§8](precision.md#8-validation-the-test-suite-performs) | as above | a `test/reference.test.js` with a handful of pinned points per body | S |

## 4. Projections track

**Shipped in 0.7.0.** The flat map has a projection seam
(`src/projections.js`): an instance is `{ forward(lat, lon) → { x, y } | null,
inverse(x, y) → { lat, lon } | null, aspect, outline() }`, the dot grid samples
the body at the inverse projection of every screen cell, and markers,
overlays, `locate()`, `projectNormalized`, borders, highlights and the graticule
use the forward mapping. What was planned, and what it became:

| # | Item | Status | Where |
|---|---|---|---|
| J1 | A projection interface with equirectangular as the default and no behaviour change | done; the one deliberate change is that points outside the map now answer `null` instead of coordinates outside 0…1 | `src/projections.js`, `src/projection.js`, `test/projections.test.js` |
| J2 | Polar stereographic (north, south) and Equal Earth as built-ins | done: `projection="equirectangular \| equal-earth \| stereographic-north \| stereographic-south"`; formulas, scale tables and measured round trips in [docs/precision.md §3.7](precision.md) | Šavrič, Patterson & Jenny, [*The Equal Earth map projection*](https://doi.org/10.1080/13658816.2018.1504949), IJGIS 2019; Snyder, [USGS PP 1395](https://pubs.usgs.gov/pp/1395/report.pdf) pp. 154–163 |
| J3 | Accept a d3-geo projection object | done: a function with `.invert` and `.stream` is wrapped through d3's actual projection stream; the streamed sphere or latitude band supplies the exact clipped outline and frame | `adaptD3` in `src/projections.js`; validated against 109 zero-argument projections from pinned `d3-geo` and `d3-geo-projection` |
| J4 | Vector outlines under other projections | done: rings are stitched into whole rings once per body (`stitchRings`, which also removes the 180° line the globe drew) and cut at the current projection's seam (`projectRings`); fills get closed pieces, edges get open arcs, a ring enclosing the far pole of a polar map is filled as a complement | `src/projections.js`; the seam-safe `.mappo-figure-fill` / `.mappo-figure-edge` split in `src/renderer.js` |
| J5 | A central meridian, `center-lon` | done, for the built-ins; cylindrical maps move their seam and re-cut, polar maps rotate | `shift()` in every built-in instance |
| J7 | Seam handling for custom and d3 projections | done safely: d3 rings and lines use d3's stream under rotation, clipping and interruption; custom projections default to a ±180° cylindrical seam, may opt out with `seam: false`, and fall back to grid contours instead of drawing a false chord when a ring is incomplete | `projectRings`, `projectPolyline`, `adaptCustom`, `adaptD3` |

What remains:

| # | Item | Why | First step | Size |
|---|---|---|---|---|
| J6 | **More built-ins**: Web Mercator (EPSG:3857) so a mappo layer can register to tile maps; Lambert azimuthal equal-area for area-true polar maps (the [NSIDC EASE-Grid 2.0](https://nsidc.org/data/user-resources/help-center/guide-ease-grids) polar products); Mollweide and Robinson for the classic global look; orthographic as a *flat* projection, for a fixed hemisphere without the globe's canvas | each is a page of closed-form or well-known series mathematics with a known inverse ([Snyder 1987](https://pubs.usgs.gov/pp/1395/report.pdf); Robinson has no closed form and is interpolated from its table, as [d3-geo-projection](https://github.com/d3/d3-geo-projection) does) | add to `BUILTINS` with `kind` and `defaultLatRange`; the test file's round-trip and frame checks are generic and pick new ids up automatically | S each |
| J8 | **Graticule labels** (latitude and longitude values along the frame or the equator) | a scientific map without labelled coordinates is a picture | positions come from `projectPolyline` today; the renderer would add `<text>` at the frame intersections, style-tier | S |
| J9 | **Cells per frame under a projection.** `cols` is cells across the frame, so a polar map at `cols="120"` samples 120 × 120 = 14,400 cells for a hemisphere where an equirectangular map samples 120 × 60; the cost model in [docs/performance.md §3](performance.md) is per cell | make the trade explicit in the docs (done) and consider a `cells` budget option that picks `cols` from the aspect | S |

The globe keeps its single orthographic projection: it is a physical view, not
a map projection, and the rotation is the point.

## 5. Features and data track

| # | Item | Why | First step | Size |
|---|---|---|---|---|
| F1 | **Regions with identities** (choropleth): a body's `borders()` become named regions (`regions()` → `[{ id, name, rings }]`), and a `region-colors` map fills each. | the stated use case: "a globe with vector countries coloured by a value" | the pinned Natural Earth admin-0 data carries `ISO_A3`, `ADM0_A3` and `NAME`; extend the pack codec with a name per ring group; fill on the flat map first, then the globe once its vector fill exists | L |
| F2 | **More bodies** from public data with the same template: Mercury (MESSENGER MDIS), Venus (Magellan), Titan, Europa, Ganymede. | the seam has survived three bodies; each new one is data plus anchors | one generator per body under `scripts/`, sources pinned by hash as today | S each |
| F3 | **A procedural-world helper**: `noiseWorld({ seed, sea, octaves })` returning a body, for games and fiction. | makes "your own world is a function" a one-liner and demonstrates the seam on something that is not a raster | reuse `noise.js`; ship as an example first, a subpath pack if it earns it | S |
| F4 | **Interaction surface**: `mappo:placeleave` / `mappo:dotleave`, and `onAnimationCycle`. | asked for since v0.3 (`TODO`) | one `mouseout` listener with the same same-group guard; one `animationiteration` listener on a sentinel dot | S |
| F5 | **Accessibility pass**: `aria-label` on every marker is done; add `role="img"` descriptions per body, and keyboard focus order for overlays. | | audit with an assistive-technology checklist | S |
| F6 | **Retire or fold the historical demos** (`v05.html`, `v05b.html`) into the gallery. | demo sprawl noted in the handoff | keep what the gallery does not already show | S |
| F7 | **`mappo/links`: arcs between places** — **done** (0.7.0). Great-circle arcs lifted by a height, spikes with a tip, colour, width, additive blend, depth fade and a `range` for reveal and erase animations, from gazetteer names or coordinates; the globe cuts the far side and grows widths toward its camera, the flat map cuts at its seam. Built on `map.addLayer()`, the canvas-over-the-map seam that shipped with it, so it registers nothing and reaches into no renderer. | every hero globe draws them (Cloudflare, Stripe, GitHub); the GitHub globe demo is the reference build, and the Region: Earth demo's hand-rolled arcs moved onto it, losing forty lines and a canvas | what remains: declarative children (`<mappo-link from to>`) if a page without JS asks for them, and a hit-test index once a page carries thousands | M |

## 6. Packaging track: one package, and the `@mappo` organisation

**Decided 2026-09-02.** mappo is one npm package, `mappo`, with subpath
exports: the core (21.5 KB gzipped, the whole Earth inside) and the opt-in
modules `mappo/globe`, `mappo/projections`, `mappo/vector`,
`mappo/bodies/earth-vector`, `mappo/bodies/moon`, `mappo/bodies/mars` and
`mappo/all`. Each module imports the core by the relative path `./mappo.js`,
which is what lets a page load one from any static host or CDN URL with no
import map and no build step. The measurements and the comparison of shapes are
in [weight.md §5](weight.md); the short version of why not a package per module:

- a module in its own package can only reach the core through a bare specifier
  (`import … from "@mappo/core"`), which browsers reject without an import map
  or a rewriting CDN, so the one-URL story would be lost for every module;
- the modules import about twenty seam helpers from the core, so their versions
  could never move independently — eight packages published in lockstep on
  every release is ceremony, not modularity;
- `npm install mappo` must remain the 21.5 KB core, or the headline is a
  footnote.

The **`@mappo` organisation on npm is registered and deliberately empty.** It
is for things with an owner, a licence or a release cadence of their own —
never for pieces of the library, which stay subpaths of `mappo`. Every
`@mappo/*` package depends on `mappo` and builds on the seam the README
documents under "Extending" (`registerRenderer`, `registerProjection`,
`registerProjectionAdapter`, `registerVector`, `extendBody` and the
exported helpers); a scoped package that needs a new seam export gets it added
to the core first, inside the size budget. Candidates, each with the trigger
that would justify publishing it:

| package | what it is | publish when | size |
|---|---|---|---|
| `@mappo/react`, `@mappo/vue`, `@mappo/svelte` | wrappers: props ↔ attributes, events ↔ callbacks, typed options, SSR-safe registration | the custom element already works in all three; a wrapper is warranted when typing or server rendering needs more than `<mappo-world>` gives | S each |
| `@mappo/regions` | named regions — countries, states — on the shared-arc topology of R8, each with an anchor point, for choropleths and `highlight-polygon` by name | when R8 lands; the analytics demo's `countries.js` (23.5 KB gzipped as rings) is the prototype | M, after R8 |
| `@mappo/earth-50m` | Natural Earth 50m coastline and borders for maps that zoom; four times the vertices of the 110m rings | when a consumer needs more than 110m; it has its own data cadence and is too large to sit beside the core | S, the generator exists |
| `@mappo/cities` | a gazetteer of thousands of places, with population and country, for autocomplete and dense marker maps | when 160 cities stop being enough; a large dataset with its own source and licence | S |
| `@mappo/cli` | `npx @mappo/cli body …`: generate a body pack from a raster or GeoJSON, with the checks the Moon and Mars generators run; carries pngjs and jpeg-js, which the runtime must never | when a third party asks how to make a world; today the answer is "copy `scripts/`" | M |
| `@mappo/body-<world>` | bodies maintained under the organisation beyond Earth, the Moon and Mars — Venus (Magellan), Mercury (MESSENGER), Titan (Cassini), the Galilean moons; community bodies publish unscoped as `mappo-body-<world>` | when the generator has produced one that passes the anchors | S each, once the CLI exists |

What would reopen the question: import maps becoming universal enough that a
bare specifier is as portable as a relative path, or a module gaining a release
cadence of its own. Neither is in sight; until then, simplicity wins.

## Superseded

The local `TODO` file (not tracked) listed the v0.3–v0.5 arcs and a parked
ideas section; everything still relevant from it is in tracks 2, 4 and 5
above (`lonRange` → J5, leave events and animation hooks → F4, region masks →
F1, custom registries → per-body `places`, canvas renderer → P8). The
handoff at `docs/handoff-2026-09-01.md` is the historical record of the
prototype and is not a roadmap.
