import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { geoOrthographic } from "d3-geo";
import { JSDOM } from "jsdom";

let dom;
let Mappo;
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://mappo.test/" });
  const { window } = dom;
  const canvasContext = new Proxy({}, {
    get(target, key) { return key in target ? target[key] : () => {}; },
    set(target, key, value) { target[key] = value; return true; }
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => canvasContext });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    CustomEvent: window.CustomEvent,
    Path2D: class { moveTo() {} lineTo() {} closePath() {} },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: window.getComputedStyle.bind(window)
  });
  ({ Mappo } = await import("../src/renderer.js"));
  await import("../src/entries/globe.js");
  await import("../src/entries/projections.js");
  await import("../src/entries/vector.js");
  await import("../src/bodies/earth-vector.js");
});

after(() => {
  document.body.replaceChildren();
  dom.window.close();
  for (const key of [ "window", "document", "HTMLElement", "CustomEvent", "Path2D", "matchMedia", "getComputedStyle" ]) delete globalThis[key];
});

function host() {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { configurable: true, value: 600 });
  document.body.appendChild(element);
  return element;
}

test("dot glyphs are clipped to curved projection frames", () => {
  const container = host();
  const map = new Mappo(container, { cols: 40, projection: "stereographic-north" });
  const dots = container.querySelector(".mappo-dots");
  assert.match(dots.getAttribute("clip-path"), /^url\(#mappo-frame-i\d+\)$/);
  map.destroy();
  container.remove();
});

test("a globe ignores projection defaults and invalid projection values until flat mode needs them", async () => {
  const container = host();
  const map = new Mappo(container, { mode: "globe", projection: "not-a-map", rotateSpeed: 0 });
  assert.deepEqual(map.options.latRange, [ -58, 84 ], "the globe keeps the body's latitude range");
  assert.doesNotThrow(() => map.update({ figureColor: "#123456" }));
  assert.equal(map.pending, null, "a globe never waits for a flat projection");
  map.update({ mode: "flat" });
  await settle();
  assert.equal(map.options.mode, "flat");
  assert.match(map.pending, /projection "not-a-map"/, "flat mode waits for the projection instead of failing");
  assert.equal(container.querySelector("svg"), null, "and draws nothing meanwhile");
  map.destroy();
  container.remove();

  const polarHost = host();
  const polar = new Mappo(polarHost, { mode: "globe", projection: "stereographic-north", rotateSpeed: 0 });
  assert.deepEqual(polar.options.latRange, [ -58, 84 ], "a polar flat-map default never crops the globe");
  polar.destroy();
  polarHost.remove();
});

test("a fresh custom projection object is never hidden by structural JSON equality", async () => {
  const make = (offset) => ({
    aspect: 2,
    forward: (lat, lon) => ({ x: offset + lon / 720, y: (90 - lat) / 180 }),
    inverse: (x, y) => ({ lat: 90 - y * 180, lon: (x - offset) * 720 })
  });
  const first = make(0.5), second = make(0.4);
  assert.equal(JSON.stringify(first), JSON.stringify(second), "this is the old comparison's blind spot");
  const container = host();
  const map = new Mappo(container, { cols: 24, projection: first });
  const firstKey = map.projection.key;
  map.update({ projection: second });
  await settle();
  assert.notEqual(map.projection.key, firstKey);
  assert.equal(map.options.projection, second);
  map.destroy();
  container.remove();
});

test("mutating a d3 projection invalidates live geometry on the next update", async () => {
  const raw = geoOrthographic();
  const container = host();
  const map = new Mappo(container, { cols: 24, projection: raw });
  const firstKey = map.projection.key;
  raw.rotate([ -90, 0 ]);
  map.update({ figureColor: "#123456" });
  await settle();
  assert.notEqual(map.projection.key, firstKey);
  assert.equal(map.projection.forward(0, -90), null);
  map.destroy();
  container.remove();
});

test("a custom projection with incomplete vector topology uses grid contours", () => {
  const projection = {
    aspect: 2,
    seam: false,
    forward: (lat, lon) => lon > 0 ? null : ({ x: (lon + 180) / 360, y: (90 - lat) / 180 }),
    inverse: (x, y) => x > 0.5 ? null : ({ lat: 90 - y * 180, lon: x * 360 - 180 })
  };
  const container = host();
  const map = new Mappo(container, { cols: 30, projection, figure: "solid outline", figureSource: "vector" });
  assert.ok(container.querySelector(".mappo-figure-fill").getAttribute("d").length > 0, "grid fill replaces incomplete vectors");
  assert.ok(container.querySelector(".mappo-figure-edge").getAttribute("d").length > 0, "grid edge replaces incomplete vectors");
  map.destroy();
  container.remove();
});
