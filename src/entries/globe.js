// mappo/globe — the rotating canvas globe, as an opt-in module.
//
//   import "mappo";
//   import "mappo/globe";
//   <mappo-world mode="globe"></mappo-world>
//
// Importing this file registers the renderer for mode="globe". Order does not
// matter: a map that asks for a globe before this module has registered draws
// nothing, then draws the globe the moment it does. The pure builders the
// globe is made of are exported for hosts doing their own sphere maths.

import { registerRenderer } from "../renderer.js";
import {
  GlobeRenderer, latLonToXYZ, uniformCount, forEachSample,
  buildGlobePoints, buildGlobeFlags, buildGlobePhases, buildGlobeTiles
} from "../globe.js";
import { parseColor, mixColor } from "../color-mix.js";

registerRenderer("globe", GlobeRenderer);

export {
  GlobeRenderer, latLonToXYZ, uniformCount, forEachSample,
  buildGlobePoints, buildGlobeFlags, buildGlobePhases, buildGlobeTiles,
  parseColor, mixColor
};
