import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// The custom element under a real DOM. Everything in here is wiring the pure
// tests cannot see: upgrade order, attribute parsing, tag defaults, overlay
// ownership, the caches that lie only when the thing they forgot changes.

const [ major, minor ] = process.versions.node.split(".").map(Number);
assert.ok(major > 22 || (major === 22 && minor >= 12),
  `Node ${process.versions.node} cannot run the DOM tests: jsdom needs require(esm), Node 22.12+ (see package.json devEngines)`);

let dom;
let api;
let MOON;
let MARS;

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://mappo.test/"
  });
  const { window } = dom;
  const canvasContext = new Proxy({}, {
    get(target, key) {
      return key in target ? target[key] : () => {};
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    customElements: window.customElements,
    CustomEvent: window.CustomEvent,
    MouseEvent: window.MouseEvent,
    Path2D: class { moveTo() {} lineTo() {} closePath() {} },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: window.getComputedStyle.bind(window)
  });

  api = await import("../dist/mappo.js?dom-regressions");
  ({ MOON } = await import("mappo/bodies/moon"));
  ({ MARS } = await import("mappo/bodies/mars"));
  api.registerBody(MOON);
  api.registerBody(MARS);
});

after(() => {
  document.body.replaceChildren();
  dom.window.close();
  for (const key of [ "window", "document", "HTMLElement", "customElements", "CustomEvent", "MouseEvent", "Path2D", "matchMedia", "getComputedStyle" ]) {
    delete globalThis[key];
  }
});

function mount(tag = "mappo-world", attributes = {}, html = "") {
  const element = document.createElement(tag);
  for (const [ name, value ] of Object.entries(attributes)) {
    if (value === true) element.setAttribute(name, "");
    else element.setAttribute(name, String(value));
  }
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
}

function unmount(element) {
  element.remove();
  assert.equal(element.map, null, "disconnect destroys and releases the live map");
}

test("registering a body defines its tag; the root tags exist too", () => {
  for (const tag of [ "mappo-world", "mappo-earth", "mappo-moon", "mappo-mars" ]) {
    assert.ok(customElements.get(tag), `<${tag}> is defined`);
  }
  api.registerBody({ id: "late-tag", name: "Late tag", figure: () => false });
  assert.ok(customElements.get("mappo-late-tag"), "a body registered later gets its tag at once");
  api.defineBodyElement("moon-map", MOON);
  const custom = mount("moon-map", { cols: 24 });
  assert.equal(custom.map.body, MOON, "a custom tag name can default to any body");
  unmount(custom);
});

test("one tag per body selects that body and its native latitude range", () => {
  const moon = mount("mappo-moon", { cols: 36 });
  assert.equal(moon.map.body, MOON);
  assert.deepEqual(moon.map.options.latRange, [ -90, 90 ]);
  assert.match(moon.querySelector("svg").getAttribute("aria-label"), /^Dotted Moon map showing maria against highlands$/);
  assert.equal(moon.querySelectorAll(".mappo-dot").length, moon.map._dotCount);
  assert.ok(moon.map._dotCount > 0);
  unmount(moon);

  const earth = mount("mappo-earth", { cols: 36 });
  assert.equal(earth.map.body, api.EARTH);
  assert.deepEqual(earth.map.options.latRange, [ -58, 84 ]);
  unmount(earth);
});

test("the tag is a default, the attribute is the truth", () => {
  const odd = mount("mappo-moon", { body: "mars", cols: 24 });
  assert.equal(odd.map.body, MARS);
  unmount(odd);
});

test("every registered tag gets its own pre-upgrade overlay flash guard", () => {
  const css = document.getElementById("mappo-upgrade-style").textContent;
  for (const tag of [ "mappo-world", "mappo-earth", "mappo-moon", "mappo-mars", "mappo-late-tag", "moon-map" ]) {
    assert.match(css, new RegExp(`${tag}:not\\(:defined\\)`));
  }
});

test("a body pack arriving after upgrade: nothing is drawn, then the body is", () => {
  const id = "late-dom-body";
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let element;
  try {
    element = mount("mappo-world", { body: id, cols: 24, places: "Somewhere" });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(element.map.body.pending, true);
  assert.equal(element.querySelectorAll(".mappo-dot").length, 0, "a pending body is drawn as nothing — never as Earth");
  assert.equal(element.querySelectorAll(".mappo-marker").length, 0);
  assert.deepEqual(warnings, [], "no unknown-place warning while the gazetteer has not arrived");
  assert.match(element.querySelector("svg").getAttribute("aria-label"), /waiting for its body pack/);

  const lateBody = {
    id, name: "Late body", latRange: [ -90, 90 ], terms: { figure: "bright", ground: "dark" },
    figure: (lat) => lat > 0,
    places: [ { name: "Somewhere", lat: 45, lon: 10 } ]
  };
  api.registerBody(lateBody);
  assert.equal(element.map.body, lateBody);
  assert.deepEqual(element.map.options.latRange, [ -90, 90 ]);
  assert.equal(element.querySelectorAll(".mappo-dot").length, 24 * 6, "the northern half of a 24×12 grid");
  assert.equal(element.querySelectorAll(".mappo-marker").length, 1, "and the place resolved against the new gazetteer");
  assert.match(element.querySelector("svg").getAttribute("aria-label"), /^Dotted Late body map showing bright against dark, highlighting Somewhere$/);
  unmount(element);
});

test("partial latitude overrides inherit the other body bound and reset on removal", () => {
  const moon = mount("mappo-moon", { "lat-min": -80, cols: 24 });
  assert.deepEqual(moon.map.options.latRange, [ -80, 90 ]);
  moon.removeAttribute("lat-min");
  assert.deepEqual(moon.map.options.latRange, [ -90, 90 ]);
  moon.setAttribute("body", "earth");
  assert.deepEqual(moon.map.options.latRange, [ -58, 84 ], "a body change re-inherits the new body's framing");
  moon.setAttribute("lat-max", "60");
  assert.deepEqual(moon.map.options.latRange, [ -58, 60 ]);
  unmount(moon);
});

test("a body update never discards other options when it resolves to the current object", () => {
  const moon = mount("mappo-world", { body: "moon", cols: 24 });
  moon.map.update({ body: MOON, cols: 30 });
  assert.equal(moon.map.body, MOON);
  assert.equal(moon.map.options.cols, 30);
  assert.equal(moon.map.grid.cols, 30);
  unmount(moon);
});

test("re-registering the same id invalidates instance and shared geometry caches", () => {
  const id = "replace-dom-body";
  const full = { id, name: "Full", latRange: [ -90, 90 ], figure: () => true };
  const empty = { id, name: "Empty", latRange: [ -90, 90 ], figure: () => false };
  api.registerBody(full);
  const element = mount("mappo-world", { body: id, cols: 24 });
  assert.ok(element.querySelectorAll(".mappo-dot").length > 0);
  api.registerBody(empty);
  assert.equal(element.map.body, empty);
  assert.equal(element.querySelectorAll(".mappo-dot").length, 0);
  unmount(element);
});

test("a body without outlines or borders is valid: vector falls back to the grid contour", () => {
  const id = "null-vectors";
  api.registerBody({ id, name: "Null vectors", latRange: [ -90, 90 ], figure: () => true });
  const element = mount("mappo-world", { body: id, cols: 24, figure: "outline", "figure-source": "vector", borders: true });
  assert.ok(element.querySelector(".mappo-figure-path").getAttribute("d").length > 0,
    "a missing vector source falls back to the body's grid contour");
  assert.equal(element.querySelector(".mappo-borders"), null);
  unmount(element);
});

test("flat markers snap against the selected body's figure", () => {
  const id = "east-only";
  api.registerBody({
    id, name: "East only", latRange: [ -90, 90 ], terms: { figure: "east", ground: "west" },
    figure: (_lat, lon) => lon > 0
  });
  const element = mount("mappo-world", { body: id, cols: 36, markers: "Test@0,-1" });
  const marker = element.querySelector("[data-place='Test']");
  assert.equal(marker.getAttribute("transform"), "translate(185 95)");
  assert.match(element.querySelector("svg").getAttribute("aria-label"), /East only map showing east against west, highlighting Test/);
  unmount(element);
});

test("places resolve against the body's own gazetteer, with kinds", () => {
  const moon = mount("mappo-moon", { cols: 36, places: "Apollo 11, Shackleton", markers: "Base@-88,0" });
  const markers = [ ...moon.querySelectorAll(".mappo-markers .mappo-pos") ];
  assert.deepEqual(markers.map((m) => m.dataset.place), [ "Apollo 11", "Shackleton", "Base" ]);
  assert.deepEqual(markers.map((m) => m.dataset.kind), [ "apollo", "feature", undefined ]);
  assert.match(moon.querySelector("svg").getAttribute("aria-label"), /highlighting Apollo 11, Shackleton, Base$/);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    moon.setAttribute("places", "London");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(moon.querySelectorAll(".mappo-markers .mappo-pos").length, 1, "only the coordinate marker survives");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unknown place "London" on Moon/);
  unmount(moon);
});

test("place events carry the record and bubble under the place name", () => {
  const element = mount("mappo-world", { cols: 36, places: "London" });
  const events = [];
  element.addEventListener("mappo:placeclick", (e) => events.push(e.detail));
  const onPlaceClick = [];
  element.map.update({ onPlaceClick: (d) => onPlaceClick.push(d.name) });
  element.querySelector("[data-place='London'] .mappo-marker")
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "London");
  assert.equal(events[0].lat, 51.5);
  assert.deepEqual(onPlaceClick, [ "London" ]);
  unmount(element);
});

test("every instance owns its SVG ids, so many maps on a page cannot share one dot shape", () => {
  const a = mount("mappo-world", { cols: 24, "dot-shape": "circle" });
  const b = mount("mappo-world", { cols: 24, "dot-shape": "square" });
  const idOf = (el) => el.querySelector("defs > :first-child").id;
  assert.notEqual(idOf(a), idOf(b));
  assert.equal(a.querySelector(".mappo-dot").getAttribute("href"), `#${idOf(a)}`);
  assert.equal(b.querySelector(".mappo-dot").getAttribute("href"), `#${idOf(b)}`);
  assert.equal(a.querySelector(`#${idOf(a)}`).tagName.toLowerCase(), "circle");
  assert.equal(b.querySelector(`#${idOf(b)}`).tagName.toLowerCase(), "rect");
  assert.equal(document.querySelectorAll(`#${idOf(a)}`).length, 1, "the id is unique in the document");
  unmount(a);
  unmount(b);
});

test("overlay children survive a mode switch in both directions", async () => {
  const element = mount("mappo-world", { cols: 24 }, `<a class="pin" data-lat="38.7" data-lon="-9.1">Lisbon</a>`);
  const pin = element.querySelector(".pin");
  assert.ok(pin.closest(".mappo-overlay"), "flat: adopted into the overlay layer");
  assert.match(pin.style.left, /%$/);

  element.setAttribute("mode", "globe");
  await settle();
  assert.ok(element.querySelector("canvas"), "now a globe");
  assert.ok(element.contains(pin), "globe: the same element is still in the map");
  assert.ok(pin.closest(".mappo-overlay"));

  element.setAttribute("mode", "flat");
  await settle();
  assert.ok(element.querySelector("svg"), "back to flat");
  assert.ok(element.contains(pin), "flat again: the overlay was not lost on the way");
  assert.ok(pin.closest(".mappo-overlay"));
  assert.match(pin.style.left, /%$/);
  assert.equal(pin.style.transform, "", "the globe's transform was cleared");
  unmount(element);
});

test("overlay children are handed back on disconnect and re-adopted on reconnect", () => {
  const element = mount("mappo-world", { cols: 24 }, `<a class="pin" data-lat="38.7" data-lon="-9.1">Lisbon</a>`);
  const pin = element.querySelector(".pin");
  element.remove();
  assert.equal(element.map, null);
  assert.equal(pin.parentElement, element, "a plain child again");
  assert.equal(pin.style.position, "", "with our inline styles removed");
  assert.equal(element.querySelector("svg"), null);

  document.body.appendChild(element);
  assert.ok(element.map, "re-connected: a new map");
  assert.ok(pin.closest(".mappo-overlay"), "which found the overlay again");
  unmount(element);
});

test("an unrelated attribute change does not re-aim a focused globe", () => {
  const globe = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0, focus: "0,90" });
  assert.equal(globe.map._globe.angle, 270, "facing 90°E means spinning by -90°");
  globe.map._globe.angle = 123;           // the user dragged it
  globe.setAttribute("figure-color", "#ff0000");
  assert.equal(globe.map._globe.angle, 123, "a colour change must not snap the globe back");
  globe.setAttribute("focus", "0,45");
  assert.equal(globe.map._globe.angle, 315, "a real focus change re-aims");
  unmount(globe);
});

test("globe canvas accessibility follows live body and marker state", () => {
  const mars = mount("mappo-mars", { mode: "globe", cols: 24, "rotate-speed": 0, markers: "First@0,0" });
  const canvas = mars.querySelector("canvas");
  assert.equal(canvas.getAttribute("role"), "img");
  assert.match(canvas.getAttribute("aria-label"), /^Dotted Mars map showing lowlands against highlands, highlighting First$/);

  mars.setAttribute("markers", "Second@1,1");
  assert.match(canvas.getAttribute("aria-label"), /highlighting Second$/);
  assert.doesNotMatch(canvas.getAttribute("aria-label"), /First/);
  mars.setAttribute("places", "Curiosity");
  assert.match(canvas.getAttribute("aria-label"), /highlighting Curiosity, Second$/);
  unmount(mars);
});

test("figure colours are stylesheet-tier: a colour change never rebuilds the geometry", () => {
  const element = mount("mappo-world", { cols: 24, figure: "solid outline", "figure-source": "vector", borders: true });
  const path = element.querySelector(".mappo-figure-path");
  const renders = { n: 0 };
  const original = element.map.render;
  element.map.render = function () { renders.n++; return original.call(this); };
  element.setAttribute("figure-color", "#123456");
  element.setAttribute("figure-stroke", "#654321");
  element.setAttribute("borders-color", "#abcdef");
  assert.equal(renders.n, 0, "three colour changes, zero geometry rebuilds");
  assert.equal(element.querySelector(".mappo-figure-path"), path, "the same path node is still in place");
  assert.match(element.querySelector("style").textContent, /\.mappo-figure-path\s*\{[^}]*fill: #123456;[^}]*stroke: #654321/);
  assert.match(element.querySelector("style").textContent, /\.mappo-borders\s*\{[^}]*stroke: #abcdef/);
  unmount(element);
});
