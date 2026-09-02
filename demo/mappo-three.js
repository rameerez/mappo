// mappo ↔ three.js — the adapter this demo needed, proposed as library surface.
//
// People will put mappo next to three.js constantly: mappo is very good at
// drawing a world and completely unable to put a camera on it. The two halves
// fit together at exactly three places, and all three are currently the
// consumer's problem to solve. They should not be.
//
//   1. A map as a TEXTURE.        mappo draws a flat map; three.js wants an
//                                 equirectangular image to wrap on a sphere.
//   2. A shared PROJECTION.       mappo answers in 0…1 (projectNormalized) and
//                                 in screen pixels (locate). Neither is a point
//                                 in 3D space, which is what a scene needs.
//   3. The seam BETWEEN them.     three.js SphereGeometry's UVs and mappo's
//                                 lon/lat have to be made to agree, once, in a
//                                 place that is not every consumer's own code.
//
// Nothing here imports three.js. THREE is passed in, so mappo would keep its
// zero dependencies if this shipped: an adapter that forces the dependency it
// adapts is not an adapter.
//
// ── THE BUG THIS EXISTS BECAUSE OF ─────────────────────────────────────────
// mappo's SVG is not self-contained. Fills and strokes come from CSS classes
// in a document stylesheet, so the moment the markup leaves the document —
// serialised, rasterised, saved, sent to a worker, rendered server-side — every
// shape falls back to black. That is not only a texture problem: it is why you
// cannot currently export a mappo map as an image at all.
//
// standaloneSvg() below is the workaround, and the shape of the fix: mappo
// should be able to hand you markup that survives leaving the page.

// Everything that decides what a shape looks like. Copied from the computed
// style, so whatever the stylesheet says travels with the markup.
const PAINT = [
  "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linejoin", "stroke-linecap",
  "stroke-dasharray", "opacity", "visibility", "display", "paint-order", "mix-blend-mode"
];

// A clone of a live SVG that still looks like itself once it is on its own.
export function standaloneSvg(svg, { width, height } = {}) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (width) clone.setAttribute("width", width);
  if (height) clone.setAttribute("height", height);

  // Walk both trees together: cloneNode preserves order, so the nth node of one
  // is the nth of the other, and the live one is the only one with a computed
  // style worth reading.
  const live = [ svg, ...svg.querySelectorAll("*") ];
  const copy = [ clone, ...clone.querySelectorAll("*") ];
  for (let i = 0; i < live.length && i < copy.length; i++) {
    const cs = getComputedStyle(live[i]);
    let css = "";
    for (const prop of PAINT) {
      const v = cs.getPropertyValue(prop);
      if (v && v !== "normal" && v !== "auto") css += `${prop}:${v};`;
    }
    if (css) copy[i].setAttribute("style", css + (copy[i].getAttribute("style") || ""));
  }
  return clone;
}

// A mappo map as an image, at whatever resolution you ask for — the map is
// vector, so this is a real re-render rather than an upscale.
export async function equirectCanvas(el, { width = 4096, background = null } = {}) {
  const svg = el.querySelector("svg");
  if (!svg) throw new Error("mappo-three: no <svg> yet — await customElements.whenDefined and a frame");
  const height = Math.round(width / 2);
  const markup = new XMLSerializer()
    .serializeToString(standaloneSvg(svg, { width, height }));

  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  await img.decode();

  const cv = document.createElement("canvas");
  cv.width = width; cv.height = height;
  const g = cv.getContext("2d");
  if (background) { g.fillStyle = background; g.fillRect(0, 0, width, height); }
  g.drawImage(img, 0, 0, width, height);
  return cv;
}

// The same, as a texture. THREE is a parameter, not an import.
export async function equirectTexture(THREE, el, opts = {}) {
  const canvas = await equirectCanvas(el, opts);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  return tex;
}

// ── the projection, in three dimensions ─────────────────────────────────────
// mappo has projectNormalized for "where is this in the box" and locate for
// "where is this on screen". This is the third one a 3D scene needs, and the
// convention below is the one makeGlobe orients its sphere to match: +Y is the
// spin axis, longitude 0 faces +X, longitude grows eastward.
export function latLonToVector3(THREE, lat, lon, radius = 1) {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  return new THREE.Vector3(
    radius * Math.cos(p) * Math.cos(l),
    radius * Math.sin(p),
    -radius * Math.cos(p) * Math.sin(l)
  );
}

// And back again, so a raycast hit can be asked "what did I click on".
export function vector3ToLatLon(v) {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  return {
    lat: Math.asin(v.y / r) * 180 / Math.PI,
    lon: Math.atan2(-v.z, v.x) * 180 / Math.PI,
    altitude: r
  };
}

// ── the whole thing, assembled ──────────────────────────────────────────────
// A sphere wearing a mappo map, already turned so latLonToVector3 lands where
// the texture says it should. Getting that half-turn wrong is the single most
// likely way to spend an afternoon, so it is not left to the caller.
export async function makeGlobe(THREE, {
  element, radius = 1, segments = 128, textureWidth = 4096,
  background = null, material = null
} = {}) {
  const geometry = new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.75));
  const mat = material ?? new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(geometry, mat);
  // SphereGeometry runs u from +X round through +Z; latLonToVector3 puts lon 0
  // on +X and grows eastward toward -Z. One half turn reconciles them.
  mesh.rotation.y = -Math.PI / 2;

  if (element) {
    try {
      mat.map = await equirectTexture(THREE, element, { width: textureWidth, background });
      mat.needsUpdate = true;
    } catch (e) {
      console.warn("[mappo-three] texture unavailable; globe will render untextured", e);
    }
  }
  return mesh;
}

// Stand an object on the surface, pointing along the local vertical. The single
// most common thing anyone wants to do with a model and a globe, and four lines
// of quaternion nobody should have to rediscover.
export function standOn(THREE, object, { lat, lon, radius, altitude = 0, lean = 0, spin = 0 }) {
  const up = latLonToVector3(THREE, lat, lon, 1);
  object.position.copy(up).multiplyScalar(radius + altitude);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
  if (spin) object.rotateZ(spin);
  if (lean) {
    const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    object.rotateOnWorldAxis(east, lean);
  }
  return object;
}
