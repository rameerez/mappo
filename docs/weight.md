# Where the weight is, and how small mappo can be to embed

Measured on the working tree of 2026-09-02 (0.7.0 with the projection, glass
globe and d3 stream-adapter work), Node 22.22, esbuild 0.25.5 for the minified
figures, `gzip -9` and brotli quality 11. The script that produced every
number is `scripts/weight.mjs` (see section 9); rerun it after any change.

## 0. What shipped

The analysis below was written against the single 98 KB bundle; this is what
the restructure it recommended produced, measured on the built `dist/`
(`npm run build` prints the same table):

| file | raw | gzip | brotli | what it is |
|---|---|---|---|---|
| `dist/mappo.js` | 56.7 KB | **22.2 KB** | 19.2 KB | the core: engine, Earth's mask and gazetteer, equirectangular, layers |
| `dist/globe.js` | 25.6 KB | 10.2 KB | 9.1 KB | `mode="globe"`, with the camera, the fog and the overlay decisions |
| `dist/projections.js` | 8.4 KB | 3.7 KB | 3.3 KB | Equal Earth, polar stereographic, custom and d3-geo adapters |
| `dist/vector.js` | 3.6 KB | 1.8 KB | 1.6 KB | seam stitching and cutting for vector outlines |
| `dist/links.js` | 7.6 KB | 3.6 KB | 3.3 KB | arcs between places and spikes at them, over either renderer |
| `dist/bodies/earth-vector.js` | 38.8 KB | 22.0 KB | 19.3 KB | Earth's coastline and border rings |
| `dist/bodies/moon.js` | 19.3 KB | 9.5 KB | 8.3 KB | the Moon pack |
| `dist/bodies/mars.js` | 10.7 KB | 6.9 KB | 6.0 KB | the Mars pack |
| `dist/all.js` | 138.7 KB | 60.7 KB | 52.3 KB | everything but the Moon and Mars, self-contained |

Beyond the split and the minifier, two encodings changed: the mask is stored
as run lengths (Earth's 16 KB of bits became 3.6 KB of text, 2.3 KB gzipped,
from 3.5 KB as base64) and the gazetteer as one string. The remaining
candidates in section 7 — a shared-arc topology for the borders, a coarser
coastline tolerance — are still open. `test/package.test.js` fails when the
core exceeds 22.5 KB gzipped.

## 1. Summary

| what a page downloads today | raw | gzip | brotli |
|---|---|---|---|
| `dist/mappo.js` as published (unminified, commented) | 275.2 KB | 98.0 KB | 81.3 KB |
| the same file minified | 140.5 KB | 55.1 KB | 47.5 KB |
| `dist/bodies/moon.js` | 39.9 KB | 11.0 KB | 9.5 KB |
| `dist/bodies/mars.js` | 32.0 KB | 8.4 KB | 7.1 KB |

Three facts decide everything below.

1. **Not minifying costs 43 KB gzipped.** The sources are 30% comments by
   bytes (80 KB of 276 KB) and the build concatenates them verbatim, so the
   documentation the code is written with is shipped to every visitor.
   Minifying the dist and nothing else takes the bundle from 98 KB to 55 KB
   gzipped. The comments stay in `src/`, where they belong.
2. **Earth's vector data is 39% of the minified bundle and most pages never
   use it.** The default figure is dots, which sample the 512×256 mask
   (3.5 KB gzipped). The coastline rings (8.9 KB) and the country borders
   (17.2 KB) are read only by `figure-source="vector"` and `borders`.
3. **The globe and the projections are each a separable tenth.** The canvas
   renderer is 8.4 KB gzipped minified; Equal Earth, the polar projections,
   the d3 adapter and the seam machinery are 5.6 KB. A flat hero section pays
   for both.

What a hero section could download, minified (section 5 explains the cuts):

| entry point | raw | gzip | brotli |
|---|---|---|---|
| core engine + Earth mask and gazetteer (flat, dots, equirectangular) | 66.2 KB | 19.6 KB | 17.1 KB |
| + the other projections (Equal Earth, polar, d3 adapter) | 80.6 KB | 24.8 KB | 21.7 KB |
| + the globe | 102.0 KB | 32.4 KB | 28.2 KB |
| + Earth's coastline and border rings (= everything, today's content) | 140.1 KB | 54.6 KB | 47.1 KB |

The embedding case goes from 98 KB to about 20 KB gzipped, a factor of five,
without removing a feature: everything stays available, as something a page
asks for.

## 2. Method

Per-module weight is measured three ways, because they answer different
questions: the module gzipped alone (its own entropy), its *marginal* gzip
cost inside the bundle (what removing it would save, since shared vocabulary
compresses across modules), and the module minified then gzipped (what a real
build would ship). The marginal costs sum to the bundle within 0.2 KB.

| module | raw | comments stripped | gzip alone | marginal gzip in bundle | brotli alone |
|---|---|---|---|---|---|
| bodies/earth.js | 69.9 KB | 69.1 KB | 29.4 KB | 30.8 KB | 25.0 KB |
| renderer.js | 64.8 KB | 39.7 KB | 22.2 KB | 21.2 KB | 19.0 KB |
| globe.js | 63.8 KB | 37.8 KB | 21.0 KB | 20.2 KB | 18.1 KB |
| projections.js | 36.2 KB | 27.1 KB | 11.7 KB | 11.7 KB | 10.3 KB |
| element.js | 10.8 KB | 6.2 KB | 4.0 KB | 3.5 KB | 3.4 KB |
| body.js | 10.9 KB | 6.4 KB | 4.1 KB | 3.5 KB | 3.4 KB |
| figure.js | 6.6 KB | 2.9 KB | 2.8 KB | 2.2 KB | 2.4 KB |
| projection.js | 4.5 KB | 2.2 KB | 1.8 KB | 1.4 KB | 1.6 KB |
| color.js, graticule.js, noise.js, highlight.js, index.js | 8.9 KB | 4.2 KB | 4.6 KB | 3.3 KB | 3.8 KB |
| **all** | **276.3 KB** | **195.6 KB** | | **98.2 KB** | |

Minified groups (esbuild, ESM, then compressed):

| group | minified | gzip | brotli |
|---|---|---|---|
| core: element, renderer, body, figure, projection, highlight, noise, color, graticule | 38.3 KB | 12.9 KB | 11.6 KB |
| projections.js | 14.4 KB | 5.6 KB | 5.1 KB |
| globe.js | 21.5 KB | 8.4 KB | 7.5 KB |
| bodies/earth.js, whole | 65.9 KB | 28.3 KB | 24.3 KB |
| bodies/earth.js with outlines and borders removed | 27.8 KB | 6.4 KB | 5.5 KB |
| outlines + borders as their own module | 38.1 KB | 21.3 KB | 18.9 KB |

## 3. The Earth pack, item by item

| literal | raw | gzip | brotli | who reads it |
|---|---|---|---|---|
| `BITS`, the 512×256 land mask, base64 | 21.3 KB | 3.5 KB | 3.1 KB | every dot, every grid contour, marker snapping |
| `OUTLINES`, 119 coastline rings, 4,156 segments | 12.9 KB | 8.9 KB | 8.1 KB | `figure-source="vector"` |
| `BORDERS`, 277 country rings, 8,080 segments | 25.1 KB | 17.2 KB | 15.7 KB | `borders` |
| `places`, 160 cities | 7.8 KB | 2.0 KB | 1.7 KB | `places="London"` |
| codec and body object | ~3 KB | ~0.8 KB | | everything |

The mask is cheap because a bitmask of continents is mostly runs; base64
costs a third on the wire but nothing after compression (2.7 KB as raw bytes,
3.5 KB as base64). The rings are expensive because they are already dense:
delta-varint text compresses to 69% of itself, so there is no encoding trick
left at that layer. The savings are structural:

- **The borders store every shared boundary twice.** 1,909 of the 8,080 border
  segments (24%) are the second copy of a boundary two countries share. A
  shared-arc topology, as TopoJSON stores it, keeps 6,171 unique segments,
  76% of today's geometry, before any simplification change.
- **The borders repeat the coastline.** 3,498 border segments (43%) coincide
  vertex for vertex with a segment in `OUTLINES`. A topology shared between
  the land rings and the country rings stores those once too.
- **Regions are free on a topology and expensive without one.** The analytics
  demo's `demo/countries.js`, every country as its own fillable ring keyed by
  ISO code, is 23.5 KB gzipped, because rings duplicate what the borders
  already carry. On shared arcs, a region is a list of arc indices: a few
  kilobytes for all of them. The generator's own header proposes moving
  regions into the Earth pack; on rings that would add 23 KB to every page,
  on arcs it is the same data the borders already are.

## 4. The engine

The core is 12.9 KB gzipped minified and none of it is fat: the renderer's
CSS template with its five animation modes is about 1.5 KB, the differential
update, the overlay bookkeeping and the SVG markup builders are the rest. The
globe's 8.4 KB is the canvas renderer plus, since the glass-globe work, a
perspective camera, fog, a Fibonacci lattice and tangent tiles. The
projections' 5.6 KB divide roughly into Equal Earth and polar stereographic
(1.5 KB), the d3 stream adapter (1.5 KB), and the seam machinery, stitching
and cutting (2 KB), which every vector outline on any body needs and so
belongs with the core.

Every body pack embeds its own copy of the ring decoder and mask sampler
(about 0.5 KB gzipped each). That is deliberate: a pack imports nothing, so it
can be served from any URL. Not worth revisiting.

## 5. Modularity: three shapes, one recommendation

The goal is a base that is small for a landing page while nothing is lost for
a dashboard or a mission planner. Three ways to get there:

| | A. minify only | B. one package, several entry points | C. an `@mappo/*` npm organisation |
|---|---|---|---|
| hero page, flat dots | 55 KB gz | ~20 KB gz | ~20 KB gz |
| one CDN URL that does everything | yes, 55 KB | yes: `mappo` stays the all-in-one; `mappo/core` is the diet | yes via an umbrella package, plus N package URLs |
| Rails importmap | one pin | one pin per entry used, chunks resolve relatively | one pin per package |
| tree-shaking with a bundler | partial (side-effect module) | by entry point | by package |
| versioning | one | one version, one changelog, one test suite | N versions, a compatibility matrix, peer dependencies |
| release work | one publish | one publish | N publishes per release, workspaces, cross-package tests |
| third-party bodies | `npm i some-body` | same | cannot publish into your scope anyway |
| what it costs to build | a devDependency | a devDependency and two small registries (section 6) | the same plus a monorepo |

**Recommendation: B, with the `@mappo` scope reserved now and left empty.**
*Taken, 2026-09-02: B shipped (section 0), the scope is registered, and the
policy for what may ever be published under it is [roadmap §6](roadmap.md).*

The size win is entirely in the entry points and the minifier; separate npm
packages add release mechanics and a version matrix without shaving a byte.
An organisation earns its keep when things have different owners or release
cadences: framework wrappers (`@mappo/react`, `@mappo/vue`), large optional
datasets (a 50m Earth, named regions with attributes), community bodies. None
of those exist yet. Registering the scope is free and prevents squatting;
publishing into it can wait for the first thing that needs its own cadence.

Within B, the question is what the bare `mappo` import means. Two phases:

1. **Now.** `mappo` keeps meaning everything (55 KB gzipped once minified), so
   the README one-liner and every existing page keep working. `mappo/core`,
   `mappo/globe`, `mappo/projections` and `mappo/bodies/earth-vector` exist
   for anyone who wants the diet, and bundler users get it by import.
2. **Once the registries exist.** `mappo` becomes the core, and the globe,
   the projections and the vector data arrive as chunks the core `import()`s
   the first time a page asks for them. One URL, 20 KB up front, the rest on
   demand, and a `<mappo-world mode="globe">` draws nothing for the frames the
   chunk takes to arrive, exactly as a map waiting for a body pack does today.
   Static entry points remain for anyone who wants to preload.

## 6. The seams the split needs

These are engine changes, not data changes, and all are small.

- **A renderer registry.** `renderer.js` imports `GlobeRenderer` statically.
  Replace it with `registerRenderer("globe", GlobeRenderer)`; a `mode` with
  no renderer registered is *pending*, drawn as nothing with one warning, and
  picked up when the module registers, on the `LIVE` set `body.js` already
  keeps for late packs. `mappo/globe` is that call plus the class.
- **A projection registry.** `BUILTINS` in `projections.js` becomes
  `registerProjection(id, spec)`; the core registers equirectangular and keeps
  the seam machinery; `mappo/projections` registers Equal Earth, the polar
  pair and the d3 adapter. `knownProjections()` answers what is loaded.
- **Body data that arrives later.** A body's `outlines()` and `borders()`
  already answer `null` for a body without them and the renderers already
  fall back to grid contours. `extendBody("earth", { outlines, borders })`
  attaches the rings to the registered body and re-renders live maps that
  use them. The body interface stays synchronous; the wait is the documented
  fallback, not a new state. `mappo/bodies/earth-vector` is one such call.
- **A real build.** esbuild as a devDependency: several entry points, ESM
  output, `splitting` so the shared engine is one chunk, `minify`, source
  maps. This retires the hand-rolled concatenation in `scripts/build.js` and
  its top-level-name collision check, which esbuild makes unnecessary. Body
  packs remain standalone files that import nothing. The unminified,
  commented source stays readable in `src/` and through the source maps.
- **`package.json` exports**, the single source of truth the build reads:

  ```
  "."                       everything (phase 1) → the core with lazy chunks (phase 2)
  "./core"                  engine + Earth mask and gazetteer, equirectangular
  "./globe"                 the canvas renderer, self-registering
  "./projections"           Equal Earth, polar stereographic, the d3 adapter
  "./bodies/earth-vector"   Earth's coastline and border rings
  "./bodies/moon"           as today
  "./bodies/mars"           as today
  ```

- **Docs and tests.** The README's Install section shows both the one-liner
  and the diet; `test/package.test.js` asserts the export surface of every
  entry point; `docs/performance.md` gets the wire weights per entry point.

Chunks load from relative URLs, which unpkg, jsDelivr and esm.sh all serve;
self-hosting means vendoring the `dist/` directory rather than one file,
which the Rails note in the README should say.

## 7. Data-side reductions, independent of packaging

| change | saves | risk |
|---|---|---|
| minify `dist/` | 43 KB gzipped | none; source maps for debugging |
| Earth vector rings as an opt-in module | 21 KB gzipped off the default page | none; grid contours are the fallback already |
| borders (and later regions) on a shared-arc topology | at least 24% of border bytes, more when coastline arcs are shared with the outlines; regions become nearly free | a new encoder and decoder in `scripts/lib/codec.js`, tested like the current one |
| coastline simplification tolerance 0.08° → 0.12° | roughly a quarter of the outline points | needs a side-by-side visual check at `cols="260"` and on the globe |
| the mask | keep 512×256: 3.5 KB gzipped is the cheapest thing in the file | |
| the gazetteer | keep: 2 KB gzipped is the zero-JS `places="…"` story | |

## 8. Sequencing and what to watch

Another agent is mid-edit in `src/` (the glass globe, the d3 stream adapter)
with one test still failing in that work, so the build and registry changes
should land after theirs, not beside them. Order: the esbuild build with
minification and today's single entry (mechanical, no API change), then the
three registries and the entry points, then the phase-2 flip of the bare
import once lazy chunks are verified in the demos, on a CDN URL and behind a
Rails importmap. Each step is a release note in the CHANGELOG and a row in
this document's tables.

## 9. Reproducing the numbers

`scripts/weight.mjs` reads the module list from the build, reports raw,
comment-stripped, gzip, marginal-gzip and brotli sizes per module, measures
the Earth literals separately, and, when esbuild is reachable through `npx`,
the minified sizes of the groups above. Run `node scripts/weight.mjs` after
any change that touches `src/` or the packs, and paste the tables here.

## Sources

- esbuild, *Code splitting*: https://esbuild.github.io/api/#splitting
- Node.js, *Subpath exports*: https://nodejs.org/api/packages.html#subpath-exports
- npm, *About scopes*: https://docs.npmjs.com/about-scopes
- TopoJSON specification (shared arcs): https://github.com/topojson/topojson-specification
- Natural Earth 110m, the source of the Earth rings: https://www.naturalearthdata.com/
