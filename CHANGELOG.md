# Changelog

mappo is pre-1.0. Minor versions may change the API; every change is listed
here with what to write instead.

## 0.7.0 — 2026-09-02

The foundation release: mappo is a map of **any world**, not a map of Earth
with a body parameter bolted on. Earth is now one body among others, the
vocabulary is body-neutral, and every body is produced by one pipeline from
pinned public data.

### The core is 21.5 KB gzipped, with the whole Earth inside

The bare import is now the **core**: the flat map, Earth's land mask and
gazetteer, the equirectangular projection. Everything else is an opt-in module
that imports the core by relative path and registers itself:

| import | adds | gzipped |
|---|---|---|
| `mappo` | the core | 21.5 KB (18.5 KB brotli) |
| `mappo/globe` | `mode="globe"` | 8.8 KB |
| `mappo/projections` | Equal Earth, polar stereographic, custom and d3-geo projections | 3.7 KB |
| `mappo/vector` | `figure-source="vector"` and `borders`, for bodies that carry rings | 1.8 KB |
| `mappo/bodies/earth-vector` | Earth's coastline and border rings; implies `mappo/vector` | 22.0 KB |
| `mappo/bodies/moon`, `mappo/bodies/mars` | as before | 9.5 KB, 6.9 KB |
| `mappo/all` | everything but the Moon and Mars, one self-contained file | 55.8 KB |

- **Breaking:** a page that uses `mode="globe"`, a projection other than
  equirectangular, `figure-source="vector"` or `borders` imports the module
  for it. Without it the map **waits**: it draws nothing (grid contours, for
  the vector features), warns once after two seconds if the module never
  arrives, and draws the moment the module registers — the rule body packs
  already followed. Order does not matter. `map.pending` says what a map waits
  for; `map.refresh()` redraws from scratch.
- **Breaking:** `dist/` is built by esbuild, minified, with source maps; the
  commented source stays in `src/`. `dist/mappo.js` was 98 KB gzipped with
  everything in it.
- The land mask is stored as run lengths (Earth: 3.6 KB of text from 21 KB of
  base64, 2.3 KB gzipped from 3.5) and the gazetteer as one string; every pack
  regenerates from the one codec, so the Moon pack is 9.5 KB gzipped from 11
  and Mars 6.9 from 8.4.
- New in the core, the seam the modules stand on: `registerRenderer`,
  `knownRenderers`, `registerProjection`, `registerProjectionAdapter`,
  `registerVector`, `extendBody`, and the helpers listed in README
  "Extending". The build refuses a module that imports anything the core does
  not export.
- The test suite holds the headline: `dist/mappo.js` over 22 KB gzipped, a
  module importing beyond the seam, or a source file bundled twice fails it.
- From a CDN, load the core by the same full, pinned URL the modules resolve
  (`…/mappo@0.7.0/dist/mappo.js` beside `…/dist/globe.js`), or use `all.js`:
  a browser keys modules by URL, and a core reached through the short
  redirecting URL would be a second core with its own registries. Rails import
  maps pin one file, since asset digests break a module's relative import; the
  body packs import nothing and pin on their own.

### Overlays: the visibility decisions

- `overlay-horizon="appear vanish"`: the globe marks an overlay
  `data-mappo-behind` once its facing falls under `vanish` and unmarks it only
  above `appear`, so a pin near the limb cannot flicker. The default, `0 0`,
  is the horizon itself, as before.
- `overlay-still="<deg/s>"`: while the globe's smoothed spin exceeds it, every
  overlay carries `data-mappo-moving`, so labels can hide during a flick and
  return as it settles. Off unless set. Both options are paint-tier on the
  globe and ignored by the flat map.
- `locate().depth` is the facing under a perspective camera — the number
  `--mappo-depth` publishes — where it was the raw depth. The Region: Earth
  demo lost its own facing formula, hysteresis and speed estimate to these.
- `resolveProjection` with a name nobody has registered still throws; the
  renderer asks `hasProjection()` first and waits instead.

### Breaking: the vocabulary is figure and ground

Every map draws a **figure** on a **ground**. On Earth the figure is land and
the ground is ocean; on the Moon, maria on highlands; on Mars, lowlands on
highlands. The options say so:

| before | now |
|---|---|
| `land="dots\|solid\|outline\|solid outline"` | `figure="…"` |
| `land-color`, `dot-color` (two knobs for one colour) | `figure-color` |
| `land-stroke`, `land-stroke-width` | `figure-stroke`, `figure-stroke-width` |
| `land-source="grid\|vector"` | `figure-source="grid\|vector"` |
| `ocean-color` | `ground-color` |
| `cities="London, Lagos"` | `places="London, Lagos"` |
| `markers` (separate option) | `markers` attribute still exists; the option is `places` |
| `onCityClick`, `onCityEnter`, `mappo:cityclick`, `mappo:cityenter` | `onPlaceClick`, `onPlaceEnter`, `mappo:placeclick`, `mappo:placeenter` |
| `data-city` on markers | `data-place` (plus `data-kind` when the gazetteer has one) |
| `.mappo-land`, `.mappo-land-path`, `.mappo-land-highlight`, `.mappo-ocean` | `.mappo-figure`, `.mappo-figure-fill` + `.mappo-figure-edge`, `.mappo-figure-highlight`, `.mappo-ground` |

Figure colours (`figure-color`, `figure-stroke`, `figure-stroke-width`,
`borders-*`, `highlight-color`) are now stylesheet-tier: changing one never
rebuilds geometry.

### Projections

The flat map has a projection. Four ship, selected with
`projection="equirectangular | equal-earth | stereographic-north | stereographic-south"`
(the option `projection` also accepts a `{ forward, inverse, aspect, outline? }`
object or a d3-geo projection), and `center-lon` sets the central meridian.
Everything is one code path: dots are sampled at the inverse projection of
each screen cell, and markers, overlays, `locate()`, `projectNormalized`,
borders, highlights and the graticule use the forward mapping. Exported:
`resolveProjection`, `knownProjections`; on an instance, `map.projection`.

- **Polar maps read `lat-min`/`lat-max` as the band shown**: the far bound is
  the rim of the disc. Unset, a polar map shows its hemisphere rather than the
  body's default framing.
- **Vector outlines are stitched** back into whole rings once per body and cut
  at the current projection's seam. The globe no longer draws the packs'
  closure edges along the 180° meridian as coastline (a visible line along 180°
  across Chukotka, Wrangel Island and Antarctica before). Fills get closed
  pieces, the edge stroke gets open arcs, so no seam is ever stroked. Curved
  cylindrical seams follow sampled boundary points rather than one straight
  fill chord; graticules meet shifted seams at the exact frame boundary.
- **The graticule draws on the flat map** too: `.mappo-graticule` and
  `.mappo-equator` inside `.mappo-graticule-group`, clipped to the world.
- **Breaking:** `.mappo-figure-path` is now two paths, `.mappo-figure-fill` and
  `.mappo-figure-edge` (plus `.mappo-figure-complement` for a ring that
  encloses the far pole of a polar map). `.mappo-bg` is a `<path>` in the
  shape of the world, not a `<rect>`, and everything is clipped to it.
- **Breaking:** `projectNormalized`, `locate()`, `project`, `cellCenter` and
  `snapToFigure` return `null` for a point or cell with no place on the map: a
  latitude outside the band, the far hemisphere of a polar map, the corner of
  an Equal Earth frame. Before, an out-of-band latitude produced coordinates
  outside 0…1 and a marker for it was clamped to the edge row. Places off the
  map are not drawn; overlays are parked off-screen with `data-mappo-behind`.
- An unknown projection name throws a `RangeError`; so does a polar map whose
  rim would be the opposite pole. A rejected `update()` changes nothing.
- `projection` and `center-lon` are geometry-tier for the flat map and ignored
  by the globe, which is a physical view rather than a map projection.
- Custom projection aspects, outlines and coordinates are validated; their
  default ±180° seam is cut without a chord, and incomplete no-seam vectors
  fall back to screen-grid contours. Fresh projection objects compare by
  identity rather than JSON that silently discards their functions.
- d3 projections use `projection.stream`, so rotation, antimeridian and
  small-circle clipping, Cartesian clipping, interrupted outlines and adaptive
  resampling match d3 itself. The streamed world is the frame instead of a
  sampled rectangle. Mutable d3 state invalidates Mappo's geometry cache.
- Projection latitude ranges cannot leave the physical `[-90, 90]` domain;
  custom aspects must be positive and finite. Dots are clipped to curved
  frames, and snapped markers can no longer land in an off-world corner cell.
- Globe framing no longer inherits a polar flat-map hemisphere. An invalid
  flat projection option is ignored while the map is a globe and validated
  atomically if it switches to flat mode.
- The current bundle is 100 KB gzipped, from 81 KB before this release's
  projection and globe-camera work. Moon and Mars remain separate 11 KB and
  8.5 KB body packs.

### The globe: a camera, fog, a lattice and tiles

Five opt-in options; the defaults draw exactly what they drew.

- `distance` — a perspective camera that many body radii from the centre
  (`Infinity`, the default, is the orthographic view). The limb stays on the
  disc; the near side grows and the far side shrinks.
- `fog="near far"` — depth fade in radii from the centre plane, positive away
  from the viewer. Set, the globe is glass: the far hemisphere is drawn too and
  everything fades from opaque at `near` to gone at `far`, as one minus a
  smoothstep (the curve a WebGL fog blends with), used as alpha directly.
- `fog-color` — the fog's colour. Unset, the fog fades to transparent; set,
  everything in it is drawn in its own colour mixed toward this one at full
  alpha, as a WebGL fog blends: a dark fog darkens the far side on a light page
  rather than paling it.
- `distribution="uniform"` — dots on a Fibonacci lattice, equal area per dot,
  `round(cols²/π)` candidates so `cols` keeps its meaning at the equator.
- `dot-shape="tile"` — squares lying on the surface, foreshortening into
  slivers along the limb; a square on the flat map.
- `graticule-width` — line width on the globe in CSS px (a multiplier of the
  flat hairline).
- `locate()` also returns `z` (depth toward the viewer, in radii) and `fade`
  (the alpha the globe draws at that depth).
- For renderers of your own, `src/globe.js` exports `forEachSample`,
  `uniformCount` and `buildGlobeTiles`; `buildGlobePoints`, `buildGlobeFlags`
  and `buildGlobePhases` take a trailing `distribution`.

`demo/region-earth.html` is why these exist: cloudflare.com's "Region: Earth"
section rebuilt on mappo, to the pixel where mappo can reach it.

### Fixed: the globe

- A parked globe (`rotate-speed="0"`, no animation, no pointer) redrew at
  60 fps for nothing. The loop draws only when something moved; an option
  change draws exactly one frame.
- The globe sized its canvas from its bounding box, so an ancestor's transform
  (a section scaling in as it appears) shrank the backing store and moved
  every `locate()` answer. It sizes from layout now.
- Every alpha-banded batch (fills, strokes) uses 24 bands instead of 6–7, so a
  depth fade reads as a gradient.

### Breaking: the body interface

```js
{
  id, name, radiusKm, latRange,
  terms: { figure: "land", ground: "ocean" },   // was { inside, outside }
  figure(lat, lon),                              // was contains(lat, lon) / isLand
  outlines(),                                    // was rings(source)
  borders(),
  places: [{ name, lat, lon, kind? }]            // NEW: the body's gazetteer
}
```

- `registerBody(body)` also defines `<mappo-{id}>`. `defineBodyElement(tag, body)`
  remains for a tag name of your own and accepts a body object.
- A `body` name that is not registered yet draws **nothing** and adopts the
  body when `registerBody()` runs. It no longer draws Earth in the meantime,
  and a name that never registers warns after two seconds.
- Body ids are validated (`^[a-z][a-z0-9-]*$`); lookups still fold case and
  whitespace.
- `MOON_SITES` and `MARS_SITES` are gone: use `MOON.places` and `MARS.places`.

### Breaking: public exports

Earth-specific modules are gone from the API; Earth is a body like the others.

| before | now |
|---|---|
| `isLand(lat, lon)`, `MASK_W`, `MASK_H` | `EARTH.figure(lat, lon)` |
| `landShapes()`, `countryShapes()` | `EARTH.outlines()`, `EARTH.borders()` |
| `CITIES`, `resolveCity(entry)` | `EARTH.places`, `resolvePlace(entry, body)` |
| `buildLand(grid)` (Earth implied) | `buildFigure(grid, { body })` — the body is required |
| `parseLandStyle` | `parseFigureStyle` |
| `snapToLand(lat, lon, grid)` | `snapToFigure(lat, lon, grid, body)` — the body is required |
| `landRings`, `borderRings` | removed; ask the body |
| `projectNormalized(lat, lon)` defaulting to Earth's framing | `latRange` is required |
| `DEFAULTS.latRange` | removed; framing comes from the body (`EARTH.latRange`) |
| new | `onBodyRegistered(fn)`, `map.body` |

### Fixed

- Two maps on one page shared SVG ids, so every later map used the FIRST
  map's dot shape and size. Every id now carries the instance id.
- Overlay children (`data-lat`/`data-lon`) were lost when switching the globe
  back to flat, and when an element was moved or re-connected in the DOM.
  Mappo now owns them and hands them back untouched on `destroy()`.
- Any attribute change on a globe with `focus` set snapped the rotation back
  to the focus longitude (the element re-parsed a fresh object every time).
  Options now compare structurally.
- The globe re-projected every figure cell corner with trigonometry every
  frame; corners, contours and vector outlines are now precomputed
  unit-sphere coordinates in typed arrays, and a frame only rotates them.
- Grid-contour strokes on the globe took the alpha of their last vertex; they
  are now depth-banded like every other line.

### Data and tooling

- Earth, the Moon and Mars are all generated by one template
  (`scripts/lib/pack.js`) from one codec (`scripts/lib/codec.js`), whose
  decoder is embedded verbatim in every pack.
- Every source is pinned by URL and SHA-256: Natural Earth at a fixed commit,
  the Clementine and MOLA rasters by hash. The Earth mask regenerates
  bit-for-bit.
- Generators read PNG and JPEG directly (`pngjs`, `jpeg-js` as dev
  dependencies); no macOS-only `sips` step.
- The renderer's contour tracer (`traceCells`) is shared with the generators.
- Gazetteers live in `scripts/data/*-places.js`.

### Development

- Node ≥ 22.22 (`devEngines`, `.nvmrc`), CI on Node 22 and 24. The DOM tests
  (jsdom) silently failed to load on older Node; they now fail with a message.

## 0.6.0

`locate()`, the Moon and Mars body packs (prototype), `<mappo-earth>`.

## 0.5.0

Figure styles, vector coastlines and borders, graticule, roll, CSS variable
colours, overlays, `projectNormalized`.
