// Review demo pages in headless Chrome over CDP, in REAL time (no virtual-time
// budget, so animation loops run): console errors and warnings, failed requests,
// every mappo map on the page with its mode and options, and for two seconds of
// steady state per map: frames drawn, draw cost, data rebuilds and update()
// calls — the numbers that tell a parked globe from one that redraws for
// nothing, and a demo that rebuilds geometry every frame from one that only
// re-aims. A screenshot per page. Serve the repo first (npm run serve), then:
//
//   node scripts/review-pages.mjs http://localhost:8099 /tmp/review index.html demo/worlds.html
//   node scripts/review-pages.mjs <base-url> <out-dir> <page> [page…]
//
// Headless Chrome cannot create WebGL contexts, so demo/mars-mission.html (three.js)
// reports its own error here; that page is checked in a real browser. macOS
// Chrome path below; point CHROME elsewhere on another platform.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const [ base, outDir, ...pages ] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const page of pages) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [ "--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/mappo-review-${port}`, "--window-size=1300,1700", "about:blank" ], { stdio: "ignore" });
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200);
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {}
  }
  if (!wsUrl) { chrome.kill(); console.log(`[${page}] no debugging target`); continue; }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const pending = new Map(); const logs = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 220)}`);
    }
    if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0].slice(0, 220)}`);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") logs.push(`log: ${m.params.entry.text.slice(0, 160)} ${m.params.entry.url ?? ""}`);
  });
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: method }); } }, 15000); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description ?? "evaluate failed" }; return r.result?.result?.value; };

  try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1700, deviceScaleFactor: 1, mobile: false });
  const t0 = Date.now();
  await send("Page.navigate", { url: `${base}/${page}` });
  await sleep(3500);
  // Headless pages throttle animation frames until they receive input; one harmless move wakes them.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await sleep(300);
  const instrumented = await evaluate(`(() => {
    const maps = [ ...document.querySelectorAll("*") ].filter((e) => e.map && e.map.options);
    window.__rev = maps.map((el) => {
      const m = el.map, r = m._renderer ?? m._globe, o = m.options;
      const rec = { el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), mode: o.mode, cols: o.cols ?? "auto", figure: o.figure + (o.figureSource === "vector" ? "/vector" : "") + (o.borders ? "+borders" : ""),
        projection: typeof o.projection === "string" ? o.projection : "custom", body: m.body?.id, pending: m.pending, dots: m._dotCount ?? (r?.points ? r.points.length / 3 : null),
        draws: 0, cost: 0, rebuilds: 0, updates: 0, geometryUpdates: 0, animation: o.animation, rotateSpeed: o.rotateSpeed, fog: !!o.fog, tiles: o.dotShape === "tile", distribution: o.distribution };
      if (r) {
        const d = r._draw.bind(r); r._draw = () => { const t = performance.now(); d(); rec.draws++; rec.cost += performance.now() - t; };
        const rb = r._rebuildData.bind(r); r._rebuildData = () => { rec.rebuilds++; rb(); };
      }
      const u = m.update.bind(m);
      const PAINT = r?.constructor?.PAINT_ONLY;
      m.update = (opts) => { rec.updates++; if (PAINT && Object.keys(opts ?? {}).some((k) => !PAINT.has(k) && JSON.stringify(opts[k]) !== JSON.stringify(m.options[k]))) rec.geometryUpdates++; return u(opts); };
      return rec;
    });
    return window.__rev.length;
  })()`);
  await sleep(2000);
  const maps = await evaluate("window.__rev ?? []");
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = `${outDir}/${page.replace(/[\/.]/g, "_")}.png`;
  if (shot.result?.data) writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`\n=== ${page}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${typeof instrumented === "number" ? instrumented : JSON.stringify(instrumented)} maps) → ${file}`);
  for (const l of [ ...new Set(logs) ].slice(0, 8)) console.log("  !", l);
  if (Array.isArray(maps)) for (const r of maps) {
    const fps = (r.draws / 2).toFixed(0), ms = r.draws ? (r.cost / r.draws).toFixed(1) : "-";
    console.log(`  ${r.el.padEnd(22)} ${String(r.mode).padEnd(5)} cols=${String(r.cols).padEnd(4)} ${r.figure.padEnd(22)} proj=${r.projection.padEnd(16)} body=${String(r.body).padEnd(6)} dots=${String(r.dots ?? "-").padEnd(6)} ` +
      `${r.pending ? "PENDING:" + r.pending + " " : ""}draws/2s=${String(r.draws).padEnd(4)} (~${fps}/s) cost=${ms}ms rebuilds=${r.rebuilds} updates=${r.updates}${r.geometryUpdates ? " GEOMETRY-UPDATES=" + r.geometryUpdates : ""}${r.fog ? " fog" : ""}${r.tiles ? " tiles" : ""}${r.distribution === "uniform" ? " uniform" : ""}${r.animation && r.animation !== "none" ? " anim=" + r.animation : ""}`);
  }
  } catch (e) { console.log(`[${page}] harness error: ${e.message}`); }
  ws.close(); chrome.kill();
}
