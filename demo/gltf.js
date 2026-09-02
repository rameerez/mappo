// The smallest glTF reader that can draw a rocket.
//
// A .glb is a 12-byte header and two chunks: a JSON document and one binary
// buffer. Everything this page needs — positions, indices, a base colour per
// material, and the transform of the node each mesh hangs from — is reachable
// with about a hundred lines, so no loader library is imported and mappo's
// "zero dependencies" stays true. Skinning, animation, textures, sparse
// accessors and morph targets are all deliberately unimplemented: the model is
// a static rocket, and pretending otherwise would be code nobody runs.
//
// Returns scene3d's mesh shape — { verts, faces } with a colour per face — so
// a loaded mesh and a generated one are the same thing to everything downstream.

const GLB_MAGIC = 0x46546c67;      // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
};
const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a .glb");
  let off = 12, json = null, bin = null;
  while (off + 8 <= buffer.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = buffer.slice(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === CHUNK_BIN) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("glb has no JSON chunk");
  return { json, bin };
}

// Accessors are a view into a bufferView into the buffer. Interleaved data has
// a byteStride, and Blender's exporter does use it.
function readAccessor(g, bin, index) {
  const acc = g.accessors[index];
  const view = g.bufferViews[acc.bufferView];
  const Type = COMPONENT[acc.componentType];
  const n = COUNT[acc.type];
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride;
  if (!stride || stride === n * Type.BYTES_PER_ELEMENT) {
    return new Type(bin, base, acc.count * n);
  }
  const out = new Type(acc.count * n);
  for (let i = 0; i < acc.count; i++) {
    const row = new Type(bin, base + i * stride, n);
    out.set(row, i * n);
  }
  return out;
}

// Column-major 4x4, the way glTF stores them.
const identity = () => [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];
function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                   a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [ tx, ty, tz ] = node.translation || [ 0, 0, 0 ];
  const [ x, y, z, w ] = node.rotation || [ 0, 0, 0, 1 ];
  const [ sx, sy, sz ] = node.scale || [ 1, 1, 1 ];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)
  ];
  return [
    r[0] * sx, r[1] * sx, r[2] * sx, 0,
    r[3] * sy, r[4] * sy, r[5] * sy, 0,
    r[6] * sz, r[7] * sz, r[8] * sz, 0,
    tx, ty, tz, 1
  ];
}
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
];

const hex = (c) => "#" + c.slice(0, 3)
  .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

// Blender's principled materials come through as a base colour factor; when a
// primitive has no material at all, bare steel is the honest default for this
// vehicle.
function materialColor(g, index, fallback) {
  const m = g.materials?.[index];
  const f = m?.pbrMetallicRoughness?.baseColorFactor;
  return f ? hex(f) : fallback;
}

export function meshFromGLB(buffer, { fallback = "#b9c0ca" } = {}) {
  const { json: g, bin } = parseGLB(buffer);
  const verts = [], faces = [];
  const scene = g.scenes?.[g.scene ?? 0];
  const roots = scene?.nodes ?? g.nodes.map((_, i) => i);

  const walk = (index, parent) => {
    const node = g.nodes[index];
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of g.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;   // triangles only
        const pos = readAccessor(g, bin, prim.attributes.POSITION);
        const idx = prim.indices !== undefined ? readAccessor(g, bin, prim.indices) : null;
        const base = verts.length;
        for (let i = 0; i < pos.length; i += 3) {
          verts.push(apply(world, [ pos[i], pos[i + 1], pos[i + 2] ]));
        }
        const color = materialColor(g, prim.material, fallback);
        const n = idx ? idx.length : pos.length / 3;
        for (let i = 0; i + 2 < n; i += 3) {
          faces.push({ i: idx ? [ base + idx[i], base + idx[i + 1], base + idx[i + 2] ]
                               : [ base + i, base + i + 1, base + i + 2 ], color });
        }
      }
    }
    for (const child of node.children || []) walk(child, world);
  };
  for (const r of roots) walk(r, identity());
  return { verts, faces };
}

export async function loadGLB(url, opts) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return meshFromGLB(await res.arrayBuffer(), opts);
}

// Recentre and reorient a loaded mesh into the convention the page draws in:
// +Z along the vehicle's long axis, origin at the engine bells, metres.
export function normalize(m, { axisUp = "z" } = {}) {
  let lo = [ Infinity, Infinity, Infinity ], hi = [ -Infinity, -Infinity, -Infinity ];
  for (const v of m.verts) for (let i = 0; i < 3; i++) {
    if (v[i] < lo[i]) lo[i] = v[i];
    if (v[i] > hi[i]) hi[i] = v[i];
  }
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  const swap = axisUp === "y";
  const verts = m.verts.map((v) => swap
    ? [ v[0] - cx, v[2] - (lo[2] + hi[2]) / 2, v[1] - lo[1] ]
    : [ v[0] - cx, v[1] - cy, v[2] - lo[2] ]);
  return { verts, faces: m.faces, size: [ hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2] ] };
}
