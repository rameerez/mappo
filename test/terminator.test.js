import { test } from "node:test";
import assert from "node:assert/strict";
import { nightRings, solarElevation, terminatorCurves } from "../demo/terminator.js";

test("solar elevation identifies the subsolar and antisolar points", () => {
  assert.ok(Math.abs(solarElevation(0, 25, 0, 25) - 90) < 1e-12);
  assert.ok(Math.abs(solarElevation(0, -155, 0, 25) + 90) < 1e-12);
  assert.ok(Math.abs(solarElevation(23.4, 25, 23.4, 25) - 90) < 1e-12);
});

test("night rings are closed and every on-sphere edge is the requested solar elevation", () => {
  for (const [ dec, subLon, h0 ] of [ [ 23.4, 30, 0 ], [ -17, -120, 0 ], [ 5, 179, -9 ] ]) {
    const rings = nightRings(dec, subLon, h0, [ -58, 84 ]);
    assert.ok(rings.length > 0);
    for (const ring of rings) {
      assert.deepEqual(ring[0], ring.at(-1), "every emitted ring is closed");
      for (const [ lon, lat ] of ring) {
        assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
        if (Math.abs(lat) >= 90) continue; // off-frame closure, not a surface point
        assert.ok(Math.abs(solarElevation(lat, lon, dec, subLon) - h0) < 1e-9);
      }
    }
  }
});

test("the exact equinox terminator is two pole-to-pole meridians", () => {
  assert.deepEqual(terminatorCurves(0, 25, 0), [
    [ [ -65, -90 ], [ -65, 90 ] ],
    [ [ 115, -90 ], [ 115, 90 ] ]
  ]);
});
