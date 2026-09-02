#!/usr/bin/env node
// A static server for the repository, for the demos and the harnesses: no
// caching (a rebuilt dist/ must show up on reload), correct module types, and
// nothing else. `npm run serve`, then http://localhost:8099/demo/.
//
//   node scripts/serve.mjs [port]     (default 8099)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8099);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json", ".json": "application/json", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".woff2": "font/woff2", ".tle": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8"
};

createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (path.endsWith("/")) path += "index.html";
    let file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}/  (demos: /demo/)`));
