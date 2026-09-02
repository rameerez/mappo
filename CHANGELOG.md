# Changelog

mappo is pre-1.0. Minor versions may change the API; every change is listed
here with what to write instead.

## 0.7.0 — 2026-09-02

The foundation release: mappo is a map of **any world**, not a map of Earth
with a body parameter bolted on. Earth is now one body among others, the
vocabulary is body-neutral, and every body is produced by one pipeline from
pinned public data.

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
  across Chukotka, Wrangel Island and Antarctica before). Fills get closed pieces, the edge
  stroke gets open arcs, so no seam is ever stroked.
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
- The bundle is 91 KB gzipped, from 81 KB: the projection module and the
  seam-aware outline geometry are the difference.

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
