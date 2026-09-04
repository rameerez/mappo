// The README's illustrations, regenerated from scripts/readme-poster.html:
//
//   npm run serve                       # the poster needs the repo served
//   node scripts/readme-images.mjs      # writes assets/readme/*.webp
//
// Every scene on the poster is parked (rotate-speed 0, a fixed focus), so a
// rerun writes the same pictures; only a change to the poster or to the
// renderers moves a pixel. Chrome encodes WebP itself, so this needs nothing
// installed beyond the Chrome the other harnesses already use.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:8099";
const OUT = new URL("../assets/readme/", import.meta.url).pathname;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Each tile, and how much bigger than its CSS box it is written: enough for a
// retina screen without paying for pixels GitHub will never show.
const TILES = [
  { id: "t-globe", out: "globe" },
  { id: "t-globe", out: "globe-dark", theme: "dark" },
  { id: "t-links", out: "links" },
  { id: "t-flat", out: "flat", scale: 1.15 },
  { id: "t-equal", out: "equal-earth", scale: 1.15 },
  { id: "t-moon", out: "moon" },
  { id: "t-mars", out: "mars" },
  { id: "t-highlight", out: "highlight", scale: 1.15 },
  { id: "t-styles", out: "styles", scale: 1 }
];
// GitHub lays a README out about 900 px wide, so the wide tiles are written at
// roughly that and the square ones a little over it: enough to stay crisp on a
// retina screen, not so much that the repository carries pixels nobody sees.
const SCALE = 1.4;      // default oversampling
const QUALITY = 72;     // WebP, encoded by Chrome

const port = 9400 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, [ "--headless=new", "--disable-gpu", "--no-first-run",
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/mappo-readme-${port}`,
  "--window-size=1500,1000", "about:blank" ], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { chrome.kill(); throw new Error("no debugging target"); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
let logs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") logs.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 160));
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: method }); } }, 60000);
});
const evaluate = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 2, mobile: false });
mkdirSync(OUT, { recursive: true });

for (const tile of TILES) {
  logs = [];
  await send("Page.navigate", { url: "about:blank" });
  await sleep(120);
  await send("Page.navigate", { url: `${BASE}/scripts/readme-poster.html` });
  await sleep(1200);
  if (tile.theme === "dark") await evaluate(`document.documentElement.dataset.theme = "dark"`);
  // The maps are parked, so this wait is for the packs to decode and the first
  // frame to land, not for an animation to reach a particular moment.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await sleep(3000);
  await evaluate(`document.getElementById(${JSON.stringify(tile.id)}).scrollIntoView({ block: "center", behavior: "instant" })`);
  await sleep(500);
  const rect = await evaluate(`(() => {
    const b = document.getElementById(${JSON.stringify(tile.id)}).getBoundingClientRect();
    return [ b.left + scrollX, b.top + scrollY, b.width, b.height ];
  })()`);
  if (!rect) { console.log(`${tile.out}: no #${tile.id} on the poster`); continue; }
  const shot = await send("Page.captureScreenshot", {
    format: "webp", quality: QUALITY,
    clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3], scale: tile.scale ?? SCALE }
  });
  if (!shot.result?.data) { console.log(`${tile.out}: nothing captured`); continue; }
  const bytes = Buffer.from(shot.result.data, "base64");
  writeFileSync(`${OUT}${tile.out}.webp`, bytes);
  console.log(`assets/readme/${tile.out}.webp  ${String(Math.round(bytes.length / 1024)).padStart(4)} KB  ${rect.slice(2).map(Math.round).join("×")} CSS px${logs.length ? "  ! " + [ ...new Set(logs) ].slice(0, 2).join(" | ") : ""}`);
}

ws.close();
chrome.kill();
