import { test } from "node:test";
import assert from "node:assert/strict";
import { Mappo } from "../dist/mappo.js";

// The crash regression (live review, 2026-08): dragging the cols slider
// re-rendered the full geometry per input event — parse, style, layout and
// GC for ~16k nodes at up to 60Hz — until the tab OOM-died. The contract
// under test: bursts of geometry changes coalesce through the debounce, and
// non-geometry options never rebuild geometry at all.

function fakeContainer() {
  return { isConnected: true, replaceChildren() {}, dispatchEvent() {} };
}

// A map whose render is stubbed, so the update tiers can be observed alone.
function stubbed(render = function () { this._lastRebuild = performance.now(); }) {
  const orig = Mappo.prototype.render;
  Mappo.prototype.render = render;
  try {
    return new Mappo(fakeContainer());
  } finally {
    Mappo.prototype.render = orig;
  }
}

test("burst of cols changes coalesces to at most leading+trailing rebuilds", async () => {
  let renders = 0;
  const orig = Mappo.prototype.render;
  Mappo.prototype.render = function () { renders++; this._lastRebuild = performance.now(); };
  let map;
  try {
    map = new Mappo(fakeContainer()); // 1 constructor render
    for (let i = 0; i < 300; i++) map.update({ cols: 100 + (i % 80) });
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(renders <= 3, `expected ≤3 renders for a 300-tick burst, got ${renders}`);
    assert.ok(renders >= 2, "the trailing rebuild must land on the resting value");
  } finally {
    map?.destroy();
    Mappo.prototype.render = orig;
  }
});

test("style-tier options never trigger a geometry rebuild", () => {
  const map = stubbed();
  const orig = Mappo.prototype.render;
  Mappo.prototype.render = () => { throw new Error("geometry rebuild on a style-tier option"); };
  try {
    let stylePatches = 0;
    map.styleEl = { set textContent(_) { stylePatches++; } };
    map.svg = null; // def/marker patches no-op safely without a DOM

    map.update({ figureColor: "#111" });
    map.update({ figureStroke: "#222", figureStrokeWidth: 2 });
    map.update({ bordersColor: "#333", bordersOpacity: 0.9 });
    map.update({ highlightColor: "#444" });
    map.update({ animation: "noise" });
    map.update({ animationPeriod: 9 });
    map.update({ animationHeight: 1.2 });
    map.update({ animationWidth: 0.08 });
    map.update({ tilt: 40, perspective: 800 });
    map.update({ markerColor: "#f00" });
    assert.equal(stylePatches, 10);

    map.update({ onPlaceClick: () => {} }); // callbacks are free — no patch at all
    assert.equal(stylePatches, 10);

    map.update({ figureColor: "#111" }); // unchanged value — no work
    assert.equal(stylePatches, 10);

    // Structural equality: a fresh array or object saying the same thing is
    // not a change. (The element re-parses every attribute on every change.)
    map.update({ places: [ "London" ] });
    assert.equal(stylePatches, 11);
    map.update({ places: [ "London" ] });
    assert.equal(stylePatches, 11);
  } finally {
    map.destroy();
    Mappo.prototype.render = orig;
  }
});

test("dot and figure geometry use separate, type-safe caches", () => {
  const map = stubbed();
  assert.ok(map._dotsCache instanceof Map);
  assert.ok(map._figureCache instanceof Map);
  assert.notEqual(map._dotsCache, map._figureCache);
  map.destroy();
});

test("invalid latitude overrides fail before producing impossible geometry", () => {
  const map = stubbed();
  try {
    const original = [ ...map.options.latRange ];
    assert.deepEqual(original, [ -58, 84 ], "Earth's framing by default");
    assert.throws(() => map.update({ latMin: 85 }), /latRange/);
    assert.deepEqual(map.options.latRange, original, "a rejected update is atomic");
    assert.throws(() => map.update({ latRange: [ -91, 90 ] }), /latRange/);
    assert.deepEqual(map.options.latRange, original, "a rejected range cannot poison later updates");
    map.update({ latRange: [ -90, 90 ] });
    assert.deepEqual(map.options.latRange, [ -90, 90 ], "a full range override is honoured");
  } finally {
    map.destroy();
  }
});

test("the map exposes its resolved body", () => {
  const map = stubbed();
  assert.equal(map.body.id, "earth");
  map.destroy();
});
