<p align="center">
  <img src="assets/mappo-logo.webp" alt="mappo" width="440">
</p>

# mappo

**Maps of any world as a zero-dependency web component.** A dot field or
vector outlines, flat SVG or a rotating canvas globe, places by name, your own
HTML positioned on the sphere. The core is **22.0 KB gzipped with the whole
Earth inside**; the globe, the other projections, real coastlines and other
worlds are opt-in modules that register themselves. No build step, no
dependencies, MIT.

```html
<script type="module" src="https://unpkg.com/mappo"></script>

<mappo-world places="London, Lagos, Singapore" tilt="40"></mappo-world>
```

That's the whole integration.

```html
<script type="module">
  import { registerBody } from "https://unpkg.com/mappo@0.7.0/dist/all.js";  // the globe, real outlines, every projection
  import { MOON } from "https://unpkg.com/mappo@0.7.0/dist/bodies/moon.js";
  registerBody(MOON);
</script>

<mappo-moon mode="globe" figure="outline" figure-source="vector"
            places="Apollo 11, Shackleton"></mappo-moon>
```

That's another world, on a globe, with real outlines — from `all.js`, the
everything file. With a bundler you would import the same things by name:
`mappo`, `mappo/globe`, `mappo/vector`, `mappo/bodies/moon`.

## Why this exists

Every SaaS hero section eventually wants the dotted world with glowing city
markers. The usual path is a designer's frozen SVG: thousands of hardcoded
rectangles, cities placed by eye, one resolution forever. mappo derives the
dots from a 3.6 KB run-length land mask instead — so resolution, dot shape, framing
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

Or skip npm entirely — the core is one file:

```html
<script type="module" src="https://unpkg.com/mappo"></script>
```

### What you download

The bare import is the **core**: the flat map, Earth's land mask and
gazetteer, the equirectangular projection. Everything else is a module you
import when a page needs it. Each one imports the core by relative path and
registers itself, so order does not matter and nothing is downloaded twice.

| import | adds | gzipped | brotli |
|---|---|---|---|
| `mappo` | the core, with the whole Earth inside | **22.0 KB** | 19.1 KB |
| `mappo/globe` | `mode="globe"` | 10.2 KB | 9.1 KB |
| `mappo/projections` | `projection="equal-earth"`, the polar pair, your own or d3-geo projections | 3.7 KB | 3.3 KB |
| `mappo/vector` | `figure-source="vector"` and `borders` for bodies that carry rings (the Moon and Mars packs do) | 1.8 KB | 1.6 KB |
| `mappo/links` | `links(map)`: arcs between places and spikes at them, over the globe or the flat map | 2.9 KB | 2.6 KB |
| `mappo/bodies/earth-vector` | Earth's coastline and border rings; implies `mappo/vector` | 22.0 KB | 19.3 KB |
| `mappo/bodies/moon`, `mappo/bodies/mars` | other worlds, as packs you register | 9.5 KB, 6.9 KB | 8.3 KB, 6.0 KB |
| `mappo/all` | everything above except the Moon and Mars, in one self-contained file | 59.8 KB | 51.5 KB |

A map that asks for something whose module has not loaded **waits**: it draws
nothing (grid contours, for the vector features), warns once after two seconds
if the module never arrives, and draws the moment it registers. The numbers are
measured by `npm run weight` and held by the test suite: the core cannot grow
past 22 KB gzipped without a test failing.

**From a CDN**, the simplest is one file: `https://unpkg.com/mappo` for the
core, or `https://unpkg.com/mappo@0.7.0/dist/all.js` for everything. To load
modules one by one, load the core by **the URL the modules resolve**: each
module imports `./mappo.js` next to itself, so name the core by the same full,
pinned path —

```html
<script type="module">
  import "https://unpkg.com/mappo@0.7.0/dist/mappo.js";
  import "https://unpkg.com/mappo@0.7.0/dist/globe.js";
</script>
```

A browser keys modules by URL. A core loaded through a short or redirecting
URL (`https://unpkg.com/mappo`) and the `./mappo.js` a module resolves are
two URLs, so the page would run two cores with two registries and the globe
would register with the wrong one. Never load `all.js` beside the core or the
modules, for the same reason. With an import map the rule is the same: map
`mappo` to the full `dist/mappo.js` URL and `mappo/globe` to `dist/globe.js`
beside it.

All of this is one npm package. The `@mappo` organisation on npm is reserved
for things with a life of their own — framework wrappers, large datasets, a
pack-generating CLI — never for pieces of the library; the policy is in
[docs/roadmap.md §6](https://github.com/rameerez/mappo/blob/main/docs/roadmap.md).

Rails with importmaps: pin **one** file. Asset digests rename files, which
breaks a module's relative `./mappo.js`; the body packs import nothing, so
they pin fine on their own.

```ruby
# config/importmap.rb — vendor dist/mappo.js (the core) or dist/all.js (everything) as mappo.js
pin "mappo", to: "mappo.js"
pin "mappo/bodies/moon", to: "mappo-moon.js"    # a pack, if the app uses it
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
| `vector` | the body's own outlines (Natural Earth 110m on Earth), quantised to 1/32° — smooth at any size, independent of `cols` | the `mappo/vector` module (1.8 KB); Earth's rings are `mappo/bodies/earth-vector` (22 KB) |

A body without outlines falls back to the grid, and so does a map whose module
has not loaded yet: it draws grid contours, warns once after two seconds if the
module never arrives, and redraws with the rings the moment it does. The option
is always safe to set.

`borders` adds the body's region boundaries — national borders on Earth, in
the same `earth-vector` module (vector only: a 512×256 raster cannot express a
border that follows a river) — with `borders-color`, `borders-width` and
`borders-opacity`. Both datasets are decoded lazily: a map that never asks for
them pays the parse of nothing.

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
import { MOON } from "mappo/bodies/moon";   // 9.5 KB gzipped
import { MARS } from "mappo/bodies/mars";   // 6.9 KB gzipped

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
wrong planet for a frame would be worse than drawing none). It adopts the body
the moment `registerBody()` runs. A name that never registers warns after two
seconds. Omitting `body`, or leaving it empty, selects the default Earth body.

The tag is a default, the attribute is the truth: `<mappo-moon body="mars">`
is a strange thing to write, but it means Mars.

### Your own world

A body is a small object:

```js
import { registerBody } from "mappo";

registerBody({
  id: "arrakis",                                   // ^[a-z][a-z0-9-]*$; also names <mappo-arrakis>
  name: "Arrakis",
  radiusKm: 6100,                                  // optional; lets consumers convert km to body radii
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

The surface seam is deliberately small. Everything a renderer asks a body is
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

## Projections

Equirectangular is in the core; the others are the `mappo/projections` module
(3.7 KB gzipped), which also accepts a projection of your own or a d3-geo one:

```html
<script type="module">import "mappo"; import "mappo/projections";</script>

<mappo-world projection="equal-earth" lat-min="-90" lat-max="90"></mappo-world>
<mappo-moon projection="stereographic-south" lat-max="-60"
            places="Shackleton, Haworth"></mappo-moon>
<mappo-world center-lon="150" places="Tokyo, Sydney, Honolulu"></mappo-world>
```

A sphere does not fit on a rectangle, and every way of forcing it lies about
something. mappo lets you choose the lie. Four projections ship:

| `projection` | kind | true to | frame |
|---|---|---|---|
| `equirectangular` (default) | cylindrical | latitude and longitude as straight lines | 360° wide by the latitude band |
| `equal-earth` | pseudocylindrical, equal-area | area, everywhere | 2.05 : 1 for the whole sphere; the corners are off the world |
| `stereographic-north` | azimuthal, conformal | shape; the north pole at the centre | a square holding a disc |
| `stereographic-south` | azimuthal, conformal | shape; the south pole at the centre | a square holding a disc |

Equal Earth is the equal-area projection of Šavrič, Patterson and Jenny
(*International Journal of Geographical Information Science*, 2019), the
modern standard for global thematic maps. Polar stereographic is what NASA
and USGS print the poles in, and the only honest way to show the Artemis
candidate regions at 85° south, which an equirectangular map smears across
most of a row.

**Polar maps read `lat-min`/`lat-max` as the band you see**: the far bound is
the rim of the disc, the near bound is normally the pole. `lat-max="-60"` on a
south polar map shows 60°S to the pole; a near bound short of the pole makes
an annulus. Unset, a polar map shows its hemisphere. Longitude 90°E is to the
right in both aspects, so 0° points down on a north map and up on a south one,
the convention planetary polar products are printed in.

**`center-lon`** sets the central meridian, in degrees east: `150` gives a
Pacific-centred map. Cylindrical maps move their seam with it, and the vector
coastlines are re-cut at the new seam rather than the old one; polar maps
rotate. The globe ignores both `projection` and `center-lon`: it is a physical
view, not a map projection.

Everything else is the same code with a projection plugged in. Dots are
sampled at the inverse projection of every screen cell, so the dot field is
uniform on screen whatever the projection; grid contours, highlights, markers,
overlays, `locate()`, `projectNormalized`, borders and the graticule follow the
forward mapping. Vector outlines are stitched into whole rings once per body
and cut at *this* map's seam, with the fill closed and the edge never stroked
along a seam — not along the frame of a cylindrical map, and not along the
180° meridian of a polar one.

A point with **no place on the map** — the far hemisphere of a polar map, a
latitude outside the band — is not drawn: places are skipped, overlays are
parked off-screen with `data-mappo-behind` (the same attribute the globe uses
for its far side), and `locate()`, `projectNormalized`, `project`, `cellCenter`
and `snapToFigure` return `null`.

### Your own projection

`projection` also takes an object, or a d3-geo projection:

```js
const sinusoidal = {
  aspect: 2,
  forward: (lat, lon) => ({ x: 0.5 + lon * Math.cos(lat * RAD) / 360, y: (90 - lat) / 180 }),
  inverse: (x, y) => {                       // null means "this frame point is off the world"
    const lat = 90 - y * 180, lon = (x - 0.5) * 360 / Math.cos(lat * RAD);
    return Math.abs(lon) <= 180 ? { lat, lon } : null;
  },
  outline: () => [ ring ]                     // optional: the clip, in unit-frame coordinates
};
new Mappo(el, { projection: sinusoidal, latRange: [-90, 90] });

import { geoMollweide } from "d3-geo-projection";
new Mappo(el, { projection: geoMollweide(), latRange: [-90, 90] });   // recognised by .invert + .stream
```

`forward(lat, lon)` returns a point in the unit frame (0…1 across, 0…1 down)
or `null`; `inverse(x, y)` returns `{ lat, lon }` or `null`. The dot field,
contours and highlights come from the inverse alone. A custom projection needs
a positive finite `aspect`; every returned point and optional `outline()` ring
must stay in the unit frame. Its seam defaults to ±180°, so vector rings are
cut correctly for the usual projection centred on 0°. Set `seam: false` for a
mapping without that cylindrical seam. If such a mapping returns `null` in the
middle of a vector ring, mappo uses its screen-grid contour rather than joining
the surviving vertices with a false chord. `center-lon` applies to built-ins
only.

For d3, mappo uses `projection.stream`: the same pipeline d3 uses for spherical
rotation, antimeridian or small-circle clipping, Cartesian clipping and
adaptive resampling. The streamed sphere (or requested latitude band) is the
actual outline and frame; points hidden by an orthographic clip are therefore
`null`, curved frames do not become rectangles, and vector fills and strokes
are cut by d3 itself. Mutable d3 state such as `rotate`, `clipAngle`,
`parallels`, or projection-specific setters is fingerprinted on `update()` so
cached geometry cannot survive a projection mutation.

`map.projection` is the resolved instance the flat map is drawing with —
`id`, `aspect`, `forward`, `inverse`, `outline()` — and `null` on the globe.
`resolveProjection(name | object, { latRange, centerLon })` and
`knownProjections()` are exported for hosts that want the same mapping without
a map. The projection formulas, their accuracy and their measured cost are in
[docs/precision.md](https://github.com/rameerez/mappo/blob/main/docs/precision.md)
and [docs/performance.md](https://github.com/rameerez/mappo/blob/main/docs/performance.md).

## Globe mode

The same world, wrapped on a sphere and spinning. The globe is the
`mappo/globe` module (10.2 KB gzipped); a page without it never pays for it:

```html
<script type="module">import "mappo"; import "mappo/globe";</script>

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

The expensive spherical geometry and trigonometry are moved out of the frame
loop: dots, figure quads, contours and vector outlines are precomputed as
unit-sphere typed arrays, and frames rotate those coordinates into short-lived
canvas paths. Several globes on one page is a first-class case — each instance
owns its stylesheet, its SVG ids and its caches, and bodies' decoded geometry
is shared between them.

### Glass, a camera, and a lattice

Four more knobs turn the hero globe into the see-through kind — the sphere
you look *through*, with the far side showing faintly behind the near:

```html
<mappo-world mode="globe" cols="396" lat-min="-90" lat-max="90"
             distribution="uniform" dot-shape="tile" dot-size="0.38"
             distance="2.37" fog="-0.67 1.01"></mappo-world>
```

| Option | Default | What it does |
|---|---|---|
| `distance` | `Infinity` | The camera's distance from the globe's centre, in body radii. Infinity is the orthographic view every version has drawn; a finite value (2 to 4 reads as a globe seen from close by) is a perspective camera: the near side grows, the far side shrinks, the visible cap is smaller than a hemisphere. The limb stays on the same disc, so nothing else on the page moves. |
| `fog` | none | `"near far"`, in radii from the centre plane, positive away from you. Set, the globe is glass: the far hemisphere is drawn too, and everything fades from opaque at `near` to gone at `far` — dots, tiles, outlines, borders and the graticule alike. The fade is a renderer's fog: one minus a smoothstep between the two, used as alpha, the curve a WebGL fog blends with. `fog="-0.67 1.01"` leaves the front third untouched and lets the far side show through, faintly. |
| `fog-color` | none | The fog's colour. Unset, whatever sits in the fog fades to transparent, toward the page. Set, it is drawn at full alpha in its own colour mixed toward this one, the way a WebGL fog blends: a dark fog darkens the far side on a light page rather than paling it, where the fade would follow the page. Over a flat page whose colour the fog shares, the two are the same picture. |
| `distribution` | `grid` | How the dots sample the sphere. `grid` is the lat/lon grid the flat map draws; `uniform` is a Fibonacci lattice — equal area per dot everywhere, no bunching at the poles, `round(cols²/π)` candidates so `cols` still means the spacing at the equator. The lattice's two convergence points sit on the equator at ±90°, in open ocean on Earth. |
| `dot-shape="tile"` | | A square lying *on* the surface rather than facing the screen. Tiles foreshorten into slivers along the limb, as a real tangent square does; on the flat map a tile is a square. |
| `graticule-width` | `1` | Line width of the grid, in CSS pixels on the globe (a multiplier of the flat map's hairline). `0.5` is one device pixel on a 2× screen. |

`locate()` also reports `z`, the point's depth toward you in radii, and
`fade`, the alpha the globe draws at that depth — under fog, the fog's — so a
layer of your own can sink into the same haze. Budget a fogged globe at twice
the dots (both hemispheres are drawn); tiles cost about what squares do. A
parked globe (`rotate-speed="0"`, nothing animating, no pointer) draws no
frames at all, and an option change draws exactly one.

[The Region: Earth demo](https://rameerez.github.io/mappo/demo/region-earth.html)
is all four together.

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

On the globe, lines break at the limb and fade with depth, so the near and far
side of the same circle never flatten into one ellipse. On the flat map they
are projected and broken wherever they leave the world or cross the seam, so a
polar map gets its radial meridians and concentric parallels from the same
option. The geometry (`buildGraticule`) is renderer-agnostic and exported.

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
| `data-mappo-behind` | present while the point is on the far hemisphere — or, with `overlay-horizon`, past the facing you chose |
| `data-mappo-moving` | present while the globe turns faster than `overlay-still` degrees per second (only when that option is set) |

```css
.pin > span {
  transform: translate(-50%, -50%);            /* you own the anchor point */
  opacity: calc(.25 + .75 * var(--mappo-depth, 1));
}
.pin[data-mappo-behind] { visibility: hidden; }
```

Two decisions are better made by the renderer than by a stylesheet, because
they need the previous frame. `overlay-horizon="0.12 0.02"` marks an element
behind once its facing drops under 0.02 and unmarks it only once it climbs
back over 0.12, so a pin near the limb never flickers between shown and
hidden. `overlay-still="172"` marks every overlay `data-mappo-moving` while
the globe's smoothed spin exceeds 172° per second, so labels can hide during a
flick and come back as it settles:

```css
.pin[data-mappo-moving] > span { opacity: 0; }
```

Both are globe options; the flat map has no limb and does not turn.
`locate().depth` reports the same facing the overlays get, camera included.

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
`map.options.latRange`. A map with a projection or a central meridian needs
those too — `projectNormalized(lat, lon, { latRange, projection: "equal-earth", centerLon: 150 })` —
and the answer is `null` for a point the map has no place for (a latitude
outside the band, the far hemisphere of a polar map).

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
point can be dimmed with the geometry rather than against it; `scale` is the
pixels per radius *at that point* — more toward a perspective camera — so a
width or a marker drawn there can grow the way the dots do. On the flat map
`front` is always true, the answer follows the map's projection and central
meridian, it is `null` for a point the projection has no place for, and the
box is the untransformed layout box — `tilt`/`rotate`/`perspective` are a CSS
transform applied on top of it.

[The Starlink demo](https://rameerez.github.io/mappo/demo/satellites.html) is
ten thousand of these calls a frame.

### `addLayer()` — a canvas over the map, redrawn with it

Rather than keep a canvas of your own in step with a turning globe, ask the
map for one:

```js
const layer = map.addLayer((ctx, view) => {
  const p = view.map.locate(51.5, -0.1);
  if (p?.front) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill(); }
});
layer.redraw();   // when what YOU draw changed and the map did not move
layer.remove();
```

`draw(ctx, view)` runs after every frame the map draws, in CSS pixels of the
map's box (`view` is `{ width, height, dpr, map }`), on a cleared canvas that
ignores the pointer and sits under the DOM overlays. A parked globe asked to
`redraw()` repaints the layers alone, not its dots. `mappo/links` is built on
exactly this and nothing else.

## Links: arcs and spikes — `mappo/links`

Every hero globe draws lines between places — an arc from where a thing began
to where it landed, a spike where something is happening now. `mappo/links`
draws them on a layer over the map, from the same `locate()` the overlays
use, so they register to the pixel on the globe and on the flat map alike:

```js
import "mappo/globe";
import { links } from "mappo/links";

const layer = links(document.querySelector("mappo-world").map, { color: "#f46bbe", width: 1.5 });
const arc = layer.add({ from: "London", to: "Tokyo" });        // a great-circle arc, lifted off the surface
const pin = layer.add({ at: "Lagos", height: 0.1, tip: 2 });   // a spike 0.1 radii tall, a 2 px dot on top
arc.range = [ 0, 0.4 ];                                         // the first 40% — animate this for a reveal
layer.redraw();                                                 // when the map itself did not move
layer.at(event);                                                // the link under the pointer, or null
```

A link is a plain object you keep and mutate. `from`, `to` and `at` take a
gazetteer name, `[lat, lon]` or `{ lat, lon }`. `height` is radii above the
surface: an arc's peak (0.3 of its half-chord unless set, so hops hug the
ground and long hauls arc) or a spike's length. `points` replaces the curve
with your own `[lat, lon, r]` samples. Per link, or as the layer's defaults:
`color` (the map's marker colour unless set; CSS variables resolve), `width`
in CSS pixels, `opacity`, `blend: "lighter"` for the additive glow WebGL
globes have, `fade: true` to fade with the globe's own depth (under fog, with
the fog), `range` as `[a, b]` fractions of the length, `tip` (a radius, or
`{ radius, color }`) for a dot at the far end, and `data` for whatever the
link means to you.

On the globe the far side is cut where the body is in the way, widths grow
toward a perspective camera, and every vertex is one `locate()`: a link costs
what it looks like. On the flat map the same points go through the projection
and are cut at its seam. The module is 2.9 KB gzipped and registers nothing;
[the GitHub globe demo](https://rameerez.github.io/mappo/demo/github-globe.html)
is a few hundred of these, opening and merging.

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
map.locate(51.5, -0.1);                 // where London is on screen right now
map.addLayer((ctx, view) => { /* … */ }); // your own canvas over the map, redrawn with it
map.body;                               // the resolved body object
map.destroy();
```

`DEFAULTS` is exported with every option and its default. Lower-level pieces
are exported too — `buildFigure`, `snapToFigure`, `project`, `cellCenter`,
`cellCorner`, `projectNormalized`, `buildGraticule`, `resolvePlace`,
`resolveBody`, `knownBodies`, `onBodyRegistered` — if you want to build your
own renderer on the same data. Everything Earth-specific is reached through
`EARTH`: `EARTH.figure(lat, lon)`, `EARTH.places`, `EARTH.latRange`, and
once `mappo/bodies/earth-vector` has loaded, `EARTH.outlines()` and
`EARTH.borders()`. `map.pending` says what a map is waiting for (a body pack,
a renderer, a projection), or `null`.

## Extending mappo

The opt-in modules are built on five registrations, and so can yours:

| call | what it adds | who calls it |
|---|---|---|
| `registerRenderer(mode, Renderer)` | a renderer for `mode="…"` — a class built as `(container, options, body, overlays)` with `update(changed, body)`, `destroy()`, `locate(lat, lon, radius)` and an `element` | `mappo/globe` |
| `registerProjection(id, spec)` | a named projection: `{ kind, defaultLatRange(bodyRange), create({ latRange, centerLon }) }` | `mappo/projections` |
| `registerProjectionAdapter(fn)` | `(value, latRange) → instance \| null` for projection values that are not names | `mappo/projections` |
| `registerVector({ stitchRings, projectRings })` | the seam machinery vector outlines need | `mappo/vector` |
| `extendBody(id, { outlines, borders, places, … })` | more data for a registered body; live maps redraw | `mappo/bodies/earth-vector` |

Every registration redraws the live maps that were waiting for it, so a module
can load in any order relative to the page's markup. Not everything is a
registration: `mappo/links` draws over the map through `map.addLayer()` and
`locate()` alone, which is the shape a heat layer or a flight tracker of your
own would take. A module imports what it
needs from the core — `resolvePlaces`, `cellCenter`, `buildFigure`,
`figureOutlines`, `vectorFeature`, `projectPolyline`, `wrapLon` and the
rest of the names `src/index.js` exports — and the build refuses a module that
imports anything else. `knownRenderers()` and `knownProjections()` list what
has registered so far.

## Styling

The component renders into light DOM with plain classes (`.mappo-dot`,
`.mappo-marker`, `.mappo-figure-fill`, `.mappo-figure-edge`, `.mappo-borders`,
`.mappo-graticule`, `.mappo-equator`, `.mappo-svg`, `.mappo-tilt`) — your stylesheet wins. The built-in styles are defaults, not
law, and they are scoped to each instance. `prefers-reduced-motion` disables
all animation automatically.

## Coordinates and conventions

mappo is a symbolic map, and it is precise about what it draws:

- **Latitude** is positive north; **longitude** is positive east and runs
  −180…180 with 0 at the centre of the frame. 180 and −180 are the same
  meridian, and longitude is periodic: `figure(lat, 190)` is `figure(lat, −170)`.
- **Latitude is interpreted on a sphere**, using the convention of each
  body's data: geodetic WGS 84 for Earth, and planetocentric for the Moon
  (Mean Earth/polar axis frame) and Mars (IAU 2000). The renderer does not
  convert between geodetic and planetocentric latitude.
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

### Precision, in numbers

mappo is an exact renderer of coarse, symbolic worlds. What it computes is
correct to double precision on a sphere; what it carries is generalised to
tens of kilometres, and the Moon and Mars figures are interpretations of
pictures. The bounds that matter, with the derivations, live in
[docs/precision.md](https://github.com/rameerez/mappo/blob/main/docs/precision.md):

| What | Bound |
|---|---|
| `locate()`, `projectNormalized`, overlays | exact for a sphere, double precision (measured round trip 2×10⁻¹³°) |
| Place markers on the **flat map** | snapped to the dot grid: typically half a cell (167 km on Earth at `cols="120"`), never on the globe |
| `figure(lat, lon)` | a 0.703° cell: 78 km on Earth, 21 km on the Moon, 42 km on Mars |
| Vector outlines | 1/32° quantisation plus 0.08–0.22° simplification; Natural Earth 110m generalisation on Earth |
| Sphere instead of ellipsoid | true surface within 14 km of the sphere on Earth and Mars, 1.4 km on the Moon |
| Latitude type | spherical; Earth data is geodetic, so feed geodetic (a geocentric input is off by up to 0.19°) |
| Limb visibility | points within 0.573° of the limb are treated as hidden |
| Time, rotation, frames, ephemerides | not modelled; you supply body-fixed coordinates |

For exact points, compute them yourself and place them with overlays or
`locate()`; never read a position off the figure.

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
`places`, `latRange`, `terms`, and `radiusKm`. Earth is generated by the very
same template and pipeline as the Moon and Mars; it is simply bundled into the
core, with its rings split off into a module by the same generator. That is
the test of the abstraction: adding a body changes no renderer code, and the
body that ships in the box is not a special case.

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

### Performance, in numbers

Measured on an M1 Max in headless Chrome (CPU rasterisation, so canvas costs
are pessimistic); the cost model, the method and the road to more are in
[docs/performance.md](https://github.com/rameerez/mappo/blob/main/docs/performance.md).

| What | Cost |
|---|---|
| Dots on a grid | 0.119 × cols² on Earth's default framing: 1 699 at 120, 8 148 at 260 |
| Flat map, first render | ≈ 8 µs per SVG node (2 per dot): 31 ms at cols 120, 126 ms at cols 260 |
| Flat map, a colour change | the same style recalculation: 33 ms at cols 120, 128 ms at cols 260 |
| Flat map, static, per frame | 0 ms (16 maps, 54k nodes, 60 fps) |
| Globe, `dots`, per frame | 0.2–0.3 µs per point: 1.1 ms at cols 260, 8.5 ms at cols 600 (60 fps), 38 ms at cols 1000 |
| Globe, `outline` vector + borders + graticule | ≈ 1 ms per frame at any cols |
| Globe, `solid` (grid fill) | 2.3 ms at cols 170, 11 ms at cols 260, 54 ms at cols 400: the style to budget for |
| Many globes | costs add: 2.9 ms per rich globe, so about five at 60 fps, twelve at 30 |
| Build (any body, any cols) | ≤ 3 ms at cols 260, 25 ms at cols 1000; paid once and cached |

No configuration tried crashed; the failure mode is a falling frame rate,
linear in the work. The flat renderer clamps `cols` at 260; the globe has no
cap.

## Data

Every body pack — Earth included — is written by one template from pinned
public data, and every input is pinned by URL **and** SHA-256, so a pack can
be regenerated bit-for-bit from a fresh checkout:

| Body | Source | Figure |
|---|---|---|
| Earth | [Natural Earth](https://www.naturalearthdata.com) 110m land and admin-0 countries (public domain), `natural-earth-vector` at commit `ca96624a` | land, rasterised into a 512×256 mask (in the core) and simplified into outlines; countries become the borders (both in `mappo/bodies/earth-vector`) |
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

## Roadmap

What comes next — the performance work with its measured gains, the precision
work toward research-grade data, more projections and seam handling for custom
ones, regions with identities, more bodies, and what the `@mappo` organisation
is for — is in
[docs/roadmap.md](https://github.com/rameerez/mappo/blob/main/docs/roadmap.md),
each item with its evidence and sources.

## Development

```bash
nvm use                         # Node 22 (see .nvmrc; package.json devEngines enforces the floor)
npm ci                          # reproducible development dependencies (esbuild, jsdom, pngjs, jpeg-js — dev only)
npm run build                   # esbuild: dist/mappo.js (the core), the modules, dist/all.js, dist/bodies/*
npm test                        # pure, DOM, packaging, weight-budget and generator tests, against dist/
npm run weight                  # where the bytes are, per module and per Earth literal (docs/weight.md)
npm run serve                   # the repo on http://localhost:8099 — the demos, and what the two harnesses below drive
node scripts/review-pages.mjs http://localhost:8099 /tmp/review index.html demo/worlds.html   # real-time review: errors, per-map frame cost, screenshots
node scripts/drag-harness.mjs http://localhost:8099/demo/worlds.html 'mappo-moon[mode="globe"]' # a real pointer drag on a globe, sampled to rest

npm run generate                # regenerate every body pack from the pinned sources
npm run generate:earth          # or one at a time; sources are cached in .cache/
```

Node ≥ 22.22 is required for development because the DOM tests use jsdom.
The published package has no Node requirement.

To add a body: write a generator (or a hand-written pack) that produces an
object satisfying the interface above, put its gazetteer in
`scripts/data/<id>-places.js`, add `"./bodies/<id>": "./dist/bodies/<id>.js"`
to `package.json`'s `exports` — the build reads the list from there — and add
its anchors to `test/body.test.js`. The renderers need no change. To add a
module, add `src/entries/<name>.js` and `"./<name>": "./dist/<name>.js"` the
same way; it may import from the core only what `src/index.js` exports.

## License

MIT © rameerez. Earth data: Natural Earth (public domain). Moon and Mars
data: NASA/USGS and NASA/MGS (public domain).
