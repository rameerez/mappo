import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRaster, coverageWithin, downsample } from "../scripts/lib/raster-body.js";
import { renderBodyPack } from "../scripts/lib/pack.js";
import { ALPHABET, SCALE, decodeRings, encodeRings, maskAt } from "../scripts/lib/codec.js";
import { simplifyRing } from "../scripts/lib/geometry.js";
import { writePng } from "../scripts/lib/image.js";
import { rasterizeRings, simplifiedRings } from "../scripts/lib/vector-body.js";
import { resolveBody } from "../dist/mappo.js";

// A synthetic world: the western half bright, the eastern half dark.
function halfWorld(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = x < width / 2 ? 0 : 255;
      rgba.set([ v, v, v, 255 ], (y * width + x) * 4);
    }
  }
  return rgba;
}

async function withImage(name, width, height, rgba, fn) {
  const directory = await mkdtemp(join(tmpdir(), "mappo-generator-"));
  try {
    const path = join(directory, name);
    writePng(path, width, height, rgba);
    return await fn(path, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("codec: rings survive encode → decode to the quantisation step", () => {
  const rings = [
    [ [ 10, -170.03 ], [ 10.5, -169 ], [ 12.25, -168.5 ], [ 10, -170.03 ] ],
    [ [ -45, 179.9 ], [ -44, 179.95 ], [ -44.5, 179 ], [ -45, 179.9 ] ]
  ];
  const decoded = decodeRings(encodeRings(rings), SCALE, ALPHABET);
  assert.equal(decoded.length, 2);
  rings.forEach((ring, r) => ring.forEach(([ lat, lon ], i) => {
    assert.ok(Math.abs(decoded[r][i][0] - lat) <= 0.5 / SCALE, "latitude within half a quantum");
    assert.ok(Math.abs(decoded[r][i][1] - lon) <= 0.5 / SCALE, "longitude within half a quantum");
  }));
  assert.deepEqual(decoded[0][0], decoded[0].at(-1), "closure is preserved exactly");
});

test("codec: the mask sampler wraps longitude and rejects impossible input", () => {
  const width = 8, height = 4;
  const bits = new Uint8Array(4);
  bits[0] = 0b00000001;                 // only cell (0, 0): lat 90..45, lon -180..-135
  assert.equal(maskAt(bits, width, height, 80, -170), true);
  assert.equal(maskAt(bits, width, height, 80, 190), true, "190° is -170°");
  assert.equal(maskAt(bits, width, height, 80, -100), false);
  assert.equal(maskAt(bits, width, height, 91, -170), false);
  assert.equal(maskAt(bits, width, height, NaN, -170), false);
  assert.equal(maskAt(bits, width, height, 80, Infinity), false);
});

test("geometry: simplifying a closed ring also tests points against the closing edge", () => {
  // A unit square with a redundant midpoint on the LAST edge (back to the
  // start). The half that includes the closing edge must remove it.
  const square = [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, 0 ], [ 0.5, 0 ], [ 0, 0 ] ];
  const simplified = simplifyRing(square, 0.01);
  assert.deepEqual(simplified, [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, 0 ], [ 0, 0 ] ]);
});

test("raster downsampling weights fractional source-pixel overlap", () => {
  // Two target cells across three source pixels: the middle source pixel is
  // split evenly between them, not counted in full twice.
  const cells = downsample(new Float32Array([ 0, 100, 200 ]), 3, 1, 2, 1);
  assert.ok(Math.abs(cells[0] - 100 / 3) < 1e-5);
  assert.ok(Math.abs(cells[1] - 500 / 3) < 1e-5);
});

test("the raster pipeline thresholds, traces and emits a pack that registers as a body", async () => {
  await withImage("half.png", 16, 8, halfWorld(16, 8), async (path) => {
    const generated = classifyRaster({
      imagePath: path,
      valueAt: (r) => r,
      targetCoverage: 0.5,
      maskWidth: 16,
      maskHeight: 8,
      epsilon: 0.01,
      minPoints: 4
    });
    assert.ok(Math.abs(generated.coverage - 0.5) < 1e-12);
    assert.equal(generated.at(0, -90), true, "the dark half is the figure");
    assert.equal(generated.at(0, 90), false);
    assert.ok(Math.abs(coverageWithin(generated.at, { lonMin: -180, lonMax: 0 }) - 1) < 1e-12);
    assert.equal(generated.rings.length, 1, "one contour around the western half");
    assert.deepEqual(generated.rings[0][0], generated.rings[0].at(-1));

    const source = renderBodyPack({
      generatedBy: "generator.test.js",
      notes: "A synthetic half-dark world.",
      body: { id: "half-world", name: "Half world", radiusKm: 1, latRange: [ -90, 90 ], terms: { figure: "dark", ground: "bright" } },
      mask: generated.mask,
      outlines: generated.outlines,
      borders: null,
      placesNotes: "none",
      places: [ { name: "Dark centre", lat: 0, lon: -90, kind: "test" } ]
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const body = module.HALF_WORLD;
    assert.equal(resolveBody(body), body, "the generated pack satisfies the body contract");
    assert.equal(body.figure(0, -90), true);
    assert.equal(body.figure(0, 90), false);
    assert.equal(body.borders(), null);
    assert.deepEqual(body.places, [ { name: "Dark centre", lat: 0, lon: -90, kind: "test" } ]);
    const decoded = body.outlines();
    assert.equal(body.outlines(), decoded, "memoized");
    assert.equal(decoded.length, generated.rings.length);
    for (let r = 0; r < decoded.length; r++) {
      assert.equal(decoded[r].length, generated.rings[r].length);
      for (let i = 0; i < decoded[r].length; i++) {
        assert.ok(Math.abs(decoded[r][i][0] - generated.rings[r][i][0]) <= 0.5 / SCALE);
        assert.ok(Math.abs(decoded[r][i][1] - generated.rings[r][i][1]) <= 0.5 / SCALE);
      }
    }
  });
});

test("the raster pipeline rejects bad input loudly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mappo-generator-invalid-"));
  try {
    const notImage = join(directory, "not.png");
    await writeFile(notImage, "not a bitmap");
    assert.throws(() => classifyRaster({ imagePath: notImage, valueAt: () => 0, targetCoverage: 0.5 }), /not a PNG or JPEG/);

    const valid = join(directory, "valid.png");
    writePng(valid, 4, 4, halfWorld(4, 4));
    assert.throws(() => classifyRaster({ imagePath: valid, valueAt: () => NaN, targetCoverage: 0.5, maskWidth: 4, maskHeight: 4 }), /non-finite value/);
    assert.throws(() => classifyRaster({ imagePath: valid, valueAt: () => 0, targetCoverage: 1, maskWidth: 4, maskHeight: 4 }), /targetCoverage/);
    assert.throws(() => classifyRaster({ imagePath: valid, valueAt: "nope", targetCoverage: 0.5 }), /valueAt/);
    assert.throws(() => classifyRaster({ imagePath: valid, valueAt: () => 0, targetCoverage: 0.5, maskWidth: 0 }), /positive integers/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the vector pipeline rasterises polygons with holes and keeps rings closed", () => {
  // A square continent with a square lake: even-odd leaves the lake as ground.
  const outer = [ [ -40, -40 ], [ 40, -40 ], [ 40, 40 ], [ -40, 40 ], [ -40, -40 ] ];   // [lat, lon]
  const lake = [ [ -10, -10 ], [ 10, -10 ], [ 10, 10 ], [ -10, 10 ], [ -10, -10 ] ];
  const mask = rasterizeRings([ outer, lake ], 72, 36);
  const at = (lat, lon) => maskAt(mask.bits, 72, 36, lat, lon);
  assert.equal(at(30, 30), true, "inside the continent");
  assert.equal(at(0, 0), false, "the lake is ground");
  assert.equal(at(60, 0), false, "outside is ground");
  const rings = simplifiedRings([ outer, lake ], { epsilon: 0.1, minPoints: 4, minArea: 1 });
  assert.equal(rings.length, 2);
  for (const ring of rings) assert.deepEqual(ring[0], ring.at(-1));
});
