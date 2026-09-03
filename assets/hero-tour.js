// The hero globe's tour of itself: one card, one thing at a time, appearing on
// the sphere as it turns. Two lines wire it:
//
//   import { heroTour } from "./assets/hero-tour.js";
//   heroTour(document.getElementById("hero"));
//
// The element is a <mappo-world mode="globe">. Nothing else on the page needs
// to know: the card is a child the tour positions with locate() every frame
// (so it rides the globe like a Cloudflare caption and hides behind the limb),
// the arc is mappo/links, pins and regions are drawn on a layer of the tour's
// own through Mappo#addLayer, and stop() takes all of it away.
//
// Steps are paced by time, not by longitude, so the cadence is the same however
// fast the globe turns and even while a visitor holds it. What a step points at
// is chosen the moment it starts, from candidates that are in view now and on
// the side of the disc that is turning toward the middle, so a subject never
// leaves during its own step. Pass `steps` to change the words or the order,
// and `keepClear` (elements) for boxes a subject must not sit under, such as
// the headline a hero globe runs behind; what is off the viewport is never chosen.

import { resolvePlace } from "../dist/mappo.js";
import { links } from "../dist/links.js";
import { regions } from "../demo/countries.js";

export const STEPS = [
  { id: "hello", text: "This is a mappo globe", hold: 6 },
  { id: "arc", eyebrow: "Links", text: "An arc between any two places", hold: 9,
    pairs: [ [ "London", "New York" ], [ "Tokyo", "San Francisco" ], [ "São Paulo", "Lagos" ], [ "Mumbai", "Nairobi" ],
      [ "Sydney", "Singapore" ], [ "Cairo", "Berlin" ], [ "Mexico City", "Toronto" ], [ "Cape Town", "Dubai" ],
      [ "Buenos Aires", "Lisbon" ], [ "Beijing", "Jakarta" ], [ "Auckland", "Tokyo" ], [ "Moscow", "Delhi" ],
      [ "Los Angeles", "Lima" ], [ "Reykjavík", "Dakar" ], [ "Perth", "Manila" ],
      // and shorter hops, so a globe of which only a slice is on the page
      // always has a pair inside the slice
      [ "Paris", "Rome" ], [ "Madrid", "Paris" ], [ "Lisbon", "London" ], [ "Paris", "London" ], [ "Casablanca", "Madrid" ],
      [ "Dakar", "Casablanca" ], [ "Dakar", "São Paulo" ], [ "Accra", "Lagos" ], [ "Lagos", "Kinshasa" ], [ "Cairo", "Istanbul" ],
      [ "Cairo", "Riyadh" ], [ "Johannesburg", "Cape Town" ], [ "Nairobi", "Addis Ababa" ], [ "Algiers", "Tunis" ], [ "Rome", "Athens" ],
      [ "Berlin", "Warsaw" ], [ "Madrid", "Berlin" ], [ "Oslo", "Stockholm" ], [ "Reykjavík", "Oslo" ], [ "Moscow", "Warsaw" ], [ "Moscow", "Kyiv" ],
      [ "New York", "Chicago" ], [ "New York", "Miami" ], [ "Toronto", "New York" ], [ "Chicago", "Denver" ], [ "Los Angeles", "San Francisco" ],
      [ "Vancouver", "Los Angeles" ], [ "Mexico City", "Havana" ], [ "Mexico City", "Bogotá" ], [ "Bogotá", "Quito" ], [ "Caracas", "Havana" ],
      [ "Lima", "Bogotá" ], [ "Lima", "La Paz" ], [ "Santiago", "Buenos Aires" ], [ "São Paulo", "Buenos Aires" ], [ "São Paulo", "Montevideo" ],
      [ "Dubai", "Karachi" ], [ "Karachi", "Delhi" ], [ "Delhi", "Mumbai" ], [ "Mumbai", "Colombo" ], [ "Kolkata", "Dhaka" ], [ "Tashkent", "Tehran" ],
      [ "Tehran", "Baghdad" ], [ "Riyadh", "Dubai" ], [ "Bangkok", "Hanoi" ], [ "Bangkok", "Singapore" ], [ "Hong Kong", "Manila" ], [ "Jakarta", "Singapore" ],
      [ "Seoul", "Beijing" ], [ "Tokyo", "Seoul" ], [ "Tokyo", "Hong Kong" ], [ "Beijing", "Hong Kong" ], [ "Ulaanbaatar", "Beijing" ], [ "Jakarta", "Manila" ],
      [ "Perth", "Melbourne" ], [ "Sydney", "Melbourne" ], [ "Sydney", "Auckland" ], [ "Vancouver", "Denver" ] ] },
  { id: "pins", eyebrow: "Places", text: "Pins by name, from a built-in gazetteer", hold: 8,
    cities: [ "London", "Paris", "Madrid", "Berlin", "Rome", "Cairo", "Lagos", "Nairobi", "Cape Town", "Dubai", "Mumbai",
      "Delhi", "Bangkok", "Singapore", "Jakarta", "Hong Kong", "Beijing", "Seoul", "Tokyo", "Sydney", "Melbourne", "Auckland",
      "Honolulu", "Vancouver", "San Francisco", "Los Angeles", "Denver", "Chicago", "Toronto", "New York", "Miami",
      "Mexico City", "Havana", "Bogotá", "Lima", "Santiago", "Buenos Aires", "São Paulo", "Reykjavík", "Moscow", "Istanbul", "Tehran" ] },
  { id: "region", eyebrow: "Regions", text: "A region filled, through the same geometry", hold: 9,
    regions: [ [ "BR", -10, -53 ], [ "AU", -25, 134 ], [ "IN", 22, 79 ], [ "US", 39, -98 ], [ "ZA", -29, 25 ], [ "JP", 36, 138 ],
      [ "MX", 23, -102 ], [ "AR", -35, -65 ], [ "EG", 27, 30 ], [ "FR", 46, 2 ], [ "ES", 40, -3 ], [ "DE", 51, 10 ],
      [ "NG", 9, 8 ], [ "KE", 0, 38 ], [ "IT", 42, 12 ], [ "GB", 54, -2 ], [ "ID", -2, 118 ], [ "CN", 35, 103 ] ] },
  { id: "size", eyebrow: "22 KB", text: "One element, no dependencies", hold: 6 }
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const CARD_W = 280;   // a card's width before it has been measured
const ease = (t) => 1 - (1 - clamp01(t)) ** 3;
const RAD = Math.PI / 180;

const CSS = `
.mappo-tour{position:absolute;left:0;top:0;pointer-events:none;z-index:5;will-change:transform}
.mappo-tour-card{position:absolute;left:14px;top:0;transform:translateY(-50%) scale(0);transform-origin:left center;
  opacity:0;transition:transform .32s cubic-bezier(.2,.8,.2,1),opacity .25s;
  display:flex;align-items:center;gap:9px;white-space:nowrap;
  font:600 12.5px/1 var(--sans,-apple-system,system-ui,sans-serif);letter-spacing:-.005em;color:var(--ink,#16181d);
  background:color-mix(in oklab,var(--bg,#fff) 84%,transparent);border:1px solid var(--line,#e8e2d8);border-radius:10px;
  padding:9px 12px;box-shadow:0 6px 22px -12px #0000004d;backdrop-filter:blur(7px)}
.mappo-tour.on .mappo-tour-card{transform:translateY(-50%) scale(1);opacity:1}
.mappo-tour.left .mappo-tour-card{left:auto;right:14px;transform-origin:right center}
.mappo-tour.free .mappo-tour-card{left:0;right:auto;transform:translate(-50%,-50%) scale(0);transform-origin:center}
.mappo-tour.free.on .mappo-tour-card{transform:translate(-50%,-50%) scale(1)}
.mappo-tour-eyebrow{font-style:normal;font-size:10px;font-weight:640;letter-spacing:.06em;text-transform:uppercase;color:var(--faint,#9aa1ac)}
.mappo-tour-eyebrow:empty,.mappo-tour-dot[hidden]{display:none}
.mappo-tour-dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#c2410c);
  box-shadow:0 0 0 4px color-mix(in oklab,var(--accent,#c2410c) 20%,transparent)}
@media (prefers-reduced-motion:reduce){.mappo-tour-card{transition:none}}`;

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

  // The card: a child of the element, placed by the tour, never harvested by
  // mappo (it is added after the map exists, and carries no data-lat).
  const root = document.createElement("div");
  root.className = "mappo-tour";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<div class="mappo-tour-card"><span class="mappo-tour-dot"></span><i class="mappo-tour-eyebrow"></i><span class="mappo-tour-text"></span></div>`;
  el.appendChild(root);
  const card = root.querySelector(".mappo-tour-card"), dot = root.querySelector(".mappo-tour-dot"), eyebrow = root.querySelector(".mappo-tour-eyebrow"), text = root.querySelector(".mappo-tour-text");

  const place = (name) => { const p = resolvePlace(name, map.body); return p ? { lat: p.lat, lon: p.lon, name } : null; };
  const eastward = (map.options.rotateSpeed ?? 0) >= 0;
  // A subject scores by how squarely it faces us, with a bonus for the half of
  // the disc that is turning toward the middle, so it stays for the whole step;
  // a point off the viewport, or under a box the page asked to keep clear, is out.
  let box = null, clear = [], drift = 0;
  const survey = (step) => {
    box = el.getBoundingClientRect();
    clear = (options.keepClear ?? []).filter(Boolean).map((n) => n.getBoundingClientRect());
    // How far, in pixels, the surface will carry a subject during the step: the
    // spin over the hold, at the disc's radius. The edge things move toward
    // gets that much more margin, so nothing chosen leaves the page mid-step.
    const R = map.locate(0, 0)?.r ?? box.width * 0.4;
    drift = Math.abs(map.options.rotateSpeed ?? 0) * RAD * (step?.hold ?? 8) * R;
  };
  const allowed = (q) => {
    if (!box) return true;
    const x = box.left + q.x, y = box.top + q.y, m = 24;
    const right = m + (eastward ? drift : 0), left = m + (eastward ? 0 : drift);
    if (x < left || x > innerWidth - right || y < m || y > innerHeight - m) return false;
    return clear.every((r) => x < r.left - (eastward ? drift : 0) - m || x > r.right + (eastward ? 0 : drift) + m || y < r.top - m || y > r.bottom + m);
  };
  const score = (q) => q && q.front && allowed(q) ? q.depth + ((q.x < q.cx) === eastward ? 0.18 : 0) : -1;
  // Whether a card opening to one side of a page point would stay on the page
  // and off the boxes to keep clear.
  const cardWidth = () => card.offsetWidth || CARD_W;
  // The card must fit where the step starts and where the spin will have
  // carried it by the end.
  const fitsThrough = (px, py, side, w = cardWidth()) => cardFits(px, py, side, w) && cardFits(px + (eastward ? drift : -drift), py, side, w);
  const cardFits = (px, py, side, w = cardWidth()) => {
    const x0 = side === "center" ? px - w / 2 : side === true || side === "left" ? px - 14 - w : px + 14, x1 = x0 + w, y0 = py - 18, y1 = py + 18;
    if (x0 < 8 || x1 > innerWidth - 8) return false;
    return clear.every((r) => x1 < r.left || x0 > r.right || y1 < r.top || y0 > r.bottom);
  };
  // Where a free card floats: a surface point that faces us, on the side
  // turning toward the middle, with room for the whole card around it. Two
  // latitudes, so the card sits over the upper part of the disc when it can.
  const frontPoint = () => {
    let best = null;
    for (const lat of [ 26, 8 ]) {
      for (let lon = -180; lon < 180; lon += 6) {
        const q = map.locate(lat, lon);
        if (!q?.front || !box) { if (score(q) > (best?.s ?? -1)) best = { s: score(q), lat, lon }; continue; }
        if (!fitsThrough(box.left + q.x, box.top + q.y, "center")) continue;
        if (score(q) > (best?.s ?? -1)) best = { s: score(q), lat, lon };
      }
      if (best) break;
    }
    return best;
  };
  const byId = new Map(regions().map((r) => [ r.id, r ]));
  const colors = () => {
    const cs = getComputedStyle(el);
    const v = (n, f) => cs.getPropertyValue(n).trim() || f;
    const accent = v("--accent", "#c2410c");
    return { pin: v("--pin", accent), area: v("--area", "#0b7285"), arc: v("--arc", accent), accent };
  };

  const state = { i: -1, step: null, t0: 0, anchor: null, subject: null, arc: null };
  let arcs = null, layer = null, raf = null;

  const setCard = (step) => {
    eyebrow.textContent = step.eyebrow ?? "";
    text.textContent = step.text;
    dot.hidden = !!step.eyebrow;
  };

  // Choose what the step points at, from what is in view right now.
  const pick = (step) => {
    survey(step);
    if (step.id === "arc") {
      let best = null;
      const why = [];
      for (const [ a, b ] of step.pairs ?? []) {
        const A = place(a), B = place(b);
        if (!A || !B) { why.push(`${a}-${b}: unknown place`); continue; }
        const qa = map.locate(A.lat, A.lon), qb = map.locate(B.lat, B.lon);
        const bad = (q, n) => !q?.front ? `${n} behind` : q.depth < 0.2 ? `${n} depth ${q.depth.toFixed(2)}` : !allowed(q) ? `${n} not allowed at ${Math.round(box.left + q.x)},${Math.round(box.top + q.y)}` : null;
        const reason = bad(qa, a) ?? bad(qb, b);
        if (reason) { why.push(reason); continue; }
        const s = Math.min(score(qa), score(qb));
        if (s > (best?.s ?? -1)) best = { s, A, B, qa, qb };
      }
      if (options.debug) console.debug("[hero-tour] arc:", best ? `${best.A.name} → ${best.B.name}` : "none", why);
      if (!best) return null;
      // The arc travels toward the middle: from the endpoint nearer the limb.
      const [ from, to ] = best.qa.depth < best.qb.depth ? [ best.A, best.B ] : [ best.B, best.A ];
      return { kind: "arc", from, to, anchor: to };
    }
    if (step.id === "pins") {
      const seen = (step.cities ?? []).map(place).filter(Boolean)
        .map((p) => ({ p, q: map.locate(p.lat, p.lon) })).filter((c) => c.q?.front && c.q.depth > 0.35 && allowed(c.q))
        .sort((x, y) => score(y.q) - score(x.q));
      const pins = [];
      for (const c of seen) {
        if (pins.every((o) => Math.hypot(o.q.x - c.q.x, o.q.y - c.q.y) > 46)) pins.push(c);
        if (pins.length === 3) break;
      }
      return pins.length ? { kind: "pins", pins: pins.map((c) => c.p), anchor: pins[0].p } : null;
    }
    if (step.id === "region") {
      let best = null;
      for (const [ id, lat, lon ] of step.regions ?? []) {
        const r = byId.get(id);
        if (!r?.rings?.length) continue;
        const q = map.locate(lat, lon);
        if (!q?.front || q.depth < 0.35 || !allowed(q)) continue;
        if (score(q) > (best?.s ?? -1)) best = { s: score(q), r, lat, lon, q };
      }
      if (!best) return null;
      // The card sits beside the shape, not on it: it hangs off the edge of the
      // shape on whichever side has room for it on the page, and opens outward.
      let east = null, west = null;
      for (const ring of best.r.rings) for (const [ lat, lon ] of ring) {
        const p = map.locate(lat, lon);
        if (!p?.front) continue;
        if (!east || p.x > east.x) east = { x: p.x, y: p.y, lat, lon };
        if (!west || p.x < west.x) west = { x: p.x, y: p.y, lat, lon };
      }
      if (!east) return null;
      // Room for the card beside the shape, after the shape has drifted through
      // the step: to the right of its east edge, else to the left of its west
      // edge; a region with room on neither side waits for another lap.
      const roomRight = !box || fitsThrough(box.left + east.x, box.top + east.y, "right");
      const roomLeft = !box || fitsThrough(box.left + west.x, box.top + west.y, "left");
      if (!roomRight && !roomLeft) return null;
      const side = roomRight ? "right" : "left", edge = roomRight ? east : west;
      return { kind: "region", region: best.r, anchor: { lat: edge.lat, lon: edge.lon, side } };
    }
    const f = frontPoint();
    return f ? { kind: "label", anchor: { lat: f.lat, lon: f.lon, side: "center" } } : null;
  };

  const advance = (now) => {
    if (state.arc) { arcs.remove(state.arc); state.arc = null; }
    for (let n = 0; n < steps.length; n++) {
      state.i = (state.i + 1) % steps.length;
      const step = steps[state.i];
      setCard(step);
      const subject = pick(step);
      if (options.debug) console.debug("[hero-tour]", step.id, subject ? subject.kind : "skipped", subject?.anchor ?? "");
      if (!subject) continue;              // nothing suitable in view: skip the step this lap
      state.step = step; state.subject = subject; state.anchor = subject.anchor; state.t0 = now;
      if (subject.kind === "arc") {
        state.arc = arcs.add({ from: [ subject.from.lat, subject.from.lon ], to: [ subject.to.lat, subject.to.lon ],
          height: 0.16, range: [ 0, 0 ], tip: 3, width: 1.6 });
      }
      return true;
    }
    return false;
  };

  const drawPin = (ctx, q, k, pulse, color) => {
    const r = 4.6 * k * (q.scale / q.r), a = 0.3 + 0.7 * q.depth;
    if (pulse < 1) {
      ctx.globalAlpha = a * 0.55 * (1 - pulse);
      ctx.beginPath(); ctx.arc(q.x, q.y, r * (1 + 2.2 * pulse), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = a;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(q.x, q.y, r + 1.2, 0, 6.2832); ctx.stroke();
  };

  const frame = (ctx) => {
    const now = performance.now() / 1000;
    if (!state.step && !advance(now)) return;
    let age = now - state.t0;
    if (age >= state.step.hold) { if (!advance(now)) return; age = 0; }
    const step = state.step, subject = state.subject, total = step.hold;
    const C = colors();

    // The card rides its anchor, and shows only while the anchor faces us.
    const q = map.locate(state.anchor.lat, state.anchor.lon);
    root.style.transform = q ? `translate3d(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px, 0)` : "translate3d(-9999px,-9999px,0)";
    root.classList.toggle("on", !!q && q.front && q.depth > 0.12 && age > 0.05 && age < total - 0.32);
    // The card opens toward the middle of the disc, unless the step says which
    // way, and never off the page: a side that would overflow flips.
    if (q) {
      let left = state.anchor.side ? state.anchor.side === "left" : q.x > q.cx;
      if (!state.anchor.side && subject.kind !== "label") {
        const b = el.getBoundingClientRect(), px = b.left + q.x, py = b.top + q.y, w = card.offsetWidth || CARD_W;
        if (!cardFits(px, py, left, w) && cardFits(px, py, !left, w)) left = !left;
      }
      root.classList.toggle("left", left);
    }

    const inK = ease(age / 0.4), outK = ease((total - age) / 0.35);
    ctx.lineJoin = ctx.lineCap = "round";

    root.classList.toggle("free", subject.kind === "label");
    if (subject.kind === "label") {
      // Nothing drawn: the card floats over the turning globe, pinned to no
      // city and no marker, the way the Cloudflare captions float.
    } else if (subject.kind === "arc") {
      const head = ease(age / 1.8), tail = 1 - ease((total - age) / 1.4);
      state.arc.range = tail < head ? [ tail, head ] : [ 0, 0 ];
      state.arc.color = C.arc;
      // The arc lands: a pin grows at the destination once the head arrives.
      if (head >= 0.999 && q?.front) { ctx.fillStyle = C.arc; ctx.strokeStyle = C.arc; drawPin(ctx, q, Math.min(ease((age - 1.8) / 0.4), outK), 1, C.arc); }
    } else if (subject.kind === "pins") {
      ctx.fillStyle = C.pin; ctx.strokeStyle = C.pin;
      subject.pins.forEach((p, i) => {
        const qp = map.locate(p.lat, p.lon);
        if (!qp?.front) return;
        const pop = Math.min(ease((age - 0.25 * i) / 0.4), outK);
        if (pop <= 0) return;
        drawPin(ctx, qp, pop, ((age * 0.45 + i * 0.33) % 1), C.pin);
      });
    } else if (subject.kind === "region") {
      const k = Math.min(ease(age / 0.8), ease((total - age) / 0.6));
      if (k <= 0) return;
      // A ring crossing the limb would close with a chord across the sphere, so
      // a shape fades out as it turns away and is gone before the tear could show.
      let disc = null, seen = 0, total = 0;
      const rings = subject.region.rings.map((ring) => {
        const pts = [];
        for (const [ lat, lon ] of ring) {
          const p = map.locate(lat, lon);
          total++;
          if (!p) continue;
          disc ??= p;
          if (p.front) { seen++; pts.push(p); }
        }
        return pts;
      });
      if (!disc || !total) return;
      const whole = clamp01((seen / total - 0.72) / 0.28);
      if (whole <= 0) return;
      ctx.save();
      ctx.beginPath(); ctx.arc(disc.cx, disc.cy, disc.r, 0, 6.2832); ctx.clip();
      ctx.beginPath();
      for (const pts of rings) { pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (pts.length) ctx.closePath(); }
      ctx.globalAlpha = 0.26 * k * whole; ctx.fillStyle = C.area; ctx.fill("evenodd");
      ctx.globalAlpha = 0.85 * k * whole; ctx.strokeStyle = C.area; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  // The tour's layer first, so its ranges are set before the arcs' layer draws
  // them in the same frame.
  layer = map.addLayer(frame);
  arcs = links(map, { fade: true, width: 1.6 });

  if (reduce) {
    // No motion: the first card, at the front, and nothing else.
    const f = frontPoint();
    if (f) { state.step = steps[0]; state.subject = { kind: "label", anchor: f }; state.anchor = f; state.t0 = -1e9; setCard(steps[0]); }
    layer.redraw();
  } else {
    // The globe redraws its layers whenever it turns; asking every frame costs
    // nothing then, and keeps the tour going when a visitor holds it still.
    const tick = () => { layer.redraw(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }

  ctl._teardown = () => {
    if (raf) cancelAnimationFrame(raf);
    layer.remove();
    arcs.destroy();
    root.remove();
  };
}
