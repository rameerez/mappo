// The wire format every body pack shares, and the two functions a pack embeds
// VERBATIM so that it can stay standalone: a pack imports nothing, so the
// decoder and the mask sampler travel inside it. They are defined here once,
// tested here once, and copied into the generated file with Function#toString
// (see pack.js), so the runtime and the tooling can never disagree.
//
//   mask    W×H bits (512×256 by default), row-major from lat +90 down and
//           lon −180 → +180, one bit per cell, stored as RUN LENGTHS: the
//           lengths of alternating ground/figure runs (the first run is
//           ground), each an unsigned varint in the same alphabet. Continents
//           are long runs, so Earth's 16 KB of bits become 3.6 KB of text that
//           gzip to 2.3 KB, against 3.5 KB for the same bits in base64.
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

// The gazetteer as one string: "name,lat,lon[,kind];…". Half the bytes of the
// object literals it stands for, and the same records once unpacked.
export function packPlaces(places) {
  return places.map(({ name, lat, lon, kind }) => {
    if (/[,;]/.test(name) || (kind && /[,;]/.test(kind))) throw new Error(`place "${name}" cannot contain "," or ";"`);
    return [ name, lat, lon, ...(kind ? [ kind ] : []) ].join(",");
  }).join(";");
}

// Embedded in every pack. Keep it self-contained.
export function unpackPlace(record) {
  const [ name, lat, lon, kind ] = record.split(",");
  const place = { name, lat: +lat, lon: +lon };
  if (kind) place.kind = kind;
  return place;
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

// The mask as run lengths, see the header. Unsigned varints: a run cannot be
// negative, so no zigzag.
export function packMask(bits, width, height) {
  const total = width * height;
  const out = [];
  let value = 0, length = 0;
  for (let i = 0; i < total; i++) {
    const bit = (bits[i >> 3] >> (i & 7)) & 1;
    if (bit === value) { length++; continue; }
    unsignedVarint(length, out);
    value = bit;
    length = 1;
  }
  unsignedVarint(length, out);
  return out.join("");
}

function unsignedVarint(value, out) {
  let v = value;
  while (v >= 32) {
    out.push(ALPHABET[(v % 32) + 32]);
    v = Math.floor(v / 32);
  }
  out.push(ALPHABET[v]);
}

// Embedded in every pack. Keep it self-contained: no free variables other than
// its parameters and Math.
export function unpackMask(runs, width, height, alphabet) {
  const index = new Map([ ...alphabet ].map((c, i) => [ c, i ]));
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  let i = 0, at = 0, value = 0;
  while (i < runs.length) {
    let mul = 1, length = 0, byte;
    do {
      byte = index.get(runs[i++]);
      length += (byte % 32) * mul;
      mul *= 32;
    } while (byte >= 32);
    if (value) for (let k = at; k < at + length; k++) bits[k >> 3] |= 1 << (k & 7);
    at += length;
    value ^= 1;
  }
  return bits;
}
