# Mappo.js: demo/vendor

Third-party code used by the **demos only**. Nothing here is imported by
`src/`, so the published `mappo` package still has zero dependencies — check
`npm pack` if you doubt it.

- `three.module.min.js` — three.js, MIT. Vendored rather than pulled from a CDN
  so the demos work offline and cannot break when a CDN moves.

Used by `demo/mars-mission.html` for the near-Earth phases, where the view has
to sit at an angle just above the surface with a vehicle standing ON it.
Mappo.js's globe is an orthographic render on a flat canvas: it can draw the
Earth beautifully from outside, and it cannot put a camera on the ground.
Rather than drop Mappo.js there, Mappo.js draws the map and three.js wraps it round
a sphere — the cartography is still Mappo.js's, the camera is three.js's.
