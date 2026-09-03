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
// The script is a story that follows the rotation: with the globe opening over
// central Europe and turning east, an arc Rome to Madrid, then Madrid across
// the ocean to Boston, then pins with names and local times as the Americas
// come round, then the whole United States highlighted, then Pacific cities
// rising over the horizon, then the size, then a fast turn back to the start. Every scripted subject has a fallback
// chosen from what is in view at that moment, so the tour keeps making sense
// on its second lap, or after a visitor has dragged the globe somewhere else.
// Steps are paced by time; what a step points at is decided when it starts,
// on the half of the disc turning toward the middle, far enough from the page
// edge to still be there at the step's end, and off the boxes in `keepClear`.
// Pass `steps` to change the words or the order.

import { resolvePlace } from "../dist/mappo.js";
import { links } from "../dist/links.js";
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
  Honolulu: "Pacific/Honolulu", Anchorage: "America/Anchorage"
};

// Places for the horizon step that the gazetteer lacks: the Pacific is where
// things rise after the Americas have come round.
const HONOLULU = { name: "Honolulu", lat: 21.3, lon: -157.9 }, ANCHORAGE = { name: "Anchorage", lat: 61.2, lon: -149.9 };
const WEST = [ "Boston", "New York", "Washington", "Toronto", "Montreal", "Chicago", "Miami", "Atlanta", "Houston", "Denver", "Mexico City",
  "Havana", "Panama City", "Bogotá", "Caracas", "Lima", "Quito", "La Paz", "Santiago", "Buenos Aires", "Montevideo", "São Paulo",
  "Rio de Janeiro", "Brasília", "Seattle", "San Francisco", "Los Angeles", "Vancouver", "Phoenix", "Calgary", "Reykjavík" ];
// The pins step shows the world's main cities, not every one it knows.
const MAJOR = [ "New York", "Los Angeles", "Chicago", "Toronto", "Mexico City", "Bogotá", "Lima", "São Paulo", "Buenos Aires", "London",
  "Paris", "Madrid", "Berlin", "Rome", "Istanbul", "Cairo", "Lagos", "Nairobi", "Johannesburg", "Dubai", "Mumbai", "Delhi", "Singapore",
  "Hong Kong", "Tokyo", "Seoul", "Sydney", "Boston", "Miami", "Casablanca", "Dakar", "Lisbon" ];
const CITIES = [ ...WEST, "London", "Lisbon", "Madrid", "Paris", "Berlin", "Rome", "Athens", "Istanbul", "Moscow", "Cairo", "Lagos", "Nairobi",
  "Casablanca", "Dakar", "Accra", "Johannesburg", "Cape Town", "Dubai", "Mumbai", "Delhi", "Bangkok", "Singapore", "Hong Kong", "Beijing",
  "Seoul", "Tokyo", "Jakarta", "Manila", "Perth", "Sydney", "Melbourne", "Auckland", HONOLULU, ANCHORAGE ];
// Pairs an arc falls back to when the scripted one is not in view: short hops
// everywhere, so a globe of which only a slice is on the page always has one.
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

// The storyboard. Each step may name the longitude that should face the
// viewer when it starts (`frontLon`): the tour turns the globe there first,
// fast and easing out, so an ocean with nothing on it is crossed in a couple of
// seconds rather than a minute. `speed` is the spin while the step plays.
export const STEPS = [
  { kind: "label", style: "title", text: "This is a mappo globe", hold: 4, speed: 1.4 },
  { kind: "arc", text: "You can draw an arc between any two places", hold: 7, speed: 1.4, height: 0.12, from: "Rome", to: "Madrid", pairs: PAIRS },
  // Boston is well over the horizon once the mid Atlantic faces us; a long arc
  // keeps low, or its apex leaves the top of the hero.
  { kind: "arc", text: "Or across an ocean, Madrid to Boston", hold: 6.5, speed: 1.6, frontLon: -33, height: 0.06, draw: 1.2, from: "Madrid", to: "Boston", pairs: PAIRS },
  // Both shores of the Atlantic are on the page here: the whole globe lights up.
  // The mid Atlantic: Lisbon, Casablanca and Dakar on one side, Boston to
  // Buenos Aires on the other, all on the page at once.
  { kind: "pins", text: "You can place pins on the map", hold: 10, speed: 1.4, frontLon: -25, cities: MAJOR, count: 10, labels: true },
  // The United States, central.
  { kind: "region", text: "You can highlight regions", hold: 9, speed: 1.4, frontLon: -76, regions: REGIONS },
  // The Pacific is rising: Honolulu and Anchorage come up over the edge.
  { kind: "rise", text: "Labels hide behind the horizon, and come back as the globe turns", hold: 9, speed: 1.8, frontLon: -93, cities: CITIES, count: 3 },
  { kind: "label", eyebrow: "22 KB", text: "And all of it is one element, with no dependencies", hold: 6, speed: 1.8 }
];
// After the last step the globe is over the Pacific, with nothing to show for
// two thirds of a turn: the tour turns it forward to the opening view the same
// way, then starts over.
const TURN_SPEED = 40;   // degrees a second at full tilt, when turning to a step

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
.mappo-tour.free .mappo-tour-card{left:0;right:auto;transform:translate(-50%,-50%) scale(0);transform-origin:center}
.mappo-tour.free.on .mappo-tour-card{transform:translate(-50%,-50%) scale(1)}
.mappo-tour.above .mappo-tour-card{left:0;right:auto;transform:translate(-50%,calc(-100% - 14px)) scale(0);transform-origin:center bottom}
.mappo-tour.above.on .mappo-tour-card{transform:translate(-50%,calc(-100% - 14px)) scale(1)}
.mappo-tour.below .mappo-tour-card{left:0;right:auto;transform:translate(-50%,14px) scale(0);transform-origin:center top}
.mappo-tour.below.on .mappo-tour-card{transform:translate(-50%,14px) scale(1)}
/* The title: the same card as every other one on the page, the rounded
   translucent panel with its hairline and its accent dot, at title size. */
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
.mappo-tour-eyebrow{font-style:normal;font-size:10px;font-weight:640;letter-spacing:.06em;text-transform:uppercase;color:var(--faint,#9aa1ac)}
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
  const eastward = (map.options.rotateSpeed ?? 0) >= 0;

  // What is in view, off the boxes to keep clear, and on the page for the whole
  // step: the spin carries a subject `drift` pixels during a step, so the edge
  // things move toward gets that much more margin.
  let box = null, clear = [], drift = 0;
  const survey = (step) => {
    box = el.getBoundingClientRect();
    clear = (options.keepClear ?? []).filter(Boolean).map((n) => n.getBoundingClientRect());
    const R = map.locate(0, 0)?.r ?? box.width * 0.4;
    drift = Math.abs(map.options.rotateSpeed ?? 0) * RAD * (step?.hold ?? 8) * R;
  };
  const allowed = (q, withDrift = true) => {
    if (!q?.front || !box) return !!q?.front;
    const x = box.left + q.x, y = box.top + q.y, m = 24, d = withDrift ? drift : 0;
    const right = m + (eastward ? d : 0), left = m + (eastward ? 0 : d);
    if (x < left || x > innerWidth - right || y < m || y > innerHeight - m) return false;
    return clear.every((r) => x < r.left - (eastward ? d : 0) - m || x > r.right + (eastward ? 0 : d) + m || y < r.top - m || y > r.bottom + m);
  };
  // The front meridian: the longitude squarely facing us right now.
  const frontLon = () => {
    let best = -2, lon = 0;
    for (let l = -180; l < 180; l += 3) { const q = map.locate(0, l); if (q && q.z > best) { best = q.z; lon = l; } }
    return lon;
  };
  // Where the horizon is, as a view depth: 1/distance under a camera, 0 without one.
  const horizonZ = () => { const D = map.options.distance; return Number.isFinite(D) && D > 1 ? 1 / D : 0; };
  // Squarely facing, with a bonus for the half of the disc turning toward the middle.
  const score = (q) => q && q.front && allowed(q) ? q.depth + ((q.x < q.cx) === eastward ? 0.18 : 0) : -1;
  // Whether a card of width w, opening to a side of a page point, stays on the
  // page and off the boxes to keep clear; and the same at both ends of the drift.
  const cardWidth = () => card.offsetWidth || CARD_W;
  const cardFits = (px, py, side, w = cardWidth()) => {
    const x0 = side === "center" ? px - w / 2 : side === "left" ? px - 14 - w : px + 14, x1 = x0 + w, y0 = py - 18, y1 = py + 18;
    if (x0 < 8 || x1 > innerWidth - 8) return false;
    return clear.every((r) => x1 < r.left || x0 > r.right || y1 < r.top || y0 > r.bottom);
  };
  const fitsThrough = (px, py, side, w = cardWidth()) => cardFits(px, py, side, w) && cardFits(px + (eastward ? drift : -drift), py, side, w);

  // Where a free card floats: a surface point that faces us, on the side turning
  // toward the middle, with room for the whole card around it, over the upper
  // part of the disc when it can.
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
    return { pin: v("--pin", accent), area: v("--area", "#0b7285"), arc: v("--arc", accent), accent };
  };

  const state = { i: -1, step: null, subject: null, t0: 0, anchor: null, arc: null, goto: null, pending: null, held: false };
  const baseSpeed = map.options.rotateSpeed ?? 0;
  const homeLon = frontLon();
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
  // A visitor holding the globe is not turned somewhere else: the story's clock
  // stops while they hold it, and when they let go the step goes on if its
  // subject is still in view, or the next step is turned to. The reset button
  // appears the first time they do.
  const onHold = (e) => { if (e.target === reset) return; state.held = true; state.touched = true; reset.hidden = false; requestAnimationFrame(() => reset.classList.add("on")); };
  const onRelease = () => { if (state.held) state.recheck = true; state.held = false; };
  const restart = () => {
    if (state.arc) { arcs.remove(state.arc); state.arc = null; }
    parkLabels();
    state.step = null; state.subject = null; state.i = -1; state.pending = null; state.goto = homeLon; root.classList.remove("on");
  };
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
  const spaced = (chosen, q) => chosen.every((o) => Math.abs(o.q.y - q.y) > 26 || Math.abs(o.q.x - q.x) > 150);

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
      if (!best) for (const [ a, b ] of step.pairs ?? []) { const t = tryPair(a, b, false); if (t && t.s > (best?.s ?? -1)) best = t; }
      debug("arc:", best ? `${best.A.name} → ${best.B.name}${scripted ? " (scripted)" : " (fallback)"}` : "none in view");
      if (!best) return null;
      // A scripted arc goes the way it was written; a fallback travels toward the middle.
      const [ from, to ] = scripted || best.qa.depth < best.qb.depth ? [ best.A, best.B ] : [ best.B, best.A ];
      return { kind, from, to, anchor: to };
    }
    if (kind === "pins") {
      // The card first, so no pin or label ends up under it; pins may drift
      // off the page edge during the step, which is what pins on a globe do.
      const f = frontPoint([ -26, -12, 36 ]);
      const fq = f && map.locate(f.lat, f.lon), w = cardWidth();
      const underCard = (q) => !!fq && Math.abs(q.y - fq.y) < 40 && q.x + 12 + 150 > fq.x - w / 2 - 8 && q.x - 8 < fq.x + w / 2 + 8;
      // In the list's order: it is written most important first, so when two
      // labels would collide the greater city keeps its place.
      const seen = (step.cities ?? CITIES).map(place).filter(Boolean)
        .map((p) => ({ p, q: map.locate(p.lat, p.lon) })).filter((c) => c.q?.front && c.q.depth > 0.12 && allowed(c.q, false) && !underCard(c.q));
      const pins = [];
      for (const c of seen) { if (spaced(pins, c.q)) pins.push(c); if (pins.length === (step.count ?? 3)) break; }
      debug("pins:", pins.map((c) => c.p.name));
      if (!pins.length) return null;
      return { kind, pins: pins.map((c) => c.p), labels: !!step.labels, anchor: f ?? { ...pins[0].p, side: "right" } };
    }
    if (kind === "rise") {
      // Cities just behind the horizon on the side that is turning into view. The
      // horizon is where the camera's cap ends, not the centre plane: under a
      // camera 2.4 radii out it sits at a view depth of 0.41.
      const zh = horizonZ();
      const seen = (step.cities ?? CITIES).map(place).filter(Boolean)
        .map((p) => ({ p, q: map.locate(p.lat, p.lon) }))
        .filter((c) => c.q && c.q.z > zh - 0.3 && c.q.z < zh + 0.05 && (c.q.x < c.q.cx) === eastward && box && box.left + c.q.x > 24 &&
          clear.every((r) => box.left + c.q.x > r.right + 8 || box.left + c.q.x < r.left - 8 || box.top + c.q.y < r.top - 8 || box.top + c.q.y > r.bottom + 8))
        .sort((x, y) => y.q.z - x.q.z);
      const pins = [];
      for (const c of seen) { if (spaced(pins, c.q)) pins.push(c); if (pins.length === (step.count ?? 3)) break; }
      debug("rise:", pins.map((c) => c.p.name));
      if (!pins.length) return null;
      const f = frontPoint([ 40, 26 ]);
      return f ? { kind, pins: pins.map((c) => c.p), labels: true, anchor: f } : null;
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
        // the shape has drifted through the step: right of its east edge, left
        // of its west edge, above its north edge, below its south edge. Edges
        // come from the rings that will be drawn, the ones wholly in view.
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
        return { kind, region: r, anchor: { lat: edge.lat, lon: edge.lon, side } };
      }
      debug("region: none in view");
      return null;
    }
    if (step.style === "title") return { kind: "label", anchor: { fixed: true, side: "center" } };
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

  // How far the front still has to fall to reach a longitude, going the way
  // the globe turns.
  const remainingTo = (lon) => ((frontLon() - lon) % 360 + 360) % 360;

  // The next step. One with a longitude of its own is reached first: the globe
  // is turned there (state.goto), and the step begins on arrival. At the end of
  // the script the turn goes home, then the script starts over.
  const advance = (now) => {
    if (state.arc) { arcs.remove(state.arc); state.arc = null; }
    parkLabels();
    state.step = null; state.subject = null;
    for (let n = 0; n <= steps.length; n++) {
      if (state.i === steps.length - 1 && baseSpeed > 0 && !reduce) {
        state.i = -1; state.goto = homeLon; state.pending = null; root.classList.remove("on");
        debug("turning home to", homeLon);
        return false;
      }
      state.i = (state.i + 1) % steps.length;
      const step = steps[state.i];
      setCard(step);                       // the words go in first, so the fit test measures this card
      const far = step.frontLon != null && !reduce && baseSpeed > 0 ? remainingTo(step.frontLon) : 0;
      if (far > 3 && far < 357) {
        state.goto = step.frontLon; state.pending = step; root.classList.remove("on");
        debug("turning to", step.frontLon, "for", step.kind);
        return false;
      }
      if (begin(step, now)) return true;
    }
    return false;
  };

  // Turning the globe to a longitude: fast over what is in between, easing out
  // as it arrives; on arrival the pending step begins (or the script restarts).
  const turn = (now) => {
    if (state.held) return;
    const forward = remainingTo(state.goto), back = 360 - forward;
    // A target a little way behind is reached by turning back, not by a lap.
    const remaining = back < 90 && back < forward ? -back : forward;
    if (Math.abs(remaining) < 2) {
      const step = state.pending;
      state.goto = null; state.pending = null;
      if (step) { if (!begin(step, now)) advance(now); }
      else { setSpeed(baseSpeed); advance(now); }
      return;
    }
    const v = Math.max(baseSpeed, Math.min(TURN_SPEED, Math.abs(remaining) * 0.5));
    setSpeed(remaining < 0 ? -v : v);
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

  // Pins with their labels beside them, popping in one after another.
  const drawPins = (ctx, pins, withLabels, age, outK, C, stagger = 0.25, dt = 0) => {
    ctx.fillStyle = C.pin; ctx.strokeStyle = C.pin;
    pins.forEach((p, i) => {
      const qp = map.locate(p.lat, p.lon);
      const l = withLabels ? label(i) : null;
      // Over the horizon a pin eases in, and behind it eases out, the way the
      // Cloudflare pins do, rather than switching at the edge.
      const want = qp?.front && qp.depth > 0.04 ? 1 : 0;
      p._vis = p._vis == null ? want : p._vis + (want - p._vis) * Math.min(1, dt * 7);
      const pop = Math.min(ease((age - stagger * i) / 0.4), outK) * ease(p._vis);
      if (l) {
        l.style.transform = qp ? `translate3d(${qp.x.toFixed(1)}px, ${qp.y.toFixed(1)}px, 0)` : "translate3d(-9999px,-9999px,0)";
        // A label near the page's right edge opens to the left of its pin.
        if (qp && box) l.classList.toggle("left", box.left + qp.x + 12 + (l.firstElementChild.offsetWidth || 120) > innerWidth - 8);
        l.classList.toggle("on", pop > 0.5);
        if (pop > 0) {
          l.firstElementChild.firstElementChild.textContent = p.name;
          l.firstElementChild.lastElementChild.textContent = TIME_ZONES[p.name] ? localTime(TIME_ZONES[p.name]) : "";
        }
      }
      if (pop <= 0) return;
      drawPin(ctx, qp, pop, ((age * 0.45 + i * 0.33) % 1));
    });
    if (withLabels) parkLabels(pins.length);
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
    if (age >= state.step.hold) { if (!advance(now)) return; age = 0; }
    const step = state.step, subject = state.subject, total = step.hold;
    const C = colors();

    // The card rides its anchor, shows while the anchor faces us, opens toward
    // the middle of the disc unless the step says which way, and never off the
    // page or onto a box kept clear. A title sits still at the centre of the disc.
    const q = state.anchor.fixed ? (disc && { x: disc.cx, y: disc.cy, cx: disc.cx, front: true, depth: 1 }) : map.locate(state.anchor.lat, state.anchor.lon);
    // Let go with the subject turned away: on to the next step, which turns the globe where it belongs.
    if (state.recheck && !state.held) { state.recheck = false; if (!q || !q.front || q.depth < 0.12) { if (!advance(now)) return; age = 0; } }
    root.style.transform = q ? `translate3d(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px, 0)` : "translate3d(-9999px,-9999px,0)";
    root.classList.toggle("on", !!q && q.front && q.depth > 0.12 && age > 0.05 && age < total - 0.32);
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

    const outK = ease((total - age) / 0.35);
    ctx.lineJoin = ctx.lineCap = "round";

    if (subject.kind === "arc" && state.arc) {
      const head = ease(age / (step.draw ?? 1.8)), tail = 1 - ease((total - age) / 1.4);
      state.arc.range = tail < head ? [ tail, head ] : [ 0, 0 ];
      state.arc.color = C.arc;
      // The arc lands: a pin grows at the destination once the head arrives.
      if (head >= 0.999 && q?.front) { ctx.fillStyle = C.arc; ctx.strokeStyle = C.arc; drawPin(ctx, q, Math.min(ease((age - (step.draw ?? 1.8)) / 0.4), outK), 1); }
    } else if (subject.kind === "pins" || subject.kind === "rise") {
      drawPins(ctx, subject.pins, subject.labels, age, outK, C, subject.kind === "rise" ? 0 : 0.25, dt);
    } else if (subject.kind === "region") {
      const k = Math.min(ease(age / 0.8), ease((total - age) / 0.6));
      if (k <= 0) return;
      // Each ring on its own: a ring only partly in view would close with a
      // chord across the sphere, so only whole rings are drawn, and the shape
      // fades with its largest ring as that one turns away.
      let disc = null;
      const rings = subject.region.rings.map((ring) => {
        const pts = [];
        let seen = 0;
        for (const [ lat, lon ] of ring) {
          const p = map.locate(lat, lon);
          if (!p) continue;
          disc ??= p;
          if (p.front) { seen++; pts.push(p); }
        }
        return { pts, frac: seen / ring.length, n: ring.length };
      });
      if (!disc) return;
      const main = rings.reduce((a, b) => (b.n > a.n ? b : a));
      const whole = clamp01((main.frac - 0.72) / 0.28);
      if (whole <= 0) return;
      ctx.save();
      ctx.beginPath(); ctx.arc(disc.cx, disc.cy, disc.r, 0, 6.2832); ctx.clip();
      ctx.beginPath();
      for (const r of rings) { if (r.frac < 0.98 || !r.pts.length) continue; r.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
      ctx.globalAlpha = 0.26 * k * whole; ctx.fillStyle = C.area; ctx.fill("evenodd");
      ctx.globalAlpha = 0.85 * k * whole; ctx.strokeStyle = C.area; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.restore();
    }
    // A free label draws nothing: it floats over the turning globe, pinned to
    // no city and no marker, the way the Cloudflare captions float.
    ctx.globalAlpha = 1;
  };

  // The tour's layer first, so its ranges are set before the arcs' layer draws
  // them in the same frame.
  layer = map.addLayer(frame);
  arcs = links(map, { fade: true, width: 1.6 });

  if (reduce) {
    // No motion: the first card, at the front, and nothing else.
    survey(steps[0]);
    const f = frontPoint();
    if (f) { state.step = steps[0]; state.subject = { kind: "label", anchor: f }; state.anchor = f; state.t0 = -1e9; setCard(steps[0]); }
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
