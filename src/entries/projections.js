// mappo/projections — the flat map's projections beyond equirectangular, as an
// opt-in module: Equal Earth, polar stereographic north and south, and the
// adapters that accept a { forward, inverse } object of your own or a d3-geo
// projection.
//
//   import "mappo";
//   import "mappo/projections";
//   <mappo-world projection="equal-earth"></mappo-world>
//   <mappo-moon projection="stereographic-south" lat-max="-60"></mappo-moon>
//
// Importing this file registers everything with the core. A map that names a
// projection before the module has registered draws nothing until it does.

import { registerProjection, registerProjectionAdapter } from "../projections.js";
import { BUILTIN_PROJECTIONS, EQUAL_EARTH, STEREOGRAPHIC_NORTH, STEREOGRAPHIC_SOUTH } from "../projections-builtin.js";
import { adaptProjection, adaptCustom, adaptD3 } from "../projections-adapters.js";

for (const [ id, spec ] of Object.entries(BUILTIN_PROJECTIONS)) registerProjection(id, spec);
registerProjectionAdapter(adaptProjection);

export { BUILTIN_PROJECTIONS, EQUAL_EARTH, STEREOGRAPHIC_NORTH, STEREOGRAPHIC_SOUTH, adaptProjection, adaptCustom, adaptD3 };
