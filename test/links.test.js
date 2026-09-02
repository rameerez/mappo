// mappo/links and the layer seam it stands on: the curve geometry (pure), then
// a jsdom globe and flat map with layers drawn on them — the layer canvas, when
// draw() runs, what locate()-based hit-testing sees, the seam cut on flat maps.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom, api, linksModule;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

before(async () => {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true, url: "https://mappo.test/" });
  const { window } = dom;
  // A 2D context that accepts every call: the globe and the layers run their
  // whole draw, so locate() has a frame to answer about.
  const canvasContext = new Proxy({}, { get(t, k) { return k in t ? t[k] : () => {}; }, set(t, k, v) { t[k] = v; return true; } });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => canvasContext });
  // jsdom lays nothing out; every box is 300 px square here, like the globe's own fallback.
  for (const prop of [ "clientWidth", "clientHeight" ]) Object.defineProperty(window.HTMLElement.prototype, prop, { configurable: true, get: () => 300 });
  Object.assign(globalThis, {
    window, document: window.document, HTMLElement: window.HTMLElement, customElements: window.customElements,
    CustomEvent: window.CustomEvent, Path2D: class { moveTo() {} lineTo() {} closePath() {} },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: window.getComputedStyle.bind(window)
  });
  api = await import("../dist/mappo.js");
  await import("../dist/globe.js");
  linksModule = await import("../dist/links.js");
});

after(() => {
  document.body.replaceChildren();
  dom.window.close();
  for (const key of [ "window", "document", "HTMLElement", "customElements", "CustomEvent", "Path2D", "matchMedia", "getComputedStyle" ]) delete globalThis[key];
});

const mount = async (html) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const el = host.firstElementChild;
  await customElements.whenDefined(el.localName);
  await new Promise(queueMicrotask);
  assert.ok(el.map, "the element upgraded and rendered");
  return el;
};

// ── the curve ────────────────────────────────────────────────────────────────

test("arcPoints: a great circle from a to b, lifted by height·sin(πt), back on the surface at both ends", () => {
  const { arcPoints } = linksModule;
  const london = { lat: 51.5, lon: -0.1 }, tokyo = { lat: 35.7, lon: 139.7 };
  const pts = arcPoints(london, tokyo, { height: 0.25 });
  assert.ok(pts.length >= 9 && pts.length <= 73, `sampled by angle: ${pts.length} points`);
  const [ a, b ] = [ pts[0], pts[pts.length - 1] ];
  assert.ok(near(a[0], 51.5) && near(a[1], -0.1) && near(a[2], 1), "starts at London on the surface");
  assert.ok(near(b[0], 35.7) && near(b[1], 139.7) && near(b[2], 1), "lands in Tokyo on the surface");
  const peak = Math.max(...pts.map((p) => p[2]));
  assert.ok(near(peak, 1.25, 1e-3), `peaks at 1 + height (${peak})`);
  assert.ok(pts.every((p) => p[2] >= 1 - 1e-9), "never sags below the surface");
  // Even steps in angle: consecutive points are the same angular distance apart.
  const { toXYZ } = linksModule;
  const steps = [];
  for (let i = 1; i < pts.length; i++) {
    const p = toXYZ(pts[i - 1][0], pts[i - 1][1]), q = toXYZ(pts[i][0], pts[i][1]);
    steps.push(Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  }
  assert.ok(Math.max(...steps) - Math.min(...steps) < 1e-6, "evenly spaced in angle");
});

test("arcPoints: the default height follows the chord, the sample count follows the angle", () => {
  const { arcPoints } = linksModule;
  const hop = arcPoints({ lat: 51.5, lon: -0.1 }, { lat: 48.9, lon: 2.3 });          // London → Paris
  assert.equal(hop.length, 9, "a short hop still gets eight segments");
  assert.ok(Math.max(...hop.map((p) => p[2])) - 1 < 0.01, "and barely leaves the ground");
  const haul = arcPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 179 });
  assert.equal(haul.length, 73, "a long haul is capped at 72 segments");
  assert.ok(near(Math.max(...haul.map((p) => p[2])), 1 + 0.3 * Math.sin((179 / 180) * Math.PI / 2), 1e-3), "peaks at 0.3 of the half-chord");
});

test("arcPoints: antipodes take the great circle over the pole; the antimeridian is crossed in xyz, not in degrees", () => {
  const { arcPoints } = linksModule;
  const anti = arcPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, { segments: 10 });
  assert.equal(anti.length, 11);
  assert.ok(Math.max(...anti.map((p) => p[0])) > 89.9, "passes over the north pole");
  assert.ok(near(anti[10][2], 1) && near(Math.abs(anti[10][1]), 180, 1e-6), "and lands at the antipode");
  const pacific = arcPoints({ lat: 35.7, lon: 139.7 }, { lat: 34.05, lon: -118.2 });   // Tokyo → Los Angeles
  assert.ok(pacific.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] >= -180 && p[1] <= 180));
  assert.ok(pacific.some((p) => p[1] > 150) && pacific.some((p) => p[1] < -150), "the samples run through the antimeridian");
});

// ── the layer seam ───────────────────────────────────────────────────────────

test("addLayer: a canvas over the globe, under the overlays, drawn after every frame and on request", async () => {
  const el = await mount(`<mappo-world mode="globe" rotate-speed="0" places="London"><span data-lat="51.5" data-lon="-0.1">L</span></mappo-world>`);
  const map = el.map;
  const calls = [];
  const layer = map.addLayer((ctx, view) => calls.push(view));
  assert.ok(calls.length >= 1, "drawn once on adding (reduced motion: at once)");
  const kids = [ ...el.children ].map((c) => c.className);
  assert.deepEqual(kids, [ "mappo-globe", "mappo-layer", "mappo-overlay" ], "between the globe's canvas and the overlay DOM");
  const view = calls.at(-1);
  assert.equal(view.map, map);
  assert.equal(view.width, 300);
  assert.equal(view.height, 300);
  assert.ok(view.dpr >= 1);
  const n = calls.length;
  layer.redraw();
  assert.equal(calls.length, n + 1, "redraw() draws the layer");
  map.update({ focus: { lat: 0, lon: 30 } });
  assert.equal(calls.length, n + 2, "a frame the globe draws draws the layer too");
  layer.remove();
  assert.equal(el.querySelector(".mappo-layer"), null, "remove() takes the canvas away");
  map.update({ focus: { lat: 0, lon: 60 } });
  assert.equal(calls.length, n + 2, "and the layer is not drawn again");
  assert.throws(() => map.addLayer("nope"), TypeError);
  map.destroy();
});

test("addLayer on the flat map: drawn with the render, and locate() answers in the same box", async () => {
  const el = await mount(`<mappo-world cols="60"></mappo-world>`);
  const calls = [];
  const layer = el.map.addLayer((ctx, view) => calls.push(view));
  assert.ok(calls.length >= 1, "drawn on adding (no animation frames here: at once)");
  assert.equal(calls.at(-1).width, 300);
  const n = calls.length;
  el.map.update({ cols: 80 });
  // The rebuild is debounced against the last render's cost, which jsdom makes large.
  for (let waited = 0; calls.length === n && waited < 4000; waited += 50) await new Promise((r) => setTimeout(r, 50));
  assert.ok(calls.length > n, "a geometry rebuild redraws the layer");
  const p = el.map.locate(0, 0);
  assert.ok(p && p.front && p.x > 0 && p.y > 0, "locate() works on the flat map for the layer to use");
  layer.remove();
  el.map.destroy();
  assert.equal(el.querySelector(".mappo-layer"), null);
});

// ── links ────────────────────────────────────────────────────────────────────

test("links on the globe: arcs and spikes project through locate(), hit-test where they were drawn, and honour range", async () => {
  const el = await mount(`<mappo-world mode="globe" rotate-speed="0"></mappo-world>`);
  const map = el.map;
  const { links } = linksModule;
  const layer = links(map, { width: 2 });
  const arc = layer.add({ from: "London", to: "Lagos", data: { id: 7 } });
  layer.redraw();
  assert.ok(arc._hits?.length >= 8, `the arc was drawn as segments (${arc._hits?.length ?? 0} numbers)`);
  const [ x, y ] = arc._hits;
  assert.equal(layer.at(x, y), arc, "the link under a point of its own first segment");
  assert.equal(layer.at(-100, -100), null, "nothing far away");
  assert.equal(layer.at({ clientX: x, clientY: y }), arc, "a pointer event works too");
  assert.equal(arc.data.id, 7, "your data rides along");
  const full = arc._hits.length;
  arc.range = [ 0, 0.5 ];
  layer.redraw();
  assert.ok(arc._hits.length < full && arc._hits.length > 0, `half the range is fewer segments (${arc._hits.length} < ${full})`);
  arc.range = [ 0.3, 0.3 ];
  layer.redraw();
  assert.equal(arc._hits, null, "an empty range draws nothing");

  const spike = layer.add({ at: [ 0, 0 ], height: 0.2, tip: 3 });
  layer.redraw();
  const base = map.locate(0, 0), top = map.locate(0, 0, 1.2);
  assert.ok(spike._hits.length >= 8, "a spike is a segment and a tip");
  assert.ok(near(spike._hits[0], base.x, 1e-6) && near(spike._hits[1], base.y, 1e-6), "from the surface");
  assert.ok(near(spike._hits[2], top.x, 1e-6) && near(spike._hits[3], top.y, 1e-6), "to height radii above it");
  assert.equal(layer.at(top.x, top.y), spike);

  // The far side is cut: an arc entirely behind the globe draws nothing.
  const behind = layer.add({ from: [ 0, 170 ], to: [ 10, -170 ], height: 0.05 });
  layer.redraw();
  assert.equal(behind._hits, null, "an arc on the far side is not drawn");
  // …unless the globe is glass.
  map.update({ fog: [ -0.7, 1.1 ] });
  assert.ok(behind._hits?.length > 0, "under fog the far side shows through, faded");

  layer.remove(spike);
  assert.equal(layer.items.length, 2);
  layer.destroy();
  assert.equal(el.querySelector(".mappo-layer"), null);
  map.destroy();
});

test("links: a name the gazetteer lacks warns once and draws nothing; points draw your own curve", async () => {
  const el = await mount(`<mappo-world mode="globe" rotate-speed="0"></mappo-world>`);
  const { links } = linksModule;
  const warned = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    const layer = links(el.map);
    const bad = layer.add({ from: "Atlantis", to: "London" });
    layer.redraw(); layer.redraw();
    assert.equal(bad._hits, null);
    assert.equal(warned.filter((w) => w.includes("Atlantis")).length, 1, "one warning, not one per frame");
    const own = layer.add({ points: [ [ 0, 0, 1 ], [ 5, 5, 1.1 ], [ 10, 10, 1 ] ] });
    layer.redraw();
    assert.ok(own._hits.length >= 8, "a custom curve draws segment by segment");
    layer.destroy();
  } finally {
    console.warn = warn;
    el.map.destroy();
  }
});

test("links on the flat map: the curve goes through the projection and is cut at the seam", async () => {
  const el = await mount(`<mappo-world cols="80"></mappo-world>`);
  const { links } = linksModule;
  const layer = links(el.map, { width: 1 });
  const atlantic = layer.add({ from: "London", to: [ 40.7, -74 ] });
  const pacific = layer.add({ from: [ 35.7, 139.7 ], to: [ 34.05, -118.2 ] });
  const spike = layer.add({ at: [ 0, 0 ], height: 0.1, tip: 2 });
  layer.redraw();
  assert.ok(atlantic._hits.length >= 8);
  assert.ok(pacific._hits.length >= 8);
  const width = 300;
  for (let k = 0; k < pacific._hits.length; k += 4) {
    assert.ok(Math.abs(pacific._hits[k + 2] - pacific._hits[k]) < width / 2, "no segment spans the map: the seam cut it");
  }
  const p = el.map.locate(0, 0);
  assert.ok(near(spike._hits[0], p.x) && spike._hits[3] < p.y, "a flat spike stands up the page");
  assert.equal(layer.at(spike._hits[0], spike._hits[1]), spike);
  layer.destroy();
  el.map.destroy();
});
