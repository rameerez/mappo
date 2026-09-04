import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const dist = (file) => readFile(new URL(`../dist/${file}`, import.meta.url), "utf8");

// The headline the README makes, held here so it cannot drift: the core, with
// the whole Earth inside, gzipped. Raise it deliberately, never by accident.
const CORE_BUDGET_GZIP = 22.5 * 1024;

test("package exposes the core, the opt-in modules and the body packs, and nothing else", async () => {
  assert.deepEqual(packageJson.exports, {
    ".": "./dist/mappo.js",
    "./all": "./dist/all.js",
    "./globe": "./dist/globe.js",
    "./projections": "./dist/projections.js",
    "./vector": "./dist/vector.js",
    "./links": "./dist/links.js",
    "./bodies/earth-vector": "./dist/bodies/earth-vector.js",
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

test("the core's export surface is explicit: the public API, and the seam the modules stand on", async () => {
  const root = await import("mappo");
  const expected = [
    // the component
    "Mappo", "DEFAULTS", "MappoElement", "register", "defineBodyElement",
    // worlds
    "EARTH", "registerBody", "extendBody", "resolveBody", "knownBodies", "onBodyRegistered", "resolvePlace",
    // geometry for hosts building their own layers
    "project", "cellCenter", "cellCorner", "projectNormalized", "resolveProjection", "knownProjections", "buildGraticule",
    "buildFigure", "parseFigureStyle", "snapToFigure", "noise2",
    // colour helpers
    "hoverShade", "resolveColor", "usesCssVars",
    // the seam: what mappo/globe, mappo/projections, mappo/vector and a module
    // of your own register with and build on
    "registerRenderer", "knownRenderers", "registerProjection", "registerProjectionAdapter", "registerVector",
    "resolvePlaces", "bodyLatRange", "rerenderLive", "warnIfStillPending",
    "figureOutlines", "figureBorders", "vectorFeature", "normalizeRings", "pointInRings",
    "hasProjection", "projectionDefaultRange", "projectPolyline", "signedArea", "unwrap", "meanLat",
    "wrapLon", "frameLon", "inRange", "finitePoint", "finiteLocation", "validateLatRange", "EPS"
  ].sort();
  assert.deepEqual(Object.keys(root).sort(), expected);
  for (const internal of [
    // the modules' own surfaces do not leak into the core
    "GlobeRenderer", "buildGlobeFlags", "buildGlobePhases", "buildGlobePoints", "buildGlobeTiles", "latLonToXYZ", "links", "arcPoints",
    "stitchRings", "projectRings", "adaptD3", "adaptCustom", "adaptProjection", "BUILTIN_PROJECTIONS", "EQUAL_EARTH",
    // engine internals
    "trackMap", "untrackMap", "validateBody", "traceCells",
    // Earth vocabulary that used to leak
    "isLand", "MASK_W", "MASK_H", "landShapes", "countryShapes", "CITIES", "resolveCity",
    "buildLand", "parseLandStyle", "landRings", "borderRings", "snapToLand"
  ]) {
    assert.equal(internal in root, false, `${internal} leaked into the core`);
  }
});

// Static imports of a built file, minified or not.
const importsOf = (code) => [ ...code.matchAll(/(?:^|[;}\n])\s*import\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)?\s*(?:from\s*)?"([^"]+)"/g) ].map((m) => m[1]);

test("modules import the core by relative path and nothing else; packs import nothing; all.js stands alone", async () => {
  for (const [ file, from ] of [ [ "globe.js", "./mappo.js" ], [ "projections.js", "./mappo.js" ], [ "vector.js", "./mappo.js" ], [ "links.js", "./mappo.js" ], [ "bodies/earth-vector.js", "../mappo.js" ] ]) {
    assert.deepEqual([ ...new Set(importsOf(await dist(file))) ], [ from ], `${file} imports only the core, relatively`);
  }
  for (const file of [ "bodies/moon.js", "bodies/mars.js", "all.js", "mappo.js" ]) {
    assert.deepEqual(importsOf(await dist(file)), [], `${file} has no runtime imports`);
  }
  const bodies = (await readdir(new URL("../dist/bodies/", import.meta.url))).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(bodies, [ "earth-vector.js", "mars.js", "moon.js" ]);
  for (const file of Object.values(packageJson.exports)) {
    assert.match(await dist(file.replace("./dist/", "")), /^\/\/ mappo v\d/, `${file} carries the banner`);
  }
});

test("the core stays inside the headline budget, with the whole Earth inside", async () => {
  const core = await readFile(new URL("../dist/mappo.js", import.meta.url));
  const gzipped = gzipSync(core, { level: 9 }).length;
  assert.ok(gzipped <= CORE_BUDGET_GZIP, `dist/mappo.js is ${(gzipped / 1024).toFixed(1)} KB gzipped, over the ${CORE_BUDGET_GZIP / 1024} KB budget`);
  // The README and the landing page quote the number; they must quote this one.
  const stated = (gzipped / 1024).toFixed(1);
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, new RegExp(`core is \\*\\*${stated.replace(".", "\\.")} KB gzipped`), `README states the core's size as built (${stated} KB)`);
  const site = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(site.includes(`${stated}&nbsp;KB gzipped`), `index.html states the core's size as built (${stated} KB)`);
  const source = core.toString("utf8");
  assert.match(source, /[A-Za-z0-9+\/]{3000,}/, "Earth's mask ships in the core, as one long run-length literal");
  assert.match(source, /London,51\.5,-0\.1/, "and so does the gazetteer");
  // Strings that survive minification and belong to the modules: Equal Earth's
  // first constant, the polar rim error, the globe's dot-shape warning.
  assert.doesNotMatch(source, /1\.340264|cannot reach the opposite pole|draws circle\/square\/triangle/, "the globe and the other projections are not in the core");
});
