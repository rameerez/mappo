// Drive a real pointer drag on a page's globe in headless Chrome over CDP, and
// report how the globe's spin angle and draw count evolve, sample by sample:
// during the drag, through the flick's momentum, and to rest. The one check no
// unit test can make — that a globe follows the pointer in a real browser —
// and the regression this file was written for (the frame loop judged "moved"
// against its own start and never saw pointer-driven changes) took a person
// to notice. Serve the repo (any static server) and run:
//
//   node scripts/drag-harness.mjs http://localhost:8099/demo/worlds.html 'mappo-moon[mode="globe"]'
//   node scripts/drag-harness.mjs <url> <selector> [x y]      (x y: where to press, page px)
//
// Expect: the angle and the draw count advance with every "moved" line, keep
// going for a few seconds after "released" (momentum), and stop together once
// the globe is at rest. Draw cost is measured inside the page. macOS Chrome path
// below; point CHROME elsewhere on another platform.
import { spawn } from "node:child_process";

const [ url, selector, sx, sy ] = process.argv.slice(2);
if (!url || !selector) { console.error("usage: node drag-harness.mjs <url> <selector> [x y]"); process.exit(1); }
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9333 + Math.floor(Math.random() * 100);
const chrome = spawn(CHROME, [ "--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/mappo-drag-${port}`, "--window-size=1300,900", "about:blank" ], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {}
}
if (!wsUrl) { chrome.kill(); throw new Error("no debugging target"); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed"); return r.result?.result?.value; };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(3500);   // module graph, packs, first frames

// Instrument: count draws and measure their cost, from inside the page.
const ok = await evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el?.map?._renderer) return "no renderer on " + ${JSON.stringify(selector)} + " (pending=" + (el?.map?.pending ?? "n/a") + ")";
  const r = el.map._renderer;
  window.__probe = { draws: 0, cost: [] };
  const draw = r._draw.bind(r);
  r._draw = () => { const t0 = performance.now(); draw(); window.__probe.draws++; window.__probe.cost.push(performance.now() - t0); };
  window.__angle = () => r.angle;
  return "ok side=" + r.side + " angle=" + r.angle.toFixed(2) + " static=" + r._static + " interactive=" + el.map.options.interactive;
})()`);
console.log("probe:", ok);
await evaluate(`(() => { document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" }); return true; })()`);
await sleep(400);
const rect = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
console.log("element box (after scrollIntoView):", rect.map((v) => Math.round(v)).join(" "));
const x0 = sx ? Number(sx) : Math.round(rect[0] + rect[2] / 2) - 100, y0 = sy ? Number(sy) : Math.round(rect[1] + rect[3] / 2);
console.log("press at", x0, y0, "— inside the element:", x0 >= rect[0] && x0 <= rect[0] + rect[2] && y0 >= rect[1] && y0 <= rect[1] + rect[3]);
const sample = async (label) => { const a = await evaluate("window.__angle()"); const d = await evaluate("window.__probe.draws"); console.log(`${label.padEnd(26)} angle ${a.toFixed(2).padStart(8)}  draws ${String(d).padStart(4)}`); };

await sample("before press");
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1, pointerType: "mouse" });
await sleep(50);
await sample("after press");
// Drag right in 8 steps, sampling after each step so drawing DURING the drag is visible.
for (let i = 1; i <= 8; i++) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + i * 25, y: y0, button: "left", buttons: 1, pointerType: "mouse" });
  await sleep(70);
  await sample(`moved +${i * 25}px`);
}
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x0 + 200, y: y0, button: "left", clickCount: 1, pointerType: "mouse" });
await sleep(60);
await sample("released");
await sleep(400);
await sample("+400ms (momentum)");
await sleep(800);
await sample("+1200ms");
await sleep(1800);
await sample("+3000ms");
await sleep(3000);
await sample("+6000ms (at rest?)");
await sleep(1000);
await sample("+7000ms");
const cost = await evaluate("(() => { const c = window.__probe.cost.slice(-60); c.sort((a,b)=>a-b); return { n: c.length, p50: c[Math.floor(c.length/2)], p95: c[Math.floor(c.length*0.95)], max: c[c.length-1] }; })()");
console.log("draw cost (last 60 frames, ms):", JSON.stringify(cost, (k, v) => typeof v === "number" ? Number(v.toFixed(2)) : v));
ws.close(); chrome.kill();
