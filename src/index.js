// mappo — maps of any world as a zero-dependency web component.
//
//   import "mappo";           // side effect: registers <mappo-world> and <mappo-earth>
//   <mappo-world places="London, Lagos"></mappo-world>
//
//   // the rest is opt-in, each a module that registers itself:
//   import "mappo/globe";                 // mode="globe"
//   import "mappo/projections";           // projection="equal-earth", the polar pair, your own, d3-geo
//   import "mappo/vector";                // figure-source="vector" and borders, for bodies that carry rings
//   import "mappo/bodies/earth-vector";   // Earth's coastline and border rings (implies mappo/vector)
//   import { registerBody } from "mappo";
//   import { MOON } from "mappo/bodies/moon";
//   registerBody(MOON);                   // <mappo-moon> and <mappo-world body="moon"> now work
//
//   // or the programmatic API:
//   import { Mappo } from "mappo";
//   new Mappo(el, { places: ["Tokyo"], tilt: 40, animation: "wave" });
//
// This file is the single source of truth for the package's public surface:
// only what is re-exported here leaves the core bundle, and the opt-in
// modules import the core by exactly these names (the build checks).

export { Mappo, DEFAULTS, snapToFigure, registerRenderer, knownRenderers } from "./renderer.js";
export { MappoElement, register, defineBodyElement } from "./element.js";
export { EARTH } from "./bodies/earth.js";
export { registerBody, extendBody, resolveBody, knownBodies, onBodyRegistered, resolvePlace } from "./body.js";
export { project, cellCenter, cellCorner, projectNormalized } from "./projection.js";
export { resolveProjection, knownProjections, registerProjection, registerProjectionAdapter } from "./projections.js";
export { buildGraticule } from "./graticule.js";
export { buildFigure, parseFigureStyle, registerVector } from "./figure.js";
export { noise2 } from "./noise.js";
export { hoverShade, resolveColor, usesCssVars } from "./color.js";

// The seam the opt-in modules are built on. Public, because a renderer, a
// projection or a data module of your own needs exactly what mappo/globe,
// mappo/projections and mappo/vector need; documented in README "Extending".
export { resolvePlaces, bodyLatRange, rerenderLive, warnIfStillPending } from "./body.js";
export { figureOutlines, figureBorders, vectorFeature } from "./figure.js";
export { normalizeRings, pointInRings } from "./highlight.js";
export {
  hasProjection, projectionDefaultRange, projectPolyline, signedArea, unwrap, meanLat,
  wrapLon, frameLon, inRange, finitePoint, finiteLocation, validateLatRange, EPS
} from "./projections.js";

import { register } from "./element.js";
// Auto-register when a DOM exists (browser); harmless no-op under Node.
if (typeof customElements !== "undefined") register();
