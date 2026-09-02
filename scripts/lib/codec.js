// The wire format every body pack shares, and the two functions a pack embeds
// VERBATIM so that it can stay standalone: a pack imports nothing, so the
// decoder and the mask sampler travel inside it. They are defined here once,
// tested here once, and copied into the generated file with Function#toString
// (see pack.js), so the runtime and the tooling can never disagree.
//
//   mask    W×H bits (512×256 by default), row-major from lat +90 down and
//           lon −180 → +180, one bit per cell, base64.
//   rings   closed [lat, lon] rings quantised to 1/SCALE degree, delta-encoded
//           along each ring, zigzagged, and varinted into a base64 alphabet
//           (five data bits per character, the sixth bit continues). Rings are
//           joined with "|". Coastlines move in small steps, so nearly every
//           delta fits in one character.

export const SCALE = 32;          // 1/32° ≈ 3.5 km at Earth's equator
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// rings: [[lat, lon], …][] — closed or not, the encoder does not care.
export function encodeRings(rings) {
  return rings.map((ring) => {
    const out = [];
    let px = 0, py = 0;
    for (const [ lat, lon ] of ring) {
      const x = Math.round((lon + 180) * SCALE);
      const y = Math.round((lat + 90) * SCALE);
      varint(x - px, out);
      varint(y - py, out);
      px = x;
      py = y;
    }
    return out.join("");
  }).join("|");
}

function varint(value, out) {
  let v = value < 0 ? -value * 2 - 1 : value * 2;   // zigzag: small magnitudes stay small
  while (v >= 32) {
    out.push(ALPHABET[(v % 32) + 32]);
    v = Math.floor(v / 32);
  }
  out.push(ALPHABET[v]);
}

// Embedded in every pack. Keep it self-contained: no free variables other than
// its parameters and Math.
export function decodeRings(encoded, scale, alphabet) {
  const index = new Map([ ...alphabet ].map((c, i) => [ c, i ]));
  const rings = [];
  for (const chunk of encoded.split("|")) {
    const ring = [];
    let i = 0, x = 0, y = 0;
    const read = () => {
      let mul = 1, result = 0, byte;
      do {
        byte = index.get(chunk[i++]);
        result += (byte % 32) * mul;
        mul *= 32;
      } while (byte >= 32);
      return result % 2 ? -(result + 1) / 2 : result / 2;   // un-zigzag
    };
    while (i < chunk.length) {
      x += read();
      y += read();
      ring.push([ y / scale - 90, x / scale - 180 ]);
    }
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}

// Embedded in every pack. Longitude wraps (180 and −180 are the same
// meridian); a latitude off the sphere, or NaN, is outside the figure.
export function maskAt(bits, width, height, lat, lon) {
  if (!(lat >= -90 && lat <= 90) || !(lon > -Infinity && lon < Infinity)) return false;
  const turn = (((lon + 180) % 360) + 360) % 360;
  const col = Math.min(width - 1, Math.floor((turn / 360) * width));
  const row = Math.min(height - 1, Math.floor(((90 - lat) / 180) * height));
  const index = row * width + col;
  return (bits[index >> 3] & (1 << (index & 7))) !== 0;
}

export function packBits(bits) {
  return Buffer.from(bits).toString("base64");
}
