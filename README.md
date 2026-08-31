<p align="center">
  <img src="assets/mappo-logo.webp" alt="mappo" width="440">
</p>

# mappo

**A dotted world map as a zero-dependency web component.** Land dots derived
from a packed bitmask at any resolution, a built-in city registry (just type
`"London"`), shapes, tilt, pulse markers, hover/click events. One ESM file,
no build step, no dependencies.

```html
<script type="module" src="https://unpkg.com/mappo"></script>

<world-map cities="London, Lagos, Singapore" tilt="40"></world-map>
```

That's the whole integration.

## Why this exists

Every SaaS hero section eventually wants the dotted world with glowing city
markers. The usual path is a designer's frozen SVG: thousands of hardcoded
rectangles, cities placed by eye, one resolution forever. `mappo`
derives the dots from a ~22 KB packed land bitmask instead — so resolution,
dot shape, projection framing, and city markers are all runtime parameters,
and "add Nairobi" is typing `Nairobi`.

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
pin "mappo", to: "mappo.js" # vendor dist/mappo.js
```

## The element

```html
<world-map
  cities="London, Lagos, Singapore, New York"
  cols="140"
  dot-shape="circle"
  dot-color="#d3dce6"
  marker-color="#2262fe"
  marker-pulse="true"   <!-- animations are opt-in; default is a calm, static map -->
  tilt="40"
  animation="wave"
></world-map>
```

Attributes are live — change one, the map re-renders. Interaction bubbles as
DOM events:

```js
map.addEventListener("worldmap:cityclick", (e) => {
  console.log(e.detail.name, e.detail.lat, e.detail.lon);
});
// also: worldmap:cityenter, :dotclick, :dotenter
```

## Globe mode

The same world, wrapped on a sphere and spinning:

```html
<world-map mode="globe" cols="170" tilt="18" rotate-speed="4"
           dot-shape="square" cities="Madrid, Nairobi, Tokyo"></world-map>
```

Globe mode renders on canvas (a rotating globe re-projects every dot every
frame — that's not SVG work), so the flat renderer's guarantees change
shape: dots shrink and fade toward the limb, the back hemisphere is culled,
a hairline halo rings the sphere, and `tilt` becomes the *axial* tilt.
`rotate-speed` is degrees per second; `0` parks it. The loop pauses when
the globe scrolls offscreen, and `prefers-reduced-motion` gets a single
static frame instead of a spin.

The six animation modes work on the globe too — dots lift radially off
the surface (sparkle scales instead), driven by the same phase fields as
the flat renderer. Hover and click events fire with the same payloads as
flat mode (canvas hit-testing through the inverse projection), and the
globe is grabbable: drag to spin it, flick for momentum, and the spin
relaxes back to `rotate-speed` on its own. Flat-only for now: marker
pulse. Custom SVG path dot shapes fall back to squares on canvas.

## Pointing at places (v0.4)

Three attributes turn the globe from a decoration into a *"here"*:

```html
<world-map mode="globe" rotate-speed="0"
           focus="48.86,2.35"
           markers="Paris@48.86,2.35"
           marker-shape="pin" marker-scale="4" marker-pulse="true"
           highlight-color="#8fabe0"
           highlight-polygon='[[[51.1,2.5],[50.1,1.4],[49.4,-1.9],[48.6,-4.6],[47.3,-2.5],[46.2,-1.2],[43.4,-1.8],[42.5,3.0],[43.5,7.0],[46.4,6.8],[49.0,8.1],[51.1,2.5]]]'
></world-map>
```

- **`markers="Name@lat,lon;..."`** — coordinate pins, no gazetteer lookup.
  Semicolon-separated, `Name@` optional. They feed the same pipeline as
  `cities` (which has always accepted `{ name, lat, lon }` objects from
  JS — this attribute just gives markup the same power) and fire the same
  events.
- **`focus="lat,lon"`** — the globe *starts facing* that point: the
  initial spin angle brings the focus longitude to the front. With
  `rotate-speed="0"` it holds there; with a spin it's the opening frame.
  Pair with `tilt` to bias the latitude toward the viewer.
- **`marker-shape="pin"`** — the map-pin silhouette (round head, punched
  hole, anchored at the TIP — the point is the place, the head floats
  above it). Draws on both renderers; `marker-pulse` pings at the anchor.
- **`highlight-polygon`** + **`highlight-color`** — every land dot inside
  the polygon draws in the highlight colour: the whole country or state
  glows, not just the pin. The value is JSON rings of `[lat, lon]` pairs
  (one ring or an array of rings — islands welcome). **mappo ships no
  boundary data** on purpose: you supply the shape (Natural Earth's
  public-domain admin polygons compact beautifully — a country is
  typically 1–3&nbsp;KB at the resolution a dot grid can even resolve).
  Rings crossing the antimeridian are normalized automatically. Globe
  mode only for now.

The highlight test runs once per geometry build, not per frame: flags
parallel the point buffer index-for-index (the same discipline as the
animation phase fields — geometry arrays never reorder, parallel arrays
annotate them), and the draw loop batches colour switches on flag runs.

## Land styles (v0.5)

One option, four values, **identical on the flat map and the globe**:

```html
<world-map land="dots"></world-map>           <!-- the dot field (default) -->
<world-map land="solid"></world-map>          <!-- filled landmass -->
<world-map land="outline"></world-map>        <!-- coastline only -->
<world-map land="solid outline"></world-map>  <!-- filled, coast on top -->
```

`land` is a space-separated token list, so combinations read the way you would
say them. `filled` and `stroke` are accepted as synonyms; order and case do not
matter.

| Option | Default | What it paints |
|---|---|---|
| `land-color` | `dot-color` | the fill |
| `land-stroke` | `land-color` → `dot-color` | the coastline |
| `land-stroke-width` | `1` | coastline weight |

All three accept `var(--x)`, like every other colour.

### One geometry, not three renderers

`solid`, `outline` and `solid outline` are three renderings of a **single**
geometry — the closed boundary contours traced once in `land.js` and exported as
`buildLand(grid)`. That matters for a reason you can see: an outline traced from
per-cell rectangles strokes every internal cell edge and draws a wireframe. A
contour is only ever drawn where land meets sea, so the coast is a coast. The
rings are closed and consistently wound (outer clockwise, holes
counter-clockwise), so the same path data also fills correctly with inland seas
left empty — no second code path, nothing to drift.

The globe splits fill and stroke deliberately, because a sphere is not a plane:
the coastline is stroked from those same contours and broken at the limb, while
the fill is painted as projected per-cell quads — a closed ring that crosses the
limb is no longer closed in screen space and cannot be filled, whereas quads
tile into the same landmass and cull one by one. Same geometry, same option
names, same result to the eye.

```js
import { buildLand, parseLandStyle } from "mappo";
const { cells, loops } = buildLand({ cols: 120, rows: 47, latRange: [-58, 84] });
// loops: closed rings in grid-corner coordinates — yours to project or stroke
```

## Roll — the lean (v0.5)
## Roll — the lean (v0.5)

```html
<world-map mode="globe" roll="-14.3" tilt="12"></world-map>
```

`roll` turns the finished globe in the plane of the screen; `tilt` leans its
axis away from the viewer. They are different gestures and they compose — roll
is the "globe sitting at an angle" look, tilt is foreshortening. Roll is applied
last, to the projected point, so dots, graticule, markers, hit-testing and DOM
overlays all rotate together. Hit-testing un-rolls the pointer first.

## The graticule (v0.5)


```html
<world-map mode="globe" graticule meridians="24" parallels="23"
           graticule-color="var(--color-border)" equator-color="var(--color-accent)"
           graticule-opacity="0.28" equator-opacity="0.6"></world-map>
```

Meridians are evenly spaced longitudes from −180; parallels are evenly spaced
latitudes between the poles. Two rules are baked in because they are what makes
a graticule readable rather than noisy:

- **The equator is its own line**, with its own colour and opacity. It is what a
  reader orients against; drowning it among eleven identical parallels wastes it.
- **A parallel that would land within 5° of the equator is dropped.** Evenly
  spacing an odd number across 180° puts one exactly on 0°, which double-draws
  the equator at double opacity and reads as a bug. `parallels="23"` therefore
  yields 22 lines plus the equator.

Lines break at the limb and fade with depth, so the near and far side of the
same circle never flatten into one ellipse. Globe mode today; the geometry
(`buildGraticule`) is renderer-agnostic and exported.

## Colours from CSS variables (v0.5)

Any colour option accepts `var(--name)` — with an optional fallback:

```html
<world-map dot-color="var(--brand-500, #d3dce6)"
           graticule-color="var(--border)"></world-map>
```

They resolve against `document.documentElement` and **re-resolve when the theme
changes**: mappo watches `class`, `style` and `data-theme` on the root element,
drops its memo, and repaints. Your dark mode just works, with no JavaScript on
your side. A map whose colours are all literals installs no observer and pays
nothing.

## Overlays: your DOM, our geometry (v0.5)

Put your own markup inside `<world-map>` with `data-lat`/`data-lon` and mappo
positions it:

```html
<world-map mode="globe" graticule>
  <a class="pin" data-lat="38.7" data-lon="-9.1" href="/lisbon"><span>Lisbon</span></a>
  <a class="pin" data-lat="35.7" data-lon="139.7" href="/tokyo"><span>Tokyo</span></a>
</world-map>
```

This exists because labels usually need to be *real*: crawlable, translatable,
focusable, styled by your own stylesheet. Painting them into canvas forfeits all
of that. So mappo writes exactly one thing per element — a `transform` — and
publishes two hooks:

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

**Use a wrapper plus an inner element**, as above. mappo rewrites the wrappers
`transform` every frame on the globe; if that same element also carried an eased
`transform`, the transition and the frame loop would fight. Keep position on the
outside, appearance on the inside.

The overlay layer is `pointer-events: none` so it never eats drag-to-spin — a
label that should be clickable sets `pointer-events: auto` on itself. Flat maps
use the same attributes and CSS hooks, written once per build instead of per
frame. Turn the whole thing off with `overlays="false"`.

## Placing your own overlays (v0.5)

If you would rather position something yourself — in a server template, say —
`projectNormalized` is the contract:

```js
import { projectNormalized } from "mappo";
const { x, y } = projectNormalized(38.9, -10.1, { latRange: [-56, 78] });
// → { x: 0.4719, y: 0.2918 }  →  left: 47.19%, top: 29.18%
```

`project` answers in grid units and needs `rows`, which mappo derives
internally — so asking a host for it forces that host to re-derive mappo's
arithmetic and keep it correct forever. Normalized coordinates need nothing but
`latRange`, and map straight onto CSS percentages.

## Backdrop


Three knobs fill the empty space, in either mode:

```html
<world-map mode="globe" ocean-color="#e8eef5" background="#f8fafc"
           globe-ring="true"></world-map>
```

- `dot-hover-color` defaults to **auto**: a contrast-aware shade of
  `dot-color` — darker for light dots, lighter for dark ones — so hovers
  never fall back to somebody else's gray. Set it (or `dot-hover-scale`)
  to override.
- `ocean-color` — water cells render as smaller filler dots in their own
  shade (think off-white on light pages, off-dark on dark ones). In flat
  mode this is a single SVG pattern — one node, any resolution, and it
  patches as pure style. Default `none`.
- `background` — a uniform fill behind everything: full-bleed rect in flat
  mode, the planet disc in globe mode. Default `none`.
- `globe-ring="true"` — adds a hairline halo around the globe (off by default).

## The JS API

```js
import { WorldMap } from "mappo";

const map = new WorldMap(document.querySelector("#hero-map"), {
  cols: 140,                       // dots across the world — the resolution
  latRange: [-58, 84],             // default framing cuts Antarctica
  dotShape: "circle",              // "circle" | "square" | "triangle" | SVG path (24×24)
  dotSize: 0.55,                   // fraction of a grid cell
  dotColor: "#d3dce6",
  dotHoverColor: "#94a8bd",
  dotHoverScale: 2.2,
  cities: [
    "Tokyo", "Berlin",             // the built-in registry (~160 cities)
    { name: "HQ", lat: 41.4, lon: 2.2, color: "#ff9900" } // or your own coords
  ],
  markerShape: "circle",
  markerColor: "#2262fe",
  markerPulse: false,
  tilt: 40,                        // the lying-down hero look (rotateX, deg)
  perspective: 1000,
  animation: "none",                 // "wave" animates the whole matrix
  cursor: "default",
  markerCursor: "pointer",
  onCityClick: ({ name }) => console.log(name)
});

map.update({ markerColor: "#ff3b30" }); // re-render with new options
map.destroy();
```

Lower-level pieces are exported too — `isLand(lat, lon)`, `project`,
`cellCenter`, `snapToLand`, and the `CITIES` registry — if you want to build
your own renderer on the same data.

## Styling

The component renders into light DOM with plain classes (`.wm-dot`,
`.wm-marker`, `.wm-svg`, `.wm-tilt`) — your stylesheet wins. The built-in
styles are defaults, not law. `prefers-reduced-motion` disables all
animation automatically.

## Design notes

### Two renderers, on purpose

The flat map is SVG. The globe is canvas. This is not an accident of
history or a migration in progress — each renderer matches the physics of
its mode, and neither should become the other.

**Why the flat map stays SVG:**

1. **SVG-ness is a feature, not an implementation detail.** Dots are real
   DOM elements: you restyle `.wm-dot` from your own stylesheet, markers
   are focusable, hover states are plain CSS, everything shows up in
   devtools, and the output is vector-crisp at any zoom and in print.
   Every canvas map library forfeits all of that. It's the reason this one
   is different.
2. **The performance math favors SVG in flat's actual regime.** A static
   SVG map costs *zero* per frame after render — and flat maps are static
   almost all the time; they re-render only when options change, which the
   differential update tiers make nearly free (style patches never touch
   geometry). Animations run as CSS keyframes: compositor-eligible,
   browser-scheduled, `prefers-reduced-motion` handled for free. A canvas
   flat map would burn main-thread JavaScript every animated frame,
   forever, to reproduce what the browser already does better.
3. **SVG only loses above ~7k animated nodes** — which is exactly the
   regime the density load gate and the cols cap already govern. The
   escape hatch for extreme grids (cols ≫ 260) is a future opt-in
   `renderer: "canvas"` behind the same options, built when someone
   actually needs 500 cols — not a wholesale conversion.

**Why the globe is canvas:**

A rotating globe re-projects every dot every frame. That's thousands of
per-frame position writes — as DOM attributes, it's the exact failure mode
the flat renderer's architecture exists to avoid; as canvas fills, it's
nothing. The globe gives up SVG's styling hooks (and re-earns the
interactive ones through inverse-projection hit-testing, so events work
the same in both modes) in exchange for a renderer that can spin at max
resolution without dropping frames.

Same options, same events, same land data — `mode` just picks the
renderer whose physics fit.

### The rest

- **Equirectangular on purpose**: this is a *symbolic* map. Linear lat/lon
  matches both the packed mask and everyone's mental world map.
- **Coastal snapping**: city coordinates snap to the nearest land dot
  (harbors sit in sea cells at coarse resolutions; a marker floating off
  the coast looks broken).
- **Globe mode is a renderer swap, not an API fork**: coordinates are
  lat/lon everywhere, the option surface is shared, and `tilt` means "lean
  the world" in both modes — CSS rotateX when flat, axial tilt when globe.

## Performance

Measured, budgeted, and regression-tested (`demo/perf.html` runs scripted
abuse with hard budgets; `test/` locks the update architecture). The rules
of thumb the numbers produced:

| you want | keep |
|---|---|
| an animated hero (`animation` on) | `cols ≤ 180` (≈4.5k dots) — full smoothness |
| an animated map at higher density | the built-in load gate animates a baked subset above 4.5k/7k dots automatically |
| maximum resolution (`cols` 200–260) | `animation="none"` — static maps stay cheap at any size |

Resolution changes are debounced adaptively (spacing self-tunes to your
machine's measured frame cost), style/color/animation knobs never rebuild
geometry, and SVG stays the renderer up to 260 cols — dots are real,
hoverable, restylable elements. A canvas mode for extreme grids is on the
roadmap behind the same options.

## Data

Land shapes derived from [Natural Earth](https://www.naturalearthdata.com)
(110m land polygons, public domain), rasterized into a 512×256 bitmask at
build time by `scripts/generate-mask.js`. Regenerate any time; consumers
never run it.

## Development

```bash
node scripts/generate-mask.js   # refresh src/mask.js from Natural Earth
node scripts/build.js           # bundle src/ → dist/mappo.js
node --test test/               # the suite runs against dist/
```

## License

MIT © rameerez. Land data: Natural Earth (public domain).
