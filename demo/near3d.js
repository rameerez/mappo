// The near-Earth phases, in real 3D.
//
// mappo's globe is an orthographic render on a flat canvas. It draws the Earth
// beautifully from outside and it cannot put a camera on the ground: rotating
// that canvas foreshortens a PICTURE of a sphere instead of looking along one,
// and a vehicle drawn over it is a sticker on a map however carefully it is
// rotated. Seeing a launch from just above the surface, at an angle, with the
// stack STANDING on that surface, needs a real perspective camera.
//
// So three.js does the camera and mappo does the cartography: a mappo flat map
// is rasterised and wrapped round the sphere as its texture. The coastlines you
// see are mappo's, drawn by the same code and the same pinned Natural Earth
// data as every other page here — they are just on a globe a camera can stand
// next to.

import * as THREE from "./vendor/three.module.min.js";
import { makeGlobe, latLonToVector3, standOn, equirectTexture } from "./mappo-three.js";

const RAD = Math.PI / 180;
export const R_EARTH = 6371;

// The three integration points all live in ./mappo-three.js now — the texture,
// the lat/lon → Vector3 convention, and standing something on the surface. They
// were written here first, then pulled out, because they are not specific to
// this page: anyone putting mappo next to three.js needs the same three things.
export const mappoTexture = (el, opts) => equirectTexture(THREE, el, opts);
export const latLonToVec = (lat, lon, radius = R_EARTH) => latLonToVector3(THREE, lat, lon, radius);

// A mesh from demo/gltf.js, as three.js geometry. Keeps the hand-rolled loader
// useful and avoids pulling in GLTFLoader and its dependencies.
export function toGeometry({ verts, faces }) {
  const pos = [], col = [];
  const c = new THREE.Color();
  for (const f of faces) {
    // Triangles only; the loader already dropped everything else.
    for (const i of [ 0, 1, 2 ]) {
      const v = verts[f.i[i]];
      pos.push(v[0], v[1], v[2]);
      c.set(f.color).convertSRGBToLinear();
      col.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// ── the scene ───────────────────────────────────────────────────────────────
export function createNearScene({ canvas, textureEl }) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true,
    // Earth is 6,371 units across and a flap is 0.006. Without a logarithmic
    // depth buffer the rocket z-fights with the planet it is standing on.
    logarithmicDepthBuffer: true
  });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 3e5);

  // The planet, from the adapter: mappo's map, wrapped, and already turned so
  // that latLonToVec lands where the texture says it should.
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R_EARTH, 128, 96),
    new THREE.MeshLambertMaterial({ color: 0x16324e })
  );
  earth.rotation.y = -Math.PI / 2;
  scene.add(earth);

  // A thin shell of atmosphere, lit from behind — the limb glow that tells you
  // you are looking along a surface rather than at a disc.
  const air = new THREE.Mesh(
    new THREE.SphereGeometry(R_EARTH * 1.018, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      uniforms: { tint: { value: new THREE.Color(0x5aa0ff) } },
      vertexShader: `varying vec3 vN; varying vec3 vP;
        void main(){ vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 tint; varying vec3 vN; varying vec3 vP;
        void main(){ float rim = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), 2.2);
          gl_FragColor = vec4(tint, rim * 0.85); }`
    })
  );
  scene.add(air);

  const sun = new THREE.DirectionalLight(0xfff2dd, 3.1);
  // Ambient stands in for the sky: without it the night side is a silhouette,
  // and a mission view where half the hardware is a hole is not readable.
  scene.add(sun, new THREE.AmbientLight(0x5b7ea8, 1.15));

  const vehicles = new THREE.Group();
  scene.add(vehicles);

  // Trails, rebuilt when the path changes rather than every frame.
  const mkLine = (color, width) => {
    const l = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, linewidth: width }));
    l.frustumCulled = false;
    scene.add(l);
    return l;
  };
  const shipTrail = mkLine(0xffd479, 2), boostTrail = mkLine(0x8fb7e8, 2);

  if (textureEl) {
    // background, because a mappo map is land on nothing — the ocean is the
    // element's CSS behind it, and CSS does not come along to a texture.
    equirectTexture(THREE, textureEl, { width: 4096, background: "#123a5c" })
      .then((tex) => { earth.material.map = tex; earth.material.color.set(0xffffff);
                       earth.material.needsUpdate = true; })
      .catch((e) => console.warn("[near3d] mappo texture unavailable", e));
  }

  const api = {
    scene, camera, renderer, earth, vehicles, shipTrail, boostTrail,
    // Put a mesh on the surface (or above it) standing along the local vertical.
    stand(object, lat, lon, altKm, { lean = 0, heading = 0 } = {}) {
      return standOn(THREE, object, { lat, lon, radius: R_EARTH, altitude: altKm, lean, spin: heading });
    },
    setTrail(line, points) {
      line.geometry.setFromPoints(points);
      line.geometry.computeBoundingSphere();
    },
    // Look at a place from a given height and distance, tipped toward the
    // horizon — this is the shot the whole module exists for.
    lookAtSurface(lat, lon, { altKm = 3, backKm = 12, targetAltKm = 0.5, heading = 93 } = {}) {
      const at = latLonToVec(lat, lon, R_EARTH + targetAltKm);
      const up = latLonToVec(lat, lon, 1).normalize();
      const north = new THREE.Vector3(0, 1, 0).sub(up.clone().multiplyScalar(up.y)).normalize();
      const east = north.clone().cross(up).normalize().negate();
      // Stand DOWNRANGE and look back at the pad, not behind it looking out.
      // Launching east from Starbase means the view out is open Gulf; the view
      // back has the Texas coast, the Yucatán and the whole of Mexico behind
      // the vehicle — which is both more legible and the map doing the work.
      const back = north.clone().multiplyScalar(Math.cos(heading * RAD))
        .add(east.clone().multiplyScalar(Math.sin(heading * RAD)));
      camera.position.copy(at)
        .add(back.multiplyScalar(backKm))
        .add(up.clone().multiplyScalar(altKm));
      camera.up.copy(up);
      camera.lookAt(at);
    },
    setSun(dir) { sun.position.copy(dir).multiplyScalar(1e5); },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    render() { renderer.render(scene, camera); }
  };
  return api;
}
