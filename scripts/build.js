#!/usr/bin/env node
// Builds dist/ with esbuild. The shape is the point:
//
//   dist/mappo.js                the core — engine, Earth's mask and gazetteer,
//                                equirectangular. One self-contained, minified
//                                file: the headline number.
//   dist/globe.js                opt-in modules. Each imports the core by the
//   dist/projections.js          RELATIVE path ./mappo.js and registers itself,
//   dist/vector.js               so they work from a CDN, a vendored dist/ or a
//   dist/links.js                bundler alike, and the core is never duplicated.
//   dist/bodies/earth-vector.js
//   dist/bodies/moon.js          body packs: standalone, import nothing.
//   dist/bodies/mars.js
//   dist/all.js                  everything in one file, for the one-URL page.
//
// package.json's `exports` is the single source of truth for what exists; this
// script derives every entry from it ("./globe" → src/entries/globe.js,
// "./bodies/moon" → src/bodies/moon.js). Two checks keep the seam honest: a
// module may import from the core only names src/index.js exports, and no
// source file may be bundled into two modules.

import { build } from "esbuild";
import { readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const banner = [
  `// mappo v${manifest.version} — maps of any world as a zero-dependency web component. MIT.`,
  "// https://github.com/rameerez/mappo · Earth data: Natural Earth (public domain).",
  "// GENERATED from src/ by scripts/build.js — edit src/, not this file."
].join("\n");

const common = {
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  target: [ "es2022" ],
  minify: true,
  sourcemap: true,
  legalComments: "none",
  banner: { js: banner },
  logLevel: "warning",
  metafile: true
};

const sourceFor = (subpath) => {
  if (subpath === ".") return "src/index.js";
  if (subpath.startsWith("./bodies/")) return `src/bodies/${subpath.slice("./bodies/".length)}.js`;
  return `src/entries/${subpath.slice(2)}.js`;
};
const outfileFor = (target) => {
  const m = String(target).match(/^\.\/(dist\/.+\.js)$/);
  if (!m) throw new Error(`export target ${target} must be ./dist/<name>.js`);
  return m[1];
};

rmSync(join(root, "dist"), { recursive: true, force: true });

// 1. The core. Its inputs are what every other module must treat as external.
const core = await build({ ...common, entryPoints: [ "src/index.js" ], outfile: outfileFor(manifest.exports["."]) });
const coreFiles = new Set(Object.keys(core.metafile.inputs).map((p) => resolve(root, p)));
const coreExports = new Set(Object.values(core.metafile.outputs).find((o) => o.entryPoint)?.exports ?? []);

// A module's imports of core source files become one external import of the
// core's dist file, by relative path.
const coreExternal = (outfile) => ({
  name: "core-external",
  setup(b) {
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      const full = resolve(args.resolveDir, args.path);
      if (!coreFiles.has(full)) return null;
      let rel = relative(dirname(join(root, outfile)), join(root, outfileFor(manifest.exports["."]))).split(sep).join("/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return { path: rel, external: true };
    });
  }
});

// 2. Every other export. `./all` is self-contained; the rest import the core.
const owned = new Map();   // non-core source file → the module that bundles it
for (const [ subpath, target ] of Object.entries(manifest.exports)) {
  if (subpath === ".") continue;
  const outfile = outfileFor(target);
  const selfContained = subpath === "./all";
  const result = await build({
    ...common,
    entryPoints: [ sourceFor(subpath) ],
    outfile,
    plugins: selfContained ? [] : [ coreExternal(outfile) ]
  });
  if (selfContained) continue;
  for (const input of Object.keys(result.metafile.inputs)) {
    if (coreFiles.has(resolve(root, input))) continue;
    if (owned.has(input)) throw new Error(`${input} is bundled into both ${owned.get(input)} and ${outfile} — it belongs in one module, or in the core`);
    owned.set(input, outfile);
  }
  const code = readFileSync(join(root, outfile), "utf8");
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.\.?\/mappo\.js)"/g)) {
    for (const spec of m[1].split(",")) {
      const name = spec.trim().split(/\s+as\s+/)[0];
      if (name && !coreExports.has(name)) throw new Error(`${outfile} imports "${name}" from the core, which src/index.js does not export`);
    }
  }
  if (subpath.startsWith("./bodies/") && !code.includes("mappo.js") && /\bfrom\s*"/.test(code)) {
    throw new Error(`${outfile}: a body pack must import nothing`);
  }
}

// 3. Report, in the units the README quotes.
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const target of Object.values(manifest.exports)) {
  const file = outfileFor(target);
  const bytes = readFileSync(join(root, file));
  console.log(`${file.padEnd(30)} ${kb(statSync(join(root, file)).size).padStart(9)} raw ${kb(gzipSync(bytes, { level: 9 }).length).padStart(9)} gzip`);
}
