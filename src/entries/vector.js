// mappo/vector — vector outlines and borders, as an opt-in module.
//
//   import "mappo";
//   import "mappo/vector";                 // the seam machinery
//   import "mappo/bodies/earth-vector";    // Earth's coastline and border rings (implies mappo/vector)
//   <mappo-world figure="solid outline" figure-source="vector" borders></mappo-world>
//
// The Moon and Mars packs carry their own rings, so with this module alone
// their vector outlines draw; Earth's rings are a module of their own because
// they are a third of the package by themselves. Until the module registers,
// every renderer draws the grid contours it can always draw.

import { registerVector } from "../figure.js";
import { stitchRings, projectRings } from "../vector.js";

registerVector({ stitchRings, projectRings });

export { stitchRings, projectRings };
