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
let globeModule;
let MOON;
let MARS;
let canvasContext;

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://mappo.test/"
  });
  const { window } = dom;
  canvasContext = new Proxy({}, {
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

  api = await import("../dist/mappo.js");
  // The opt-in modules register themselves with the core they import — the
  // same core instance, because they import it by relative path.
  globeModule = await import("../dist/globe.js");
  await import("../dist/projections.js");
  await import("../dist/vector.js");
  await import("../dist/bodies/earth-vector.js");
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

test("a highlight lights the dots of a dot map, and the region it was given", () => {
  // The globe recoloured its dots and the flat map only painted figure cells,
  // so a dot map — the default — showed no highlight at all.
  const box = [ [ [ 40, -20 ], [ 40, 20 ], [ 80, 20 ], [ 80, -20 ], [ 40, -20 ] ] ];
  const element = mount("mappo-world", {
    cols: 36, "lat-min": -90, "lat-max": 90,
    "highlight-polygon": JSON.stringify(box), "highlight-color": "#ff0000"
  });
  const lit = [ ...element.querySelectorAll(".mappo-dot-highlight") ];
  assert.ok(lit.length > 0, "the dots inside the rings are lit");
  assert.ok(lit.length < element.querySelectorAll(".mappo-dot").length, "and only those");
  assert.match(element.querySelector("style").textContent, /\.mappo-dot-highlight \{ fill: #ff0000/,
    "the lit dots take the highlight colour");

  // Every lit dot's own cell centre is inside the rings.
  const grid = { cols: 36, rows: 18, latRange: [ -90, 90 ] };
  for (const use of lit) {
    const cell = use.parentElement;
    const c = api.cellCenter(Number(cell.dataset.col), Number(cell.dataset.row), grid);
    assert.ok(c.lat >= 40 && c.lat <= 80 && c.lon >= -20 && c.lon <= 20,
      `a lit dot at ${c.lat.toFixed(1)}, ${c.lon.toFixed(1)} is inside the region`);
  }

  // The same size, a different region: the dot markup is cached by size, so
  // this is the case that would have served one map another's highlight.
  const other = mount("mappo-world", {
    cols: 36, "lat-min": -90, "lat-max": 90,
    "highlight-polygon": JSON.stringify([ [ [ -40, -70 ], [ -40, -30 ], [ -10, -30 ], [ -10, -70 ], [ -40, -70 ] ] ]),
    "highlight-color": "#ff0000"
  });
  const elsewhere = [ ...other.querySelectorAll(".mappo-dot-highlight") ]
    .map((u) => u.parentElement.dataset.col + "," + u.parentElement.dataset.row);
  const here = lit.map((u) => u.parentElement.dataset.col + "," + u.parentElement.dataset.row);
  assert.ok(elsewhere.length > 0, "the other region is lit too");
  assert.ok(!elsewhere.some((k) => here.includes(k)), "and it is a different set of dots");
  unmount(other);
  unmount(element);
});

test("one invalid live range cannot poison late registration and can recover", () => {
  const id = "late-narrow-body";
  const element = mount("mappo-world", { body: id, cols: 24, "lat-min": 70 });
  assert.equal(element.map.body.pending, true);
  assert.deepEqual(element.map.options.latRange, [ 70, 90 ]);

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  const body = { id, name: "Late narrow body", latRange: [ -60, 60 ], figure: () => true };
  try {
    assert.doesNotThrow(() => api.registerBody(body), "one bad instance does not break global registration");
  } finally {
    console.error = originalError;
  }
  assert.equal(api.resolveBody(id), body, "the body is registered globally");
  assert.ok(customElements.get(`mappo-${id}`), "its convenience tag was still defined");
  assert.equal(element.map.body.pending, true, "the incompatible instance remains unchanged");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not apply body.*latRange/);

  element.setAttribute("lat-max", "90");
  assert.equal(element.map.body, body, "correcting the range retries the now-registered name");
  assert.deepEqual(element.map.options.latRange, [ 70, 90 ]);
  assert.ok(element.querySelectorAll(".mappo-dot").length > 0);
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
  assert.ok(element.querySelector(".mappo-figure-fill").getAttribute("d").length > 0,
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
  const element = document.createElement("mappo-world");
  element.setAttribute("cols", "24");
  element.innerHTML = `<div class="wrapper"><span>before</span>` +
    `<a class="pin" data-lat="38.7" data-lon="-9.1">Lisbon</a><span>after</span></div>` +
    `<p class="ordinary">ordinary host content</p>`;
  const wrapper = element.querySelector(".wrapper");
  const pin = element.querySelector(".pin");
  const ordinary = element.querySelector(".ordinary");
  document.body.appendChild(element);
  element.remove();
  assert.equal(element.map, null);
  assert.equal(wrapper.parentElement, element, "the original wrapper is back");
  assert.equal(pin.parentElement, wrapper, "the overlay is back in its original parent");
  assert.deepEqual([ ...wrapper.children ].map((child) => child.textContent), [ "before", "Lisbon", "after" ],
    "sibling order is exact");
  assert.equal(ordinary.parentElement, element, "non-overlay host content survives teardown");
  assert.equal(pin.style.position, "", "with our inline styles removed");
  assert.equal(element.querySelector("svg"), null);

  document.body.appendChild(element);
  assert.ok(element.map, "re-connected: a new map");
  assert.ok(pin.closest(".mappo-overlay"), "which found the overlay again");
  unmount(element);
});

test("overlay teardown restores host-owned inline styles and attributes exactly", () => {
  const element = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0 },
    `<a class="pin" data-lat="38.7" data-lon="-9.1" data-mappo-behind="host" ` +
    `style="position:relative;left:7px;top:8px;transform:scale(2);will-change:opacity;` +
    `--mappo-depth:.4!important;color:red">Lisbon</a>`);
  const pin = element.querySelector(".pin");
  assert.equal(pin.style.position, "absolute", "the live renderer owns positioning");

  element.remove();
  assert.equal(pin.parentElement, element);
  assert.equal(pin.style.position, "relative");
  assert.equal(pin.style.left, "7px");
  assert.equal(pin.style.top, "8px");
  assert.equal(pin.style.transform, "scale(2)");
  assert.equal(pin.style.willChange, "opacity");
  assert.equal(pin.style.getPropertyValue("--mappo-depth"), ".4");
  assert.equal(pin.style.getPropertyPriority("--mappo-depth"), "important");
  assert.equal(pin.style.color, "red", "unrelated host styles survive");
  assert.equal(pin.getAttribute("data-mappo-behind"), "host");
});

test("an unnamed coordinate marker still has an accessible name", () => {
  const element = mount("mappo-world", { cols: 24, markers: "0,0" });
  const marker = element.querySelector(".mappo-markers .mappo-pos");
  assert.equal(marker.getAttribute("role"), "button");
  assert.equal(marker.getAttribute("aria-label"), "0, 0");
  unmount(element);
});

test("globe boundaries render over fills for grid and vector figure sources", () => {
  const id = "border-order";
  const ring = [ [ -30, -30 ], [ -30, 30 ], [ 30, 30 ], [ 30, -30 ], [ -30, -30 ] ];
  api.registerBody({
    id, name: "Border order", latRange: [ -90, 90 ], figure: () => true,
    outlines: () => [ ring ], borders: () => [ ring ]
  });

  const originalFill = canvasContext.fill;
  const originalStroke = canvasContext.stroke;
  try {
    for (const source of [ "grid", "vector" ]) {
      const calls = [];
      canvasContext.fill = () => calls.push([ "fill", canvasContext.fillStyle ]);
      canvasContext.stroke = () => calls.push([ "stroke", canvasContext.strokeStyle ]);
      const element = mount("mappo-world", {
        body: id, mode: "globe", cols: 24, figure: "solid", "figure-source": source,
        borders: true, "figure-color": "#112233", "borders-color": "#fedcba",
        "rotate-speed": 0
      });

      const figureFills = calls
        .map((call, index) => [ call, index ])
        .filter(([ call ]) => call[0] === "fill" && call[1] === "#112233")
        .map(([, index ]) => index);
      const borderStrokes = calls
        .map((call, index) => [ call, index ])
        .filter(([ call ]) => call[0] === "stroke" && call[1] === "#fedcba")
        .map(([, index ]) => index);
      assert.ok(figureFills.length > 0, `${source}: the figure fill was painted`);
      assert.ok(borderStrokes.length > 0, `${source}: boundaries were painted`);
      assert.ok(Math.min(...borderStrokes) > Math.max(...figureFills),
        `${source}: every boundary stroke is above the fill`);
      unmount(element);
    }
  } finally {
    if (originalFill === undefined) delete canvasContext.fill;
    else canvasContext.fill = originalFill;
    if (originalStroke === undefined) delete canvasContext.stroke;
    else canvasContext.stroke = originalStroke;
  }
});

test("an unrelated attribute change does not re-aim a focused globe", () => {
  const globe = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0, focus: "0,90" });
  assert.equal(globe.map._renderer.angle, 270, "facing 90°E means spinning by -90°");
  globe.map._renderer.angle = 123;           // the user dragged it
  globe.setAttribute("figure-color", "#ff0000");
  assert.equal(globe.map._renderer.angle, 123, "a colour change must not snap the globe back");
  globe.setAttribute("focus", "0,45");
  assert.equal(globe.map._renderer.angle, 315, "a real focus change re-aims");
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
  const path = element.querySelector(".mappo-figure-fill");
  const renders = { n: 0 };
  const original = element.map.render;
  element.map.render = function () { renders.n++; return original.call(this); };
  element.setAttribute("figure-color", "#123456");
  element.setAttribute("figure-stroke", "#654321");
  element.setAttribute("borders-color", "#abcdef");
  assert.equal(renders.n, 0, "three colour changes, zero geometry rebuilds");
  assert.equal(element.querySelector(".mappo-figure-fill"), path, "the same path node is still in place");
  assert.match(element.querySelector("style").textContent, /\.mappo-figure-fill\s*\{[^}]*fill: #123456;/);
  assert.match(element.querySelector("style").textContent, /\.mappo-figure-edge\s*\{[^}]*stroke: #654321;/);
  assert.match(element.querySelector("style").textContent, /\.mappo-borders\s*\{[^}]*stroke: #abcdef/);
  unmount(element);
});

test("built-in styles are instance-scoped defaults, so ordinary consumer CSS wins", () => {
  const consumer = document.createElement("style");
  consumer.textContent = `.mappo-dot { fill: rgb(1, 2, 3); }`;
  document.head.appendChild(consumer);
  try {
    const element = mount("mappo-world", { cols: 24, "figure-color": "#abcdef" });
    const dot = element.querySelector(".mappo-dot");
    assert.equal(getComputedStyle(dot).fill, "rgb(1, 2, 3)");
    const scopedRules = [ ...element.querySelector("style").sheet.cssRules ]
      .filter((rule) => rule.selectorText)
      .map((rule) => rule.selectorText)
      .join("\n");
    assert.match(scopedRules, new RegExp(`:where\\(\\[data-mappo="${element.map._uid}"\\] \\.mappo-dot\\)`));
    unmount(element);
  } finally {
    consumer.remove();
  }
});

test("projection: a polar map is a disc — square frame, dots only inside it, off-map places skipped", () => {
  const moon = mount("mappo-moon", { cols: 40, projection: "stereographic-south", "lat-max": -60, places: "Shackleton, Apollo 11" });
  assert.deepEqual(moon.map.options.latRange, [ -90, -60 ], "lat-max is the rim; the pole is the centre");
  assert.equal(moon.map.projection.id, "stereographic-south");
  assert.equal(moon.querySelector("svg").getAttribute("viewBox"), "0 0 400 400", "aspect 1");
  assert.ok(moon.querySelector("clipPath path").getAttribute("d").length > 200, "the frame clip is the disc");
  let dots = 0;
  for (const pos of moon.querySelectorAll(".mappo-dots .mappo-pos")) {
    const [ , x, y ] = pos.getAttribute("transform").match(/translate\(([\d.]+) ([\d.]+)\)/).map(Number);
    assert.ok(Math.hypot(x - 200, y - 200) <= 200 + 8, `dot at ${x},${y} is inside the disc`);
    dots++;
  }
  assert.ok(dots > 0, "the polar maria are drawn");
  assert.deepEqual([ ...moon.querySelectorAll("[data-place]") ].map((m) => m.dataset.place), [ "Shackleton" ],
    "Apollo 11 has no place on a south polar cap");
  unmount(moon);
});

test("projection: default framing follows the projection, explicit bounds still win, bad values are refused atomically", async () => {
  const north = mount("mappo-world", { cols: 24, projection: "stereographic-north" });
  assert.deepEqual(north.map.options.latRange, [ 0, 90 ], "a hemisphere, not Earth's -58…84");
  north.setAttribute("lat-min", "30");
  assert.deepEqual(north.map.options.latRange, [ 30, 90 ]);
  north.setAttribute("projection", "equirectangular");
  assert.deepEqual(north.map.options.latRange, [ 30, 84 ], "back on a cylindrical map the body's own top bound returns");
  assert.throws(() => north.map.update({ projection: "stereographic-north", latMin: -90 }), /opposite pole/);
  assert.equal(north.map.options.projection, "equirectangular", "a rejected update changes nothing");
  assert.deepEqual(north.map.options.latRange, [ 30, 84 ]);
  // A name nobody has registered is not an error but a wait — its module may
  // still be loading. The map draws nothing and says what it waits for.
  north.map.update({ projection: "mercator" });
  await settle();
  assert.match(north.map.pending, /projection "mercator"/);
  assert.equal(north.querySelector("svg"), null, "a waiting map draws nothing");
  assert.equal(north.getAttribute("data-mappo-pending"), 'projection "mercator"');
  north.setAttribute("projection", "equirectangular");
  await settle();
  assert.equal(north.map.pending, null);
  assert.ok(north.querySelector("svg"), "and draws again as soon as it can");
  unmount(north);
});

test("projection: Equal Earth leaves the corners empty", () => {
  const ee = mount("mappo-world", { cols: 40, projection: "equal-earth", "lat-min": -90, "lat-max": 90 });
  assert.equal(ee.querySelector('.mappo-dots .mappo-pos[data-col="0"][data-row="0"]'), null, "no dot in the top-left corner");
  assert.ok(ee.map._dotCount > 0);
  assert.equal(ee.querySelector("svg").getAttribute("viewBox"), "0 0 400 190", "rows follow the 2.05:1 aspect");
  unmount(ee);
});

test("projection: vector outlines split into a fill and an edge, and the edge never crosses the map", () => {
  const el = mount("mappo-world", { cols: 60, "center-lon": 150, figure: "solid outline", "figure-source": "vector", borders: "" });
  const fill = el.querySelector(".mappo-figure-fill"), edge = el.querySelector(".mappo-figure-edge");
  assert.ok(fill.getAttribute("d").length > 1000 && edge.getAttribute("d").length > 1000);
  let prev = null;
  for (const [ , cmd, x ] of edge.getAttribute("d").matchAll(/([ML])([\d.]+) [\d.]+/g)) {
    if (cmd === "L") assert.ok(Math.abs(Number(x) - prev) < 300, "an edge segment never spans half the frame");
    prev = Number(x);
  }
  assert.ok(el.querySelector(".mappo-borders").getAttribute("d").length > 1000);
  assert.equal(el.querySelector(".mappo-figure").getAttribute("clip-path"), `url(#mappo-frame-i${el.map._uid})`);
  unmount(el);
});

test("projection: the graticule draws on the flat map and its colours are style-tier", () => {
  const el = mount("mappo-world", { cols: 40, graticule: "", projection: "stereographic-north" });
  assert.ok(el.querySelector(".mappo-graticule").getAttribute("d").length > 100);
  assert.ok(el.querySelector(".mappo-equator").getAttribute("d").length > 20);
  const renders = { n: 0 };
  const original = el.map.render;
  el.map.render = function () { renders.n++; return original.call(this); };
  el.setAttribute("graticule-color", "#ff0000");
  assert.equal(renders.n, 0);
  assert.match(el.querySelector("style").textContent, /\.mappo-graticule\s*\{[^}]*stroke: #ff0000/);
  unmount(el);
});

test("projection: overlays follow the projection and off-map points are parked as behind", () => {
  const el = mount("mappo-world", { cols: 40, projection: "stereographic-south", "lat-max": -60 },
    `<a class="pin" data-lat="-89.9" data-lon="0">Pole</a><a class="far" data-lat="45" data-lon="0">Paris</a>`);
  const pin = el.querySelector(".pin"), far = el.querySelector(".far");
  assert.ok(Math.abs(parseFloat(pin.style.left) - 50) < 1 && Math.abs(parseFloat(pin.style.top) - 50) < 1, "the pole is the centre");
  assert.equal(pin.hasAttribute("data-mappo-behind"), false);
  assert.equal(far.style.left, "-9999px");
  assert.ok(far.hasAttribute("data-mappo-behind"), "a point the projection cannot place is behind");
  unmount(el);
});

test("glass globe: fog draws the far side, and locate() reports depth and fade", () => {
  const el = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0, "lat-min": -90, "lat-max": 90 });
  // Opaque by default: the antipode is behind and invisible, the facing point full.
  const behind = el.map.locate(0, 180);
  assert.equal(behind.front, false);
  assert.ok(behind.z < -0.99, `antipode depth ${behind.z}`);
  assert.equal(behind.fade, 0);
  const facing = el.map.locate(0, 0);
  assert.equal(facing.front, true);
  assert.ok(Math.abs(facing.z - 1) < 1e-9 && Math.abs(facing.fade - 1) < 1e-9);
  // Fog: the far side is faint and the antipode all but gone; the near third
  // is untouched. The curve is a renderer's: one minus a smoothstep between
  // near and far, used as alpha directly.
  el.setAttribute("fog", "-0.6 1.1");
  assert.deepEqual(el.map.options.fog, [ -0.6, 1.1 ]);
  const fogged = (z) => { const t = Math.min(1, Math.max(0, (-z + 0.6) / 1.7)); return 1 - t * t * (3 - 2 * t); };
  assert.ok(Math.abs(el.map.locate(0, 180).fade - fogged(-1)) < 1e-9, "the antipode keeps a trace of alpha");
  assert.ok(el.map.locate(0, 180).fade > 0.005 && el.map.locate(0, 180).fade < 0.02, `antipode fade ${el.map.locate(0, 180).fade}`);
  assert.ok(Math.abs(el.map.locate(0, 0).fade - 1) < 1e-9);
  assert.ok(Math.abs(el.map.locate(0, 90).fade - fogged(0)) < 1e-9, "the limb sits 0.6 radii into a 1.7-radii fog");
  assert.ok(el.map.locate(0, 90).fade > 0.70 && el.map.locate(0, 90).fade < 0.73);
  assert.ok(Math.abs(el.map.locate(0, -50).fade - 1) < 1e-9, "everything nearer than `near` is opaque");
  assert.ok(el.map.locate(0, 120).fade > el.map.locate(0, 150).fade && el.map.locate(0, 150).fade > el.map.locate(0, 180).fade, "monotonic into the fog");
  // A fog colour turns the fade into a mix; it is plumbing here, paint in the globe.
  el.setAttribute("fog-color", "#151414");
  assert.equal(el.map.options.fogColor, "#151414");
  el.removeAttribute("fog-color");
  assert.equal(el.map.options.fogColor, null);
  // A malformed fog is no fog.
  el.setAttribute("fog", "banana");
  assert.equal(el.map.options.fog, null);
  el.setAttribute("fog", "2 1");
  assert.equal(el.map.options.fog, null, "near must be less than far");
  unmount(el);
});

test("perspective: a camera at `distance` keeps the limb on the disc and folds the far side inward", () => {
  const el = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0, "lat-min": -90, "lat-max": 90 });
  const R = el.map.locate(0, 0).r;
  const ortho = el.map.locate(0, 90);
  assert.ok(Math.abs(ortho.x - (ortho.cx + R)) < 1e-6, "orthographic: 90° east is the disc edge");
  el.setAttribute("distance", "2");
  const D = 2, horizonLon = Math.acos(1 / D) * 180 / Math.PI;   // depth 1/D is where the surface turns away
  const limb = el.map.locate(0, horizonLon);
  assert.ok(Math.abs(limb.z - 1 / D) < 1e-9);
  assert.ok(Math.abs(limb.x - (limb.cx + R)) < 1e-6, `the horizon lands exactly on the disc edge (${limb.x} vs ${limb.cx + R})`);
  assert.equal(el.map.locate(0, 30).front, true);
  assert.equal(el.map.locate(0, 80).front, false, "past the horizon is hidden, though 80° is still in front of the centre plane");
  // The mirror point on the far side projects inside the disc at R·(D²−1)/(D²+1).
  const back = el.map.locate(0, 180 - horizonLon);
  assert.ok(Math.abs((back.x - back.cx) - R * (D * D - 1) / (D * D + 1)) < 1e-6, "the far side is drawn smaller");
  assert.equal(back.front, false);
  // Something in orbit over the far side still shows when the body is not in the way.
  assert.equal(el.map.locate(60, 180, 3).front, true, "three radii out over the far side, off the axis, stands beside the disc");
  assert.equal(el.map.locate(0, 180, 3).front, false, "three radii out on the axis behind the antipode is behind the body");
  assert.equal(el.map.locate(0, 180, 1.05).front, false, "just above the antipode is hidden by the body");
  // Not a distance: back to orthographic, once, with a warning.
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    el.setAttribute("distance", "0.5");
    assert.ok(Math.abs(el.map.locate(0, 90).x - (ortho.cx + R)) < 1e-6);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /distance must be/);
  unmount(el);
});

test("reduced motion is opt-in: the OS setting alone does not stop a globe; reduced-motion honours it", async () => {
  // The harness pins prefers-reduced-motion on and gives no
  // requestAnimationFrame, so globes here never loop. Give this one the
  // window's rAF: with the setting on, only a map that asked to honour it stays still.
  const savedRaf = globalThis.requestAnimationFrame, savedCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  const spinning = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 30 });
  const honouring = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 30, "reduced-motion": "" });
  const flat = mount("mappo-world", { cols: 24, animation: "wave" });
  const flatHonouring = mount("mappo-world", { cols: 24, animation: "wave", "reduced-motion": "" });
  try {
    assert.equal(spinning.map._renderer._static, false, "by default the OS setting does not freeze the globe");
    assert.ok(spinning.map._renderer._raf !== null, "and its loop is running");
    assert.equal(honouring.map._renderer._static, true, "reduced-motion honours the setting: one static frame");
    assert.equal(honouring.map._renderer._raf, null, "and no loop");
    const css = (el) => el.querySelector("style").textContent;
    assert.doesNotMatch(css(flat), /prefers-reduced-motion/, "the flat map's stylesheet leaves animation alone by default");
    assert.match(css(flatHonouring), /prefers-reduced-motion/, "and switches it off under the setting when asked");
  } finally {
    for (const el of [ spinning, honouring, flat, flatHonouring ]) unmount(el);
    if (savedRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = savedRaf;
    if (savedCaf === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = savedCaf;
  }
});

test("a parked globe draws no frames; a spinning one does", async () => {
  // The harness gives no requestAnimationFrame, which means a globe never
  // starts its frame loop. This test is about the loop, so it gets the
  // window's requestAnimationFrame for its duration.
  const savedMatchMedia = globalThis.matchMedia, savedRaf = globalThis.requestAnimationFrame, savedCaf = globalThis.cancelAnimationFrame;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  const el = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0 });
  const original = canvasContext.clearRect;
  let clears = 0;
  canvasContext.clearRect = () => clears++;
  try {
    assert.ok(el.map._renderer._raf !== null, "the loop is running");
    await settle(200);
    const parked = clears;
    await settle(300);
    assert.equal(clears, parked, "nothing moved, nothing drawn");
    el.setAttribute("figure-color", "#123456");
    assert.equal(clears, parked + 1, "an option change draws exactly one frame");
    el.setAttribute("rotate-speed", "30");
    await settle(300);
    assert.ok(clears > parked + 4, `a spinning globe keeps drawing (${clears - parked} frames)`);
  } finally {
    if (original === undefined) delete canvasContext.clearRect;
    else canvasContext.clearRect = original;
    unmount(el);
    globalThis.matchMedia = savedMatchMedia;
    if (savedRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = savedRaf;
    if (savedCaf === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = savedCaf;
  }
});

test("uniform tiles: the element rebuilds the dot field for distribution and dot-shape, and the flat map draws tiles as squares", () => {
  const el = mount("mappo-world", { mode: "globe", cols: 40, "rotate-speed": 0, distribution: "uniform", "dot-shape": "tile", "lat-min": -90, "lat-max": 90 });
  const g = el.map._renderer;
  const n = Math.round((40 * 40) / Math.PI);
  assert.ok(g.points.length / 3 > 0.25 * n && g.points.length / 3 < 0.33 * n, "about 29% of the lattice is land");
  assert.equal(g.tiles.length / 9, g.points.length / 3, "one tile per point");
  el.setAttribute("distribution", "grid");
  assert.equal(g.points.length, api.buildFigure({ cols: 40, rows: 20, latRange: [ -90, 90 ] }, { body: api.EARTH }).cells.length * 3, "back on the grid, the dots are the grid's cells");
  el.setAttribute("dot-shape", "circle");
  assert.equal(g.tiles, null);
  unmount(el);

  const flat = mount("mappo-world", { cols: 24, "dot-shape": "tile", graticule: "", "graticule-width": "2" });
  assert.equal(flat.querySelector("defs > :first-child").tagName.toLowerCase(), "rect", "a tile on a flat map is a square");
  assert.match(flat.querySelector("style").textContent, /\.mappo-graticule\s*\{[^}]*stroke-width: 1.2/, "graticule-width scales the hairline");
  unmount(flat);
});

test("a renderer module arriving after upgrade: the map waits, then draws with it, no re-mount", async () => {
  class Orrery {
    constructor(container, options, body, overlays) {
      this.o = options; this.body = body; this.overlays = overlays;
      this.element = document.createElement("canvas");
      this.element.className = "orrery";
      container.replaceChildren(this.element);
    }
    update() {}
    destroy() { this.element.remove(); }
    locate() { return { x: 1, y: 2, depth: 1, front: true }; }
  }
  const element = mount("mappo-world", { mode: "orrery", cols: 24 });
  assert.equal(element.map.pending, 'renderer "orrery"');
  assert.equal(element.children.length, 0, "a waiting map draws nothing");
  assert.equal(element.getAttribute("data-mappo-pending"), 'renderer "orrery"');
  assert.equal(element.map.locate(0, 0), null);
  api.registerRenderer("orrery", Orrery);
  assert.equal(element.map.pending, null);
  assert.ok(element.querySelector("canvas.orrery"), "registered: drawn at once");
  assert.equal(element.querySelector("canvas.orrery").getAttribute("role"), "img");
  assert.match(element.querySelector("canvas.orrery").getAttribute("aria-label"), /Earth map/);
  assert.deepEqual(element.map.locate(0, 0), { x: 1, y: 2, depth: 1, front: true });
  assert.deepEqual(api.knownRenderers(), [ "flat", "globe", "orrery" ]);
  element.setAttribute("mode", "flat");
  await settle();
  assert.ok(element.querySelector("svg"), "back to the flat map");
  assert.equal(element.querySelector("canvas.orrery"), null, "the renderer was torn down");
  assert.throws(() => api.registerRenderer("flat", Orrery), /other than "flat"/);
  unmount(element);
});

test("a projection module arriving after upgrade: the map waits, then draws with it", () => {
  const element = mount("mappo-world", { cols: 24, projection: "plate-carree" });
  assert.equal(element.map.pending, 'projection "plate-carree"');
  assert.equal(element.querySelector("svg"), null);
  api.registerProjection("plate-carree", {
    kind: "cylindrical",
    defaultLatRange: (range) => range,
    create({ latRange: [ lat0, lat1 ] }) {
      const span = lat1 - lat0;
      return {
        aspect: 360 / span,
        forwardShifted: (lat, lonS) => ({ x: (lonS + 180) / 360, y: (lat1 - lat) / span }),
        inverse: (x, y) => (x < 0 || x > 1 || y < 0 || y > 1) ? null : { lat: lat1 - y * span, lonS: -180 + x * 360 },
        outline: () => [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ], [ 0, 0 ] ] ]
      };
    }
  });
  assert.equal(element.map.pending, null);
  assert.ok(element.querySelector("svg"));
  assert.equal(element.map.projection.id, "plate-carree");
  assert.ok(api.knownProjections().includes("plate-carree"));
  assert.ok(element.map._dotCount > 0);
  unmount(element);
});

test("extendBody: rings arriving after the map drew are drawn at once, and the figure caches are dropped", () => {
  const id = "late-rings";
  api.registerBody({ id, name: "Late rings", latRange: [ -90, 90 ], terms: { figure: "a", ground: "b" }, figure: (lat, lon) => lat > 0 && lon > 0 });
  const element = mount(`mappo-${id}`, { cols: 24, figure: "solid outline", "figure-source": "vector" });
  const gridEdge = element.querySelector(".mappo-figure-edge").getAttribute("d");
  assert.ok(gridEdge.length > 0, "grid contours meanwhile");
  assert.equal(element.map.body.outlines, undefined);
  api.extendBody(id, { outlines: () => [ [ [ 10, 10 ], [ 80, 10 ], [ 80, 170 ], [ 10, 170 ], [ 10, 10 ] ] ] });
  assert.equal(element.map.body.outlines().length, 1);
  const vectorEdge = element.querySelector(".mappo-figure-edge").getAttribute("d");
  assert.notEqual(vectorEdge, gridEdge, "redrawn from the rings");
  assert.throws(() => api.extendBody("nobody", {}), /no body/);
  assert.throws(() => api.extendBody(id, { figure: () => true }), /not something a body can be given later/);
  unmount(element);
});

test("globe: a drag is drawn while the pointer moves, not only on release", async () => {
  // Every other test here runs its globes under prefers-reduced-motion (the
  // matchMedia stub above), which is exactly the mode WITHOUT a frame loop.
  // This one needs the loop: give it jsdom's requestAnimationFrame and a
  // motion-allowing matchMedia for its lifetime, then put both back.
  const saved = { matchMedia: globalThis.matchMedia, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  try {
    const element = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0 });
    const renderer = element.map._renderer;
    assert.equal(renderer._static, false, "this globe has a frame loop");
    const canvas = element.querySelector("canvas");
    let draws = 0;
    const draw = renderer._draw.bind(renderer);
    renderer._draw = () => { draws++; draw(); };
    renderer.side = 400;   // jsdom has no layout; the drag maths divides by the canvas side
    await settle(100);
    const idle = draws;
    await settle(100);
    assert.equal(draws, idle, "a parked globe draws no frames before anything moves");
    const angle0 = renderer.angle;
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 200, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 160, clientY: 200, bubbles: true }));
    assert.notEqual(renderer.angle, angle0, "the pointer owns the angle");
    await settle(120);   // a few animation frames, pointer still down
    assert.ok(draws > idle, "a moved angle is drawn on the next frame — the globe follows the pointer");
    const drawsWhileDown = draws;
    // An angle changed by anyone between frames is drawn too: the loop judges
    // against the frame it last drew, not against its own start.
    renderer.angle = (renderer.angle + 15) % 360;
    await settle(120);
    assert.ok(draws > drawsWhileDown, "an external angle change is drawn");
    // Release without a flick: a parked globe draws no frames at all.
    renderer._drag.v = 0;
    canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 160, clientY: 200, bubbles: true }));
    await settle(150);
    const parked = draws;
    await settle(200);
    assert.equal(draws, parked, "a parked globe costs no frames");
    // A flick carries momentum past release, and momentum is drawn.
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 200, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 220, clientY: 200, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 220, clientY: 200, bubbles: true }));
    const released = renderer.angle;
    await settle(150);
    assert.notEqual(renderer.angle, released, "momentum keeps the globe turning after release");
    assert.ok(draws > parked, "and the turning is drawn");
    unmount(element);
  } finally {
    Object.assign(globalThis, { matchMedia: saved.matchMedia, requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf });
    if (saved.raf === undefined) delete globalThis.requestAnimationFrame;
    if (saved.caf === undefined) delete globalThis.cancelAnimationFrame;
  }
});

test("overlays: locate().depth is the facing the overlays get, and overlay-horizon hides with hysteresis", () => {
  // A pin 60° east of the focus under a camera 2.5 radii away: facing 0.115,
  // under the appear threshold of 0.5 — behind, although it is on the near side.
  const element = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0, focus: "0,0", distance: "2.5", "overlay-horizon": "0.5 0.2" },
    `<a class="pin" data-lat="0" data-lon="60">A</a>`);
  const pin = element.querySelector(".pin");
  const D = 2.5;
  const facingAt = (dLon) => { const z = Math.cos(dLon * Math.PI / 180); return (D * z - 1) / Math.sqrt(D * D - 2 * D * z + 1); };
  const located = element.map.locate(0, 60);
  assert.ok(located.front, "on the near side");
  assert.ok(Math.abs(located.depth - Math.max(0, facingAt(60))) < 1e-9, "depth is the camera's facing, not the raw depth");
  assert.equal(pin.style.getPropertyValue("--mappo-depth"), facingAt(60).toFixed(3), "the same number the overlay carries");
  assert.equal(pin.hasAttribute("data-mappo-behind"), true, "under the appear threshold: behind");
  element.setAttribute("focus", "0,60");
  assert.equal(pin.hasAttribute("data-mappo-behind"), false, "facing the camera: shown");
  element.setAttribute("focus", "0,15");   // 45° off: facing 0.467, between vanish and appear
  assert.ok(facingAt(45) > 0.2 && facingAt(45) < 0.5);
  assert.equal(pin.hasAttribute("data-mappo-behind"), false, "hysteresis: still shown between the thresholds");
  element.setAttribute("focus", "0,-10");  // 70° off: past the camera's horizon
  assert.equal(pin.hasAttribute("data-mappo-behind"), true);
  element.setAttribute("focus", "0,15");   // 45° again: below appear, so it stays hidden
  assert.equal(pin.hasAttribute("data-mappo-behind"), true, "hysteresis: hidden until the appear threshold");
  element.setAttribute("focus", "0,60");
  assert.equal(pin.hasAttribute("data-mappo-behind"), false);
  // Without the option the attribute means the far side, as before.
  element.removeAttribute("overlay-horizon");
  element.setAttribute("focus", "0,15");
  assert.equal(pin.hasAttribute("data-mappo-behind"), false, "default horizon: near side is shown whatever the facing");
  element.setAttribute("focus", "0,-10");
  assert.equal(pin.hasAttribute("data-mappo-behind"), true);
  unmount(element);
});

test("overlays: data-mappo-moving while the globe turns faster than overlay-still", () => {
  const element = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0, focus: "0,0", "overlay-still": "30" },
    `<a class="pin" data-lat="0" data-lon="0">A</a>`);
  const pin = element.querySelector(".pin");
  assert.equal(pin.hasAttribute("data-mappo-moving"), false, "a still globe is not moving");
  element.setAttribute("focus", "0,120");   // 120° in a few milliseconds
  assert.equal(pin.hasAttribute("data-mappo-moving"), true, "a fast turn marks every overlay moving");
  for (let i = 0; i < 80; i++) element.map.update({ figureColor: i % 2 ? "#111" : "#222" });   // frames without a turn: the speed decays
  assert.equal(pin.hasAttribute("data-mappo-moving"), false, "and it settles");
  element.removeAttribute("overlay-still");
  element.setAttribute("focus", "0,-120");
  assert.equal(pin.hasAttribute("data-mappo-moving"), false, "off unless the option is set");
  unmount(element);
});

test("overlays: a parked globe settles its overlay-still speed by itself, without another update", async () => {
  // The speed is measured on the frames drawn, and a globe re-aimed in one
  // jump then left alone draws no frame on its own — so the estimate froze at
  // thousands of degrees a second and every overlay stayed moving. Under the
  // frame loop (see the drag test for the harness) the globe must keep drawing
  // until the estimate has fallen under the threshold.
  const saved = { matchMedia: globalThis.matchMedia, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  try {
    const element = mount("mappo-world", { mode: "globe", cols: 24, "rotate-speed": 0, focus: "0,0", "overlay-still": "30" },
      `<a class="pin" data-lat="0" data-lon="0">A</a>`);
    const pin = element.querySelector(".pin");
    element.setAttribute("focus", "0,120");
    assert.equal(pin.hasAttribute("data-mappo-moving"), true, "the jump reads as a fast turn");
    for (let i = 0; i < 60 && pin.hasAttribute("data-mappo-moving"); i++) await settle(50);
    assert.equal(pin.hasAttribute("data-mappo-moving"), false, "and the parked globe clears it on its own");
    assert.ok(element.map._renderer._speed < 30, `the estimate settled (${element.map._renderer._speed.toFixed(1)}°/s)`);
    unmount(element);
  } finally {
    Object.assign(globalThis, { matchMedia: saved.matchMedia, requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf });
    if (saved.raf === undefined) delete globalThis.requestAnimationFrame;
    if (saved.caf === undefined) delete globalThis.cancelAnimationFrame;
  }
});

test("layer-bleed: the layer canvas reaches past the box, layers keep the box's coordinates", () => {
  // jsdom lays nothing out: give every canvas a 300 px box for this test, as
  // the layer seam's own tests do, and take it back after.
  const proto = dom.window.HTMLCanvasElement.prototype;
  for (const prop of [ "clientWidth", "clientHeight" ]) Object.defineProperty(proto, prop, { configurable: true, get: () => 300 });
  try {
    const el = mount("mappo-world", { mode: "globe", "rotate-speed": 0, "layer-bleed": 0.15 });
    const views = [];
    el.map.addLayer((ctx, view) => views.push(view));
    const canvas = el.querySelector(".mappo-layer");
    assert.ok(canvas, "a layer canvas was mounted");
    const style = canvas.style;
    assert.equal(style.left, "-15%");
    assert.equal(style.top, "-15%");
    assert.equal(style.width, "130%");
    assert.equal(style.height, "130%");
    assert.equal(style.pointerEvents, "none", "the bleed never takes the pointer");
    assert.ok(views.length >= 1, "drawn on adding");
    // The 300 px the stub reports is the whole canvas, bleed included: the box
    // the layer draws in is what is left once the bleed is taken off.
    assert.ok(Math.abs(views.at(-1).width - 300 / 1.3) < 1e-9, `view.width is the box, ${views.at(-1).width}`);
    assert.ok(Math.abs(views.at(-1).height - 300 / 1.3) < 1e-9);
    // Live change: back to the edge, and the box is the canvas again.
    el.map.update({ layerBleed: 0 });
    assert.equal(style.left, "0%");
    assert.equal(style.width, "100%");
    assert.equal(views.at(-1).width, 300);
    // Nonsense is no bleed.
    el.map.update({ layerBleed: -2 });
    assert.equal(style.width, "100%");
    el.setAttribute("layer-bleed", "banana");
    assert.equal(style.width, "100%");
    assert.equal(api.DEFAULTS.layerBleed, 0, "off by default");
    unmount(el);
  } finally {
    for (const prop of [ "clientWidth", "clientHeight" ]) delete proto[prop];
  }
});
