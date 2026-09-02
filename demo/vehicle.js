// Starship and Super Heavy, built from published dimensions rather than
// downloaded.
//
// Every Starship model on CGTrader, TurboSquid and Sketchfab is commercial or
// unclear-licensed, none is from SpaceX or NASA, and importing one would put a
// binary of unknown provenance and a glTF loader into a zero-dependency MIT
// repo — to draw a shape that is a cylinder, a cone and eight flat panels.
// The dimensions are public and exact, so the geometry is generated:
//
//   stacked        121 m          Super Heavy    71 m
//   Starship        50 m          diameter        9 m  (both stages)
//   booster        33 Raptor 2    ship           3 Raptor + 3 Raptor Vacuum
//
// Local frame: +Z along the vehicle's long axis, origin at the engine bells.

import { mesh, addRevolution, addQuad } from "./scene3d.js";

export const DIM = {
  stacked: 121, booster: 71, ship: 50, radius: 4.5,
  noseLength: 13,          // where the ship's cylinder gives way to the nose
  towerHeight: 146,        // the catch tower, "Mechazilla"
  engines: { booster: 33, shipSea: 3, shipVac: 3 }
};

const STEEL = "#b9c0ca";        // bare 304L, which is what the vehicle is
const STEEL_DARK = "#8b929d";
const TILE = "#26292f";         // the windward heat shield
const ENGINE = "#5a6068";
const TOWER = "#6f7783";

// Black down one side and steel down the other, split at the segment level so
// the tiles curve around the hull the way they actually do.
const heatshield = (s, i, segments) => {
  const a = (s + 0.5) / segments * Math.PI * 2;
  return Math.cos(a) > 0.12 ? TILE : STEEL;
};

// ── Super Heavy ─────────────────────────────────────────────────────────────
export function superHeavy({ segments = 20, gridFins = true } = {}) {
  const m = mesh();
  const R = DIM.radius;
  addRevolution(m, [
    [ R * 0.86, 0 ], [ R, 3.5 ],          // the engine skirt tapers in
    [ R, DIM.booster - 2 ], [ R * 0.99, DIM.booster ]
  ], segments, (s, i) => i === 0 ? ENGINE : STEEL, { closeBottom: true });

  // Four grid fins, near the top, folded flat against the hull.
  if (gridFins) {
    const z = DIM.booster - 9;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const tx = -sa, ty = ca;              // tangent, so the fin lies along the hull
      const o = [ ca * R * 0.99, sa * R * 0.99, z ];
      addQuad(m,
        [ o[0] - tx * 1.8, o[1] - ty * 1.8, o[2] - 2.6 ],
        [ o[0] + tx * 1.8, o[1] + ty * 1.8, o[2] - 2.6 ],
        [ o[0] + tx * 1.8 + ca * 3.4, o[1] + ty * 1.8 + sa * 3.4, o[2] + 1.6 ],
        [ o[0] - tx * 1.8 + ca * 3.4, o[1] - ty * 1.8 + sa * 3.4, o[2] + 1.6 ],
        STEEL_DARK);
    }
  }
  return m;
}

// ── Starship ────────────────────────────────────────────────────────────────
export function starship({ segments = 20, flaps = true } = {}) {
  const m = mesh();
  const R = DIM.radius;
  const cyl = DIM.ship - DIM.noseLength;
  addRevolution(m, [
    [ R * 0.9, 0 ], [ R, 2.5 ],
    [ R, cyl ],
    [ R * 0.86, cyl + 4 ], [ R * 0.58, cyl + 8.5 ], [ R * 0.22, cyl + 11.5 ], [ 0, DIM.ship ]
  ], segments, (s, i) => i === 0 ? ENGINE : heatshield(s, i, segments), { closeBottom: true });

  if (flaps) {
    // Two forward, two aft, on the windward side — the flaps that fly the
    // belly-first descent at both planets.
    const flap = (z, span, chord, sweep) => {
      for (const sign of [ -1, 1 ]) {
        const a = sign * 0.62 * Math.PI;         // to either side of the tiled face
        const ca = Math.cos(a), sa = Math.sin(a);
        const o = [ ca * R * 0.98, sa * R * 0.98, z ];
        addQuad(m,
          [ o[0], o[1], o[2] ],
          [ o[0], o[1], o[2] + chord ],
          [ o[0] + ca * span, o[1] + sa * span, o[2] + chord - sweep ],
          [ o[0] + ca * span, o[1] + sa * span, o[2] + sweep * 0.4 ],
          TILE);
      }
    };
    flap(cyl - 1.5, 5.5, 7.5, 2.2);              // forward
    flap(3.5, 6.5, 10.5, 3.0);                   // aft, larger
  }
  return m;
}

// The full stack, ship sitting on the booster with the hot-stage ring between.
export function stack(opts = {}) {
  const b = superHeavy(opts);
  const s = starship(opts);
  const lift = DIM.booster + 2;
  return {
    verts: [ ...b.verts, ...s.verts.map((v) => [ v[0], v[1], v[2] + lift ]) ],
    faces: [ ...b.faces, ...s.faces.map((f) => ({ ...f, i: f.i.map((k) => k + b.verts.length) })) ]
  };
}

// ── the tower ───────────────────────────────────────────────────────────────
// Mechazilla: the thing the booster comes back to. Drawn as a lattice column
// and two arms, because that silhouette is the entire point of the catch.
export function tower({ armsOpen = 0.5 } = {}) {
  const m = mesh();
  const w = 6, h = DIM.towerHeight;
  for (const [ dx, dy ] of [ [ -w, -w ], [ w, -w ], [ w, w ], [ -w, w ] ]) {
    addRevolution(place2(m), [], 0, TOWER);      // no-op keeps the shape of the call site
    addQuad(m, [ dx, dy, 0 ], [ dx * 0.92, dy * 0.92, h ],
      [ dx * 0.92 + 1.1, dy * 0.92 + 1.1, h ], [ dx + 1.1, dy + 1.1, 0 ], TOWER);
  }
  // Cross-bracing, so it reads as a lattice rather than a slab.
  for (let z = 8; z < h; z += 14) {
    addQuad(m, [ -w, -w, z ], [ w, -w, z ], [ w, -w, z + 0.9 ], [ -w, -w, z + 0.9 ], "#5c636e");
    addQuad(m, [ -w, w, z ], [ w, w, z ], [ w, w, z + 0.9 ], [ -w, w, z + 0.9 ], "#5c636e");
  }
  // The chopsticks. armsOpen 0 is closed on the booster, 1 is wide.
  const az = h - 26, reach = 26, gap = 5 + armsOpen * 16;
  for (const sign of [ -1, 1 ]) {
    addQuad(m,
      [ w, sign * gap, az ], [ w + reach, sign * (gap + 2), az ],
      [ w + reach, sign * (gap + 2), az + 3 ], [ w, sign * gap, az + 3 ], "#8790a0");
  }
  return m;
}
const place2 = (m) => m;   // addRevolution with an empty profile adds nothing

export const COLORS = { STEEL, STEEL_DARK, TILE, ENGINE, TOWER };
