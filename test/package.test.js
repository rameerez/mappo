import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));

test("package exposes the root and both documented opt-in body subpaths", async () => {
  assert.deepEqual(packageJson.exports, {
    ".": "./dist/mappo.js",
    "./bodies/moon": "./dist/bodies/moon.js",
    "./bodies/mars": "./dist/bodies/mars.js"
  });
  assert.equal((await import("mappo/bodies/moon")).MOON.id, "moon");
  assert.equal((await import("mappo/bodies/mars")).MARS.id, "mars");
  assert.equal(packageJson.dependencies, undefined, "the runtime remains zero-dependency");
  assert.equal(packageJson.devEngines.runtime.name, "node");
  assert.equal(packageJson.devEngines.runtime.onFail, "error");
  assert.ok(packageJson.files.includes("dist/"));
});

test("the root export surface is explicit, minimal and contains no bundled internals", async () => {
  const root = await import("mappo");
  const expected = [
    // the component
    "Mappo", "DEFAULTS", "MappoElement", "register", "defineBodyElement",
    // worlds
    "EARTH", "registerBody", "resolveBody", "knownBodies", "onBodyRegistered", "resolvePlace",
    // geometry for hosts building their own layers
    "project", "cellCenter", "cellCorner", "projectNormalized", "buildGraticule",
    "buildFigure", "parseFigureStyle", "snapToFigure", "noise2",
    // colour helpers
    "hoverShade", "resolveColor", "usesCssVars"
  ].sort();
  assert.deepEqual(Object.keys(root).sort(), expected);
  for (const internal of [
    "GlobeRenderer", "buildGlobeFlags", "buildGlobePhases", "buildGlobePoints", "latLonToXYZ",
    "normalizeRings", "pointInRings", "trackMap", "untrackMap", "validateBody", "resolvePlaces",
    "traceCells", "figureOutlines", "figureBorders", "bodyLatRange",
    // Earth vocabulary that used to leak
    "isLand", "MASK_W", "MASK_H", "landShapes", "countryShapes", "CITIES", "resolveCity",
    "buildLand", "parseLandStyle", "landRings", "borderRings", "snapToLand"
  ]) {
    assert.equal(internal in root, false, `${internal} leaked into the public package`);
  }
});

test("body packs are standalone modules exporting exactly one body", async () => {
  const dir = new URL("../dist/bodies/", import.meta.url);
  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, [ "mars.js", "moon.js" ]);
  for (const file of files) {
    const source = await readFile(new URL(file, dir), "utf8");
    assert.doesNotMatch(source, /^import\s/m, `${file} imports nothing`);
    const exports = [ ...source.matchAll(/^export\s+(?:const|let|var|function|class)\s+(\w+)/gm) ].map((m) => m[1]);
    assert.deepEqual(exports, [ file.replace(".js", "").toUpperCase() ]);
    assert.equal(source, await readFile(new URL(`../src/bodies/${file}`, import.meta.url), "utf8"),
      `dist/bodies/${file} is a verbatim copy of its source`);
  }
});
