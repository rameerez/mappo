# mappo — handoff

**Written:** 2026-09-01. **Branch:** `main`. **HEAD:** `756baff`.
**Pushed:** no — `origin/main` is at `a1890d1`. Three local-only commits.

This document is written for an agent picking the project up cold, and
deliberately for one that will be **adversarially reviewed**. It discloses
known bugs, unverified claims, shortcuts, and the places I am least confident.
Where I assert something is verified, the method is stated so you can re-run
it. Where I am guessing, it says so.

---

## Table of contents

1. [What mappo is](#1-what-mappo-is)
2. [Repo map](#2-repo-map)
3. [Architecture](#3-architecture)
4. [Where this session came from](#4-where-this-session-came-from)
5. [The body-pack work: problem, options, decision](#5-the-body-pack-work)
6. [What was actually built](#6-what-was-actually-built)
7. [The data generation pipeline](#7-the-data-generation-pipeline)
8. [Every bug found this session](#8-every-bug-found-this-session)
9. [Verification: what is actually proven](#9-verification-what-is-actually-proven)
10. [Known bugs and technical debt](#10-known-bugs-and-technical-debt)
11. [Open design questions](#11-open-design-questions)
12. [Recommended next steps](#12-recommended-next-steps)
13. [How to run everything](#13-how-to-run-everything)
14. [Adversarial review guide](#14-adversarial-review-guide)

---

## 1. What mappo is

A **world map as a zero-dependency web component**. Package `mappo`, v0.6.0,
MIT, by `rameerez`, repo `github.com/rameerez/mappo`, homepage
`rameerez.github.io/mappo/`.

The pitch: one `<script type="module">`, one custom element, no build step.

```html
<mappo-world cities="London, Lagos, Singapore" tilt="40"></mappo-world>
```

It ships **two renderers behind one options surface**:

- **flat** — SVG. A dot field (the thing it is named for), or filled/outlined
  landmasses, plus graticule, borders, markers, animations.
- **globe** — canvas. Orthographic projection, hemisphere culling, limb
  foreshortening, halo ring, axial tilt, drag-to-spin with momentum,
  inverse-projection hit-testing.

Both accept the same attributes. Switching `mode` swaps renderers.

**Who uses it:** the author's own projects (a VehiclesDB hero is cited in
`TODO` as the first production showcase). It is **pre-release** — the user
stated explicitly this session: *"our library is still in pre-release so
there's no one using it other than us -- no need for backwards compat."*
That is the standing licence for breaking changes, and it is load-bearing for
several recommendations below.

**What it is for:** hero sections, dashboards, and — increasingly — full-page
marketing showpieces (see §4).

---

## 2. Repo map

```
src/                    the library (hand-ordered module graph, no bundler)
  index.js              re-exports + auto-register. NOT concatenated into dist.
  element.js    (180)   <mappo-world> custom element, ATTR_MAP, register(),
                        defineBodyElement()
  renderer.js   (972)   Mappo class: flat SVG renderer + orchestration,
                        differential update tiers, caches, locate()
  globe.js     (1138)   GlobeRenderer: canvas orthographic globe
  body.js        (87)   NEW — the body seam. EARTH, registerBody, resolveBody,
                        knownBodies, trackMap, untrackMap
  land.js       (139)   buildLand (contour tracing), parseLandStyle,
                        landRings, borderRings
  mask.js        (19)   Earth's packed 512x256 land bitmask + isLand()
  shapes.js      (56)   Earth's vector coastlines + country borders (decoder)
  cities.js     (106)   Earth city gazetteer, accent-folding lookup
  projection.js  (57)   project, cellCenter, cellCorner, projectNormalized
  graticule.js   (59)   meridians/parallels/equator geometry
  highlight.js   (33)   ray-cast point-in-rings
  color.js       (45)   CSS var resolution, hover shades
  noise.js       (35)   2D value noise for animation phase fields
  bodies/
    moon.js      (97)   GENERATED. MOON + MOON_SITES
    mars.js     (100)   GENERATED. MARS + MARS_SITES

scripts/
  build.js       (63)   concatenates src/ into dist/mappo.js + dist/bodies/*
  generate-mask.js(104) Earth bitmask from a raster
  generate-shapes.js(201) Earth vectors from Natural Earth
  generate-moon.js(363) GENERATES src/bodies/moon.js
  generate-mars.js(394) GENERATES src/bodies/mars.js

test/                   46 tests, node --test, NO DOM
  core.test.js, globe.test.js, graticule.test.js, land.test.js, update.test.js

demo/
  index.html            the demo gallery (links: land, orbit, perf,
                        satellites, v05, v05b, year)
  worlds.html           NEW — the body-pack showcase. NOT LINKED FROM ANYWHERE.
  satellites.html       full-page Starlink + ISS experience
  year.html             full-page Earth-orbit / sun-view experience
  land.html, orbit.html, perf.html, v05.html, v05b.html
  sgp4.js, astro.js, timectl.js, clocks.js   shared demo modules
  data/starlink.tle, data/iss.tle

index.html              the landing page
dist/mappo.js           GENERATED, COMMITTED (CI enforces it is current)
dist/bodies/{moon,mars}.js  GENERATED, COMMITTED
.cache/                 NEW, gitignored — source rasters for the generators
TODO                    product roadmap
README.md         (501) does NOT mention bodies at all
docs/teardown-cloudflare-globe.md
```

---

## 3. Architecture

### 3.1 The build

There is **no bundler**. `scripts/build.js` holds a hand-ordered list:

```js
const MODULES = ["mask.js", "projection.js", "graticule.js", "shapes.js",
  "body.js", "land.js", "noise.js", "color.js", "cities.js", "highlight.js",
  "globe.js", "renderer.js", "element.js"];
```

It strips `^import ...;` lines and concatenates. Everything lands in one
scope. `index.js` is *not* concatenated — its re-exports and auto-register are
reproduced in a footer.

Consequences you must know:

- **Aliased imports break silently.** `import { isLand as earthIsLand }` has
  its import line deleted, leaving `earthIsLand` undefined at runtime. There is
  now a **build-time guard** that throws on any `import { ... as ... }` in a
  concatenated file. This guard exists because it already bit us (§8.3).
- **Every module-level `export` becomes a package export.** `src/index.js`
  declares ~20 exports; `dist/mappo.js` actually exports **39**, including
  `GlobeRenderer`, `buildGlobePoints`, `buildGlobeFlags`, `buildGlobePhases`,
  `normalizeRings`, `pointInRings`, `trackMap`, `untrackMap`. This is an
  **accidental public API surface** (see §10.7).
- `dist/` is committed and CI runs `git diff --exit-code dist/`, so a source
  change without a rebuild fails CI.

### 3.2 The rendering pipeline

```
body.isLand(lat, lon)          the binary
        |
   buildLand(grid, {wrapX, body})
        |
   { cells, loops }            cells for fills, closed contours for coastline
        |
  flat: SVG path (loops x CELL)     globe: project each corner to the sphere
```

`land-source` picks between two levels of detail of the *same* boundary:

- `"grid"` — contours traced from the packed bitmask. Blocky by design,
  follows `cols`, zero extra bytes, and the only source the dot field agrees
  with.
- `"vector"` — pre-traced rings, smooth at any size, independent of `cols`.

`land="dots | solid | outline | solid outline"` are three renderings of **one**
geometry. This matters: contours (not per-cell rectangles) mean the stroke is a
real coastline, and because the loops are closed and consistently wound
(outer clockwise in screen space, holes counter-clockwise), the same path data
also fills correctly under `fill-rule: nonzero` — inland seas stay empty with
nobody declaring them.

### 3.3 The differential update

`Mappo.update(options)` diffs against current options and picks the cheapest
sufficient refresh:

- callbacks only → no work
- globe mode → cheap buffer/style refresh (`PAINT_ONLY` set)
- `mode` change → renderer swap via `#scheduleRebuild()`
- `body` change → **full rebuild** (added this session, §8.5)
- geometry keys (`cols`, `latRange`, `interactive`) → full rebuild
- style keys → attribute patch

Two per-instance caches live in `this._dotsCache`:
- `land|<body>|<landSource>|<borders>|<cols>|<latMin>|<latMax>` → land markup
- `<body>|<cols>|<latMin>|<latMax>` → dot markup

Both keys now carry the body id. They did not until `756baff`, which is §8.5.

### 3.4 The custom element

`element.js` maps ~50 attributes to options via `ATTR_MAP`. Two subtleties:

**Absent attribute means DEFAULT, not "last value".** `#optionsFromAttributes`
resets any absent attribute to `DEFAULTS[key]`. Without this, removing an
attribute never un-sets its option and every boolean latches on forever. This
behaviour directly caused §8.4.

**The element is defined in the light DOM**, on purpose, so consumers restyle
`.mappo-dot` with plain CSS.

---

## 4. Where this session came from

This was a long session, mostly outside the library itself. Rough arc, in
order, because it explains why the demo surface is now so large:

1. **Terminator polish** on the landing page — day/night on the flat map.
   Went through several rejected designs (a film over the map, stacked
   twilight bands, a blurred shadow). Ended as **two maps**: a day map and a
   separate night map clipped to the terminator. Root cause of a recurring
   "vertical strips" bug: night was modelled as *a curve filled to the pole*,
   but below about -9 degrees near equinox the cap does not reach the pole, so
   `terminatorLat` returned the wrong pole and blacked out columns. Fixed with
   a `capSpan()` formulation.
2. **Landing page revamp.**
3. **`<world-map>` renamed to `<mappo-world>`** — no backwards compat, by
   explicit instruction.
4. **`demo/satellites.html`** — full-page Starlink + ISS visualisation. Real
   SGP4 (near-Earth branch, WGS-72), TLE parsing, GMST/IAU-82, TEME to
   geodetic. Explicitly framed by the user as *"a marketing gimmick to attract
   attention to mappo."*
5. **`demo/year.html`** — full-page Earth orbit and rotation around the Sun.
   Kepler by Newton, JPL Keplerian elements plus rates, precession, nutation,
   aberration, equation of time. A "sun's-eye Earth" widget became the page's
   main element. Shares DRY time controls (`timectl.js`) and a UTC/Zulu master
   clock (`clocks.js`, 12 cities) with the satellites page.
6. **Body packs** — this handoff's subject. Started as *"just exploratory"*,
   became *"let's just prototype it... see if we like it and if it has a good
   fit with Mappo and we are able to draw the right seams."*

The demo pages are large single-file HTML documents with their own CSS token
sets. They are impressive and they are now the biggest, least-tested surface
in the repo. See §11.4.

---

## 5. The body-pack work

### 5.1 The ask

> *"any chance we could abstract + generalize Mappo not only for Earth but to
> the Moon and/or Mars? ... It would be cool as hell to do another full-screen
> experiment where we explore moon vs earth, where we imagine and pinpoint the
> future Moon base location(s) by SpaceX, where we imagine future cities on
> Mars"*

then

> *"let's not force everyone to download mars + moon etc, maybe we can do
> modules ... make other celestial bodies opt-in kinda ... see if we are able
> to draw the right seams and get the right solution shape."*

So: **generality without a size tax**, and the real deliverable was **evidence
about whether the seam is right**, not just working pixels.

### 5.2 Mechanisms considered

**(a) A `body` option carrying raw data (mask bytes + rings).**
Rejected: it makes the engine own decode logic per body and forces every body
into Earth's exact data representation. A body that wants a procedural
`isLand` (a fictional planet, a Voronoi world) could not exist.

**(b) Subclass `Mappo` per body.**
Rejected: bodies differ in *data*, not *behaviour*. Subclassing would mean
`MoonMappo extends Mappo` overriding nothing but constants, and it composes
badly with the custom element (you would need a class per body anyway, and
consumers would have to pick a class instead of writing markup).

**(c) A global "current body" setting.**
Rejected outright: two maps on one page must be able to show different bodies.
`demo/worlds.html` puts Earth, Moon and Mars side by side, which this makes
impossible.

**(d) A body is a small object satisfying an interface, handed over at
runtime. CHOSEN.**

```js
{
  id, name, radiusKm, latRange,
  terms: { inside, outside },
  isLand(lat, lon),            // the binary everything derives from
  rings(source),               // vector outlines, or null
  borders(),                   // political borders, or null
  maskSize: [W, H]
}
```

The engine asks a body six questions and never a seventh. Earth is not
special — it is only the body that ships in the box.

### 5.3 Why opt-in, and how

Earth's mask and coastlines are ~28 KB gzipped of a 75.6 KB bundle. A library
that made you download the Moon to put a world map in a hero section would
have lost the plot. So packs are **separate files that import nothing from the
engine** and are handed over by the consumer:

```js
import { registerBody, defineBodyElement } from "mappo";
import { MOON } from "mappo/bodies/moon";
registerBody(MOON);
```

**The late-arrival problem.** mappo defines its custom element *as it loads*,
which upgrades every `<mappo-world body="moon">` on the page **before the
consumer's own first line runs**. So a pack always arrives late.

Options considered: (i) document a required script order — rejected, nobody
can enforce it and it fails silently; (ii) defer element definition until an
explicit `mappo.start()` — rejected, breaks the zero-JS promise; (iii) **track
live maps and redraw them when their body registers** — chosen.

```js
const LIVE = new Set();
export const trackMap = (m) => LIVE.add(m);
export const untrackMap = (m) => LIVE.delete(m);

export function registerBody(body) {
  REGISTRY.set(id, body);
  for (const m of LIVE) {
    if (String(m.options?.body ?? "").toLowerCase() === id) m.adoptBody(body);
  }
  return body;
}
```

**This mechanism was broken until commit `756baff` and shipped broken in
`0b06a06`.** See §8.5. It is fixed and verified now, but it is the single most
important thing for a reviewer to re-check, because it is the primary
documented path and the tests cannot see it.

An unknown body name **warns and falls back to Earth** rather than throwing:
a world map that renders Earth is a better failure than a blank page. This is
a judgement call and is worth challenging — it also means a typo in `body=`
silently renders the wrong planet.

---

## 6. What was actually built

### 6.1 The Moon pack (`src/bodies/moon.js`, 11.5 KB gzipped)

- Data: Clementine 750 nm global albedo mosaic, simple cylindrical, public
  domain (NASA/USGS).
- Binary: **maria against highlands**, thresholded so maria are 16% of the
  sphere (the published figure).
- 512x256 packed bitmask, 1 bit/cell, base64.
- **161 vector rings**, 5685 points, traced from the same threshold.
- `latRange: [-90, 90]`, `radiusKm: 1737.4`,
  `terms: { inside: "maria", outside: "highlands" }`, `borders: () => null`.
- `MOON_SITES`: 15 entries — 6 Apollo, robotic (Luna 9, Chang'e 4/6), and 5
  Artemis candidate regions, each `{ name, lat, lon, kind }`.

**`POLE_CUT = 72`.** Beyond 72 degrees latitude the mosaic is *shadow*, not
basalt. Discovered by latitude-band profiling: 75-90N read 21% dark against
0.1% just below. Without the cut the Moon grows fake polar maria.

**Honest caveat, stated in the generated file:** this binary is an
*interpretation*, unlike Earth's coastline. Mare boundaries are gradational —
basalt thins out rather than stopping at a line — so the edge is a brightness
level, not a shore.

### 6.2 The Mars pack (`src/bodies/mars.js`, 8.9 KB gzipped)

- Data: MOLA global topography, colour-ramped, public domain (NASA/MGS via
  Wikimedia).
- Binary: **the crustal dichotomy** — northern lowlands against southern
  highlands — thresholded to one third of the surface, the published figure.
- **28 vector rings**, 2255 points. `radiusKm: 3389.5`,
  `terms: { inside: "lowlands", outside: "highlands" }`.
- `MARS_SITES`: landing sites plus candidate regions.

Two findings worth preserving:

- **The ramp direction was inverted.** `lum = 300 - height` selected the high
  ground. Corrected to `lum = height`.
- **The source map runs 0-360E, not -180..180.** This was *found*, not
  assumed: rolling it half a turn lifted correlation with published elevations
  from **-0.08 to 0.889**.

### 6.3 Vector outlines for both

Previously only Earth had vector rings; other bodies were pixels only. Both
packs now trace contours at full source raster resolution, chain them into
closed rings, simplify with Douglas-Peucker at 0.22 degrees, and encode with
the same quantise/delta/zigzag/varint/base64 scheme `generate-shapes.js` uses
for Earth. So `land-source="vector"` vs `"grid"` is the *same* two-levels-of-
detail relationship Earth already had.

### 6.4 Tag aliases

```js
defineBodyElement("mappo-moon", "moon");
```

`<mappo-moon>` reads better than `<mappo-world body="moon">`. The tag supplies
a **default**, never an override — `<mappo-moon body="mars">` is a strange
thing to write but it means Mars, because the attribute is the truth.
`register("mappo-earth")` ships in the auto-register footer.

**Cost:** one subclass per tag. `customElements.define` refuses the same
constructor twice, and reusing it threw `NotSupportedError` *and took
`mappo-world` down with it* (§8.2).

### 6.5 `demo/worlds.html`

Five sections: opting in (code sample), outlines-vs-pixels (Moon globe, side
by side), flat maps for both bodies, a Mars landing-sites globe, and three
worlds at true relative scale. **It is not linked from the demo gallery or the
landing page.**

---

## 7. The data generation pipeline

Both generators follow the same shape. They are ~370 lines each and are
**near-identical copies** (§10.2).

```
raster (BMP)
  -> read pixels (hand-rolled BMP reader; the repo has no image decoder)
  -> luminance per pixel
  -> AREA-WEIGHTED threshold search: binary search the threshold until the
     cos(lat)-weighted dark fraction hits the published target
  -> sanity checks against named places (throws if any fail)
  -> 512x256 packed bitmask (1 bit/cell, base64)
  -> contour trace at FULL source resolution
  -> chain directed edges into closed rings
  -> Douglas-Peucker simplify (EPS = 0.22 deg) with a closed-ring anchor split
  -> quantise 1/32 deg, delta, zigzag, varint, base64
  -> write src/bodies/<body>.js
```

**Area weighting matters.** A naive pixel count over-weights the poles in an
equirectangular raster. The search weights each row by `cos(lat)`.

**The sanity checks are assertions, not tests.** Mars checks eight named
places spanning -7 km (Hellas) to +21 km (Olympus Mons). The Moon checks five.
The generator *throws* if any fail, so a bad threshold cannot be committed.

**Source rasters.** They lived in `/tmp` and **evaporated between sessions**.
They now live in a gitignored `.cache/`:

```
curl -o .cache/mars.png https://upload.wikimedia.org/wikipedia/commons/8/89/Mars_topography_%28MOLA_dataset%29.png
sips -s format bmp .cache/mars.png --out .cache/mars.bmp
node scripts/generate-mars.js .cache/mars.bmp

curl -o .cache/moon.jpg https://upload.wikimedia.org/wikipedia/commons/e/ea/Clementine_albedo_simp750.jpg
sips -s format bmp .cache/moon.jpg --out .cache/moon.bmp
node scripts/generate-moon.js .cache/moon.bmp
```

`sips` is macOS-only. **The generators are not reproducible on Linux/CI** as
documented (§10.6).

**Note on the Mars threshold value.** Before the rasters were lost, the run
reported `threshold 64.2 -> 33.3% low`. After re-fetching, it reports
`threshold 136.3 -> 33.3% low`. Same target fraction, same eight checks pass,
different luminance scale — almost certainly a different rendition or a
different `sips` gamma path. **I did not chase this down.** It is benign
*given* the checks, but it means the pipeline is not byte-reproducible from
the documented commands, and a reviewer may reasonably want that nailed.

---

## 8. Every bug found this session

Presented root-cause-first, because several are the interesting kind.

### 8.1 Aliased import lost by the bundler

`import { isLand as earthIsLand }` in `body.js`. The bundler strips import
lines, so the alias had nothing to bind and threw `earthIsLand is not
defined`. **Fixed:** un-aliased, plus a build-time guard that throws on any
aliased import in a concatenated file.

### 8.2 `register("mappo-earth")` reused the constructor

`customElements.define` accepts a given constructor **once**. Registering
`mappo-earth` with the same class threw `NotSupportedError`, and because the
throw happened inside the auto-register footer it **also took `mappo-world`
down**. **Fixed:** a fresh anonymous subclass per tag.

### 8.3 `this._body` over-applied to standalone exports

Standalone functions (`snapToLand`, `landRings`, `borderRings`, `buildLand`)
were reading a body that only exists on an instance. **Fixed:** `body = EARTH`
default parameters. Then inserting `body` mid-signature broke positional
callers (2 test failures) — **moved to the last parameter**.

### 8.4 The tag default never applied (shipped broken, then fixed)

`defineBodyElement` set `static defaultBody = "moon"`, and
`#optionsFromAttributes` checked:

```js
if (options.body === undefined && this.constructor.defaultBody) { ... }
```

But an absent attribute is reset to its **DEFAULT** (§3.4), and
`DEFAULTS.body` is `null`. So `options.body` was `null`, never `undefined`,
and the check never fired. **Every tag resolved to `earth`.** Fixed to
`if (!options.body && ...)`.

**How it was found:** not by tests — by a pixel/state probe in Chrome. The
tests pass either way.

### 8.5 `registerBody`'s late arrival never actually arrived (THE BIG ONE)

Shipped broken in `0b06a06`, fixed in `756baff`.

The documented path `<mappo-world body="moon">` upgrades when mappo loads,
*before* `registerBody(MOON)` runs — which is the entire justification for the
live-map redraw. **It redrew them as Earth.** Two independent causes:

1. **The geometry caches were not keyed on the body.** `#landMarkup` used
   `land|<source>|<borders>|<cols>|<latMin>|<latMax>` and `#dotsMarkup` used
   `<cols>|<latMin>|<latMax>`. The map drew Earth while the pack loaded,
   cached it, then "rebuilt" straight back into the cached Earth.
2. **`latRange` was applied from the body once, in the constructor**, where
   the body was still Earth. A body registering later brought no band with it.

**Fix:** both keys carry `this._body.id`; the constructor records
`_bodyOwnsLatRange` (whether the caller supplied a range); and one
`adoptBody(body)` does body + latRange + rebuild. `update()` routes a `body`
change through it and skips the patch tiers, like `mode` does.

**Measured before:** `_body` flipped to `"moon"` while the map kept Earth's
**1699** dots and Earth's `[-58, 84]`.
**Measured after:** **831** dots and `[-90, 90]`.

Reproduce it (this probe is how it was found; recreate it as
`demo/_tmp-body-order.html`, and **hard-reload `/dist/mappo.js`** or you will
test a cached bundle and conclude it is still broken):

```html
<meta charset="utf-8"><title>body order probe</title>
<mappo-world id="a" body="moon" mode="flat" cols="120" land="solid" land-source="grid"></mappo-world>
<script type="module">
  import { registerBody } from "/dist/mappo.js";
  import { MOON } from "/dist/bodies/moon.js";
  const a = document.getElementById("a");
  await new Promise(r => setTimeout(r, 300));
  const before = { body: a.map._body.id, dots: a.map._dotCount,
                   latRange: JSON.stringify(a.map.options.latRange) };
  registerBody(MOON);
  await new Promise(r => setTimeout(r, 300));
  const after = { body: a.map._body.id, dots: a.map._dotCount,
                  latRange: JSON.stringify(a.map.options.latRange) };
  window.PROBE = { before, after };
</script>
```

### 8.6 Straight chords across Mars (the user caught this one visually)

The flat Mars map showed long straight lines cutting across landmasses. The
globe was fine, because that demo uses `land-source="grid"` (the bitmask,
always correct).

**Root cause:** the contour tracer wrapped column *lookups* at the
antimeridian (`c % VW`, so the seam would not be an edge) but the corner
**keys** the chain-walker follows do **not** wrap. Any region crossing +/-180
dead-ended the walk, which hit its `break` and emitted an **open** chain — and
the renderer draws every ring as a closed subpath, joining the loose end to
the start with a straight chord.

Mars showed it and the Moon did not because **Vastitas Borealis wraps the
entire planet** while the maria sit near longitude 0 and never touch the seam.

**Fix:** the antimeridian is now a real boundary (`if (c < 0 || c >= VW)
return false`), so a wrapping region becomes two rings that each hug the seam
— which is what a cylindrical projection wants anyway. **Additionally**,
unclosed walks are now counted and **dropped**, with a build-time warning, so
a regression surfaces as a number instead of as lines across a planet.

Applied to **both** generators, since they are copies.

### 8.7 Circles-from-gazetteer for maria (discarded approach)

An early attempt built maria from a gazetteer of named seas as circles. It
gave 24% coverage against a published 16% and made the near side nearly solid.
Discarded in favour of thresholding the actual mosaic. Recorded so nobody
retries it.

### 8.8 Environmental gotchas that cost real time

- The browser aggressively caches `dist/mappo.js`. Several "the fix did not
  work" conclusions were wrong for this reason alone. **Always**
  `fetch(url, {cache: 'reload'})` for `dist/mappo.js` *and* `dist/bodies/*.js`
  before re-testing.
- Chrome's `Page.captureScreenshot` timed out repeatedly (7 attempts, across
  different pages, after freezing animation and resizing) and then recovered
  on its own. JS execution kept working throughout. If screenshots hang, it is
  the renderer's frame capture, not the page.
- `python3` exits silently on this machine. Use `perl`/`ruby` for scripted
  edits and verify on disk.

---

## 9. Verification: what is actually proven

The project has a genuine habit of **measuring rather than eyeballing**, and
this is its strongest quality signal. But be precise about what is proven.

### Independently checked against the outside world

| Claim | Method | Result |
|---|---|---|
| Moon threshold | near-side maria fraction, **not tuned on** | 30.3% vs published ~31% |
| Mars threshold | 8 named places, -7 km to +21 km | all 8 correct |
| Moon places | Crisium, Imbrium, Tranquillitatis, far side, south pole | all 5 correct |
| Mars longitude convention | correlation with published elevations | -0.08 -> 0.889 after roll |
| SGP4 (demo) | vs wheretheiss.at | within 340 m |
| Equation of time (demo) | 4 annual extremes | within 0.06 min |
| Euler decomposition | round-trip error | 3.9e-16 |
| Terminator cap | 1.78M-sample verification | passed |

The Moon's 30.3%-vs-31% is the best of these: it is a **held-out** check, not
the quantity being fitted.

### Proven by the test suite (46 tests, `node --test`)

Pure geometry and data: mask lookups, projection inverses, graticule spacing,
`buildLand` closure and cell-count agreement, city folding, `parseLandStyle`,
update-tier coalescing, `DEFAULTS` consistency.

### NOT proven, and this is the important part

**The test suite runs entirely without a DOM.** There is no jsdom, no browser
harness. So nothing that requires an element to upgrade is testable, which is
exactly where both of this session's shipped bugs lived (§8.4, §8.5).

Note the irony: `test("buildLand: memoized per grid + wrap")` and
`test("dot geometry caches per resolution")` both exist — they test the cache
dimension *next to* the one that was broken.

**Everything about the body packs is verified by browser probes and
screenshots only**, recorded in this document but not automated. If you change
anything in `body.js`, `element.js`, or the renderer caches, **you have no
regression net.** Fixing that is recommendation #1 in §12.

---

## 10. Known bugs and technical debt

Ranked by what I would fix first.

### 10.1 The vocabulary is lying, and it is load-bearing

Options are still `land`, `ocean`, `land-color`, `land-stroke`, `landSource`,
`dotColor`, `oceanColor`. On Mars, `land` means *lowlands*; on the Moon it
means *maria*. `EARTH.terms = { inside: "land", outside: "ocean" }` exists on
every body **and is wired to nothing** — grep it, no consumer.

This is the line between "mappo generalizes to other bodies" and "mappo has an
Earth-shaped API with a body parameter bolted on." It gets more expensive with
every body and every demo page. **The user has explicitly authorised breaking
changes** (pre-release, no external users), so the cost is at its lifetime
minimum right now.

Candidate renames: `land` -> `surface` / `region` / `figure`;
`ocean-color` -> `ground-color`. No decision has been made. This needs the
user's taste, not an agent's guess.

### 10.2 Two 370-line generators that are the same file

`generate-moon.js` (363) and `generate-mars.js` (394) share the BMP reader,
the area-weighted threshold search, the contour tracer, the chainer,
Douglas-Peucker, and the encoder. **I fixed §8.6 in both by patching them in
lockstep.** That works exactly once. Extract `scripts/lib/raster-body.js`
before a third body.

### 10.3 No DOM in the test suite

See §9. Both shipped bugs were invisible to 46 passing tests. Minimum viable
fix: add `jsdom` (dev dependency only) and three tests:

1. `<mappo-moon>` resolves to the moon body.
2. `<mappo-world body="moon">` + late `registerBody(MOON)` ends with the
   Moon's dot count and the Moon's `latRange`. (This is §8.5 exactly.)
3. Switching `body` on a live element changes the rendered geometry.

Add a fourth in the generators: **assert every emitted ring is closed** (the
counter added in §8.6 warns; make it throw).

### 10.4 `hideOverlaysUntilDefined` only ever fires for the first tag

```js
function hideOverlaysUntilDefined(tag) {
  if (typeof document === "undefined" ||
      document.getElementById("mappo-upgrade-style")) return;   // <-- here
  ...
  style.textContent = `${tag}:not(:defined) [data-lat][data-lon]{visibility:hidden}`;
}
```

The guard is keyed on the style element existing at all, not on the tag. The
auto-register footer runs `register()` first, which creates the style for
`mappo-world` — so `mappo-earth`, `mappo-moon` and `mappo-mars` **never get
their rule**. Overlay children on those tags will flash in the element corner
before upgrade.

**Not yet fixed. Not yet observed in the wild** (worlds.html's overlays are
built in JS *after* registration, which sidesteps it). Fix: accumulate
selectors into the one style element, or key the guard per tag.

### 10.5 `mappo/bodies/moon` is not a valid import specifier

`package.json` declares:

```json
"exports": { ".": "./dist/mappo.js" }
```

There is **no `./bodies/*` subpath**. So the import shown in `body.js`'s
header comment, in `demo/worlds.html`'s code sample, and in §5.3 of this
document — `import { MOON } from "mappo/bodies/moon"` — **would fail from
npm**. It works in the demos only because they import by path
(`/dist/bodies/moon.js`).

Fix: add `"./bodies/*": "./dist/bodies/*.js"`. Also `files` already includes
`dist/`, so the packs would ship. Also update `description` and `keywords`,
which say nothing about bodies.

### 10.6 The generators are macOS-only

They depend on `sips` for format conversion. CI cannot regenerate a pack.
Acceptable while packs are generated by hand and committed, but it should be
written down (it is now) and ideally replaced with a tiny PNG/JPEG decode step
or a checked-in intermediate.

### 10.7 The npm package exports 39 symbols, `index.js` declares ~20

Because the bundle concatenates modules with `export` intact, internals became
public API: `GlobeRenderer`, `buildGlobePoints`, `buildGlobeFlags`,
`buildGlobePhases`, `normalizeRings`, `pointInRings`, `trackMap`,
`untrackMap`. Nobody chose this. Before 1.0, either strip non-index exports in
the build or accept and document them.

### 10.8 No per-body gazetteer

`cities.js` is Earth's, hardcoded. `MOON_SITES` / `MARS_SITES` live in the
packs with a **different shape** (`{name, lat, lon, kind}`) and are not
reachable through the `cities=` attribute. So there are two unrelated
mechanisms for "named points on a body". A body should probably be able to
answer `sites()` the way it answers `rings()`.

### 10.9 `demo/worlds.html` is an orphan

Not linked from `demo/index.html` (which links land, orbit, perf, satellites,
v05, v05b, year) nor from the landing page.

### 10.10 Smaller items

- `README.md` (501 lines) does not mention bodies at all.
- The Mars landing-sites globe in `worlds.html` still uses
  `land-source="grid"` and looks visibly blocky beside the crisp vector Moon.
  Mars has 28 rings now; switch it. Small change, and it is that page's
  centrepiece.
- The thin light strip along Mars' north edge is **Planum Boreum**, not an
  artifact — the polar cap is genuinely elevated and the MOLA ramp puts white
  at the top of the scale, so the threshold classes it as highland.
  Defensible, but it interrupts the "one clean line around the planet" caption.
- `simplifyRing`'s closed-ring split anchors at `open[0]` and the farthest
  point, but segment `b` runs `far -> n-1` **without wrapping back to
  `open[0]`**, so points near the end are never tested against the closing
  edge. Conservative (keeps too many points), not a correctness bug. Cheap to
  improve.
- `update()` re-resolves the body but the `latRange` re-application now lives
  in `adoptBody`. Verify a `lat-min`/`lat-max` attribute *plus* a body change
  behaves sensibly — I did not test that combination.
- `TODO` still lists v0.3/v0.5 arcs and has no body-pack section.

---

## 11. Open design questions

These need the user, not an agent guessing.

### 11.1 Is mappo a world-map component or a planetary visualization toolkit?

The body packs are a genuine extension of the core. SGP4, Kepler solvers,
precession and nutation are a **different library wearing mappo's coat** —
excellent marketing, and now the largest and least-tested surface in the repo.
This determines whether the next hard problem is "Mars gazetteer" or "orbit
propagation accuracy", and those pull in opposite directions.

### 11.2 npm layout

The user floated *"I can create the mappo org on npmjs or something."*
Options: subpath exports on the single `mappo` package (smallest change, see
§10.5), or `@mappo/core` + `@mappo/moon` + `@mappo/mars`. Subpaths are
probably right until there is a reason otherwise — a scoped org adds
publishing ceremony for no user-visible benefit while the packs are 9-12 KB.

### 11.3 How far does the seam actually stretch?

Mars and the Moon are both **thresholded rasters of a real body**. The seam is
not yet tested by anything genuinely different: a procedural body, a fictional
world, a body with a real gazetteer, or one whose `isLand` is expensive
(the engine calls it per cell, per grid, uncached beyond `buildLand`).

### 11.4 Demo sprawl

`worlds.html`, `satellites.html`, `year.html`, `index.html`, `demo/index.html`
are each large single-file pages with their own CSS token sets and layout
conventions. None is tested. Some (`v05.html`, `v05b.html`) look like
historical artifacts. Worth an explicit keep/retire pass.

---

## 12. Recommended next steps

In the order I would actually do them.

1. **Add a DOM test harness (jsdom) and the four tests in §10.3.** Everything
   below is riskier without it, and §8.5 shipped to `main` precisely because
   this did not exist.
2. **Fix §10.5** (`exports` subpath) — the documented import is currently
   wrong, which is embarrassing in a way that is cheap to fix.
3. **Fix §10.4** (`hideOverlaysUntilDefined`) — small, and it is a latent
   flash on three of the four tags.
4. **Decide §10.1** (the vocabulary) with the user. This is the biggest
   irreversible-ish call and its cost only grows. Do it before more bodies and
   before 1.0.
5. **Extract `scripts/lib/raster-body.js`** (§10.2) before a third body.
6. **Switch the Mars sites globe to `land-source="vector"`** and link
   `worlds.html` from the gallery (§10.9, §10.10).
7. **Push.** Three commits are local-only. The user has not been asked yet
   whether the body-pack prototype should go to `origin` — **do not push
   without asking**; it was framed as a prototype to evaluate, and §11.3 is
   still open.
8. Then, and only then, consider a third body or the moon-base/Mars-cities
   full-page experience the user originally described.

---

## 13. How to run everything

```bash
cd ~/GitHub/mappo

npm run build          # src/ -> dist/mappo.js + dist/bodies/*.js
npm test               # node --test, 46 tests, no DOM

# regenerate a pack (macOS only, see §10.6)
node scripts/generate-moon.js .cache/moon.bmp
node scripts/generate-mars.js .cache/mars.bmp
npm run build          # packs are copied into dist/ by the build

# serve the demos
python3 -m http.server 8099      # NOTE: python3 is broken on this machine
npx serve -l 8099 .              # use this instead
# then: http://localhost:8099/demo/worlds.html
```

**CI** (`.github/workflows/ci.yml`) builds, asserts `git diff --exit-code
dist/`, then runs the tests. **A source change without a rebuild fails CI.**

**Standing instruction from the user, quoted:** *"test everything visually on
chrome btw -- don't take code tests as the only green light."* This is not
decoration — it is how §8.4 and §8.6 were found. And when testing in Chrome,
hard-reload `dist/mappo.js` **and** `dist/bodies/*.js` (§8.8).

---

## 14. Adversarial review guide

If you are reviewing this, here is where I would attack it, roughly in
descending order of how likely you are to find something real.

1. **`registerBody` late-arrival (§8.5).** Fixed hours ago, verified once, by
   one probe, in one browser. Re-run the probe. Then try the combinations I
   did *not*: `<mappo-moon>` with an explicit `lat-min`, a body change on a
   live globe (not flat), two maps sharing a body where one registers between
   their constructions, and `registerBody` called twice with different objects
   for the same id.
2. **The cache keys.** I added `body.id` to two keys. There are four caches in
   total and I checked all of them: `buildLand`'s module-level cache keys on
   `body.id` (already did); `_dotsCache` now does (both of its key shapes);
   `shapes.js` memoizes into module-level `_land`/`_countries` but is
   **Earth-only by construction** — the packs carry their own `outlines()`
   with their own closure-local memo — so there is no cross-body leak there.
   Verify that reasoning rather than trusting it, and check I did not miss a
   fifth.
3. **`adoptBody` calls `this.render()` synchronously** from inside
   `registerBody`'s loop, and from inside `update()`. Consider re-entrancy: a
   `render()` that triggers an `attributeChangedCallback` that calls
   `update()` that calls `adoptBody()`. I did not analyse this.
4. **The tracer fix (§8.6).** I made the antimeridian a hard boundary. Verify
   the *globe* still looks right with `land-source="vector"` for a body whose
   region wraps the seam — a seam-split ring should be fine on a sphere, but I
   verified the flat map carefully and the globe only casually.
5. **`POLE_CUT = 72` for the Moon, `91` for Mars.** These are different for a
   reason (lunar polar shadow) but 91 is a no-op sentinel and reads as
   accidental. Check the Mars poles specifically.
6. **The threshold drift (§7).** 64.2 -> 136.3 across a re-download. I
   accepted it because the eight place-checks pass. That may be too generous.
7. **Everything in §10.** Each item is disclosed but only §8.4, §8.5 and §8.6
   are fixed.
8. **Claims in this document.** Where I wrote "verified", the method is
   stated; where a number appears (1699 dots, 831 dots, 161 rings, 28 rings,
   30.3%), it came from an actual run and you can re-run it. If a number here
   disagrees with what you measure, **trust your measurement** — the packs
   were regenerated from re-downloaded rasters and some figures in earlier
   commit messages predate that.

What I am **least** confident about, stated plainly: whether the seam is
actually *right* rather than merely *working*. Two thresholded rasters is a
weak test of an abstraction (§11.3), and the naming problem (§10.1) is real
evidence that the abstraction is still Earth-shaped underneath.
