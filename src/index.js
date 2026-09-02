// mappo — maps of any world as a zero-dependency web component.
//
//   import "mappo";           // side effect: registers <mappo-world> and <mappo-earth>
//   <mappo-world places="London, Lagos"></mappo-world>
//
//   // other worlds are opt-in packs
//   import { registerBody } from "mappo";
//   import { MOON } from "mappo/bodies/moon";
//   registerBody(MOON);       // <mappo-moon> and <mappo-world body="moon"> now work
//
//   // or the programmatic API:
//   import { Mappo } from "mappo";
//   new Mappo(el, { places: ["Tokyo"], tilt: 40, animation: "wave" });
//
// This file is the single source of truth for the package's public surface:
// only what is re-exported here leaves the bundle.

export { Mappo, DEFAULTS, snapToFigure } from "./renderer.js";
export { MappoElement, register, defineBodyElement } from "./element.js";
export { EARTH } from "./bodies/earth.js";
export { registerBody, resolveBody, knownBodies, onBodyRegistered, resolvePlace } from "./body.js";
export { project, cellCenter, cellCorner, projectNormalized } from "./projection.js";
export { resolveProjection, knownProjections } from "./projections.js";
export { buildGraticule } from "./graticule.js";
export { buildFigure, parseFigureStyle } from "./figure.js";
export { noise2 } from "./noise.js";
export { hoverShade, resolveColor, usesCssVars } from "./color.js";

import { register } from "./element.js";
// Auto-register when a DOM exists (browser); harmless no-op under Node.
if (typeof customElements !== "undefined") register();
