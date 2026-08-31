// mappo — a dotted world map as a zero-dependency web component.
//
//   import "mappo";           // side effect: registers <world-map>
//   <world-map cities="London, Lagos"></world-map>
//
//   // or the programmatic API:
//   import { WorldMap } from "mappo";
//   new WorldMap(el, { cities: ["Tokyo"], tilt: 40, animation: "wave" });

export { WorldMap, DEFAULTS, snapToLand } from "./renderer.js";
export { WorldMapElement, register } from "./element.js";
export { CITIES, resolveCity } from "./cities.js";
export { isLand, MASK_W, MASK_H } from "./mask.js";
export { project, cellCenter, cellCorner, projectNormalized } from "./projection.js";
export { buildGraticule } from "./graticule.js";
export { buildLand, parseLandStyle, landRings, borderRings } from "./land.js";
export { landShapes, countryShapes } from "./shapes.js";
export { noise2 } from "./noise.js";
export { hoverShade, resolveColor, usesCssVars } from "./color.js";

import { register } from "./element.js";
// Auto-register when a DOM exists (browser); harmless no-op under Node.
if (typeof customElements !== "undefined") register();
