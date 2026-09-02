// Screenshot one element of a page after `wait` ms of real time in headless
// Chrome:  node shot.mjs <url> <out.png> <waitMs> [selector] [width] [height]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [ url, out, waitMs = "5000", selector = "body", width = "1300", height = "1700" ] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, [ "--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/mappo-shot-${port}`, `--window-size=${width},${height}`, "about:blank" ], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { chrome.kill(); throw new Error("no debugging target"); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const pending = new Map(); const logs = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") logs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" ")); });
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: method }); } }, 20000); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
await sleep(1500);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });   // wake the animation frames
await sleep(Number(waitMs));
const rect = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3], scale: 1 } });
if (shot.result?.data) writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`${out} ← ${selector} ${rect.map(Math.round).join(" ")} after ${waitMs} ms${logs.length ? "\n  ! " + [ ...new Set(logs) ].slice(0, 5).join("\n  ! ") : ""}`);
ws.close(); chrome.kill();
