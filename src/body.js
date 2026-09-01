// A body is a data pack. The engine draws lat/lon and knows nothing about
// which sphere it is on — so Earth is not special, it is only the one that
// ships in the box.
//
// Everything a body has to answer:
//
//   isLand(lat, lon)   the binary the whole grid derives from. On Earth that
//                      is land against sea; on the Moon it is maria against
//                      highlands. Same question, different sphere.
//   rings(source)      vector outlines for land-source="vector", or null when
//                      the body has no crisp boundary to trace.
//   borders()          political borders, or null. Only Earth has politics.
//   latRange           the band worth drawing, used when the caller has not
//                      asked for one.
//   terms              what the two classes are called, for people rather
//                      than for code.
//
// Other bodies are opt-in on purpose. Earth's mask and coastlines are 28 KB
// gzipped of the 73 KB bundle, and a library that made you download the Moon
// to put a world map in a hero section would have lost the plot. So they load
// separately and register themselves:
//
//   import { registerBody } from "mappo";
//   import { MOON } from "mappo/bodies/moon";
//   registerBody(MOON);
//   <mappo-world body="moon">

// Not aliased: the bundle is a concatenation with the import lines removed,
// so `as` renames do not survive it. scripts/build.js refuses them outright.
import { isLand, MASK_W, MASK_H } from "./mask.js";
import { landShapes, countryShapes } from "./shapes.js";

export const EARTH = {
  id: "earth",
  name: "Earth",
  radiusKm: 6371,
  latRange: [ -58, 84 ],          // Antarctica and the arctic emptiness cut
  terms: { inside: "land", outside: "ocean" },
  isLand,
  rings: (source) => (source === "vector" ? landShapes() : null),
  borders: () => countryShapes(),
  maskSize: [ MASK_W, MASK_H ]
};

const REGISTRY = new Map([ [ EARTH.id, EARTH ] ]);

// Live maps, so a pack that arrives late can still take effect. It always
// arrives late: mappo defines the custom element as it loads, which upgrades
// every <mappo-world body="moon"> on the page before the consumer has had a
// line of their own run. Making the order not matter is better than
// documenting an order nobody can enforce.
const LIVE = new Set();
export const trackMap = (m) => LIVE.add(m);
export const untrackMap = (m) => LIVE.delete(m);

// Hand a body over once, use it by name for ever after. Returns it, so the
// call reads as a definition rather than a side effect.
export function registerBody(body) {
  if (!body?.id || typeof body.isLand !== "function") {
    throw new TypeError("a body needs an id and an isLand(lat, lon)");
  }
  const id = String(body.id).toLowerCase();
  REGISTRY.set(id, body);
  // Anything already on the page that asked for this body by name was drawn
  // as Earth. Redraw it as what it asked to be.
  for (const m of LIVE) {
    if (String(m.options?.body ?? "").toLowerCase() === id) m.adoptBody(body);
  }
  return body;
}

export const knownBodies = () => [ ...REGISTRY.values() ];

// Accepts a name, a body object, or nothing. An unknown NAME is worth saying
// out loud — it almost always means the pack was never imported — but it is
// not worth throwing over: a world map that renders Earth is a better failure
// than a blank page.
export function resolveBody(value) {
  if (!value) return EARTH;
  if (typeof value === "object") return value;
  const found = REGISTRY.get(String(value).toLowerCase());
  if (!found) {
    console.warn(`[mappo] unknown body "${value}" — did you registerBody() its pack? Falling back to Earth.`);
    return EARTH;
  }
  return found;
}
