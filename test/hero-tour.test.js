// Exercise the actual tour with a deterministic globe and clock. Geometry is
// supplied because jsdom has no layout; scrolling changes viewport rects just
// as a browser does. Browser painting is checked separately in the harness.
import { after, before, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { heroTour } from '../assets/hero-tour.js';

let dom, el, ctl, paint, now, viewport, rect, clearRect, disc;
const saved = new Map();
before(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    performance: { now: () => now * 1000 },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  for (const [key, axis] of [['clientWidth','width'], ['clientHeight','height']]) {
    Object.defineProperty(document.documentElement, key, { get: () => viewport[axis] });
  }
});
after(() => {
  dom.window.close();
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key];
  }
});
beforeEach(() => {
  now = 1;
  viewport = { width: 390, height: 664 };
  rect = { left: -39, top: 490, width: 468, height: 468 };
  clearRect = { left: 0, top: 730, width: 390, height: 80 };
  disc = { x: 234, y: 234, cx: 234, cy: 234, r: 220, scale: 220, front: true, depth: 1, z: 1 };
  window.scrollX = window.scrollY = 0;
  el = document.createElement('div');
  el.getBoundingClientRect = () => bounds(rect);
  Object.defineProperties(el, {
    clientWidth: { get: () => rect.width }, clientHeight: { get: () => rect.height },
  });
  el.map = {
    options: { rotateSpeed: 0 }, locate: () => ({ ...disc }),
    addLayer(fn) {
      paint ??= fn;
      return { redraw() {}, remove() {} };
    },
  };
  document.body.appendChild(el);
});
afterEach(() => { ctl?.stop(); ctl = paint = null; document.body.replaceChildren(); });
function bounds(r) {
  const left = r.left - window.scrollX, top = r.top - window.scrollY;
  return { ...r, x: left, y: top, left, top, right: left + r.width, bottom: top + r.height };
}
async function start({ keepClear = false, ...options } = {}) {
  const blocker = document.createElement('div');
  blocker.getBoundingClientRect = () => bounds(clearRect);
  ctl = heroTour(el, { reduceMotion: false,
    steps: [{ kind: 'label', style: 'title', text: 'This is a mappo globe', hold: 4 },
      { kind: 'label', style: 'title', text: 'Next identical anchor', hold: 4 }],
    keepClear: keepClear ? [blocker] : [], ...options });
  await Promise.resolve();
  const card = el.querySelector('.mappo-tour-card');
  Object.defineProperties(card, { offsetWidth: { get: () => 200 }, offsetHeight: { get: () => 40 } });
  draw();
}
function draw() { paint({}, { width: rect.width, height: rect.height }); }
function position() { return el.querySelector('.mappo-tour').style.transform; }

test('a title stays at the same globe anchor during a document scroll', async () => {
  await start(); const before = position();
  window.scrollY = 220; draw(); assert.equal(position(), before);
});
test('toolbar height changes cannot move a title within the current step', async () => {
  await start(); const before = position();
  viewport.height = 844; draw(); assert.equal(position(), before);
});
test('a new step does not re-anchor its card to the scrolled viewport', async () => {
  await start(); const before = position();
  window.scrollY = 480; now += 4.1; draw();
  assert.equal(el.tour.state.i, 1); assert.equal(position(), before);
});
test('keep-clear collisions stay in the same coordinate system across steps', async () => {
  viewport.height = 844;
  await start({ keepClear: true }); const before = position();
  window.scrollY = 900; now += 4.1; draw(); assert.equal(position(), before);
});
test('starting while the page is scrolled uses the same document anchor', async () => {
  await start({ keepClear: true }); const before = position();
  ctl.stop(); paint = null;
  window.scrollY = 480; await start({ keepClear: true }); assert.equal(position(), before);
});
test('a real globe resize refreshes placement during a step', async () => {
  await start(); const before = position();
  viewport.width = 844; viewport.height = 390;
  rect = { left: 350, top: 0, width: 600, height: 600 };
  disc = { ...disc, x: 300, y: 300, cx: 300, cy: 300, r: 280 };
  draw();
  const numbers = position().match(/-?\d+(?:\.\d+)?(?=px)/g).map(Number);
  assert.notEqual(position(), before);
  assert.ok(rect.left + numbers[0] + 100 <= viewport.width - 8, 'card fits the new page width');
  assert.ok(numbers[1] >= 30 && numbers[1] <= rect.height - 30, 'card fits the resized globe');
});
test('height-only page reflow cannot change the next step anchor on the globe', async () => {
  await start({ keepClear: true }); const before = position();
  viewport.height = 844;
  // A vh-based ancestor moves the entire composition as the viewport changes.
  rect.top += 22; clearRect.top += 22;
  window.scrollY = 480; now += 4.1; draw();
  assert.equal(position(), before);
});
test('the voyage can re-survey while scrolling without moving its fixed card', async () => {
  await start({ keepClear: true, steps: [{ kind: 'voyage', text: 'Voyage', cities: [], arcsAfter: 100 }] });
  const before = position();
  window.scrollY = 900; now += 1; draw();
  assert.equal(el.tour.state.subject.kind, 'voyage');
  assert.equal(position(), before);
});
test('explicit composition bounds work when the globe starts below the fold', async () => {
  rect.top = 700; clearRect.top = 910; viewport.height = 390;
  const section = document.createElement('header');
  section.getBoundingClientRect = () => bounds({ left: 0, top: 74, width: 390, height: 1200 });
  await start({ bounds: section, keepClear: true });
  const y = Number(position().match(/, ([-\d.]+)px/)[1]);
  assert.ok(y >= 0 && y < rect.height, 'title stays on the globe, not above it to reach the viewport');
  assert.ok(rect.top + y + 20 <= clearRect.top - 10, 'title clears the band');
  const before = position();
  window.scrollY = 720; now += 4.1; draw();
  assert.equal(position(), before);
});
