#!/usr/bin/env node
// Builds dist/mappo.js — ONE self-contained ESM file, because the whole point
// is zero-friction consumption: a single <script type="module">, one importmap
// pin, one CDN URL. No bundler dependency: the module graph is a hand-ordered
// list and imports are internal-only, so "bundling" is stripping import lines
// and concatenating. If the graph ever gets real complexity, switch to esbuild
// — not before.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, "..", "src", f), "utf8");
const manifest = JSON.parse(readFileSync(join(here, "..", "package.json")));

// Dependency order, leaves first. Earth is a body pack like any other; it is
// simply the one concatenated into the bundle. index.js is transformed into
// the footer so it remains the single source of truth for the package's public
// exports and auto-registration behaviour.
const MODULES = [
  "projection.js", "graticule.js", "bodies/earth.js", "body.js", "figure.js",
  "noise.js", "color.js", "highlight.js", "globe.js", "renderer.js", "element.js"
];

// Opt-in body packs ship SEPARATELY, one file each, and package.json's
// `exports` is the single source of truth for which ones exist. Each pack is
// standalone — it imports nothing from the engine — and is handed to
// registerBody() by the consumer.
const BODIES = Object.entries(manifest.exports)
  .filter(([ subpath ]) => subpath.startsWith("./bodies/"))
  .map(([ , target ]) => {
    const match = String(target).match(/^\.\/dist\/bodies\/([^/]+\.js)$/);
    if (!match) throw new Error(`body export ${target} must target ./dist/bodies/<name>.js`);
    return match[1];
  });

// The concatenation removes import lines, which means an aliased import has
// nothing left to bind its new name to and fails at runtime as an undefined
// reference. Cheaper to refuse it here than to find it in the browser.
for (const file of MODULES) {
  const alias = src(file).match(/^import\s*\{[^}]*\bas\b[^}]*\}/m);
  if (alias) throw new Error(`src/${file}: aliased import does not survive bundling — ${alias[0].replace(/\s+/g, " ")}`);
}

// Every module shares one scope in the bundle, so two modules declaring the
// same top-level name would be a SyntaxError at load time — caught here, with
// the file names, instead.
const declared = new Map();
const body = MODULES.map((file) => {
  const code = src(file)
    .replace(/^import\s[^;]+;\n/gm, "")       // internal imports: now same scope
    // Internal source exports remain useful to source-level unit tests, but
    // only src/index.js chooses what the npm package exposes.
    .replace(/^export\s+(?=(?:const|let|var|function|class)\b)/gm, "")
    .trimEnd();
  if (/^(?:import|export)\s/m.test(code)) {
    throw new Error(`src/${file}: unsupported module syntax survived bundling`);
  }
  for (const [ , name ] of code.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (declared.has(name)) throw new Error(`top-level "${name}" is declared in both src/${declared.get(name)} and src/${file}`);
    declared.set(name, file);
  }
  return `// ══════════ src/${file} ══════════\n${code}`;
}).join("\n\n");

const banner = `// mappo v${manifest.version}
// Maps of any world as a zero-dependency web component. MIT license.
// https://github.com/rameerez/mappo
// Earth data: Natural Earth (public domain, naturalearthdata.com).
// GENERATED from src/ by scripts/build.js — edit src/, not this file.
`;

const footer = src("index.js")
  .replace(/^import\s[^;]+;\n/gm, "")
  .replace(/^export\s+\{([^}]+)\}\s+from\s+["'][^"']+["'];/gm, "export {$1};")
  .trim();
if (/\bfrom\s+["']\.\//.test(footer) || /^import\s/m.test(footer)) {
  throw new Error("src/index.js: unsupported entry syntax survived bundling");
}

mkdirSync(join(here, "..", "dist", "bodies"), { recursive: true });
writeFileSync(join(here, "..", "dist", "mappo.js"), `${banner}\n${body}\n\n// ══════════ src/index.js ══════════\n${footer}\n`);
console.log("wrote dist/mappo.js");

for (const file of BODIES) {
  const code = src(`bodies/${file}`);
  if (/^import\s/m.test(code)) throw new Error(`src/bodies/${file}: a body pack must import nothing`);
  writeFileSync(join(here, "..", "dist", "bodies", file), code);
  console.log(`wrote dist/bodies/${file}`);
}
