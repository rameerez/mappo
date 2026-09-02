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
// Order does not matter. A map that asks for a non-empty body name before its
// pack has registered draws NOTHING — not Earth — and adopts the body the
// moment registerBody() runs. Drawing the wrong planet for a frame would be
// worse than drawing none. An omitted or empty name means the default, Earth.

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

// Draw every live map that `filter` selects again — the hook that lets a
// module arriving after the page's maps were built (a body pack, a renderer,
// a projection, the vector feature, a body's rings) take effect without
// anyone re-mounting anything. Failures are contained per map, as in
// registerBody: one map that cannot redraw must not stop the others.
export function rerenderLive(filter = () => true) {
  for (const m of LIVE) {
    if (!filter(m)) continue;
    try {
      m.refresh();
    } catch (error) {
      console.error(`[mappo] could not redraw a live map: ${error?.message ?? String(error)}`);
    }
  }
}

// One warning per missing thing, after a grace period. Modules normally
// register within the same script run, so the message should mean "you forgot
// to import it", not "the module graph has not finished loading yet".
const PENDING_WARNINGS = new Set();
export function warnIfStillPending(key, stillPending, message) {
  if (PENDING_WARNINGS.has(key) || typeof setTimeout !== "function") return;
  PENDING_WARNINGS.add(key);
  const timer = setTimeout(() => { if (stillPending()) console.warn(`[mappo] ${message}`); }, PENDING_GRACE_MS);
  timer.unref?.();
}

// Hand a body over once, use it by name for ever after. Returns it, so the
// call reads as a definition rather than a side effect. Registering the same
// id again replaces the pack: maps that asked for it BY NAME follow the
// registry; maps handed a body object directly keep the object they were given.
export function registerBody(body) {
  validateBody(body);
  REGISTRY.set(body.id, body);
  PENDING.delete(body.id);
  for (const m of LIVE) {
    if (typeof m.options?.body !== "string" || normalizeId(m.options.body) !== body.id) continue;
    try {
      m.adoptBody(body);
    } catch (error) {
      // Registration is global; one live map with incompatible partial
      // latitude bounds must not prevent the pack, its tag, or other maps
      // from becoming available. That map keeps its previous body and retries
      // name resolution on its next update, after the consumer can correct it.
      console.error(`[mappo] could not apply body "${body.id}" to one live map: ${error?.message ?? String(error)}`);
    }
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
  if (!ID.test(id)) throw new TypeError(`body name must match ${ID} (got ${JSON.stringify(value)})`);
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
    warnIfStillPending(`body:${id}`, () => !REGISTRY.has(id),
      `body "${id}" was never registered — maps asking for it stay empty until registerBody() runs. Did you import its pack?`);
  }
  return body;
}

// Give a registered body more than its pack carried: the vector outlines and
// borders that arrive as a module of their own (mappo/bodies/earth-vector),
// or more places. The body object is changed in place, so every map already
// drawing it keeps its identity and the caches for what did not change, and
// is redrawn for what did. A frozen body cannot be extended.
export function extendBody(id, patch) {
  const body = REGISTRY.get(normalizeId(id));
  if (!body) throw new RangeError(`extendBody: no body "${id}" is registered`);
  if (!patch || typeof patch !== "object") throw new TypeError("extendBody needs a patch object");
  const allowed = new Set([ "name", "radiusKm", "latRange", "terms", "outlines", "borders", "places" ]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new TypeError(`extendBody: "${key}" is not something a body can be given later`);
  }
  const merged = { ...body, ...patch };
  if (patch.places) merged.places = [ ...(body.places ?? []), ...patch.places ];
  validateBody(merged);
  Object.assign(body, merged);
  PLACE_INDEX.delete(body);
  rerenderLive((m) => m.body === body);
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
  if (body.radiusKm != null && (!Number.isFinite(body.radiusKm) || !(body.radiusKm > 0))) {
    throw new TypeError(`${at} radiusKm must be a finite positive number`);
  }
  for (const key of [ "outlines", "borders" ]) {
    if (body[key] != null && typeof body[key] !== "function") throw new TypeError(`${at} ${key} must be a function`);
  }
  if (body.places != null) {
    if (!Array.isArray(body.places)) throw new TypeError(`${at} places must be an array`);
    const names = new Set();
    for (let i = 0; i < body.places.length; i++) {
      const place = body.places[i];
      if (!place || typeof place !== "object" || typeof place.name !== "string" || !place.name.trim()) {
        throw new TypeError(`${at} places[${i}] needs a non-empty name`);
      }
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) ||
          Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) {
        throw new TypeError(`${at} places[${i}] needs lat/lon within [-90, 90] and [-180, 180]`);
      }
      if (place.kind != null && typeof place.kind !== "string") {
        throw new TypeError(`${at} places[${i}] kind must be a string`);
      }
      if (place.color != null && typeof place.color !== "string") {
        throw new TypeError(`${at} places[${i}] color must be a string`);
      }
      const key = fold(place.name);
      if (names.has(key)) throw new TypeError(`${at} has duplicate place name ${JSON.stringify(place.name)}`);
      names.add(key);
    }
  }
  if (body.terms != null &&
      (typeof body.terms.figure !== "string" || !body.terms.figure.trim() ||
       typeof body.terms.ground !== "string" || !body.terms.ground.trim())) {
    throw new TypeError(`${at} terms must be non-empty { figure, ground } strings`);
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
function fold(name) {
  return name.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
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
  if (entry && Number.isFinite(entry.lat) && Number.isFinite(entry.lon) &&
      Math.abs(entry.lat) <= 90 && Math.abs(entry.lon) <= 180 &&
      (entry.name == null || typeof entry.name === "string") &&
      (entry.kind == null || typeof entry.kind === "string") &&
      (entry.color == null || typeof entry.color === "string")) {
    return { ...entry, name: entry.name ?? "" };
  }
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
