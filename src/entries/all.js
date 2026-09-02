// mappo/all — everything in one file: the core, the globe, every projection,
// vector outlines with Earth's rings. For the page that wants one URL and does
// not mind the bytes:
//
//   <script type="module" src="https://unpkg.com/mappo/dist/all.js"></script>
//
// It is self-contained on purpose (no imports at runtime), so do not load it
// alongside mappo.js or the other modules: two copies of the core would each
// keep their own registries. The Moon and Mars packs remain separate: no
// landing page needs another world by default.

export * from "../index.js";
export {
  GlobeRenderer, latLonToXYZ, uniformCount, forEachSample,
  buildGlobePoints, buildGlobeFlags, buildGlobePhases, buildGlobeTiles
} from "./globe.js";
export { BUILTIN_PROJECTIONS, adaptProjection, adaptCustom, adaptD3 } from "./projections.js";
export { stitchRings, projectRings } from "./vector.js";
import "../bodies/earth-vector.js";
