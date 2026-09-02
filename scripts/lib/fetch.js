// Source data for the generators is pinned twice: by URL (a commit-locked
// path where the host offers one) and by SHA-256. A pack is therefore
// reproducible from a fresh checkout for as long as the bytes exist anywhere,
// and a silently changed upstream file fails here rather than in a map.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache");
const USER_AGENT = "mappo-generator (+https://github.com/rameerez/mappo)";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Returns the path of a verified local copy, downloading it into .cache/ when
// missing or stale.
export async function fetchCached({ url, sha256: expected, file }) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, file);
  if (existsSync(path) && sha256(readFileSync(path)) === expected) return path;

  console.log(`fetching ${url}`);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${url}: SHA-256 ${actual} does not match the pinned ${expected}. ` +
      "The upstream file changed; inspect it and update the pin deliberately.");
  }
  writeFileSync(path, bytes);
  return path;
}
