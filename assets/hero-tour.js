// The hero globe's tour of itself: one card, one thing at a time, told in
// order as the globe turns. Two lines wire it:
//
//   import { heroTour } from "./assets/hero-tour.js";
//   heroTour(document.getElementById("hero"), { keepClear: [ copyElement ] });
//
// The element is a <mappo-world mode="globe">. Nothing else on the page needs
// to know: the card and the labels are children the tour positions with
// locate() every frame (so they ride the globe like Cloudflare's captions and
// hide behind the limb), the arcs are mappo/links, pins and regions are drawn
// on a layer of the tour's own through Mappo#addLayer, and stop() takes all of
// it away.
//
// The script is a story that follows the rotation, and the tour directs the
// globe to each scene: it opens over Europe; draws Rome to Madrid and, directly
// after, Madrid across the ocean to Boston; lights the main cities on the page
// with names and local times; turns to the United States and raises its dots;
// then sets off west at speed, through the Pacific and Asia and back to Europe,
// with cities popping up over the horizon and arcs drawn between them sliding
// behind it, and says how small it all is. Every turn goes the way the Earth
// turns. Every scripted subject has a fallback chosen from what is in view, so
// the tour keeps making sense after a visitor has dragged the globe somewhere
// else. Pass `steps` to change the words or the order, `keepClear` for boxes a
// subject must not sit under, and `debug` to have every choice explained.

import { resolvePlace, normalizeRings, pointInRings } from "../dist/mappo.js";
import { links } from "../dist/links.js";
import { forEachSample, mixColor } from "../dist/globe.js";
import { regions } from "../demo/countries.js";

// Local time for a labelled pin, by city.
export const TIME_ZONES = {
  Boston: "America/New_York", "New York": "America/New_York", Philadelphia: "America/New_York", Washington: "America/New_York",
  Miami: "America/New_York", Atlanta: "America/New_York", Toronto: "America/Toronto", Montreal: "America/Toronto",
  Chicago: "America/Chicago", Houston: "America/Chicago", Denver: "America/Denver", Phoenix: "America/Phoenix", Calgary: "America/Edmonton",
  Seattle: "America/Los_Angeles", "Los Angeles": "America/Los_Angeles", "San Francisco": "America/Los_Angeles", Vancouver: "America/Vancouver",
  "Mexico City": "America/Mexico_City", Guadalajara: "America/Mexico_City", Monterrey: "America/Monterrey", "Guatemala City": "America/Guatemala",
  Havana: "America/Havana", "Panama City": "America/Panama", "San José": "America/Costa_Rica", Bogotá: "America/Bogota", Caracas: "America/Caracas",
  Quito: "America/Guayaquil", Lima: "America/Lima", "La Paz": "America/La_Paz", Santiago: "America/Santiago",
  "Buenos Aires": "America/Argentina/Buenos_Aires", Córdoba: "America/Argentina/Cordoba", Montevideo: "America/Montevideo",
  "São Paulo": "America/Sao_Paulo", "Rio de Janeiro": "America/Sao_Paulo", Brasília: "America/Sao_Paulo", Reykjavík: "Atlantic/Reykjavik",
  London: "Europe/London", Lisbon: "Europe/Lisbon", Madrid: "Europe/Madrid", Paris: "Europe/Paris", Berlin: "Europe/Berlin", Rome: "Europe/Rome",
  Athens: "Europe/Athens", Istanbul: "Europe/Istanbul", Moscow: "Europe/Moscow", Cairo: "Africa/Cairo", Lagos: "Africa/Lagos",
  Nairobi: "Africa/Nairobi", Johannesburg: "Africa/Johannesburg", "Cape Town": "Africa/Johannesburg", Dubai: "Asia/Dubai",
  Mumbai: "Asia/Kolkata", Delhi: "Asia/Kolkata", Bangkok: "Asia/Bangkok", Singapore: "Asia/Singapore", "Hong Kong": "Asia/Hong_Kong",
  Beijing: "Asia/Shanghai", Seoul: "Asia/Seoul", Tokyo: "Asia/Tokyo", Jakarta: "Asia/Jakarta", Manila: "Asia/Manila",
  Perth: "Australia/Perth", Sydney: "Australia/Sydney", Melbourne: "Australia/Melbourne", Auckland: "Pacific/Auckland",
  Casablanca: "Africa/Casablanca", Dakar: "Africa/Dakar", Accra: "Africa/Accra", Tehran: "Asia/Tehran", Karachi: "Asia/Karachi",
  Kolkata: "Asia/Kolkata", "Addis Ababa": "Africa/Addis_Ababa", Kinshasa: "Africa/Kinshasa", Riyadh: "Asia/Riyadh", Hanoi: "Asia/Bangkok",
  Ulaanbaatar: "Asia/Ulaanbaatar", Tashkent: "Asia/Tashkent", Kyiv: "Europe/Kyiv", Warsaw: "Europe/Warsaw", Stockholm: "Europe/Stockholm",
  Oslo: "Europe/Oslo", Colombo: "Asia/Colombo", Dhaka: "Asia/Dhaka", Baghdad: "Asia/Baghdad", Algiers: "Africa/Algiers", Tunis: "Africa/Tunis",
  Honolulu: "Pacific/Honolulu", Anchorage: "America/Anchorage", Papeete: "Pacific/Tahiti", Apia: "Pacific/Apia", Suva: "Pacific/Fiji",
  Nouméa: "Pacific/Noumea", Wellington: "Pacific/Auckland", Brisbane: "Australia/Brisbane", Petropavlovsk: "Asia/Kamchatka", Anadyr: "Asia/Anadyr"
};

// Places the gazetteer lacks, for the trip west: the Pacific is where things
// rise after the Americas have gone round.
const PACIFIC = [ { name: "Honolulu", lat: 21.3, lon: -157.9 }, { name: "Anchorage", lat: 61.2, lon: -149.9 },
  { name: "Papeete", lat: -17.5, lon: -149.6 }, { name: "Apia", lat: -13.8, lon: -171.8 }, { name: "Suva", lat: -18.1, lon: 178.4 },
  { name: "Nouméa", lat: -22.3, lon: 166.4 }, { name: "Wellington", lat: -41.3, lon: 174.8 }, { name: "Brisbane", lat: -27.5, lon: 153 },
  { name: "Petropavlovsk", lat: 53, lon: 158.6 }, { name: "Anadyr", lat: 64.7, lon: 177.5 } ];
// The pins step shows the world's main cities, most important first.
const MAJOR = [ "New York", "Los Angeles", "Chicago", "Toronto", "Mexico City", "Bogotá", "Lima", "São Paulo", "Buenos Aires", "London",
  "Paris", "Madrid", "Berlin", "Rome", "Istanbul", "Cairo", "Lagos", "Nairobi", "Johannesburg", "Dubai", "Mumbai", "Delhi", "Singapore",
  "Hong Kong", "Tokyo", "Seoul", "Sydney", "Boston", "Miami", "Casablanca", "Dakar", "Lisbon" ];
// Everything that may pop up on the trip west.
const WORLD = [ ...MAJOR, "Seattle", "San Francisco", "Vancouver", "Denver", "Houston", "Havana", "Caracas", "Santiago", "Reykjavík",
  "Moscow", "Athens", "Tehran", "Karachi", "Bangkok", "Jakarta", "Manila", "Beijing", "Perth", "Melbourne", "Auckland", "Cape Town",
  "Accra", "Kinshasa", "Addis Ababa", "Riyadh", "Kolkata", "Hanoi", "Ulaanbaatar", "Tashkent", "Kyiv", "Warsaw", "Stockholm", "Oslo", ...PACIFIC ];
// Pairs an arc falls back to when the scripted one is not in view.
const PAIRS = [ [ "Paris", "Rome" ], [ "Madrid", "Paris" ], [ "Lisbon", "London" ], [ "Paris", "London" ], [ "Casablanca", "Madrid" ],
  [ "Dakar", "Casablanca" ], [ "Dakar", "São Paulo" ], [ "Accra", "Lagos" ], [ "Lagos", "Kinshasa" ], [ "Cairo", "Istanbul" ], [ "Cairo", "Riyadh" ],
  [ "Johannesburg", "Cape Town" ], [ "Nairobi", "Addis Ababa" ], [ "Algiers", "Tunis" ], [ "Rome", "Athens" ], [ "Berlin", "Warsaw" ],
  [ "Madrid", "Berlin" ], [ "Oslo", "Stockholm" ], [ "Reykjavík", "Oslo" ], [ "Moscow", "Warsaw" ], [ "Moscow", "Kyiv" ], [ "New York", "Chicago" ],
  [ "New York", "Miami" ], [ "Toronto", "New York" ], [ "Boston", "Washington" ], [ "Chicago", "Denver" ], [ "Los Angeles", "San Francisco" ],
  [ "Vancouver", "Los Angeles" ], [ "Mexico City", "Havana" ], [ "Mexico City", "Bogotá" ], [ "Bogotá", "Quito" ], [ "Caracas", "Havana" ],
  [ "Lima", "Bogotá" ], [ "Lima", "La Paz" ], [ "Santiago", "Buenos Aires" ], [ "São Paulo", "Buenos Aires" ], [ "São Paulo", "Montevideo" ],
  [ "Dubai", "Karachi" ], [ "Karachi", "Delhi" ], [ "Delhi", "Mumbai" ], [ "Mumbai", "Colombo" ], [ "Kolkata", "Dhaka" ], [ "Tashkent", "Tehran" ],
  [ "Tehran", "Baghdad" ], [ "Riyadh", "Dubai" ], [ "Bangkok", "Hanoi" ], [ "Bangkok", "Singapore" ], [ "Hong Kong", "Manila" ],
  [ "Jakarta", "Singapore" ], [ "Seoul", "Beijing" ], [ "Tokyo", "Seoul" ], [ "Tokyo", "Hong Kong" ], [ "Beijing", "Hong Kong" ],
  [ "Ulaanbaatar", "Beijing" ], [ "Jakarta", "Manila" ], [ "Perth", "Melbourne" ], [ "Sydney", "Melbourne" ], [ "Sydney", "Auckland" ],
  [ "Vancouver", "Denver" ], [ "London", "New York" ], [ "Tokyo", "San Francisco" ], [ "Sydney", "Singapore" ], [ "Buenos Aires", "Lisbon" ] ];
// Regions a highlight falls back to, in order of preference, each with the
// point its card and visibility are judged at.
const REGIONS = [ [ "US", 39, -98 ], [ "BR", -10, -53 ], [ "MX", 23, -102 ], [ "AR", -35, -65 ], [ "CA", 56, -100 ], [ "ES", 40, -3 ], [ "FR", 46, 2 ],
  [ "DE", 51, 10 ], [ "IT", 42, 12 ], [ "GB", 54, -2 ], [ "EG", 27, 30 ], [ "NG", 9, 8 ], [ "KE", 0, 38 ], [ "ZA", -29, 25 ], [ "IN", 22, 79 ],
  [ "CN", 35, 103 ], [ "JP", 36, 138 ], [ "ID", -2, 118 ], [ "AU", -25, 134 ] ];

// The storyboard. A step may name the longitude that should face the viewer
// when it starts (`frontLon`): the tour turns the globe there first, forward,
// fast and easing out. `speed` is the spin while the step plays. The voyage
// runs until the globe is back where the next lap needs it.
export const STEPS = [
  { kind: "label", style: "title", text: "This is a mappo globe", hold: 4, speed: 1.4 },
  // A little quicker under the first arc, so that Boston is over the horizon
  // the moment the second begins: the two arcs follow each other directly.
  { kind: "arc", text: "You can draw an arc between any two places", hold: 7, speed: 2.6, height: 0.12, from: "Rome", to: "Madrid", pairs: PAIRS },
  { kind: "arc", text: "Or across an ocean, Madrid to Boston", hold: 6.5, speed: 2, height: 0.06, draw: 1.2, from: "Madrid", to: "Boston", pairs: PAIRS },
  // Whatever main cities are on the page now: the Americas, and Europe's edge while it lasts.
  { kind: "pins", text: "You can place pins on the map", hold: 8, speed: 1.4, cities: MAJOR, count: 10, labels: true },
  // The United States, central, its dots extruded into low bars.
  { kind: "region", text: "You can highlight regions", hold: 6.5, speed: 1.4, frontLon: -76, regions: REGIONS },
  // West, through the Pacific and Asia and back to Europe: slowly at first, so
  // Hawaii and Anchorage can be watched rising over the horizon, then gathering
  // speed, with arcs drawn between the cities from Asia onward and left to
  // slide behind the edge.
  { kind: "voyage", text: "Labels and arcs hide behind the horizon, and come back as the globe turns", speed: 2.6, fast: 18, quicken: 8, arcsAfter: 11, frontLon: -90, cities: WORLD, count: 8 },
  { kind: "label", style: "center", eyebrow: "22 KB", text: "And all of it is one element, with no dependencies", hold: 6, speed: 1.4 }
];
const TURN_SPEED = 40;   // degrees a second at full tilt, when turning to a step
// A highlighted region is one tile per dot of the map, and a wave runs through
// them: at the crest a tile rides a little higher off the sphere, swells, and
// warms toward the page's accent, so the band reads three ways at once and none
// of them is a wall. Lengths are in lattice steps, the angle between
// neighbouring dots, so they hold at any globe size or dot density.
const RELIEF = 0.03;     // how far off the sphere a tile rests
const WAVE = 0.22;       // how much higher the crest carries it
const TILE = 0.62;       // a tile at rest, wider than the dot it stands over
const TILE_SWELL = 0.3;  // how much wider the crest makes it
const WARM = 0.8;        // how far the crest mixes the ink toward the accent
const BANDS = 6;         // shades between the two, one fill each
const WAVE_DEG = 34;     // degrees of longitude between crests
const WAVE_SECS = 2.6;   // seconds for a crest to travel from one to the next

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (t) => 1 - (1 - clamp01(t)) ** 3;
const RAD = Math.PI / 180;
const CARD_W = 280;   // a card's width before it has been measured

const CSS = `
.mappo-tour,.mappo-tour-label{position:absolute;left:0;top:0;pointer-events:none;z-index:5;will-change:transform}
.mappo-tour-card,.mappo-tour-label .in{display:flex;align-items:center;white-space:nowrap;
  font:600 12.5px/1 var(--sans,-apple-system,system-ui,sans-serif);letter-spacing:-.005em;color:var(--ink,#16181d);
  background:color-mix(in oklab,var(--bg,#fff) 84%,transparent);border:1px solid var(--line,#e8e2d8);border-radius:10px;
  box-shadow:0 6px 22px -12px #0000004d;backdrop-filter:blur(7px)}
.mappo-tour-card{position:absolute;left:14px;top:0;gap:9px;padding:9px 12px;transform:translateY(-50%) scale(0);transform-origin:left center;
  opacity:0;transition:transform .32s cubic-bezier(.2,.8,.2,1),opacity .25s}
.mappo-tour.on .mappo-tour-card{transform:translateY(-50%) scale(1);opacity:1}
.mappo-tour.left .mappo-tour-card{left:auto;right:14px;transform-origin:right center}
.mappo-tour.free .mappo-tour-card{left:0;right:auto;transform:translate(-50%,-50%) scale(0);transform-origin:center;
  white-space:normal;text-wrap:balance;width:max-content;max-width:min(292px,58vw);line-height:1.35}
.mappo-tour.free.on .mappo-tour-card{transform:translate(-50%,-50%) scale(1)}
.mappo-tour.above .mappo-tour-card{left:0;right:auto;transform:translate(-50%,calc(-100% - 14px)) scale(0);transform-origin:center bottom}
.mappo-tour.above.on .mappo-tour-card{transform:translate(-50%,calc(-100% - 14px)) scale(1)}
.mappo-tour.below .mappo-tour-card{left:0;right:auto;transform:translate(-50%,14px) scale(0);transform-origin:center top}
.mappo-tour.below.on .mappo-tour-card{transform:translate(-50%,14px) scale(1)}
/* The title: the same card as every other one on the page, at title size. */
.mappo-tour.title .mappo-tour-card{gap:11px;padding:13px 18px 13px 15px;border-radius:13px;
  font-size:17px;font-weight:650;letter-spacing:-.016em}
.mappo-tour.title .mappo-tour-dot{width:10px;height:10px;box-shadow:0 0 0 5px color-mix(in oklab,var(--accent,#c2410c) 18%,transparent)}
.mappo-tour-reset{position:absolute;left:0;top:0;transform:translate(-50%,-50%);pointer-events:auto;z-index:6;cursor:pointer;
  font:600 12px/1 var(--sans,-apple-system,system-ui,sans-serif);color:var(--muted,#6b7280);
  background:color-mix(in oklab,var(--bg,#fff) 84%,transparent);border:1px solid var(--line,#e8e2d8);border-radius:999px;padding:8px 13px;
  opacity:0;transition:opacity .3s}
.mappo-tour-reset.on{opacity:1}
.mappo-tour-reset:hover{color:var(--ink,#16181d)}
.mappo-tour-reset[hidden]{display:none}
.mappo-tour-eyebrow{font-style:normal;white-space:nowrap;font-size:10px;font-weight:640;letter-spacing:.06em;text-transform:uppercase;color:var(--faint,#9aa1ac)}
.mappo-tour-eyebrow:empty,.mappo-tour-dot[hidden]{display:none}
.mappo-tour-dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#c2410c);
  box-shadow:0 0 0 4px color-mix(in oklab,var(--accent,#c2410c) 20%,transparent)}
.mappo-tour-label .in{position:absolute;left:12px;top:0;gap:7px;padding:6px 9px;font-size:11.5px;border-radius:8px;
  transform:translateY(-50%) scale(.6);transform-origin:left center;opacity:0;transition:transform .25s cubic-bezier(.2,.8,.2,1),opacity .2s}
.mappo-tour-label.on .in{transform:translateY(-50%) scale(1);opacity:1}
.mappo-tour-label.left .in{left:auto;right:12px;transform-origin:right center}
.mappo-tour-label span{color:var(--faint,#9aa1ac);font-weight:500;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.mappo-tour-card,.mappo-tour-label .in{transition:none}}`;

function injectStyle() {
  if (document.getElementById("mappo-tour-style")) return;
  const s = document.createElement("style");
  s.id = "mappo-tour-style";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const ready = (el) => el.map ? Promise.resolve() : customElements.whenDefined(el.localName).then(() => new Promise(queueMicrotask));

export function heroTour(el, options = {}) {
  const ctl = { stopped: false, stop() { this.stopped = true; this._teardown?.(); } };
  ready(el).then(() => { if (!ctl.stopped) start(el, options, ctl); });
  return ctl;
}

function start(el, options, ctl) {
  const map = el.map;
  if (!map) return;
  injectStyle();
  const steps = options.steps ?? STEPS;
  const reduce = options.reduceMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const debug = (...a) => { if (options.debug) console.debug("[hero-tour]", ...a); };

  // The card: a child of the element, placed by the tour, never harvested by
  // mappo (it is added after the map exists, and carries no data-lat).
  const root = document.createElement("div");
  root.className = "mappo-tour";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<div class="mappo-tour-card"><span class="mappo-tour-dot"></span><i class="mappo-tour-eyebrow"></i><span class="mappo-tour-text"></span></div>`;
  el.appendChild(root);
  // A way back after a visitor has turned the globe somewhere else: shown once
  // they have, at the bottom of the disc, it restarts the story from the top.
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "mappo-tour-reset";
  reset.textContent = "Reset demo";
  reset.hidden = true;
  el.appendChild(reset);
  const card = root.querySelector(".mappo-tour-card"), dot = root.querySelector(".mappo-tour-dot"),
    eyebrow = root.querySelector(".mappo-tour-eyebrow"), text = root.querySelector(".mappo-tour-text");
  // Labels for pins: a pool, made as needed, each a name and a local time.
  const labels = [];
  const label = (i) => {
    while (labels.length <= i) {
      const l = document.createElement("div");
      l.className = "mappo-tour-label";
      l.setAttribute("aria-hidden", "true");
      l.innerHTML = `<div class="in"><b></b><span></span></div>`;
      el.appendChild(l);
      labels.push(l);
    }
    return labels[i];
  };
  const parkLabels = (from = 0) => { for (let i = from; i < labels.length; i++) { labels[i].classList.remove("on"); labels[i].style.transform = "translate3d(-9999px,-9999px,0)"; } };
  const times = new Map();
  const localTime = (zone) => {
    const minute = Math.floor(Date.now() / 60000), key = zone + minute;
    if (!times.has(key)) {
      times.clear();
      try { times.set(key, new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }).format(new Date())); }
      catch { times.set(key, ""); }
    }
    return times.get(key);
  };

  // A place: a gazetteer name, [lat, lon] or { name, lat, lon }.
  const place = (v) => {
    if (Array.isArray(v)) return Number.isFinite(v[0]) && Number.isFinite(v[1]) ? { lat: v[0], lon: v[1], name: "" } : null;
    if (v && typeof v === "object") return Number.isFinite(v.lat) && Number.isFinite(v.lon) ? { name: "", ...v } : null;
    const p = resolvePlace(v, map.body);
    return p ? { lat: p.lat, lon: p.lon, name: v } : null;
  };
  const baseSpeed = map.options.rotateSpeed ?? 0;
  const eastward = baseSpeed >= 0;

  // What is in view, off the boxes to keep clear, and on the page for the whole
  // step: the spin carries a subject `drift` pixels during a step, so the edge
  // things move toward gets that much more margin.
  let box = null, clear = [], drift = 0;
  const survey = (step) => {
    box = el.getBoundingClientRect();
    clear = (options.keepClear ?? []).filter(Boolean).map((n) => n.getBoundingClientRect());
    // At the step's own speed, and at the scale the camera gives the front of
    // the globe, which is where the subjects are.
    const front = map.locate(0, 0), scale = front?.scale ?? front?.r ?? box.width * 0.4;
    drift = Math.abs(step?.speed ?? baseSpeed) * RAD * (step?.hold ?? 8) * scale;
  };
  const pageW = () => document.documentElement.clientWidth || innerWidth;
  const pageH = () => document.documentElement.clientHeight || innerHeight;
  const allowed = (q, withDrift = true) => {
    if (!q?.front || !box) return !!q?.front;
    const x = box.left + q.x, y = box.top + q.y, m = 24, d = withDrift ? drift : 0;
    const right = m + (eastward ? d : 0), left = m + (eastward ? 0 : d);
    if (x < left || x > pageW() - right || y < m || y > pageH() - m) return false;
    return clear.every((r) => x < r.left - (eastward ? d : 0) - m || x > r.right + (eastward ? 0 : d) + m || y < r.top - m || y > r.bottom + m);
  };
  // The front meridian: the longitude squarely facing us right now.
  const frontLon = () => {
    let best = -2, lon = 0;
    for (let l = -180; l < 180; l += 3) { const q = map.locate(0, l); if (q && q.z > best) { best = q.z; lon = l; } }
    return lon;
  };
  // How far the front still has to fall to reach a longitude, going the way the globe turns.
  const remainingTo = (lon) => ((frontLon() - lon) % 360 + 360) % 360;
  // Where the horizon is, as a view depth: 1/distance under a camera, 0 without one.
  const horizonZ = () => { const D = map.options.distance; return Number.isFinite(D) && D > 1 ? 1 / D : 0; };
  // Squarely facing, with a bonus for the half of the disc turning toward the middle.
  const score = (q) => q && q.front && allowed(q) ? q.depth + ((q.x < q.cx) === eastward ? 0.18 : 0) : -1;
  // Whether a card of width w, opening to a side of a page point, stays on the
  // page and off the boxes to keep clear; and the same at both ends of the drift.
  const cardWidth = () => card.offsetWidth || CARD_W;
  const cardFits = (px, py, side, w = cardWidth()) => {
    const x0 = side === "center" ? px - w / 2 : side === "left" ? px - 14 - w : px + 14, x1 = x0 + w, y0 = py - 18, y1 = py + 18;
    if (x0 < 8 || x1 > pageW() - 8) return false;
    return clear.every((r) => x1 < r.left || x0 > r.right || y1 < r.top || y0 > r.bottom);
  };
  const fitsThrough = (px, py, side, w = cardWidth()) => cardFits(px, py, side, w) && cardFits(px + (eastward ? drift : -drift), py, side, w);

  // Where a free card floats: a surface point that faces us, on the side turning
  // toward the middle, with room for the whole card around it.
  const frontPoint = (lats = [ 30, 12 ]) => {
    let best = null;
    for (const lat of lats) {
      for (let lon = -180; lon < 180; lon += 6) {
        const q = map.locate(lat, lon);
        if (!q?.front) continue;
        if (box && !fitsThrough(box.left + q.x, box.top + q.y, "center")) continue;
        if (score(q) > (best?.s ?? -1)) best = { s: score(q), lat, lon };
      }
      if (best) break;
    }
    return best ? { lat: best.lat, lon: best.lon, side: "center" } : null;
  };
  const byId = new Map(regions().map((r) => [ r.id, r ]));
  const colors = () => {
    const cs = getComputedStyle(el);
    const v = (n, f) => cs.getPropertyValue(n).trim() || f;
    const accent = v("--accent", "#c2410c");
    return { pin: v("--pin", accent), area: v("--area", "#0b7285"), arc: v("--arc", accent), accent, ink: v("--ink", "#16181d") };
  };

  // The globe's own dots inside a region, from the same lattice the globe
  // samples, so a raised dot stands exactly where a dot is. Built once per
  // region, when it is first highlighted.
  const dotsCache = new Map();
  const regionDots = (r) => {
    if (dotsCache.has(r.id)) return dotsCache.get(r.id);
    const rings = normalizeRings(r.rings);
    let latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
    for (const ring of r.rings) for (const [ la, lo ] of ring) { latMin = Math.min(latMin, la); latMax = Math.max(latMax, la); lonMin = Math.min(lonMin, lo); lonMax = Math.max(lonMax, lo); }
    const wraps = lonMax - lonMin > 180;
    const out = [];
    const cols = map.options.cols ?? 170, distribution = map.options.distribution === "uniform" ? "uniform" : "grid";
    forEachSample(cols, map.options.latRange, distribution, (lat, lon) => {
      if (lat < latMin || lat > latMax || (!wraps && (lon < lonMin || lon > lonMax))) return;
      if (pointInRings(lat, lon, rings)) out.push(lat, lon);
    });
    const dots = new Float64Array(out);
    dotsCache.set(r.id, dots);
    return dots;
  };

  // The angle between neighbouring dots, in radius units: the grid's cell on a
  // lat/lon lattice, the Fibonacci spacing on a uniform one. Bars are sized in
  // these, so they fit the map's dots whatever the globe's size or density.
  const latticeStep = () => {
    const cols = map.options.cols ?? 170;
    return map.options.distribution === "uniform"
      ? Math.sqrt(4 * Math.PI / Math.round(cols * cols / Math.PI))
      : 2 * Math.PI / cols;
  };

  const state = { i: -1, step: null, subject: null, t0: 0, anchor: null, arc: null, goto: null, pending: null, held: false, lastNow: 0 };
  const homeLon = frontLon();
  // For harnesses and the curious: the tour's state and its front meridian.
  el.tour = { state, steps, frontLon, homeLon };
  let arcs = null, layer = null, raf = null;
  // Speed changes are applied from the tour's own tick, never from inside a
  // frame: map.update() redraws synchronously, which would run this frame again
  // inside itself.
  let speedWanted = null;
  const setSpeed = (v) => { speedWanted = v; };
  const applySpeed = () => {
    if (speedWanted == null) return;
    const v = speedWanted; speedWanted = null;
    if (Math.abs((map.options.rotateSpeed ?? 0) - v) > 0.3) map.update({ rotateSpeed: v });
  };
  // A visitor holding the globe stops the story's clock; when they let go the
  // step goes on if its subject still faces them, else the next step is turned
  // to. The reset button appears the first time they do.
  const onHold = (e) => { if (e.target === reset) return; state.held = true; reset.hidden = false; requestAnimationFrame(() => reset.classList.add("on")); };
  const onRelease = () => { if (state.held) state.recheck = true; state.held = false; };
  const clearSubject = () => {
    if (state.arc) { arcs.remove(state.arc); state.arc = null; }
    for (const a of state.subject?.arcs ?? []) arcs.remove(a.link);
    parkLabels();
    state.step = null; state.subject = null;
  };
  const restart = () => { clearSubject(); state.i = -1; state.pending = null; state.goto = homeLon; root.classList.remove("on"); };
  el.addEventListener("pointerdown", onHold);
  el.addEventListener("pointerup", onRelease);
  el.addEventListener("pointercancel", onRelease);
  reset.addEventListener("click", restart);

  const setCard = (step) => {
    eyebrow.textContent = step.eyebrow ?? "";
    text.textContent = step.text;
    dot.hidden = !!step.eyebrow;
    root.classList.toggle("title", step.style === "title");
  };

  // Pins with room for their labels: no two within a label's height of each
  // other unless a label's width apart.
  const spaced = (chosen, q) => chosen.every((o) => Math.abs(o.q.y - q.y) > 24 || Math.abs(o.q.x - q.x) > 150);

  // Cities just behind the horizon on the side that is turning into view, or
  // only just over it, that are not already among `have`, with room for their
  // labels. The horizon is where the camera's cap ends, not the centre plane:
  // under a camera 2.4 radii out it sits at a view depth of 0.41. Nothing
  // above the hero's top edge or under a box kept clear. `risen` widens the
  // window to take in what came up a moment ago, which a step needs on its
  // first scan: an ocean nobody has named yet looks empty.
  const risers = (step, have, max = step.count ?? 3, risen = 0) => {
    const zh = horizonZ(), names = new Set(have.map((p) => p.name));
    const chosen = have.map((p) => ({ p, q: map.locate(p.lat, p.lon) })).filter((c) => c.q);
    const seen = (step.cities ?? WORLD).map(place).filter(Boolean).filter((p) => !names.has(p.name))
      .map((p) => ({ p, q: map.locate(p.lat, p.lon) }))
      .filter((c) => c.q && c.q.z > zh - 0.3 && c.q.z < zh + 0.08 + risen && (c.q.x < c.q.cx) === eastward && box && box.left + c.q.x > 24 && box.top + c.q.y > 56 && box.top + c.q.y < Math.min(pageH() - 40, box.bottom - 22) &&
        clear.every((r) => box.left + c.q.x > r.right + 8 || box.left + c.q.x < r.left - 8 || box.top + c.q.y < r.top - 8 || box.top + c.q.y > r.bottom + 8))
      .sort((x, y) => y.q.z - x.q.z);
    const out = [];
    for (const c of seen) { if (spaced([ ...chosen, ...out ], c.q)) out.push(c); if (have.length + out.length >= max) break; }
    return out.map((c) => c.p);
  };

  // Choose what a step points at: the scripted subject if it is in view now,
  // else the best of the step's fallbacks.
  const pick = (step) => {
    survey(step);
    const kind = step.kind ?? step.id;
    if (kind === "arc") {
      // An arc may come in from beyond the page edge; where it lands carries the
      // card, so that end must be on the page now, clear of the boxes, with room
      // for its card on one side for the whole step.
      const offCopy = (q) => !box || clear.every((r) => { const x = box.left + q.x, y = box.top + q.y; return x < r.left - 24 || x > r.right + 24 || y < r.top - 24 || y > r.bottom + 24; });
      const landing = (q) => allowed(q, false) && (fitsThrough(box.left + q.x, box.top + q.y, "right") || fitsThrough(box.left + q.x, box.top + q.y, "left"));
      const tryPair = (a, b, scripted) => {
        const A = place(a), B = place(b);
        if (!A || !B) return null;
        const qa = map.locate(A.lat, A.lon), qb = map.locate(B.lat, B.lon);
        if (!qa?.front || !qb?.front || qa.depth < 0.15 || qb.depth < 0.15) return null;
        if (scripted) { if (!offCopy(qa) || !landing(qb)) return null; }
        else if (!allowed(qa, false) || !landing(qb)) return null;
        return { s: Math.min(score(qa), score(qb)), A, B, qa, qb };
      };
      let best = step.from && step.to ? tryPair(step.from, step.to, true) : null;
      const scripted = !!best;
      if (!best) for (const [ a, b ] of step.pairs ?? PAIRS) { const t = tryPair(a, b, false); if (t && t.s > (best?.s ?? -1)) best = t; }
      debug("arc:", best ? `${best.A.name} → ${best.B.name}${scripted ? " (scripted)" : " (fallback)"}` : "none in view");
      if (!best) return null;
      // A scripted arc goes the way it was written; a fallback travels toward the middle.
      const [ from, to ] = scripted || best.qa.depth < best.qb.depth ? [ best.A, best.B ] : [ best.B, best.A ];
      return { kind, from, to, anchor: to };
    }
    if (kind === "pins") {
      // The card sits at the centre of the disc; no pin or label goes under it.
      // Pins may drift off the page edge during the step, which is what pins on
      // a globe do. In the list's order: it is written most important first, so
      // when two labels would collide the greater city keeps its place.
      const disc = map.locate(0, 0), w = cardWidth();
      const underCard = (q) => !!disc && Math.abs(q.y - disc.cy) < 40 && q.x + 12 + 150 > disc.cx - w / 2 - 8 && q.x - 8 < disc.cx + w / 2 + 8;
      const seen = (step.cities ?? MAJOR).map(place).filter(Boolean)
        .map((p) => ({ p, q: map.locate(p.lat, p.lon) })).filter((c) => c.q?.front && c.q.depth > 0.12 && allowed(c.q, false) && !underCard(c.q));
      const pins = [];
      for (const c of seen) { if (spaced(pins, c.q)) pins.push(c); if (pins.length === (step.count ?? 3)) break; }
      debug("pins:", pins.map((c) => c.p.name));
      if (!pins.length) return null;
      return { kind, pins: pins.map((c) => c.p), labels: !!step.labels, anchor: { fixed: true, side: "center" } };
    }
    if (kind === "voyage") {
      // Ends where the next lap needs the globe: home, less what the steps after
      // it will turn while they play.
      const after = steps.slice(state.i + 1).reduce((a, s) => a + (s.hold ?? 0) * (s.speed ?? baseSpeed), 0);
      // The Pacific starts half named: Hawaii and Alaska are over the horizon
      // by the time the region step lets go, and an empty ocean is a dull opening.
      return { kind, pins: risers(step, [], step.count ?? 8, 0.35), arcs: [], nextArc: 0, endLon: homeLon + after, anchor: { fixed: true, side: "center" } };
    }
    if (kind === "region") {
      // The first region on the list that is squarely in view wins; otherwise
      // the most central of the rest, so a highlight is never off in a corner.
      const list = (step.regions ?? REGIONS).map(([ id, lat, lon ]) => ({ id, lat, lon, q: map.locate(lat, lon) }))
        .filter((c) => c.q?.front && c.q.depth >= 0.45 && allowed(c.q));
      const scripted = (step.regions ?? REGIONS)[0]?.[0];
      const first = list.filter((c) => c.id === scripted);
      for (const { id, lat, lon, q } of [ ...first, ...list.filter((c) => c.id !== scripted).sort((a, b) => b.q.depth - a.q.depth) ]) {
        const r = byId.get(id);
        if (!r?.rings?.length) continue;
        // The card hangs off the shape on whichever side has room for it after
        // the shape has drifted through the step: right of its east edge, above
        // its north edge, left of its west edge, below its south edge. Edges come
        // from the rings wholly in view.
        const edges = {};
        for (const ring of r.rings) {
          const pts = ring.map(([ la, lo ]) => ({ p: map.locate(la, lo), la, lo })).filter((e) => e.p?.front);
          if (pts.length < ring.length * 0.98) continue;
          for (const { p, la, lo } of pts) {
            if (!edges.east || p.x > edges.east.x) edges.east = { x: p.x, y: p.y, lat: la, lon: lo };
            if (!edges.west || p.x < edges.west.x) edges.west = { x: p.x, y: p.y, lat: la, lon: lo };
            if (!edges.north || p.y < edges.north.y) edges.north = { x: p.x, y: p.y, lat: la, lon: lo };
            if (!edges.south || p.y > edges.south.y) edges.south = { x: p.x, y: p.y, lat: la, lon: lo };
          }
        }
        if (!edges.east) continue;
        const room = (e, side, dy = 0) => !box || fitsThrough(box.left + e.x, box.top + e.y + dy, side);
        const side = room(edges.east, "right") ? "right" : room(edges.north, "center", -32) ? "above"
          : room(edges.west, "left") ? "left" : room(edges.south, "center", 32) ? "below" : null;
        if (!side) { debug("region:", id, "no room for its card"); continue; }
        const edge = { right: edges.east, left: edges.west, above: edges.north, below: edges.south }[side];
        debug("region:", id, side);
        return { kind, region: r, dots: regionDots(r), anchor: { lat: edge.lat, lon: edge.lon, side } };
      }
      debug("region: none in view");
      return null;
    }
    if (step.style === "title" || step.style === "center") return { kind: "label", anchor: { fixed: true, side: "center" } };
    const f = frontPoint(step.at === "bottom" ? [ -24, -10 ] : [ 30, 12 ]);
    return f ? { kind: "label", anchor: f } : null;
  };

  // Start a step whose longitude (if it has one) is facing us: choose its
  // subject now, set its speed, and run.
  const begin = (step, now) => {
    const subject = pick(step);
    debug(step.kind ?? step.id, subject ? "→ " + subject.kind : "skipped this lap");
    if (!subject) return false;
    state.step = step; state.subject = subject; state.anchor = subject.anchor; state.t0 = now;
    if (!reduce) setSpeed(step.speed ?? baseSpeed);
    if (subject.kind === "arc") {
      state.arc = arcs.add({ from: [ subject.from.lat, subject.from.lon ], to: [ subject.to.lat, subject.to.lon ],
        height: step.height ?? 0.14, range: [ 0, 0 ], tip: 3, width: 1.6 });
    }
    return true;
  };

  // The next step. One with a longitude of its own is reached first: the globe
  // is turned there (state.goto), and the step begins on arrival.
  const advance = (now) => {
    clearSubject();
    for (let n = 0; n < steps.length; n++) {
      state.i = (state.i + 1) % steps.length;
      const step = steps[state.i];
      setCard(step);                       // the words go in first, so the fit test measures this card
      const far = step.frontLon != null && !reduce && baseSpeed > 0 ? remainingTo(step.frontLon) : 0;
      if (far > 3 && far < 120) {
        state.goto = step.frontLon; state.pending = step; root.classList.remove("on");
        debug("turning to", step.frontLon, "for", step.kind);
        return false;
      }
      if (begin(step, now)) return true;
    }
    return false;
  };

  // Turning the globe to a longitude: only ever the way the Earth turns, fast
  // over what is in between, easing out as it arrives; on arrival the pending
  // step begins (or the script goes on).
  const turn = (now) => {
    if (state.held) return;
    const remaining = remainingTo(state.goto);
    if (remaining < 2 || remaining > 130) {
      const step = state.pending;
      state.goto = null; state.pending = null;
      if (step) { if (!begin(step, now)) advance(now); }
      else { setSpeed(baseSpeed); advance(now); }
      return;
    }
    setSpeed(Math.max(6, baseSpeed, Math.min(TURN_SPEED, remaining)));
  };

  const drawPin = (ctx, q, k, pulse) => {
    const r = 4.6 * k * (q.scale / q.r), a = 0.3 + 0.7 * q.depth;
    if (pulse < 1) {
      ctx.globalAlpha = a * 0.55 * (1 - pulse);
      ctx.beginPath(); ctx.arc(q.x, q.y, r * (1 + 2.2 * pulse), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 6.2832); ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(q.x, q.y, r + 1.2, 0, 6.2832); ctx.stroke();
  };

  // Pins with their labels beside them, popping in one after another; over the
  // horizon a pin eases in, and behind it eases out, the way the Cloudflare
  // pins do, rather than switching at the edge.
  const drawPins = (ctx, pins, withLabels, age, outK, C, stagger = 0.25, dt = 0) => {
    ctx.fillStyle = C.pin; ctx.strokeStyle = C.pin;
    // Two labels riding into each other (the camera slows a pin past the centre
    // while one behind it catches up): the one further along, on its way out,
    // gives way.
    const at = pins.map((p) => map.locate(p.lat, p.lon));
    const masked = new Set();
    const span = (q, i) => {
      const w = labels[i]?.firstElementChild.offsetWidth || 120;
      return box && box.left + q.x + 12 + w > pageW() - 8 ? [ q.x - 12 - w, q.x - 12 ] : [ q.x + 12, q.x + 12 + w ];
    };
    if (withLabels) for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      const a = at[i], b = at[j];
      if (!a?.front || !b?.front || Math.abs(a.y - b.y) > 26) continue;
      const sa = span(a, i), sb = span(b, j);
      if (sa[0] < sb[1] && sb[0] < sa[1]) masked.add((eastward ? a.x > b.x : a.x < b.x) ? i : j);
    }
    pins.forEach((p, i) => {
      const qp = at[i];
      const l = withLabels ? label(i) : null;
      const wl = l ? l.firstElementChild.offsetWidth || 120 : 0;
      const px = qp && box ? box.left + qp.x : 0;
      const room = !l || !box || (px > 12 && px < pageW() - 20 && (px + 12 + wl < pageW() - 8 || px - 12 - wl > 8));
      const want = qp?.front && qp.depth > 0.04 && room && !masked.has(i) ? 1 : 0;
      p._vis = p._vis == null ? want : p._vis + (want - p._vis) * Math.min(1, dt * 7);
      p._gone = want ? 0 : (p._gone ?? 0) + dt;
      const pop = Math.min(ease((age - stagger * i) / 0.4), outK) * ease(p._vis);
      if (l) {
        l.style.transform = qp ? `translate3d(${qp.x.toFixed(1)}px, ${qp.y.toFixed(1)}px, 0)` : "translate3d(-9999px,-9999px,0)";
        if (qp && box) l.classList.toggle("left", box.left + qp.x + 12 + (l.firstElementChild.offsetWidth || 120) > pageW() - 8);
        l.classList.toggle("on", pop > 0.5);
        if (pop > 0) {
          l.firstElementChild.firstElementChild.textContent = p.name;
          l.firstElementChild.lastElementChild.textContent = TIME_ZONES[p.name] ? localTime(TIME_ZONES[p.name]) : "";
        }
      }
      if (pop <= 0.001) return;
      drawPin(ctx, qp, pop, ((age * 0.45 + i * 0.33) % 1));
    });
    if (withLabels) parkLabels(pins.length);
  };

  // The voyage's arcs: from the first frame and every second and a half, up to
  // three at once, drawn between two visible risers or, failing that, any pair
  // of places in view; then left to ride the globe until an end goes behind
  // the horizon, when the arc erases from its tail and goes.
  const voyageArcs = (subject, now, dt, C) => {
    subject.nextArc -= dt;
    if (subject.nextArc <= 0 && subject.arcs.length < 3) {
      subject.nextArc = 1.5;
      const inUse = new Set(subject.arcs.flatMap((a) => [ a.a.name, a.b.name ]));
      const ok = (c) => c.q?.front && c.q.depth > 0.05 && !inUse.has(c.p.name) && (!box || box.left + c.q.x < pageW() - 12);
      const vis = subject.pins.map((p) => ({ p, q: map.locate(p.lat, p.lon) })).filter(ok);
      let pair = null;
      for (let i = 0; i < vis.length && !pair; i++) for (let j = i + 1; j < vis.length && !pair; j++) {
        if (Math.hypot(vis[i].q.x - vis[j].q.x, vis[i].q.y - vis[j].q.y) > 90) pair = [ vis[i], vis[j] ];
      }
      if (!pair) for (const [ a, b ] of PAIRS) {
        const A = place(a), B = place(b);
        if (!A || !B) continue;
        const ca = { p: A, q: map.locate(A.lat, A.lon) }, cb = { p: B, q: map.locate(B.lat, B.lon) };
        if (ok(ca) && ok(cb)) { pair = [ ca, cb ]; break; }
      }
      if (pair) {
        const [ A, B ] = pair[0].q.x < pair[1].q.x ? pair : [ pair[1], pair[0] ];
        subject.arcs.push({ a: A.p, b: B.p, t0: now, tail: 0, link: arcs.add({ from: [ A.p.lat, A.p.lon ], to: [ B.p.lat, B.p.lon ], height: 0.1, range: [ 0, 0 ], tip: 2.5, width: 1.5 }) });
        debug("voyage arc:", A.p.name, "→", B.p.name);
      }
    }
    for (const a of [ ...subject.arcs ]) {
      const qa = map.locate(a.a.lat, a.a.lon), qb = map.locate(a.b.lat, a.b.lon);
      const head = ease((now - a.t0) / 1);
      if (!qa?.front && !qb?.front) a.tail = 1;
      else if (!qa?.front || !qb?.front) a.tail = Math.min(1, a.tail + dt / 0.9);
      a.link.color = C.arc;
      a.link.range = a.tail < head ? [ a.tail, head ] : [ 0, 0 ];
      if (a.tail >= 1) { arcs.remove(a.link); subject.arcs.splice(subject.arcs.indexOf(a), 1); }
    }
  };

  let inFrame = false;
  const frame = (ctx) => {
    if (inFrame) return;
    inFrame = true;
    try { paint(ctx); } finally { inFrame = false; }
  };
  const paint = (ctx) => {
    const now = performance.now() / 1000;
    const dt = state.lastNow ? Math.min(0.1, now - state.lastNow) : 0;
    state.lastNow = now;
    if (state.held) { state.t0 += dt; }   // the clock waits with the hand
    const disc = map.locate(0, 0);
    if (disc && !reset.hidden) reset.style.transform = `translate3d(${disc.cx.toFixed(1)}px, ${(disc.cy + disc.r - 30).toFixed(1)}px, 0) translate(-50%, -50%)`;
    if (state.goto != null) { turn(now); if (state.goto != null || !state.step) return; }
    if (!state.step && !advance(now)) return;
    let age = now - state.t0;
    const step0 = state.step, subj0 = state.subject;
    // A step ends when its time is up; the voyage, when the globe is home.
    const over = subj0.kind === "voyage" ? age > 4 && remainingTo(subj0.endLon) < 3 : age >= step0.hold;
    if (over) { if (!advance(now)) return; age = 0; }
    const step = state.step, subject = state.subject, total = step.hold ?? 1e9;
    const C = colors();

    // The card rides its anchor, shows while the anchor faces us, opens toward
    // the middle of the disc unless the step says which way, and never off the
    // page or onto a box kept clear. A fixed anchor sits still on the disc.
    // A fixed card sits on the disc's centre line, but on the page: pushed left
    // as far as it must to fit when the disc's centre is near the page's edge.
    const fixedX = () => {
      const b = el.getBoundingClientRect(), w = cardWidth(), want = disc.cx + (state.anchor.fx ?? 0) * disc.r;
      return Math.max(w / 2 + 8 - b.left, Math.min(pageW() - 8 - w / 2 - b.left, want));
    };
    const fixedY = () => {
      const b = el.getBoundingClientRect(), h = card.offsetHeight || 40, w = cardWidth();
      const top = h / 2 + 10 - b.top, bottom = pageH() - 10 - h / 2 - b.top;
      let want = Math.max(top, Math.min(Math.max(top, bottom), disc.cy + (state.anchor.fy ?? 0) * disc.r));
      const x = b.left + fixedX();
      for (const r of clear) {
        if (x + w / 2 < r.left || x - w / 2 > r.right) continue;
        if (b.top + want + h / 2 > r.top && b.top + want - h / 2 < r.bottom) want = Math.min(want, r.top - 10 - h / 2 - b.top);
      }
      return Math.max(top, want);
    };
    const q = state.anchor.fixed
      ? (disc && { x: fixedX(), y: fixedY(), cx: disc.cx, front: true, depth: 1 })
      : map.locate(state.anchor.lat, state.anchor.lon);
    // Let go with the subject turned away: on to the next step, which turns the globe where it belongs.
    if (state.recheck && !state.held) { state.recheck = false; if (!q || !q.front || q.depth < 0.12) { if (!advance(now)) return; age = 0; } }
    root.style.transform = q ? `translate3d(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px, 0)` : "translate3d(-9999px,-9999px,0)";
    const ending = subject.kind === "voyage" ? clamp01((remainingTo(subject.endLon) - 3) / 12) : 1;
    root.classList.toggle("on", !!q && q.front && q.depth > 0.12 && age > 0.05 && age < total - 0.32 && ending > 0.5);
    const side = state.anchor.side;
    const free = side === "center";
    root.classList.toggle("free", free);
    root.classList.toggle("above", side === "above");
    root.classList.toggle("below", side === "below");
    if (q && !free && side !== "above" && side !== "below") {
      let left = state.anchor.side ? state.anchor.side === "left" : q.x > q.cx;
      if (!state.anchor.side) {
        const b = el.getBoundingClientRect(), px = b.left + q.x, py = b.top + q.y, w = cardWidth();
        if (!cardFits(px, py, left ? "left" : "right", w) && cardFits(px, py, left ? "right" : "left", w)) left = !left;
      }
      root.classList.toggle("left", left);
    }

    const outK = subject.kind === "voyage" ? ease(ending) : ease((total - age) / 0.35);
    ctx.lineJoin = ctx.lineCap = "round";

    if (subject.kind === "arc" && state.arc) {
      const head = ease(age / (step.draw ?? 1.8)), tail = 1 - ease((total - age) / 1.4);
      state.arc.range = tail < head ? [ tail, head ] : [ 0, 0 ];
      state.arc.color = C.arc;
      // The arc lands: a pin grows at the destination once the head arrives.
      if (head >= 0.999 && q?.front) { ctx.fillStyle = C.arc; ctx.strokeStyle = C.arc; drawPin(ctx, q, Math.min(ease((age - (step.draw ?? 1.8)) / 0.4), outK), 1); }
    } else if (subject.kind === "pins") {
      drawPins(ctx, subject.pins, subject.labels, age, outK, C, 0.25, dt);
    } else if (subject.kind === "voyage") {
      // Every second, whatever is next to rise; pins long gone behind free their places.
      if (age - (subject.scanned ?? -9) > 0.8) {
        subject.scanned = age;
        survey(step);
        for (let i = subject.pins.length - 1; i >= 0; i--) if ((subject.pins[i]._gone ?? 0) > 1.5) subject.pins.splice(i, 1);
        for (const p of risers(step, subject.pins, step.count ?? 8)) subject.pins.push(p);
      }
      drawPins(ctx, subject.pins, true, age, outK, C, 0, dt);
      // Slow across the Pacific, then gathering speed; the arcs begin over Asia.
      if (step.fast) setSpeed(step.speed + (step.fast - step.speed) * ease((age - (step.quicken ?? 8)) / 3));
      if (age > (step.arcsAfter ?? 0)) voyageArcs(subject, now, dt, C);
    } else if (subject.kind === "region") {
      // One square per dot of the map inside the region, and nothing else: no
      // wall, no plate beneath it. Each square is opaque and wider than the dot
      // it stands over, so the map never shows through, and the wave moves the
      // square rather than building anything on it. The crest travels east, the
      // way the map's own surface drifts, and leans with latitude so it crosses
      // the country on a diagonal; squaring the swell keeps the troughs still.
      // Tiles are collected into a few shades, so a whole band is a handful of
      // fills, and the crest is painted last, over the tiles it has passed.
      const k = Math.min(ease(age / 0.9), ease((total - age) / 0.6));
      if (k <= 0) return;
      const d = subject.dots, step = latticeStep(), phase = age / WAVE_SECS;
      const bands = Array.from({ length: BANDS }, () => new Path2D());
      for (let i = 0; i < d.length; i += 2) {
        const b = map.locate(d[i], d[i + 1]);
        if (!b?.front || b.depth < 0.05) continue;
        const s = 0.5 + 0.5 * Math.sin(2 * Math.PI * ((d[i + 1] + 0.35 * d[i]) / WAVE_DEG - phase));
        const swell = s * s;
        const t = map.locate(d[i], d[i + 1], 1 + step * (RELIEF + WAVE * swell) * k);
        const w = step * (TILE + TILE_SWELL * swell) * t.scale / 2;
        bands[Math.min(BANDS - 1, swell * BANDS | 0)].rect(t.x - w, t.y - w, w * 2, w * 2);
      }
      ctx.globalAlpha = k;
      for (let i = 0; i < BANDS; i++) {
        ctx.fillStyle = mixColor(C.ink, C.accent, WARM * (i + 0.5) / BANDS, ctx);
        ctx.fill(bands[i]);
      }
    }
    ctx.globalAlpha = 1;
  };

  // The tour's layer first, so its ranges are set before the arcs' layer draws
  // them in the same frame.
  layer = map.addLayer(frame);
  arcs = links(map, { fade: true, width: 1.6 });

  if (reduce) {
    // No motion: the first card, at the centre, and nothing else.
    survey(steps[0]);
    state.step = steps[0]; state.subject = { kind: "label", anchor: { fixed: true, side: "center" } }; state.anchor = state.subject.anchor; state.t0 = -1e9; setCard(steps[0]);
    layer.redraw();
  } else {
    // The globe redraws its layers whenever it turns; asking every frame costs
    // nothing then, and keeps the tour going when a visitor holds it still.
    const tick = () => { applySpeed(); layer.redraw(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }

  ctl._teardown = () => {
    if (raf) cancelAnimationFrame(raf);
    el.removeEventListener("pointerdown", onHold);
    el.removeEventListener("pointerup", onRelease);
    el.removeEventListener("pointercancel", onRelease);
    reset.remove();
    if (!reduce && Math.abs((map.options.rotateSpeed ?? 0) - baseSpeed) > 0.3) map.update({ rotateSpeed: baseSpeed });
    layer.remove();
    arcs.destroy();
    root.remove();
    for (const l of labels) l.remove();
  };
}
