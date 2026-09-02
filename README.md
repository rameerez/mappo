<p align="center">
  <img src="assets/mappo-logo.webp" alt="mappo" width="440">
</p>

# mappo

**Maps of any world as a zero-dependency web component.** A dot field or
vector outlines, flat SVG or a rotating canvas globe, places by name, your own
HTML positioned on the sphere. Earth ships in the file; the Moon and Mars are
opt-in packs; a world of your own is a function. One ES module, no build step,
no dependencies.

```html
<script type="module" src="https://unpkg.com/mappo"></script>

<mappo-world places="London, Lagos, Singapore" tilt="40"></mappo-world>
```

That's the whole integration.

```html
<mappo-moon mode="globe" figure="outline" figure-source="vector"
            places="Apollo 11, Shackleton"></mappo-moon>
```

That's another world.

## Why this exists

Every SaaS hero section eventually wants the dotted world with glowing city
markers. The usual path is a designer's frozen SVG: thousands of hardcoded
rectangles, cities placed by eye, one resolution forever. mappo derives the
dots from a ~22 KB packed bitmask instead — so resolution, dot shape, framing
and markers are all runtime parameters, and "add Nairobi" is typing `Nairobi`.

Then it turned out that nothing in that engine was about the Earth. A map asks
its *body* one question — is this latitude and longitude part of the
**figure** or the **ground**? — and draws the answer. On Earth the figure is
land and the ground is ocean; on the Moon, maria on highlands; on Mars, the
northern lowlands on the southern highlands; on the planet in your game,
whatever you say. Same options, same renderers, same events.

## Install

```bash
npm install mappo
```

Or skip npm entirely — it's one file:

```html
<script type="module" src="https://unpkg.com/mappo"></script>
```

Rails with importmaps:

```ruby
# config/importmap.rb
pin "mappo", to: "mappo.js"                       # vendor dist/mappo.js
pin "mappo/bodies/moon", to: "mappo/bodies/moon.js" # optional packs
```

Node ≥ 22.22 is needed only to *develop* mappo (see Development); the
published package is browser ESM with no runtime requirement beyond a modern
browser.

## The element

```html
<mappo-world
  places="London, Lagos, Singapore, New York"
  cols="140"
  dot-shape="circle"
  figure-color="#d3dce6"
  marker-color="#2262fe"
  marker-pulse="true"   <!-- animations are opt-in; default is a calm, static map -->
  tilt="40"
  animation="wave"
></mappo-world>
```

Attributes are live — change one, the map re-renders. Interaction bubbles as
DOM events:

```js
map.addEventListener("mappo:placeclick", (e) => {
  console.log(e.detail.name, e.detail.lat, e.detail.lon, e.detail.kind);
});
// also: mappo:placeenter, :dotclick, :dotenter
```

## Figure and ground

Every mappo map is a **figure** drawn on a **ground**. That is the entire
vocabulary, and it is the same on every body:

| | figure | ground |
|---|---|---|
| Earth | land | ocean |
| Moon | maria | highlands |
| Mars | lowlands | highlands |
| your world | whatever `figure(lat, lon)` says | the rest |

Every option that styles the figure starts with `figure-`; the ground has
`ground-color`.

```html
<mappo-world figure="dots"></mappo-world>           <!-- the dot field (default) -->
<mappo-world figure="solid"></mappo-world>          <!-- filled -->
<mappo-world figure="outline"></mappo-world>        <!-- the edge only -->
<mappo-world figure="solid outline"></mappo-world>  <!-- filled, edge on top -->
```

`figure` is a space-separated token list, so combinations read the way you
would say them. `filled` and `stroke` are accepted as synonyms; order and case
do not matter.

| Option | Default | What it paints |
|---|---|---|
| `figure-color` | `#d3dce6` | the figure — the dots, or the fill |
| `figure-stroke` | `figure-color` | the edge (the coastline, on Earth) |
| `figure-stroke-width` | `1` | edge weight |
| `ground-color` | `none` | everything that is not figure, as smaller filler dots |
| `background` | `none` | a uniform fill behind everything: the rect on a flat map, the disc on a globe |

All colours accept `var(--x)` (see *Colours from CSS variables*). Figure
colours are stylesheet-tier: changing one rewrites one `<style>` element and
never touches geometry.

### Two levels of detail: `figure-source`

```html
<mappo-world figure="outline"></mappo-world>                        <!-- grid (default) -->
<mappo-world figure="outline" figure-source="vector"></mappo-world> <!-- the body's outlines -->
<mappo-world figure="solid" figure-source="vector" borders></mappo-world>
```

| Source | What it is | Cost |
|---|---|---|
| `grid` | contours traced from the body's `figure()` on the dot grid — blocky by design, follows `cols` | free |
| `vector` | the body's own outlines (Natural Earth 110m on Earth), quantised to 1/32° — smooth at any size, independent of `cols` | ~13 KB on Earth |

A body without outlines silently falls back to the grid, so the option is
always safe to set.

`borders` adds the body's region boundaries — national borders on Earth (~25
KB, vector only: a 512×256 raster cannot express a border that follows a
river) — with `borders-color`, `borders-width` and `borders-opacity`. Both
datasets are decoded lazily: a map that never asks for them pays the bytes,
never the parse.

### One geometry, not three renderers

`solid`, `outline` and `solid outline` are three renderings of a **single**
geometry — the closed boundary contours traced once in `figure.js` and
exported as `buildFigure(grid, { body })`. An outline traced from per-cell
rectangles strokes every internal cell edge and draws a wireframe; a contour
is only ever drawn where figure meets ground, so the coast is a coast. The
rings are closed and consistently wound (outer clockwise, holes
counter-clockwise), so the same path data also fills correctly with inland
seas left empty — no second code path, nothing to drift.

On the globe a vector outline is exact, but a *filled* figure deliberately
uses the grid. Filling a spherical polygon correctly requires clipping it to
the visible hemisphere; filling the whole ring mirrors the far side onto the
near side, while dropping hidden points closes the remainder with a false
chord. Per-cell quads project and cull individually and cannot fail that way.
Use `figure="outline" figure-source="vector"` for the crispest globe edge;
flat maps use vector geometry for both fill and edge.

```js
import { buildFigure, EARTH } from "mappo";
const { cells, loops } = buildFigure({ cols: 120, rows: 47, latRange: [-58, 84] }, { body: EARTH });
// loops: closed rings in grid-corner coordinates — yours to project or stroke
```

## Bodies

Earth is in the bundle because a world map is what most people came for.
Everything else is a separate file you ask for by name, so an ordinary world
map never downloads it:

```js
import { registerBody } from "mappo";
import { MOON } from "mappo/bodies/moon";   // ~11 KB gzipped
import { MARS } from "mappo/bodies/mars";   // ~8 KB gzipped

registerBody(MOON);   // <mappo-moon> now exists, and so does body="moon"
registerBody(MARS);
```

```html
<mappo-world body="moon" figure="solid outline" figure-source="vector"></mappo-world>
<mappo-mars figure="outline" figure-source="vector" places="Curiosity, Perseverance"></mappo-mars>
<mappo-earth></mappo-earth>   <!-- ships with the bundle -->
```

**Order does not matter.** mappo defines its elements as it loads, which
upgrades every `<mappo-world body="moon">` on the page before your own first
line has run — so a pack always arrives late. A map that asks for a body by
name before its pack has registered draws **nothing** (not Earth: drawing the
wrong planet for a frame would be worse than drawing none, and a typo in
`body=""` should look broken rather than look like Earth). It adopts the body
the moment `registerBody()` runs. A name that never registers warns after two
seconds.

The tag is a default, the attribute is the truth: `<mappo-moon body="mars">`
is a strange thing to write, but it means Mars.

### Your own world

A body is a small object:

```js
import { registerBody } from "mappo";

registerBody({
  id: "arrakis",                                   // ^[a-z][a-z0-9-]*$; also names <mappo-arrakis>
  name: "Arrakis",
  radiusKm: 6100,                                  // optional; scales locate()'s orbit argument
  latRange: [-90, 90],                             // optional default framing
  terms: { figure: "rock", ground: "sand" },       // optional; used in the accessible label
  figure(lat, lon) {                               // REQUIRED: the classification
    return noise(lat / 12, lon / 12) > 0.35;
  },
  outlines: () => null,                            // optional: closed [lat, lon] rings for figure-source="vector"
  borders: () => null,                             // optional: closed [lat, lon] rings of regions
  places: [{ name: "Arrakeen", lat: 24, lon: -16, kind: "city" }]   // optional gazetteer
});
```

```html
<mappo-arrakis mode="globe" figure="solid" figure-color="#b98b5a" places="Arrakeen"></mappo-arrakis>
```

`figure(lat, lon)` is called once per grid cell per resolution and memoised
per body object, so it can be a bitmask lookup, a noise function, or a
lookup into your game's terrain. `outlines()` and `borders()` are called
lazily and may return `null`. Registering the same id again replaces the pack
for every map that asked for it *by name*; a map handed a body object directly
keeps the object it was given.

Prefer a tag name of your own? `defineBodyElement("dune-map", ARRAKIS)`
registers the body and defines `<dune-map>`.

The interface is deliberately six things. Everything a renderer asks a body is
in it, and nothing a renderer does is in a body: the Moon pack contains no
drawing code, and the renderers contain no Moon.

## Places

Every body carries its own gazetteer — Earth's ~160 cities, the Moon's landing
sites and Artemis candidate regions, Mars's landers and reference features —
and the `places` option resolves against the body the map is drawing:

```html
<mappo-world places="Nairobi, Seoul"></mappo-world>
<mappo-moon places="Apollo 11, Chang'e 4, Shackleton"></mappo-moon>
```

Lookups fold accents and case (`Sao Paulo`, `são paulo` and `São Paulo` are
the same place); the name you typed is what gets labelled. Unknown names warn
once and are skipped — a typo must never take down a hero section.

Coordinates without the gazetteer go in `markers`, semicolon-separated because
the coordinates need the comma:

```html
<mappo-world markers="HQ@41.4,2.2; 48.2,16.4"></mappo-world>
```

In JavaScript both are one option:

```js
places: ["Tokyo", { name: "HQ", lat: 41.4, lon: 2.2, color: "#ff9900", kind: "office" }]
```

Records carry through to the events: `e.detail.kind` is whatever the
gazetteer or you put there. `resolvePlace(entry, body)` is exported for your
own lookups; `EARTH.places`, `MOON.places` and `MARS.places` are plain arrays.

Coastal coordinates snap to the nearest figure dot at the current resolution
(harbours sit in sea cells on a coarse grid, and a marker floating just off
the coast looks broken). Deep-ocean coordinates render where they are.

## Globe mode

The same world, wrapped on a sphere and spinning:

```html
<mappo-world mode="globe" cols="170" tilt="18" rotate-speed="4"
             dot-shape="square" places="Madrid, Nairobi, Tokyo"></mappo-world>
```

Globe mode renders on canvas (a rotating globe re-projects every dot every
frame — that's not SVG work), so the flat renderer's guarantees change shape:
dots shrink and fade toward the limb, the back hemisphere is culled, a
hairline halo can ring the sphere, and `tilt` becomes the *axial* tilt.
`rotate-speed` is degrees per second; `0` parks it. The loop pauses when the
globe scrolls offscreen, and `prefers-reduced-motion` gets a single static
frame instead of a spin.

The animation modes work on the globe too — dots lift radially off the
surface (sparkle scales instead), driven by the same phase fields as the flat
renderer. Hover and click events fire with the same payloads as flat mode
(canvas hit-testing through the inverse projection), and the globe is
grabbable: drag to spin it, flick for momentum, and the spin relaxes back to
`rotate-speed` on its own. Flat-only for now: marker pulse. Custom SVG path
dot shapes fall back to squares on canvas.

Nothing on the sphere is allocated per frame: dots, figure quads, contours and
vector outlines are precomputed unit-sphere coordinates in typed arrays, and a
frame only rotates them. Several globes on one page is a first-class case —
each instance owns its stylesheet, its SVG ids and its caches, and bodies'
decoded geometry is shared between them.

## Pointing at places

Three attributes turn the globe from a decoration into a *"here"*:

```html
<mappo-world mode="globe" rotate-speed="0"
             focus="48.86,2.35"
             markers="Paris@48.86,2.35"
             marker-shape="pin" marker-scale="4" marker-pulse="true"
             highlight-color="#8fabe0"
             highlight-polygon='[[[51.1,2.5],[50.1,1.4],[49.4,-1.9],[48.6,-4.6],[47.3,-2.5],[46.2,-1.2],[43.4,-1.8],[42.5,3.0],[43.5,7.0],[46.4,6.8],[49.0,8.1],[51.1,2.5]]]'
></mappo-world>
```

- **`focus="lat,lon"`** — the globe *faces* that point: the spin angle brings
  the focus longitude to the front. With `rotate-speed="0"` it holds there;
  with a spin it's the opening frame. Setting it again re-aims; an unrelated
  attribute change does not. Pair with `tilt` to bias the latitude toward the
  viewer.
- **`marker-shape="pin"`** — the map-pin silhouette (round head, punched hole,
  anchored at the TIP — the point is the place, the head floats above it).
  Draws on both renderers; `marker-pulse` pings at the anchor.
- **`highlight-polygon`** + **`highlight-color`** — every figure dot inside the
  polygon draws in the highlight colour: the whole country or state glows, not
  just the pin. The value is JSON rings of `[lat, lon]` pairs (one ring or an
  array of rings — islands welcome). **mappo ships no per-region boundary
  data** on purpose: you supply the shape (Natural Earth's public-domain admin
  polygons compact beautifully — a country is typically 1–3 KB at the
  resolution a dot grid can even resolve). Rings crossing the antimeridian are
  normalized automatically. Works on both renderers.

The highlight test runs once per geometry build, not per frame: flags parallel
the point buffer index-for-index (the same discipline as the animation phase
fields — geometry arrays never reorder, parallel arrays annotate them), and
the draw loop batches colour switches on flag runs.

## Roll — the lean

```html
<mappo-world mode="globe" roll="-14.3" tilt="12"></mappo-world>
```

`roll` turns the finished globe in the plane of the screen; `tilt` leans its
axis away from the viewer. They are different gestures and they compose — roll
is the "globe sitting at an angle" look, tilt is foreshortening. Roll is
applied last, to the projected point, so dots, graticule, markers, hit-testing
and DOM overlays all rotate together. Hit-testing un-rolls the pointer first.

## The graticule

```html
<mappo-world mode="globe" graticule meridians="24" parallels="23"
             graticule-color="var(--color-border)" equator-color="var(--color-accent)"
             graticule-opacity="0.28" equator-opacity="0.6"></mappo-world>
```

Meridians are evenly spaced longitudes from −180; parallels are evenly spaced
latitudes between the poles. Two rules are baked in because they are what
makes a graticule readable rather than noisy:

- **The equator is its own line**, with its own colour and opacity. It is
  what a reader orients against; drowning it among eleven identical parallels
  wastes it.
- **A parallel that would land within 5° of the equator is dropped.** Evenly
  spacing an odd number across 180° puts one exactly on 0°, which
  double-draws the equator at double opacity and reads as a bug.
  `parallels="23"` therefore yields 22 lines plus the equator.

Lines break at the limb and fade with depth, so the near and far side of the
same circle never flatten into one ellipse. Globe mode today; the geometry
(`buildGraticule`) is renderer-agnostic and exported.

## Colours from CSS variables

Any colour option accepts `var(--name)` — with an optional fallback:

```html
<mappo-world figure-color="var(--brand-500, #d3dce6)"
             graticule-color="var(--border)"></mappo-world>
```

They resolve against `document.documentElement` and **re-resolve when the
theme changes**: mappo watches `class`, `style` and `data-theme` on the root
element, drops its memo, and repaints. Your dark mode just works, with no
JavaScript on your side. A map whose colours are all literals installs no
observer and pays nothing.

## Overlays: your DOM, our geometry

Put your own markup inside the element with `data-lat`/`data-lon` and mappo
positions it:

```html
<mappo-world mode="globe" graticule>
  <a class="pin" data-lat="38.7" data-lon="-9.1" href="/lisbon"><span>Lisbon</span></a>
  <a class="pin" data-lat="35.7" data-lon="139.7" href="/tokyo"><span>Tokyo</span></a>
</mappo-world>
```

This exists because labels usually need to be *real*: crawlable, translatable,
focusable, styled by your own stylesheet. Painting them into canvas forfeits
all of that. So mappo writes exactly one thing per element — its position —
and publishes two hooks:

| Hook | Meaning |
|---|---|
| `--mappo-depth` | `1` facing the viewer → `0` at the limb (always `1` on a flat map) |
| `data-mappo-behind` | present while the point is on the far hemisphere |

```css
.pin > span {
  transform: translate(-50%, -50%);            /* you own the anchor point */
  opacity: calc(.25 + .75 * var(--mappo-depth, 1));
}
.pin[data-mappo-behind] { visibility: hidden; }
```

**Use a wrapper plus an inner element**, as above. mappo rewrites the
wrapper's `transform` every frame on the globe; if that same element also
carried an eased `transform`, the transition and the frame loop would fight.
Keep position on the outside, appearance on the inside.

The overlay layer is `pointer-events: none` so it never eats drag-to-spin — a
label that should be clickable sets `pointer-events: auto` on itself. Flat
maps use the same attributes and CSS hooks, written once per build instead of
per frame. The elements are yours: they survive a `mode` switch in either
direction, and when the element is removed from the DOM (or moved by Turbo or a
framework) they are handed back exactly as you wrote them. Turn positioning
off with `overlays="false"`.

## Placing your own overlays

If you would rather position something yourself — in a server template, say —
`projectNormalized` is the contract:

```js
import { projectNormalized, EARTH } from "mappo";
const { x, y } = projectNormalized(38.9, -10.1, { latRange: [-56, 78] });
// → { x: 0.4719, y: 0.2918 }  →  left: 47.19%, top: 29.18%
projectNormalized(lat, lon, { latRange: EARTH.latRange });   // Earth's default framing
```

`project` answers in grid units and needs `rows`, which mappo derives
internally — so asking a host for it forces that host to re-derive mappo's
arithmetic and keep it correct forever. Normalized coordinates need nothing
but `latRange`, and map straight onto CSS percentages. `latRange` is required:
it is the one thing that differs between Earth's default framing, a
full-sphere Moon and your own crop, and a silent default would put another
world's labels in the wrong place. A live map's range is
`map.options.latRange`.

## `locate()` — drawing your own layer

`projectNormalized` answers about a flat map in the abstract. `locate()`
answers about the frame **on screen right now**, which is what you need when
the globe is turning and you want your own canvas over it:

```js
const p = map.locate(51.5, -0.1);          // CSS px from the corner of the element
if (p.front) ctx.fillRect(p.x, p.y, 3, 3); // false when the body is in the way
```

The third argument is distance from the centre in radii of the body being
drawn, so anything in orbit lands where you would actually see it — including
satellites over the far side, which show standing off the limb rather than
vanishing:

```js
const s = map.locate(lat, lon, 1 + altitudeKm / map.body.radiusKm);
```

`depth` runs 0 at the limb to 1 facing you, the same fade the dots wear, so a
point can be dimmed with the geometry rather than against it. On the flat map
`front` is always true and the answer is the untransformed layout box —
`tilt`/`rotate`/`perspective` are a CSS transform applied on top of it.

[The Starlink demo](https://rameerez.github.io/mappo/demo/satellites.html) is
ten thousand of these calls a frame.

## The JS API

```js
import { Mappo, EARTH } from "mappo";

const map = new Mappo(document.querySelector("#hero-map"), {
  body: "earth",                   // or "moon", "mars", any registered id, or a body object
  cols: 140,                       // dots across the world — the resolution
  latMin: -58, latMax: 84,         // or latRange: [-58, 84]; null bounds follow the body
  figure: "dots",                  // "dots" | "solid" | "outline" | "solid outline"
  figureColor: "#d3dce6",
  figureSource: "grid",            // "grid" | "vector"
  groundColor: "none",
  dotShape: "circle",              // "circle" | "square" | "triangle" | SVG path (24×24)
  dotSize: 0.55,                   // fraction of a grid cell
  dotHoverColor: "#94a8bd",
  dotHoverScale: 2.2,
  places: [
    "Tokyo", "Berlin",             // the body's gazetteer
    { name: "HQ", lat: 41.4, lon: 2.2, color: "#ff9900" } // or your own coords
  ],
  markerShape: "circle",
  markerColor: "#2262fe",
  markerPulse: false,
  tilt: 40,                        // the lying-down hero look (rotateX, deg)
  perspective: 1000,
  animation: "none",               // "wave" animates the whole matrix
  cursor: "default",
  markerCursor: "pointer",
  onPlaceClick: ({ name }) => console.log(name)
});

map.update({ markerColor: "#ff3b30" }); // re-render with new options, as cheaply as possible
map.body;                               // the resolved body object
map.destroy();
```

`DEFAULTS` is exported with every option and its default. Lower-level pieces
are exported too — `buildFigure`, `snapToFigure`, `project`, `cellCenter`,
`cellCorner`, `projectNormalized`, `buildGraticule`, `resolvePlace`,
`resolveBody`, `knownBodies`, `onBodyRegistered` — if you want to build your
own renderer on the same data. Everything Earth-specific is reached through
`EARTH`: `EARTH.figure(lat, lon)`, `EARTH.outlines()`, `EARTH.borders()`,
`EARTH.places`, `EARTH.latRange`.

## Styling

The component renders into light DOM with plain classes (`.mappo-dot`,
`.mappo-marker`, `.mappo-figure-path`, `.mappo-borders`, `.mappo-svg`,
`.mappo-tilt`) — your stylesheet wins. The built-in styles are defaults, not
law, and they are scoped to each instance. `prefers-reduced-motion` disables
all animation automatically.

## Coordinates and conventions

mappo is a symbolic map, and it is precise about what it draws:

- **Latitude** is positive north; **longitude** is positive east and runs
  −180…180 with 0 at the centre of the frame. 180 and −180 are the same
  meridian, and longitude is periodic: `figure(lat, 190)` is `figure(lat, −170)`.
- **Latitude is planetocentric** on every body — the IAU/USGS convention for
  the Moon (Mean Earth/polar axis frame) and Mars (IAU 2000). Earth's data is
  geodetic WGS 84, as Natural Earth publishes it; the difference is below the
  resolution of a 512×256 mask.
- Bodies whose native maps use another convention are converted when their
  pack is **generated**, never at draw time. Mars's 0–360°E is rolled to
  −180…180; a 0–360 figure above 180 becomes negative.
- The **flat map is equirectangular**: linear lat/lon ↔ x/y, matching the
  packed mask and everyone's mental image of "the world map". It is not
  area-accurate and does not pretend to be.
- The **globe is an orthographic projection of a unit sphere**. `radiusKm` is
  a body's mean radius, provided so *you* can turn kilometres into the body
  radii `locate()` speaks; the renderer never uses it. Oblateness is not
  modelled: Earth's flattening would move a pole by about 0.3% of the radius,
  well under a dot.
- The **grid** has `cols` cells across 360° of longitude and
  `round(cols · (latMax − latMin) / 360)` rows, so cells are square in
  degrees. A dot is drawn where `figure()` is true at the cell's centre.
- **Masks** are 512×256 bits (0.7°/cell); **vector outlines** are quantised
  to 1/32° (about 3.5 km on Earth).

## Design notes

### Two renderers, on purpose

The flat map is SVG. The globe is canvas. This is not an accident of history
or a migration in progress — each renderer matches the physics of its mode,
and neither should become the other.

**Why the flat map stays SVG:**

1. **SVG-ness is a feature, not an implementation detail.** Dots are real DOM
   elements: you restyle `.mappo-dot` from your own stylesheet, markers are
   focusable, hover states are plain CSS, everything shows up in devtools, and
   the output is vector-crisp at any zoom and in print. Every canvas map
   library forfeits all of that. It's the reason this one is different.
2. **The performance math favors SVG in flat's actual regime.** A static SVG
   map costs *zero* per frame after render — and flat maps are static almost
   all the time; they re-render only when options change, which the
   differential update tiers make nearly free (style patches never touch
   geometry). Animations run as CSS keyframes: compositor-eligible,
   browser-scheduled, `prefers-reduced-motion` handled for free.
3. **SVG only loses above ~7k animated nodes** — which is exactly the regime
   the density load gate and the cols cap already govern.

**Why the globe is canvas:**

A rotating globe re-projects every dot every frame. That's thousands of
per-frame position writes — as DOM attributes, it's the exact failure mode the
flat renderer's architecture exists to avoid; as canvas fills, it's nothing.
The globe gives up SVG's styling hooks (and re-earns the interactive ones
through inverse-projection hit-testing, so events work the same in both modes)
in exchange for a renderer that can spin at max resolution without dropping
frames.

Same options, same events, same body — `mode` just picks the renderer whose
physics fit.

### The body seam

Rendering knows nothing about any particular world. The renderers ask a body
`figure(lat, lon)` and, when they need them, `outlines()`, `borders()`,
`places`, `latRange`, `terms`, `radiusKm` — and never a seventh thing. Earth
is generated by the very same template and pipeline as the Moon and Mars; it
is simply concatenated into the bundle. That is the test of the abstraction:
adding a body changes no renderer code, and the body that ships in the box is
not a special case.

## Performance

Measured, budgeted, and regression-tested (`demo/perf.html` runs scripted
abuse with hard budgets; `test/` locks the update architecture). The rules of
thumb the numbers produced:

| you want | keep |
|---|---|
| an animated hero (`animation` on) | `cols ≤ 180` (≈4.5k dots) — full smoothness |
| an animated map at higher density | the built-in load gate animates a baked subset above 4.5k/7k dots automatically |
| maximum resolution (`cols` 200–260) | `animation="none"` — static maps stay cheap at any size |

Resolution changes are debounced adaptively (spacing self-tunes to your
machine's measured frame cost), style/colour/animation knobs never rebuild
geometry, and SVG stays the renderer up to 260 cols — dots are real,
hoverable, restylable elements. A canvas mode for extreme flat grids is on the
roadmap behind the same options.

## Data

Every body pack — Earth included — is written by one template from pinned
public data, and every input is pinned by URL **and** SHA-256, so a pack can
be regenerated bit-for-bit from a fresh checkout:

| Body | Source | Figure |
|---|---|---|
| Earth | [Natural Earth](https://www.naturalearthdata.com) 110m land and admin-0 countries (public domain), `natural-earth-vector` at commit `ca96624a` | land, rasterised into a 512×256 mask and simplified into outlines; countries become the borders |
| Moon | Clementine UVVIS 750 nm global albedo mosaic (public domain, NASA/USGS) | the dark maria, thresholded to 16% of the sphere; the held-out near side comes out at 30%, matching the published figure |
| Mars | MOLA global topography, colour-ramped (public domain, NASA/MGS) | the lowest third of the surface — the crustal dichotomy — checked at eight places of known height from Hellas to Olympus Mons |

The Moon and Mars figures are interpretations rather than coastlines: a
brightness level and an elevation class. Their generators verify named
places before writing anything, and the shipped packs are tested against the
same anchors. Gazetteers live in `scripts/data/*-places.js`.

## Scope

mappo draws worlds. It is deliberately **not** an astronomy library: the
Starlink and orbit demos carry their own SGP4 propagator, Kepler solver and
sidereal-time code in `demo/`, as showcases of what `locate()` makes possible,
and none of that is part of the package or its supported API. A body is a
surface classification, its outlines, its regions and its places — nothing in
the seam knows about time, orbits or ephemerides, and that is what keeps the
seam small enough to survive the next body.

## Development

```bash
nvm use                         # Node 22 (see .nvmrc; package.json devEngines enforces the floor)
npm ci                          # reproducible development dependencies (jsdom, pngjs, jpeg-js — dev only)
npm run build                   # bundle src/ → dist/mappo.js + dist/bodies/*
npm test                        # pure, DOM, packaging and generator tests, against dist/

npm run generate                # regenerate every body pack from the pinned sources
npm run generate:earth          # or one at a time; sources are cached in .cache/
```

Node ≥ 22.22 is required for development because the DOM tests use jsdom.
The published package has no Node requirement.

To add a body: write a generator (or a hand-written pack) that produces an
object satisfying the interface above, put its gazetteer in
`scripts/data/<id>-places.js`, add `"./bodies/<id>": "./dist/bodies/<id>.js"`
to `package.json`'s `exports` — the build reads the list from there — and add
its anchors to `test/body.test.js`. The renderers need no change.

## License

MIT © rameerez. Earth data: Natural Earth (public domain). Moon and Mars
data: NASA/USGS and NASA/MGS (public domain).
