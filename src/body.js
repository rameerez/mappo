// A body is a world: the data pack behind a map. The engine draws latitude and
// longitude and knows nothing about which sphere it is on — Earth is not
// special, it is only the body that ships in the box.
//
// What a body answers, and nothing more:
//
//   id, name         "moon", "Moon". The id also names the <mappo-moon> tag.
//   radiusKm         mean radius, so a consumer can turn kilometres into the
//                    body radii locate() speaks. May be null for an invented
//                    world.
//   latRange         the default framing, when the caller has not asked.
//   terms            { figure, ground } — what the two classes are called,
//                    for people rather than for code ("land"/"ocean",
//                    "maria"/"highlands"). Used in accessible labels.
//   figure(lat,lon)  the classification everything derives from: is this
//                    point part of the FIGURE (drawn) or the GROUND (not)?
//   outlines()       closed [lat, lon] rings of the figure, for
//                    figure-source="vector"; null if the body has none.
//   borders()        closed [lat, lon] rings of region boundaries; null if
//                    the body has no regions. Only Earth has politics so far.
//   places           the gazetteer: [{ name, lat, lon, kind? }] you can name
//                    in places="…".
//
// Other bodies are opt-in on purpose. Earth's mask and coastlines are already
// a substantial part of the root bundle, and a library that made you download
// the Moon to put a world map in a hero section would have lost the plot. So
// they load separately and register themselves:
//
//   import { registerBody } from "mappo";
//   import { MOON } from "mappo/bodies/moon";
//   registerBody(MOON);                     // also defines <mappo-moon>
//   <mappo-world body="moon">  or  <mappo-moon>
//
// Order does not matter. A map that asks for a body by name before its pack
// has registered draws NOTHING — not Earth — and adopts the body the moment
// registerBody() runs. Drawing the wrong planet for a frame would be worse
// than drawing none, and a typo in body="" should look broken, not like Earth.

import { EARTH } from "./bodies/earth.js";

const ID = /^[a-z][a-z0-9-]*$/;
const FULL_RANGE = [ -90, 90 ];
const PENDING_GRACE_MS = 2000;

const REGISTRY = new Map([ [ EARTH.id, EARTH ] ]);
const PENDING = new Map();     // id → the placeholder handed out until the pack arrives
const LISTENERS = new Set();   // registerBody() subscribers (element.js defines tags)

// Live maps, so a pack that arrives late can still take effect. It always
// arrives late: mappo defines the custom element as it loads, which upgrades
// every <mappo-world body="moon"> on the page before the consumer has had a
// line of their own run.
const LIVE = new Set();
export const trackMap = (m) => LIVE.add(m);
export const untrackMap = (m) => LIVE.delete(m);

// Hand a body over once, use it by name for ever after. Returns it, so the
// call reads as a definition rather than a side effect. Registering the same
// id again replaces the pack: maps that asked for it BY NAME follow the
// registry; maps handed a body object directly keep the object they were given.
export function registerBody(body) {
  validateBody(body);
  REGISTRY.set(body.id, body);
  PENDING.delete(body.id);
  for (const m of LIVE) {
    if (typeof m.options?.body === "string" && normalizeId(m.options.body) === body.id) m.adoptBody(body);
  }
  for (const fn of LISTENERS) fn(body);
  return body;
}

// Called with every body registered from now on. Returns an unsubscribe.
export function onBodyRegistered(fn) {
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

export const knownBodies = () => [ ...REGISTRY.values() ];

// Accepts a name, a body object, or nothing (Earth). A name that is not
// registered yet resolves to a PENDING body — a placeholder that draws nothing
// and is swapped for the real one by registerBody(). Its identity is stable
// per id, so geometry caches keyed on the body object stay coherent.
export function resolveBody(value) {
  if (value == null || value === "") return EARTH;
  if (typeof value === "object") return validateBody(value);
  if (typeof value !== "string") throw new TypeError("body must be a name or a body object");
  const id = normalizeId(value);
  return REGISTRY.get(id) ?? pendingBody(id);
}

function pendingBody(id) {
  let body = PENDING.get(id);
  if (!body) {
    body = Object.freeze({
      id, name: id, pending: true, radiusKm: null, latRange: FULL_RANGE, terms: null,
      figure: () => false, outlines: () => null, borders: () => null, places: Object.freeze([])
    });
    PENDING.set(id, body);
    // Packs normally register within the same script run, so the warning
    // waits: it should mean "you forgot to import the pack", not "the module
    // graph has not finished loading yet".
    if (typeof setTimeout === "function") {
      const timer = setTimeout(() => {
        if (!REGISTRY.has(id)) {
          console.warn(`[mappo] body "${id}" was never registered — maps asking for it stay empty until registerBody() runs. Did you import its pack?`);
        }
      }, PENDING_GRACE_MS);
      timer.unref?.();
    }
  }
  return body;
}

function normalizeId(value) {
  return String(value).trim().toLowerCase();
}

// Strict on purpose: a body is data that other people's maps will be built
// on, and a loose shape here becomes an undefined-is-not-a-function in a
// renderer later.
export function validateBody(body) {
  if (!body || typeof body !== "object") throw new TypeError("a body must be an object");
  if (typeof body.id !== "string" || !ID.test(body.id)) {
    throw new TypeError(`body id must match ${ID} (got ${JSON.stringify(body.id)})`);
  }
  const at = `body "${body.id}"`;
  if (typeof body.name !== "string" || !body.name.trim()) throw new TypeError(`${at} needs a name`);
  if (typeof body.figure !== "function") throw new TypeError(`${at} needs a figure(lat, lon) function`);
  if (body.latRange != null && !validRange(body.latRange)) {
    throw new TypeError(`${at} latRange must lie within [-90, 90] with min < max`);
  }
  if (body.radiusKm != null && !(body.radiusKm > 0)) throw new TypeError(`${at} radiusKm must be positive`);
  for (const key of [ "outlines", "borders" ]) {
    if (body[key] != null && typeof body[key] !== "function") throw new TypeError(`${at} ${key} must be a function`);
  }
  if (body.places != null && !Array.isArray(body.places)) throw new TypeError(`${at} places must be an array`);
  if (body.terms != null && (typeof body.terms.figure !== "string" || typeof body.terms.ground !== "string")) {
    throw new TypeError(`${at} terms must be { figure, ground } strings`);
  }
  return body;
}

export function validRange(range) {
  return Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) &&
    range[0] >= -90 && range[1] <= 90 && range[0] < range[1];
}

// The band a body wants drawn when the caller has not said.
export function bodyLatRange(body) {
  return body.latRange ?? FULL_RANGE;
}

// ── places ──────────────────────────────────────────────────────────────────

// "São Paulo" and "Sao Paulo" are the same place, and a person typing the
// first should not be told their city does not exist. Lookups fold accents
// and case; the name you passed is what gets labelled — folding is how we
// find the place, not how we spell it back.
const fold = (name) => name.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const PLACE_INDEX = new WeakMap();   // body → Map(folded name → record)

// One entry of the `places` option: a gazetteer name (string) or a
// { name?, lat, lon, … } record of your own. Returns a normalised record, or
// null for a name the body does not know.
export function resolvePlace(entry, body) {
  if (typeof entry === "string") {
    const name = entry.trim();
    if (!name) return null;
    let index = PLACE_INDEX.get(body);
    if (!index) {
      index = new Map();
      for (const place of body.places ?? []) index.set(fold(place.name), place);
      PLACE_INDEX.set(body, index);
    }
    const hit = index.get(fold(name));
    return hit ? { ...hit, name } : null;
  }
  if (entry && Number.isFinite(entry.lat) && Number.isFinite(entry.lon)) return { name: "", ...entry };
  return null;
}

// The whole option, with one warning per unknown name and body — never a
// throw: a typo'd place must not take down a hero section. A body that is
// still pending knows no places yet, and says nothing.
const WARNED_PLACES = new Set();
export function resolvePlaces(entries, body) {
  const out = [];
  for (const entry of entries ?? []) {
    const place = resolvePlace(entry, body);
    if (place) { out.push(place); continue; }
    if (body.pending) continue;
    const key = `${body.id}|${JSON.stringify(entry)}`;
    if (!WARNED_PLACES.has(key)) {
      WARNED_PLACES.add(key);
      console.warn(`[mappo] unknown place ${JSON.stringify(entry)} on ${body.name} — not in its gazetteer; pass { name, lat, lon } instead`);
    }
  }
  return out;
}
