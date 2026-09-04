// The arcs' life, once. On the hero globe an arc between two places is added
// empty, draws itself out from one end with a cubic ease, rides the globe, and
// erases from its tail when an end goes over the horizon; a new one leaves
// every second and a half and at most three are in the air. The tour in
// ./hero-tour.js reads its voyage from these numbers, and the flat map on the
// landing page flies the same arcs through `flights()` below, so the two
// cannot drift apart: change a number here and both maps change.

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const ease = (t) => 1 - (1 - clamp01(t)) ** 3;   // cubic out: fast away, soft arrival

// The links layer both maps draw on.
export const LAYER = { fade: true, width: 1.6 };

// A voyage arc, as the hero globe draws it.
export const VOYAGE = {
  height: 0.1,   // the bow, as a fraction of the chord
  tip: 2.5,      // the dot at the head, in CSS pixels
  width: 1.5,
  draw: 1,       // seconds for the head to reach the far end
  erase: 0.9,    // seconds for the tail to catch up once it starts
  every: 1.5,    // seconds between departures
  atOnce: 3      // arcs in the air at most
};

// What the layer is told to draw: the part of the arc between the tail and
// the head, or nothing at all once they have crossed.
export const arcRange = (tail, head) => (tail < head ? [ tail, head ] : [ 0, 0 ]);

// The voyage on a map with no horizon. A flat map never hides an end, so an
// arc rides for `ride` seconds after it has drawn and then erases the way the
// globe's do. `places` are the names the pairs are drawn from, two at a time,
// never one already in use, and only pairs `ok(a, b)` allows when given (a
// flat map has a seam, and an arc that leaves one edge to come back on the
// other looks like it came from nowhere); `layer` is a mappo/links layer. Returns a stepper
// for whoever owns the frame loop, plus `settle()` for a page that asks for
// no motion: three arcs, whole, and no loop at all.
export function flights(layer, { places, ok = () => true, ride = 1.6, ...arc } = {}) {
  const A = { ...VOYAGE, ...arc };
  const live = [];
  let next = 0;
  const pick = () => {
    const inUse = new Set(live.flatMap((a) => [ a.from, a.to ]));
    const free = places.filter((p) => !inUse.has(p));
    const pairs = [];
    for (let i = 0; i < free.length; i++) for (let j = 0; j < free.length; j++) if (i !== j && ok(free[i], free[j])) pairs.push([ free[i], free[j] ]);
    return pairs.length ? pairs[Math.floor(Math.random() * pairs.length)] : null;
  };
  const add = (from, to) => layer.add({ from, to, height: A.height, range: [ 0, 0 ], tip: A.tip, width: A.width });
  return {
    step(now, dt) {
      next -= dt;
      if (next <= 0 && live.length < A.atOnce) {
        next = A.every;
        const pair = pick();
        if (pair) live.push({ from: pair[0], to: pair[1], t0: now, tail: 0, link: add(pair[0], pair[1]) });
      }
      for (const a of [ ...live ]) {
        const age = (now - a.t0) / 1000;
        const head = ease(age / A.draw);
        if (age > A.draw + ride) a.tail = Math.min(1, a.tail + dt / A.erase);
        a.link.range = arcRange(a.tail, head);
        if (a.tail >= 1) { layer.remove(a.link); live.splice(live.indexOf(a), 1); }
      }
    },
    settle() {
      for (let k = 0; k < A.atOnce; k++) {
        const pair = pick();
        if (!pair) break;
        const link = add(pair[0], pair[1]);
        link.range = [ 0, 1 ];
        live.push({ from: pair[0], to: pair[1], t0: 0, tail: 0, link });
      }
      layer.redraw();
    }
  };
}
