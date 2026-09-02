#!/usr/bin/env node
// Where the bytes are. Reports, per module and for the Earth pack's data
// literals, the raw, comment-stripped, gzip, marginal-gzip and brotli sizes
// of what the build ships, and — when esbuild is reachable through npx — the
// minified sizes of the entry points docs/weight.md proposes. Nothing here
// touches dist/ or src/; the numbers go into docs/weight.md by hand.
//
//   node scripts/weight.mjs              everything
//   node scripts/weight.mjs --no-minify  skip the esbuild pass (no network)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gz = (s) => gzipSync(Buffer.from(s), { level: 9 }).length;
const br = (s) => brotliCompressSync(Buffer.from(s), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(9);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\n\s*\n+/g, "\n");
const row = (...cells) => console.log(cells.map((c, i) => (i ? String(c).padStart(11) : String(c).padEnd(64))).join(""));

// The module list is the build's, so this cannot drift from what ships.
const build = read("scripts/build.js");
const modules = [ ...new Set([ ...build.matchAll(/"([\w/.-]+\.js)"/g) ].map((m) => m[1])) ]
  .filter((m) => existsSync(join(ROOT, "src", m)));
const src = Object.fromEntries(modules.map((m) => [ m, read(`src/${m}`) ]));
const bundle = read("dist/mappo.js");
const all = modules.map((m) => src[m]).join("\n");

console.log(`dist/mappo.js  raw ${kb(bundle.length)}  gzip ${kb(gz(bundle))}  brotli ${kb(br(bundle))}\n`);
row("module", "raw", "stripped", "gzip", "marginal", "brotli");
const rows = modules.map((m) => {
  const without = modules.filter((x) => x !== m).map((x) => src[x]).join("\n");
  return { m, raw: src[m].length, stripped: strip(src[m]).length, gzAlone: gz(src[m]), marginal: gz(all) - gz(without), brAlone: br(src[m]) };
}).sort((a, b) => b.marginal - a.marginal);
for (const r of rows) row(r.m, kb(r.raw), kb(r.stripped), kb(r.gzAlone), kb(r.marginal), kb(r.brAlone));
row("all", kb(all.length), kb(strip(all).length), kb(gz(all)), "", kb(br(all)));
console.log(`comments and blank lines: ${kb(all.length - strip(all).length)} raw, ${kb(gz(all) - gz(strip(all)))} gzip\n`);

const earth = src["bodies/earth.js"];
const lit = (name) => earth.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1] ?? "";
const bits = earth.match(/atob\("([^"]+)"\)/)?.[1] ?? "";
const places = earth.slice(earth.indexOf("places: ["), earth.indexOf("\n    ]\n  };") + 6);
row("Earth literal", "raw", "gzip", "brotli");
for (const [ label, s ] of [ [ "BITS (mask, base64)", bits ], [ "OUTLINES", lit("OUTLINES") ], [ "BORDERS", lit("BORDERS") ], [ "places", places ] ]) {
  row(label, kb(s.length), kb(gz(s)), kb(br(s)));
}
for (const pack of [ "moon", "mars" ]) {
  if (!existsSync(join(ROOT, "src", "bodies", `${pack}.js`))) continue;
  const s = read(`src/bodies/${pack}.js`);
  row(`bodies/${pack}.js`, kb(s.length), kb(gz(s)), kb(br(s)));
}

if (process.argv.includes("--no-minify")) process.exit(0);
const dir = join(tmpdir(), "mappo-weight");
mkdirSync(dir, { recursive: true });
const minify = (code, name) => {
  writeFileSync(join(dir, `${name}.js`), code);
  execSync(`npx --yes esbuild@0.25.5 ${JSON.stringify(join(dir, `${name}.js`))} --minify --format=esm --outfile=${JSON.stringify(join(dir, `${name}.min.js`))} --log-level=error`, { stdio: "pipe", timeout: 180000 });
  return readFileSync(join(dir, `${name}.min.js`), "utf8");
};
try { execSync("npx --yes esbuild@0.25.5 --version", { stdio: "pipe", timeout: 180000 }); }
catch { console.log("\n(esbuild not reachable through npx; skipping the minified pass)"); process.exit(0); }

const bare = (m) => src[m].replace(/^import .*$/gm, "").replace(/^export /gm, "");
const CORE = [ "projection.js", "graticule.js", "body.js", "figure.js", "noise.js", "color.js", "highlight.js", "renderer.js", "element.js" ].filter((m) => src[m]);
const maskOnly = earth.replace(/const OUTLINES = "[^"]+"/, "const OUTLINES = null").replace(/const BORDERS = "[^"]+"/, "const BORDERS = null");
console.log("\nminified with esbuild (the numbers a real build would ship)");
row("group / entry point", "minified", "gzip", "brotli");
const show = (label, code) => { const mn = minify(code, label.replace(/[^a-z0-9]+/gi, "_")); row(label, kb(mn.length), kb(gz(mn)), kb(br(mn))); };
show("whole bundle", bundle);
show("core: element, renderer, body, figure, grid, highlight, noise, color, graticule", CORE.map(bare).join("\n"));
show("projections.js", bare("projections.js"));
show("globe.js", bare("globe.js"));
show("bodies/earth.js, whole", earth);
show("bodies/earth.js, mask + places only", maskOnly);
show("core + Earth mask/places (flat dots, equirectangular)", [ ...CORE.map(bare), maskOnly ].join("\n"));
show("… + projections.js", [ ...CORE.map(bare), bare("projections.js"), maskOnly ].join("\n"));
show("… + globe.js", [ ...CORE.map(bare), bare("projections.js"), bare("globe.js"), maskOnly ].join("\n"));
show("… + Earth vector rings (= everything)", [ ...CORE.map(bare), bare("projections.js"), bare("globe.js"), earth ].join("\n"));
