// mappo/links — arcs between places and spikes at them, as an opt-in module.
//
//   import "mappo";
//   import "mappo/globe";
//   import { links } from "mappo/links";
//   const layer = links(document.querySelector("mappo-world").map, { color: "#f46bbe" });
//   layer.add({ from: "London", to: "Tokyo" });
//
// Works on the globe and the flat map alike (see src/links.js). Registers
// nothing: a layer is something you ask a map for.

export { links, Links, arcPoints, arcAngle, arcHeight, toXYZ, toLatLon } from "../links.js";
