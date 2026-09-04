// Vector outlines across the seam — the opt-in module mappo/vector.
//
// Every body's rings are stored cut at ±180° with closure edges along the cut,
// because that is what a cylindrical map centred on 0° needs. Nothing else
// needs it: a polar map has no seam there, and a map centred on 150° has its
// seam somewhere else. So rings are STITCHED back into whole rings once per
// body (the cut edges removed, the halves joined across ±180), and then cut
// again per projection — at the projection's own seam for cylindrical
// projections, not at all for azimuthal ones. Fills get closed pieces; the
// edge stroke gets the open arcs, so no seam is ever stroked.
//
// This is a module of its own because the default map never runs it: dots
// sample the body's mask, and grid contours are traced in screen space. Only
// figure-source="vector" and borders need rings, and Earth's rings are a
// third of the package by themselves (mappo/bodies/earth-vector). The
// renderers ask figure.js whether the feature is registered and draw grid
// contours until it is.

import { unwrap, meanLat } from "./projections.js";

const onSeam = (v) => Math.abs(Math.abs(v[1]) - 180) < 1e-9;
const closeRing = (pts) => [ ...pts, [ pts[0][0], pts[0][1] ] ];
const STITCHED = new WeakMap();

// Undo the cut every pack makes at ±180°: remove the closure edges that run
// along the seam and join the halves back into whole rings. A ring that never
// touches the seam passes through unchanged. Memoised on the rings array, which
// a body memoises in turn, so this runs once per body per page.
export function stitchRings(rings) {
  const cached = STITCHED.get(rings);
  if (cached) return cached;

  const out = [];
  const arcs = [];   // open arcs, seam vertex to seam vertex, with the ring they came from
  rings.forEach((ring0, source) => {
    let ring = ring0;
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
    if (ring.length < 3) return;
    const n = ring.length;
    const seamEdge = (i) => onSeam(ring[i]) && onSeam(ring[(i + 1) % n]);
    let firstSeamEdge = -1;
    for (let i = 0; i < n; i++) if (seamEdge(i)) { firstSeamEdge = i; break; }
    if (firstSeamEdge < 0) { out.push(closeRing(ring)); return; }
    // Start just after a seam edge and collect arcs between seam edges.
    let arc = [];
    for (let k = 0; k < n; k++) {
      const i = (firstSeamEdge + 1 + k) % n;
      arc.push(ring[i]);
      if (seamEdge(i)) {
        if (arc.length >= 2) arcs.push({ pts: arc, source });
        arc = [];
      }
    }
  });

  // Chain arcs across the seam: an arc leaving at (lat, +180) continues with
  // the arc arriving at (lat, −180), and vice versa. The two latitudes need not
  // be identical: a boundary that crosses the seam obliquely meets the raster's
  // last column and its first column a few rows apart (Vastitas Borealis: 1/8°;
  // a lunar mare: 0.7°), so the join is the nearest candidate on the other side
  // within a degree, and when the two vertices differ the crossing edge between
  // them is kept — the cut step interpolates the seam crossing on it.
  const TOL = 1;
  const used = new Set();
  const failed = new Set();   // source rings whose arcs could not all be matched
  const successes = [];
  for (const first of arcs) {
    if (used.has(first)) continue;
    const chain = [ ...first.pts ];
    const members = [ first ];
    used.add(first);
    let cur = first;
    let closed = false;
    for (let guard = 0; guard <= arcs.length; guard++) {
      const end = cur.pts[cur.pts.length - 1];
      const endSide = Math.sign(end[1]);
      const start = first.pts[0];
      const closeGap = Math.sign(start[1]) === -endSide ? Math.abs(end[0] - start[0]) : Infinity;
      let next = null, gap = TOL;
      for (const a of arcs) {
        if (used.has(a) || Math.sign(a.pts[0][1]) !== -endSide) continue;
        const d = Math.abs(a.pts[0][0] - end[0]);
        if (d < gap) { gap = d; next = a; }
      }
      if (closeGap < TOL && closeGap <= gap) { closed = true; break; }
      if (!next) break;
      used.add(next);
      members.push(next);
      chain.push(...(Math.abs(next.pts[0][0] - end[0]) < 1e-9 ? next.pts.slice(1) : next.pts));
      cur = next;
    }
    if (closed) successes.push({ ring: closeRing(chain), members });
    else for (const m of members) failed.add(m.source);
  }
  // Stitching is transactional at SOURCE-ring level. A source may contain
  // several arcs; if any one cannot be paired, no successful chain containing
  // another of its arcs may also be emitted beside the untouched original.
  // Propagate that invalidation through chains before deciding what survives.
  let invalidated = true;
  while (invalidated) {
    invalidated = false;
    for (const success of successes) {
      if (!success.members.some((m) => failed.has(m.source))) continue;
      for (const m of success.members) {
        if (!failed.has(m.source)) { failed.add(m.source); invalidated = true; }
      }
    }
  }
  for (const success of successes) {
    if (!success.members.some((m) => failed.has(m.source))) out.push(success.ring);
  }
  // Anything that would not stitch is drawn as the pack stored it.
  for (const source of failed) out.push(rings[source]);

  STITCHED.set(rings, out);
  return out;
}

// Cut one unwrapped ring at the seam of a cylindrical projection (λ' = ±180 and
// its 360° repeats). Returns pieces with shifted longitudes inside [−180, 180],
// each tagged with how it must be closed.
function cutAtSeam({ seq, total }) {
  const band = (lon) => Math.floor((lon + 180) / 360);
  const pieces = [];
  let piece = [ seq[0] ];
  for (let i = 0; i < seq.length; i++) {
    let a = seq[i];
    const b = i + 1 < seq.length ? seq[i + 1] : [ seq[0][0], seq[0][1] + total ];
    let ba = band(a[1]);
    const bb = band(b[1]);
    while (ba !== bb) {
      const dir = bb > ba ? 1 : -1;
      const boundary = dir > 0 ? 180 + 360 * ba : -180 + 360 * ba;
      const t = (boundary - a[1]) / (b[1] - a[1]);
      const cross = [ a[0] + t * (b[0] - a[0]), boundary ];
      piece.push(cross);
      pieces.push(piece);
      piece = [ cross ];
      a = cross;
      ba += dir;
    }
    if (i + 1 < seq.length) piece.push(b);
  }
  if (pieces.length === 0) return [ { pts: normalizePiece(piece), closure: "ring" } ];
  // The last piece runs on to the first vertex — one full turn further round
  // for a ring that winds a pole. Lifted by the ring's total swing, the first
  // piece continues it exactly, so the two are one piece in one band.
  pieces[0] = [ ...piece, ...pieces[0].slice(1).map(([ lat, lon ]) => [ lat, lon + total ]) ];
  return pieces.map((pts) => {
    const norm = normalizePiece(pts);
    const startSide = Math.sign(norm[0][1]), endSide = Math.sign(norm[norm.length - 1][1]);
    return { pts: norm, closure: startSide === endSide ? "seam" : "pole" };
  });
}

// A piece lies within one 360° band; put it into [−180, 180] by its midpoint,
// and drop the repeated vertices a cut exactly on a vertex leaves behind.
function normalizePiece(pts) {
  const lons = pts.map((p) => p[1]);
  const mid = (Math.min(...lons) + Math.max(...lons)) / 2;
  const k = Math.round(mid / 360);
  const out = [];
  for (const [ lat, lon ] of pts) {
    const v = [ lat, lon - 360 * k ];
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - v[0]) > 1e-12 || Math.abs(last[1] - v[1]) > 1e-12) out.push(v);
  }
  return out;
}

// Interior points along one side of a cylindrical frame. Equal Earth and
// sinusoidal seams are curves, so closing a fill with SVG's one straight Z
// segment cuts a shallow false chord through the map edge. A two-degree
// latitude step is finer than the stored vector geometry and follows the
// projection's real boundary; the stroke remains the open geographic arc.
function seamClosure(last, first) {
  const count = Math.ceil(Math.abs(first[0] - last[0]) / 2);
  const points = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    points.push([ last[0] + t * (first[0] - last[0]), last[1] ]);
  }
  return points;
}

// Rings of [lat, lon] → what the flat renderer draws, in unit-frame
// coordinates: `fill` pieces (closed; `complement` marks a ring whose interior
// contains the far pole of an azimuthal map and must be filled outside-in) and
// `edge` arcs (open, never along a seam). `complete` is false when the
// projection could not place every vertex; the renderer then falls back to
// grid contours rather than joining survivors with a false chord.
export function projectRings(rings, projection) {
  if (typeof projection.projectRings === "function") return projection.projectRings(rings);
  const fill = [], edge = [];
  let complete = true;
  const toFrame = (pts) => {
    const frame = [];
    for (const [ lat, lonS ] of pts) {
      const p = projection.forwardShifted(lat, lonS);
      if (!p) { complete = false; return null; }
      frame.push([ p.x, p.y ]);
    }
    return frame;
  };

  for (const ring of rings) {
    if (ring.length < 4) continue;
    if (projection.kind === "custom") {
      const pts = [];
      for (const [ lat, lon ] of ring) {
        const p = projection.forward(lat, lon);
        if (!p) { complete = false; break; }
        pts.push([ p.x, p.y ]);
      }
      if (pts.length === ring.length && pts.length >= 3) { fill.push({ points: pts, complement: false }); edge.push(pts); }
      continue;
    }
    const unwrapped = unwrap(ring, projection.shift);
    if (projection.kind === "azimuthal") {
      const pts = toFrame(unwrapped.seq);
      if (!pts) continue;
      const enclosedPole = unwrapped.winding !== 0 ? (meanLat(unwrapped.seq) >= 0 ? 90 : -90) : null;
      fill.push({ points: pts, complement: enclosedPole !== null && enclosedPole === projection.farPole });
      edge.push([ ...pts, pts[0] ]);
      continue;
    }
    for (const { pts, closure } of cutAtSeam(unwrapped)) {
      const frame = toFrame(pts);
      if (!frame) continue;
      if (closure === "ring") {
        fill.push({ points: frame, complement: false });
        edge.push([ ...frame, frame[0] ]);
      } else {
        edge.push(frame);
        if (closure === "pole") {
          // Up the seam to the pole, along the pole, back down the other seam.
          // The two seam legs run along the frame's own edge, which Equal
          // Earth bends, so they take the same latitude steps the seam closure
          // does rather than one chord each: a chord from 45° to the pole cut
          // a straight false edge across the whole top corner of Mars.
          const pole = meanLat(pts) >= 0 ? 90 : -90;
          const last = pts[pts.length - 1], first = pts[0];
          const up = [ pole, last[1] ], down = [ pole, first[1] ];
          const closureFrame = toFrame([ ...seamClosure(last, up), up, down, ...seamClosure(down, first) ]);
          if (closureFrame) fill.push({ points: [ ...frame, ...closureFrame ], complement: false });
        } else {
          const boundary = toFrame(seamClosure(pts[pts.length - 1], pts[0]));
          if (boundary) fill.push({ points: [ ...frame, ...boundary ], complement: false });
        }
      }
    }
  }
  return { fill, edge, complete };
}
