# Precision, accuracy, and what mappo does not model

This document is for people who want to put real positions on a mappo map:
mission planners, orbit visualisers, researchers, educators. It states, with
numbers, what mappo computes exactly, what it approximates and by how much,
and what it does not model at all. Every figure below is either derived from a
formula in the source, from the IAU/WGS 84 body constants named in §5, or
measured in the test suite; where a figure is measured, the method is stated.

The one-sentence version: **mappo is an exact renderer of coarse, symbolic
worlds.** The projections and every coordinate it hands back are correct to
double precision on a sphere. The surface data it carries is generalised to
tens of kilometres, and two of its three shipped bodies are interpretations of
pictures, not classifications of measurements. Positions you compute yourself
are placed exactly; positions you read off mappo's own figure are not.

## 1. Summary

| Quantity | Status | Bound |
|---|---|---|
| Equirectangular projection (flat map) | exact | linear in lat/lon; IEEE 754 double |
| Orthographic projection (globe), `locate()`, `projectNormalized()` | exact for a sphere | double precision; measured round trip 2.1×10⁻¹³° |
| Overlay placement (`data-lat`/`data-lon`) | exact, then rounded for CSS | 0.0036° flat (400 m on Earth), 0.01 px globe |
| Place markers on the **globe** | exact | double precision |
| Place markers on the **flat map** | **snapped to the dot grid** | up to 3.5 cells: 10.5° at `cols="120"`, 4.85° at `cols="260"` |
| Figure classification `body.figure(lat, lon)` | nearest-cell lookup | cell 0.703125° = 78 km Earth, 21 km Moon, 42 km Mars |
| Vector outlines (`figure-source="vector"`) | quantised and simplified | 1/32° steps plus 0.08–0.22° simplification; source generalised for 1:110 M (Earth) |
| Sphere instead of ellipsoid | approximation | surface within 14.2 km (Earth), 13.3 km (Mars), 1.4 km (Moon) of the sphere |
| Latitude type | spherical; Earth data is geodetic | up to 0.19° (21 km) offset on Earth if you feed geocentric latitude |
| Limb visibility | exact with a fixed margin | points within 0.573° of the limb are treated as hidden |
| Time, rotation, reference frames, ephemerides | not modelled | none; the consumer supplies body-fixed coordinates |

## 2. Conventions and reference frames

- **Latitude** is positive north. **Longitude** is positive east, runs −180° to
  +180° with 0° at the centre of the flat frame, and is periodic: 180° and
  −180° are one meridian, and `figure(lat, 190)` equals `figure(lat, −170)`.
  Latitudes outside ±90° and non-finite inputs classify as ground.
- **All rendering is spherical.** A latitude is treated as an angle from the
  centre of a sphere. Whether that is geodetic or planetocentric is a property
  of the data you and the packs feed in (see §5).
- **Earth**: Natural Earth data, geodetic latitude on WGS 84. Feed geodetic
  coordinates (what GPS, most gazetteers and `satellite.js`'s geodetic
  conversion give you) so your points land on the same coastlines.
- **Moon**: the IAU Mean Earth/polar axis (ME) frame, planetocentric latitude,
  east longitude, 0° at the mean sub-Earth point. LRO-era products and the
  Apollo site coordinates shipped in the pack use this frame.
- **Mars**: IAU 2000 planetocentric latitude, east longitude. The MOLA source
  map runs 0–360°E from its left edge; the generator rolls it by exactly half
  its width (1440 of 2880 pixels) into mappo's −180…180 convention, so no
  interpolation is involved. Landing-site coordinates in the pack are the
  published planetocentric values. Older Mars literature uses planetographic
  latitude and west longitude; convert before plotting (§5 gives the size of
  the latitude difference).
- **Your own body**: whatever frame your `figure()` and `places` use is the
  frame the map is in. Document it for your readers; mappo cannot know.

## 3. The geometry mappo computes

### 3.1 Formulas

Flat map, for a grid of `cols` columns covering longitude −180…180 and `rows`
rows covering `latRange = [φmin, φmax]`:

```
x = (λ + 180) / 360 · cols
y = (φmax − φ) / (φmax − φmin) · rows
rows = round(cols · (φmax − φmin) / 360)
```

`projectNormalized` is the same mapping into 0…1. It is linear, so it is exact
for every point regardless of the grid, and it returns `null` for a latitude
outside `latRange` — the point has no place on that map. With a `projection`
or `centerLon` it applies the formulas of section 3.7 instead.

Globe, with unit-sphere coordinates `(x, y, z) = (cos φ sin λ, sin φ, cos φ cos λ)`
(λ = 0 faces the viewer, +y is north), spin angle θ about the polar axis,
axial tilt τ, screen roll ρ, disc radius `R` in CSS pixels and centre `(cx, cy)`:

```
x₁ = x cos θ + z sin θ          z₁ = −x sin θ + z cos θ
y₂ = y cos τ − z₁ sin τ         z₂ = y sin τ + z₁ cos τ
sx = cx + R (x₁ cos ρ − (−y₂) sin ρ)
sy = cy + R (x₁ sin ρ + (−y₂) cos ρ)
depth = z₂
```

`locate(lat, lon, r)` multiplies `(x, y, z)` by `r`, the distance from the
body's centre in body radii, before the rotations. A point on the surface has
`r = 1`; a point 550 km above Earth has `r = 1 + 550 / 6371`. The result is
exact for the sphere model.

### 3.2 Visibility

A surface point is drawn when `z₂ > 0.01`, not `z₂ > 0`. The margin exists so
that dots on the limb do not flicker; it means a surface point within
`asin(0.01) = 0.5730°` of the limb (63.7 km along Earth's surface) is treated
as hidden. A point above the surface (`r > 1`) is hidden only when it is both
behind that plane and projects inside the unit disc, which is the correct
occlusion test for a sphere apart from the same margin. `locate()` reports the
decision as `front`.

### 3.3 Screen geometry

| Element | Size |
|---|---|
| Sphere radius `R` | 0.40 × the canvas's CSS width |
| Painted disc (`background`) | 1.02 R, so the painted edge lies 2% outside the true limb |
| Halo (`globe-ring`) | 1.08 R |
| Canvas backing store | `round(side × min(devicePixelRatio, maxDpr))` device pixels; the drawable edge may differ from the CSS box by under one device pixel |

`locate()` returns `cx`, `cy` and `r` (the true `R`), so a consumer drawing on
its own canvas can align to the limb exactly rather than to the painted disc.

### 3.4 Numeric precision

| Path | Representation | Bound |
|---|---|---|
| Everything returned to you: `locate()`, `projectNormalized`, `project`, `cellCenter`, `snapToFigure` | IEEE 754 binary64 | relative 1.1×10⁻¹⁶; lat/lon → xyz → lat/lon round trip measured at 2.1×10⁻¹³° over a 0.37° × 0.73° grid (2.4×10⁻⁸ m on Earth) |
| Globe geometry buffers (dots, figure quads, contours, vector outlines) | Float32Array, rendering only | unit-sphere error ≤ 2⁻²⁴ = 6.0×10⁻⁸, i.e. 3.4×10⁻⁶° (0.38 m on Earth) or 6×10⁻⁵ px on a 1000 px globe |
| Overlay position, flat | percentage of the frame to 3 decimals | 10⁻⁵ of 360° = 0.0036° = 400 m on Earth |
| Overlay position, globe | CSS px to 2 decimals; depth to 3 decimals | 0.01 px |
| Vector outline coordinates in the SVG | 0.1 SVG unit = 0.01 cell | 0.030° (3.3 km Earth) at `cols="120"`; 0.0138° at `cols="260"` |
| `locate()` on the flat map | uses the element's integer `clientWidth` | scale error under 0.5 px across the width; use `projectNormalized` for exact fractions |

### 3.5 The flat grid is not perfectly square

`rows` is rounded, so vertical and horizontal cell sizes differ slightly unless
the latitude span divides evenly:

| `cols` | `latRange` | rows | °/row | °/col | anisotropy |
|---|---|---|---|---|---|
| 120 | [−58, 84] | 47 | 3.0213 | 3.0000 | +0.71% |
| 170 | [−58, 84] | 67 | 2.1194 | 2.1176 | +0.08% |
| 260 | [−58, 84] | 103 | 1.3786 | 1.3846 | −0.43% |
| any | [−90, 90] | cols/2 | equal | equal | 0 |

This affects only the dot grid and grid-traced contours. Overlays,
`projectNormalized` and `locate()` are linear in `latRange` and unaffected.
Under another projection the same rounding applies to `rows = round(cols / aspect)`.

### 3.6 Place markers on the flat map are snapped

On the flat map, every `places` entry (and every `markers` coordinate) is moved
to the centre of the nearest figure cell, searching up to three cells away, so
a harbour on a coarse grid sits on the coast rather than in the sea. This is a
cartographic convenience, not a position:

| `cols` | cell | typical displacement (half a cell) | worst case (3.5 cells) |
|---|---|---|---|
| 120 | 3.000° | 1.50° = 167 km on Earth | 10.5° |
| 170 | 2.118° | 1.06° = 118 km | 7.41° |
| 260 | 1.385° | 0.69° = 77 km | 4.85° |

On the **globe**, markers are placed at their exact coordinates with no
snapping. **For exact points on either renderer use overlays
(`data-lat`/`data-lon`) or `locate()`**, both of which are exact to the bounds
in §3.4.

### 3.7 Projections

The flat map's grid is "sample the body at the inverse projection of every
screen cell", so a projection is defined by its inverse as much as its forward
mapping, and the accuracy of both is what the round-trip figures below
measure. All formulas are for the unit sphere and are then scaled into the
unit frame; `λ′ = λ − λ₀` is the longitude relative to the central meridian
`center-lon`.

**Equirectangular** (default): `x = (λ′ + 180)/360`, `y = (φmax − φ)/(φmax − φmin)`.
Linear, exact in double precision (section 3.1).

**Equal Earth** (Šavrič, Patterson & Jenny, *The Equal Earth map projection*,
IJGIS 33(3), 2019, doi:10.1080/13658816.2018.1504949), with the published
constants `A₁ = 1.340264`, `A₂ = −0.081106`, `A₃ = 0.000893`, `A₄ = 0.003796`,
`M = √3/2`:

```
θ = asin(M sin φ)
x = λ′ cos θ / (M (A₁ + 3A₂θ² + θ⁶(7A₃ + 9A₄θ²)))
y = θ (A₁ + A₂θ² + θ⁶(A₃ + A₄θ²))
```

The inverse solves the y polynomial for θ by Newton's method to a step below
10⁻¹³ rad (it converges in 3–5 iterations from θ₀ = y) and recovers λ′ from x.
The frame is `[−x(180°, 0), x(180°, 0)] × [y(φmin), y(φmax)]`; for the whole
sphere its aspect ratio is 2.05458 : 1. Equal-area means the ground area a
screen cell represents is the same everywhere on the map; it is the projection
to use when the dot density is meant to be read as a density.

**Polar stereographic** (Snyder, *Map Projections: A Working Manual*, USGS
Professional Paper 1395, 1987, pp. 154–163), north or south, with `c` the
angular distance from the centre pole:

```
ρ = 2 tan(c/2)                     c = 90° − φ  (north)   c = 90° + φ  (south)
x = ρ sin λ′                       y = ∓ρ cos λ′   (− north: 0° at the bottom; + south: 0° at the top)
k = 2 / (1 + cos c) = sec²(c/2)    the scale factor; area scale k²
```

Conformal: shapes are true locally and the scale is the same in every
direction at a point, but grows toward the rim:

| `c` from the pole | latitude on a north map | scale `k` | area scale `k²` |
|---|---|---|---|
| 0° | 90° | 1 | 1 |
| 15° | 75° | 1.0173 | 1.035 |
| 30° | 60° | 1.0718 | 1.149 |
| 45° | 45° | 1.1716 | 1.373 |
| 60° | 30° | 1.3333 | 1.778 |
| 90° | 0° | 2 | 4 |

So on a hemispheric polar map a screen cell at the rim covers half the ground
distance and a quarter of the ground area of one at the pole; the dot density
is a density of *screen* cells, not of ground. The frame is the disc of radius
`ρ(rim)` where the rim is the far latitude bound, or an annulus when the near
bound stops short of the pole. The opposite pole (`c = 180°`) is at infinity;
a `latRange` whose rim reaches it is refused with a `RangeError`, and for
geometry that crosses the rim (a coastline continuing into the far hemisphere)
the far points are clamped at four rim radii, far outside the clip, so the
visible part of the outline keeps its exact shape.

**Measured round trip** `forward → inverse → forward`, on a 0.37° × 0.73° grid
over each projection's default frame, Node 22, IEEE 754 binary64:

| projection | points | worst of `|Δφ|` and `|Δλ| cos φ` | on Earth's surface | worst frame error |
|---|---|---|---|---|
| equirectangular | 239,598 | 1.14×10⁻¹³° | 1.3×10⁻⁸ m | 2.2×10⁻¹⁶ |
| equal-earth | 239,598 | 7.09×10⁻¹²° | 7.9×10⁻⁷ m | 4.4×10⁻¹⁶ |
| stereographic-north | 119,799 | 1.14×10⁻¹³° | 1.3×10⁻⁸ m | 7.8×10⁻¹⁶ |
| stereographic-south | 119,799 | 1.14×10⁻¹³° | 1.3×10⁻⁸ m | 7.8×10⁻¹⁶ |

The stereographic scale factor is verified numerically: at 60° N the
meridional scale is 1.07180, against `2/(1 + cos 30°) = 1.07180`. The test
suite asserts all of this (`test/projections.test.js`).

**What a projection does not change.** The body's classification is sampled
at the exact inverse-projected coordinate, so the figure/ground decision for a
cell is as accurate as the pack (section 4.1), whatever the projection. A
place, an overlay or a `locate()` point is projected exactly; only markers
are snapped to the grid (section 3.6), and that snap is a search in *screen*
cells, so its radius in ground terms follows the projection's scale. The
vector outlines are the pack's rings, stitched across ±180° and cut at the
projection's own seam by linear interpolation of the crossing latitude — an
error of at most one vertex spacing (1/32° in the packs) along the seam line
itself, and zero elsewhere.

**Custom and d3 projections.** A `{ forward, inverse }` object is validated at
the boundary: its aspect must be positive and finite; geographic results must
stay within the requested physical latitude band; frame points and
`outline()` vertices must be finite and in 0…1. Its seam defaults to ±180°.
When `seam: false` is set, an incomplete vector ring falls back to the traced
screen-grid contour rather than bridging a projection cut with a chord.

A d3-geo projection is wrapped through `projection.stream`, which is where d3
applies rotation, spherical and Cartesian clipping, antimeridian cutting and
adaptive resampling. Streaming `Sphere` gives the exact projected outline and
bounding box for the full globe; a spherical polygon whose latitude edges are
segmented every 0.25° gives a cropped `latRange` band (the segments are great
circle arcs, so only that cropped boundary has the sub-segment approximation).
A
frame point is on-world only when d3's inverse returns a physical coordinate,
that coordinate is in the requested band, and the streamed point round-trips
within 10⁻⁶ of the native d3 frame. Vector rings and graticules use that same
stream, so clipped hemispheres and interrupted or rotated projections retain
d3's own topology.

### 3.8 The glass globe

With `distance` the globe is a perspective view: a unit-sphere point `(X, Y, Z)`
in view space (Z toward the camera, which sits at `D` radii) lands at
`F·X/(D − Z)`, `F·Y/(D − Z)` from the centre with `F = R·√(D² − 1)`, so the
sphere's horizon `Z = 1/D` falls exactly on the disc of radius `R`; the visible
cap is `acos(1/D)` from the sub-camera point (65° at `D = 2.37`, against 90°
for the orthographic view). A tile's edges are projected with the same
division, including the term `X·dZ/(D − Z)` from the edge's depth component;
this is what folds a tile to nothing at the horizon.

With `fog="near far"` alpha is `(1 − s)^(1/2.2)` where `s = smoothstep(near,
far, −Z)`, the curve of a three.js `Fog` mixed in linear light and converted
to sRGB alpha over a dark ground; over a light ground the far side reads
stronger than the linear-light mix would give.

## 4. The data mappo carries

### 4.1 Resolution of the figure

Every shipped body classifies its surface on a 512 × 256 grid, one bit per
cell, sampled by nearest cell without interpolation. The position of any
figure/ground boundary read from `figure()` is therefore uncertain by half a
cell.

| | Cell (0.703125°) | Half-cell uncertainty |
|---|---|---|
| Earth | 78.2 km | 39.1 km |
| Moon | 21.3 km | 10.7 km |
| Mars | 41.6 km | 20.8 km |

Vector outlines are quantised to 1/32° (Earth 3.47 km, Moon 0.95 km, Mars
1.85 km; rounding error ±1/64°) and then simplified with Douglas-Peucker, whose
tolerance bounds the perpendicular deviation from the unsimplified line in
degree space:

| Outlines | Tolerance | Upper bound of deviation |
|---|---|---|
| Earth coastlines | 0.08° | 8.9 km |
| Earth borders | 0.10° | 11.1 km |
| Moon maria | 0.22° | 6.7 km |
| Mars lowlands | 0.22° | 13.0 km |

(The bound is per degree of latitude; along longitude it shrinks by cos φ.)

### 4.2 Provenance and classification method, per body

| | Earth | Moon | Mars |
|---|---|---|---|
| Source | Natural Earth 110m land and admin-0 countries, `natural-earth-vector` @ `ca96624a`, SHA-256 pinned | Clementine UVVIS 750 nm global albedo mosaic, simple cylindrical, SHA-256 pinned | MOLA global topography, **colour-ramped** rendering, simple cylindrical, SHA-256 pinned |
| Source resolution | generalised for 1:110 000 000 (1 mm on paper = 110 km); islands and inlets of that order are absent | 1080 × 540 px = 0.333°/px = 10.1 km; lossy JPEG | 2880 × 1300 px = 0.125° × 0.138°/px = 7.4 × 8.2 km; PNG (lossless) |
| What the figure is | land polygons rasterised at cell centres (even-odd scanline) | pixels darker than a brightness threshold, after box-filtering to the mask grid | pixels whose ramp colour inverts to an elevation below a threshold, after box-filtering |
| Threshold | none (geometry) | chosen so maria cover 16.0% of the sphere (cos-weighted); no maria assigned above 72° latitude, where the mosaic is shadow | chosen so the low class covers 33.3% of the sphere |
| Independent checks | 8 named land/sea points; area-weighted land fraction 28.9% at 0.25° sampling (reference ≈ 29.2%) | near side alone 30.2% maria, not tuned on, vs published ≈ 30–31%; 5 named places | 8 named places from Hellas (−7 km) to Olympus Mons (+21 km) |
| Known artefacts | Antarctica present but cut by the default framing; small islands missing | mare edges are gradational, so the boundary is a brightness level, not a shore; polar shadow excluded by the 72° cut | the north polar cap (Planum Boreum) is classed high because it is; hue inversion is qualitative, not metric elevation |

The Moon and Mars figures are **visual interpretations** suitable for
orientation and communication. They are not geologic-unit boundaries and not
elevation contours in metres; cite the Unified Geologic Map of the Moon or the
MOLA MEGDR gridded products for those.

The threshold search is a 40-step bisection on the 0–255 scale (resolution
2.3×10⁻¹⁰); the fitted coverage matches its target to the weight of one cell,
about 0.0012 percentage points. The test suite checks it to ±0.5 points on a
1° sampling grid.

### 4.3 Gazetteers

| | Precision of stored coordinates | On the ground |
|---|---|---|
| Earth cities | 0.1° | 11.1 km |
| Moon sites | 0.01° | 0.30 km |
| Mars sites | 0.01° | 0.59 km |

Coordinates are transcribed from published mission and nomenclature values and
are not individually cited in the pack. Treat them as labels, not survey
points, and supply your own coordinates when it matters.

## 5. Sphere versus ellipsoid

mappo draws every body as a sphere of its mean radius. The bodies are
ellipsoids.

| Body | Radius mappo uses | Equatorial | Polar | 1/f | True surface relative to the sphere |
|---|---|---|---|---|---|
| Earth (WGS 84) | 6371.0 km | 6378.137 | 6356.752 | 298.3 | +7.1 km at the equator, −14.2 km at the poles |
| Moon (IAU) | 1737.4 km | 1738.1 | 1736.0 | 827.7 | +0.7 km, −1.4 km |
| Mars (IAU 2000) | 3389.5 km | 3396.19 | 3376.20 | 169.9 | +6.7 km, −13.3 km |

Constants: WGS 84 for Earth; IAU Working Group on Cartographic Coordinates and
Rotational Elements (Archinal et al., 2018) for the Moon and Mars.

Two consequences:

1. **Geodetic versus geocentric latitude.** On an ellipsoid the two differ by
   up to `atan(e² / (2√(1 − e²)))`:

   | Body | Maximum difference | On the ground | Where |
   |---|---|---|---|
   | Earth | 0.1924° | 21.4 km | 45.1° |
   | Mars | 0.3382° | 20.0 km | 45.2° |
   | Moon | 0.0693° | 2.1 km | 45.0° |

   Earth's data is geodetic; feed geodetic. Mars's data is planetocentric;
   feed planetocentric (convert planetographic sources). The Moon's difference
   is below a mask cell either way.

2. **Altitude to radius.** `locate(lat, lon, r)` expects distance from the
   body's centre in mean radii. If you compute `r = |position vector| / R_mean`
   from a body-fixed Cartesian state vector, the projection is exact for the
   sphere model. If instead you convert an altitude above the ellipsoid as
   `r = 1 + h / R_mean`, the object is misplaced relative to the drawn limb by
   the ellipsoid's departure from the sphere at that latitude: up to 14.2 km on
   Earth, which is 2.6% of a 550 km orbit's altitude.

## 6. What mappo does not model

- **Time.** No epochs, no clocks.
- **Rotation.** No IAU rotational elements (pole direction, prime meridian
  angle `W(t)`); a body is drawn in its body-fixed frame and `focus` or the
  spin angle is set by you.
- **Reference frames.** No ICRF, J2000, ECI, TEME or ECEF transforms; no
  precession, nutation, polar motion or libration.
- **Light-time, aberration, refraction, terminator, illumination.** The
  demos compute a terminator and satellite positions in their own code (SGP4
  agreeing with a reference position to 340 m at one epoch; low-precision
  solar coordinates good to about one arcminute; equation of time within
  0.06 min). None of that is in the package or its API.
- **Distances and areas.** The flat map is equirectangular and is neither
  conformal nor equal-area; do not measure on it. The globe is orthographic;
  screen distances are not surface distances.
- **Elevation.** The figure is binary; there is no height field.

## 7. Recommended practice for scientific use

1. Compute positions in your own code, in the body's frame, and place them
   with overlays or `locate()`. Never read positions off the figure.
2. For orbits, pass `r` from the body-fixed position vector divided by the
   body's `radiusKm`, and quote the mean radius you used.
3. On Earth feed geodetic latitude; on Mars feed planetocentric latitude and
   east longitude; state the frame in your figure caption.
4. Use `figure-source="vector"` for the least generalised boundary the pack
   has, and say in the caption that the base map is Natural Earth 110m, the
   Clementine albedo mosaic or MOLA, as §4.2 states.
5. Treat `places` as labels. If a marker's position matters, use overlays or
   `locate()`, or use the globe, where markers are not snapped.
6. Do not rely on features within 0.573° of the limb being visible.
7. Register a body of your own when the shipped figure is not the quantity
   you need: `figure(lat, lon)` can wrap any dataset you have, at any
   resolution, and the renderers do not change.

## 8. Validation the test suite performs

| Check | Tolerance |
|---|---|
| Projection inverses (`project` ↔ `cellCenter`) | 10⁻⁹ grid units |
| Frame corners of `projectNormalized` | 10⁻¹² |
| Unit-sphere radius of every globe point | 10⁻⁶ (Float32) |
| Earth, Moon, Mars area-weighted coverage vs target | ±0.5 percentage points on a 1° grid |
| Moon near-side coverage vs published ≈ 30% | ±2.5 points |
| Named-place anchors (Earth 7, Moon 4, Mars 4 in tests; more in the generators) | exact class |
| Every packed outline closed, finite, in range | exact |
| Codec round trip after quantisation | ±1/64° |
| Every Earth gazetteer entry on a land cell after snapping at `cols="120"` | exact |

Verified at generation time rather than in the suite: regenerating the Earth
pack from the pinned Natural Earth commit reproduces the committed mask
bit-for-bit (2026-09-02). Not yet validated anywhere: absolute positional
accuracy of any outline against an independent reference dataset, and
agreement of the orthographic projection with an independent implementation.
Both are listed below.

## 9. Toward research grade

In order of leverage:

1. An ellipsoid on the body (`radiusEquatorial`, `radiusPolar`), a declared
   latitude convention per body, and geodetic/planetocentric conversion
   helpers, so §5's offsets become zero rather than documented.
2. Measured source data: MOLA MEGDR and LOLA LDEM gridded elevation with
   thresholds in metres; USGS geologic units for real mare boundaries; Natural
   Earth 10m or finer for Earth; higher-resolution or tiled masks so
   `figure()` stops being a 78 km question.
3. Per-entry sourced gazetteers with frame and epoch.
4. Optional IAU rotational elements, so a body can be oriented for an epoch
   and `focus` can be computed rather than set.
5. A validation suite against independent references: known coastline
   vertices, IAU nomenclature coordinates, and an independent orthographic
   implementation agreeing with `locate()` to 10⁻⁹.

Item 1 is the only one that touches the body seam.
