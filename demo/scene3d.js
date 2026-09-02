// A very small 3D renderer on a 2D canvas — enough for a mission, not a frame
// more. No WebGL and no dependencies: the scene is a few thousand triangles at
// its worst, painter's algorithm sorts them, and the whole thing is easier to
// reason about than a shader would be.
//
// Units are kilometres throughout, from a 9 m rocket to a 1.5 AU transfer, so
// the camera carries the dynamic range rather than the geometry: nothing is
// ever pre-scaled, the camera just gets closer or further away.

const sub = (a, b) => [ a[0] - b[0], a[1] - b[1], a[2] - b[2] ];
const add = (a, b) => [ a[0] + b[0], a[1] + b[1], a[2] + b[2] ];
const mul = (a, s) => [ a[0] * s, a[1] * s, a[2] * s ];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] ];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [ a[0] / l, a[1] / l, a[2] / l ]; };
export { sub, add, mul, dot, cross, len, norm };

// A camera orbiting a target: azimuth and elevation around it, at a distance.
// Everything on this page is "look at that thing from here", so that is the
// only kind of camera there is.
export function createCamera() {
  return {
    target: [ 0, 0, 0 ], distance: 1000, az: 0.6, el: 0.35, fov: 45,
    eye() {
      const ce = Math.cos(this.el);
      return add(this.target, [
        this.distance * ce * Math.cos(this.az),
        this.distance * ce * Math.sin(this.az),
        this.distance * Math.sin(this.el)
      ]);
    },
    // The view basis, rebuilt per frame. Z of the world is "up" — the ecliptic
    // north pole — which keeps the solar system flat on screen by default.
    basis() {
      const eye = this.eye();
      const fwd = norm(sub(this.target, eye));
      let up = [ 0, 0, 1 ];
      if (Math.abs(dot(fwd, up)) > 0.999) up = [ 0, 1, 0 ];
      const right = norm(cross(fwd, up));
      return { eye, fwd, right, up: cross(right, fwd) };
    }
  };
}

// Project world → screen. Returns null behind the camera, so callers can drop
// a segment rather than draw it wrapped around the back of the viewer.
//
// cx/cy default to the middle of the canvas but do not have to be: a HUD with
// a panel down one side has a smaller clear area than it has pixels, and the
// scene should be centred in what can actually be seen. Mars spent its first
// render behind the telemetry.
export function projector(cam, w, h, cx = w / 2, cy = h / 2) {
  const { eye, fwd, right, up } = cam.basis();
  const f = (h / 2) / Math.tan((cam.fov * Math.PI / 180) / 2);
  return (p) => {
    const d = sub(p, eye);
    const z = dot(d, fwd);
    if (z <= 1e-9) return null;
    return {
      x: cx + f * dot(d, right) / z,
      y: cy - f * dot(d, up) / z,
      z,
      // How many pixels one kilometre covers at that depth — the number every
      // "is this worth drawing" decision is made from.
      scale: f / z
    };
  };
}

// ── meshes ──────────────────────────────────────────────────────────────────
// A mesh is { verts, faces }, faces carrying their own colour. Built in local
// coordinates and placed with a transform, because the same Starship appears
// at Boca Chica, in orbit, and at Mars.

export const mesh = () => ({ verts: [], faces: [] });

export function addRevolution(m, profile, segments, color, opts = {}) {
  const { closeTop = false, closeBottom = false } = opts;
  const base = m.verts.length;
  for (let i = 0; i < profile.length; i++) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      m.verts.push([ profile[i][0] * Math.cos(a), profile[i][0] * Math.sin(a), profile[i][1] ]);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      // colour may be a function of (segment, ring) — the heat shield is black
      // down one side of the same cylinder, not a separate part.
      m.faces.push({ i: [ base + i * segments + s, base + i * segments + s2,
        base + (i + 1) * segments + s2, base + (i + 1) * segments + s ],
        color: typeof color === "function" ? color(s, i, segments) : color });
    }
  }
  // The caps need the colour RESOLVED too. Leaving them holding the function
  // itself only fails once the camera comes round far enough to stop culling
  // them — which is to say in a later phase, long after it looked fine.
  const flat = (ring) => typeof color === "function" ? color(0, ring, segments) : color;
  if (closeBottom) m.faces.push({ i: Array.from({ length: segments }, (_, s) => base + s), color: flat(0) });
  if (closeTop) {
    const top = base + (profile.length - 1) * segments;
    m.faces.push({ i: Array.from({ length: segments }, (_, s) => top + segments - 1 - s),
      color: flat(profile.length - 1) });
  }
  return m;
}

// A flat panel: flaps, grid fins, chopstick arms. Four corners, one colour.
export function addQuad(m, a, b, c, d, color) {
  const base = m.verts.length;
  m.verts.push(a, b, c, d);
  m.faces.push({ i: [ base, base + 1, base + 2, base + 3 ], color });
  return m;
}

// Rotate about Z (the vehicle's long axis), then place. Enough for a rocket:
// it points somewhere and it is somewhere.
export function place(m, { origin = [ 0, 0, 0 ], axis = [ 0, 0, 1 ], roll = 0, scale = 1 } = {}) {
  const z = norm(axis);
  let ref = Math.abs(z[2]) > 0.9 ? [ 1, 0, 0 ] : [ 0, 0, 1 ];
  const x0 = norm(cross(ref, z)), y0 = cross(z, x0);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x = add(mul(x0, cr), mul(y0, sr));
  const y = add(mul(y0, cr), mul(x0, -sr));
  return {
    verts: m.verts.map((v) => add(origin, add(add(mul(x, v[0] * scale), mul(y, v[1] * scale)), mul(z, v[2] * scale)))),
    faces: m.faces
  };
}

// Painter's algorithm with back-face culling. Correct enough for convex-ish
// hardware seen from outside, which is what a rocket is, and it costs nothing.
export function drawMesh(ctx, m, project, { light = norm([ 1, 0.4, 0.6 ]), ambient = 0.28 } = {}) {
  const pts = m.verts.map(project);
  const out = [];
  for (const face of m.faces) {
    const p = face.i.map((k) => pts[k]);
    if (p.some((q) => !q)) continue;
    // Screen-space winding: positive area is a face turned toward us.
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      area += p[i].x * q.y - q.x * p[i].y;
    }
    if (area <= 0) continue;
    const v = face.i.map((k) => m.verts[k]);
    const n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
    const lit = ambient + (1 - ambient) * Math.max(0, dot(n, light));
    out.push({ p, z: p.reduce((s, q) => s + q.z, 0) / p.length, lit, color: face.color });
  }
  out.sort((a, b) => b.z - a.z);
  for (const f of out) {
    ctx.beginPath();
    ctx.moveTo(f.p[0].x, f.p[0].y);
    for (let i = 1; i < f.p.length; i++) ctx.lineTo(f.p[i].x, f.p[i].y);
    ctx.closePath();
    ctx.fillStyle = shade(f.color, f.lit);
    ctx.fill();
  }
  return out.length;
}

// #rrggbb at a brightness. Cheap, and the only colour maths this needs.
export function shade(hex, k) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return "#ff00ff";      // loud, but still a frame
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// ── bodies ──────────────────────────────────────────────────────────────────
// A planet is a disc with a terminator, not a sphere mesh: at every scale this
// page uses it is either a few pixels across or filling the frame, and in both
// cases a shaded circle is indistinguishable from geometry and far cheaper.
export function drawBody(ctx, project, { center, radiusKm, color, night = "#0a0f18", sunDir, ring }) {
  const c = project(center);
  if (!c) return null;
  const r = radiusKm * c.scale;
  if (r < 0.4) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(0.7, r), 0, Math.PI * 2); ctx.fill();
    return { ...c, r };
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
  if (sunDir) {
    // The lit side, as a gradient across the disc in the Sun's screen
    // direction. A terminator drawn as a hard ellipse reads as a bug at these
    // sizes; a gradient reads as a planet.
    const s = project(add(center, mul(sunDir, radiusKm * 4)));
    if (s) {
      const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy) || 1;
      const g = ctx.createLinearGradient(c.x + (dx / d) * r, c.y + (dy / d) * r,
        c.x - (dx / d) * r * 1.05, c.y - (dy / d) * r * 1.05);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.52, "rgba(0,0,0,0.12)");
      g.addColorStop(0.62, night + "cc");
      g.addColorStop(1, night);
      ctx.fillStyle = g;
      ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
    }
  }
  ctx.restore();
  if (ring) {
    ctx.strokeStyle = ring; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
  }
  return { ...c, r };
}

// A polyline in space, dropped where it goes behind the camera.
export function drawPath(ctx, project, points, { color, width = 1, dash = null, alpha = 1 }) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  let pen = false;
  for (const p of points) {
    const q = project(p);
    if (!q) { pen = false; continue; }
    if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
  }
  ctx.stroke();
  ctx.restore();
}
