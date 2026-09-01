// The clock these pages are driven by, and the bar you drive it with.
//
// One `simTime` is the whole page's authority and the slider is a VIEW of it
// rather than a second control, so scrubbing, playback and the transport keys
// can never disagree about what time it is. Both the satellite tracker and the
// orbit page import this: a demo that showed two different "now"s would be
// worse than one that showed none.
//
// The bar carries its own stylesheet, injected once, so using it is one import
// and a mount point. Colours come from --tc-* with defaults, so a host page can
// re-tint it without knowing anything about the markup.

const CSS = `
.tc{width:min(660px,58vw)}
.tc-bar{display:flex;align-items:center;gap:11px;
  background:var(--tc-bg,rgb(10 16 26 / .72));
  border:1px solid var(--tc-line,#1b2634);border-radius:13px;
  padding:9px 13px;backdrop-filter:blur(7px)}
.tc-bar button{background:none;border:1px solid transparent;color:var(--tc-dim,#8b98ad);
  border-radius:7px;padding:4px 9px;font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;
  cursor:pointer;flex:none;min-width:38px}
.tc-bar button:hover{color:var(--tc-ink,#e8eef7);border-color:var(--tc-line,#1b2634)}
.tc-bar button[aria-pressed="true"]{color:var(--tc-accent,#ffb454);border-color:var(--tc-line,#1b2634)}
.tc-keys{display:flex;gap:2px;flex:none}
.tc-bar .tc-k{min-width:31px;padding:4px 6px;font-size:11px;letter-spacing:.5px}
.tc-rate{flex:none;min-width:54px;text-align:center;color:var(--tc-accent,#ffb454);
  font:600 11.5px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.tc-rate.tc-held{color:var(--tc-faint,#4a5668)}
/* A hairline at the middle of the track: without it the slider has no zero,
   and "back to now" is a place you can only reach with the button. */
.tc-scrub{flex:1;min-width:0;height:4px;-webkit-appearance:none;appearance:none;
  background:
    linear-gradient(90deg,transparent calc(50% - .5px),rgb(220 233 247 / .45) calc(50% - .5px),
      rgb(220 233 247 / .45) calc(50% + .5px),transparent calc(50% + .5px)),
    linear-gradient(90deg,#20303f,#3a5670,#20303f);
  border-radius:3px;cursor:ew-resize}
.tc-scrub::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;
  background:var(--tc-accent,#ffb454);border:2px solid #0b1119;
  box-shadow:0 0 9px rgb(255 180 84 / .55);cursor:grab}
.tc-scrub::-moz-range-thumb{width:13px;height:13px;border-radius:50%;
  background:var(--tc-accent,#ffb454);border:2px solid #0b1119;cursor:grab}
.tc-cap{margin-top:8px;text-align:center;
  font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--tc-faint,#4a5668)}
.tc-cap b{color:var(--tc-dim,#8b98ad);font-weight:600}
@media(max-width:820px){ .tc{width:calc(100vw - 56px)} }
`;

function injectCss() {
  if (typeof document === "undefined" || document.getElementById("tc-style")) return;
  const el = document.createElement("style");
  el.id = "tc-style";
  el.textContent = CSS;
  document.head.append(el);
}

// A shuttle, not a cycle: rewind walks left along the ladder and fast-forward
// walks right, so holding one direction accelerates and the other slows you
// down and then turns you round. No wrap — reaching the end of a transport
// control and finding yourself at the other end is disorienting.
const SPEEDS = [ -600, -60, -1, 1, 60, 600 ];

// How far from real time, in words rather than in minutes.
function saySpan(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 1) return null;
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  const parts = d ? [ `${d} d`, `${h % 24} h` ] : h ? [ `${h} h`, `${m % 60} min` ] : [ `${m} min` ];
  return parts.filter((x) => !/^0 /.test(x)).join(" ");
}

/**
 * @param mount   [HTMLElement] emptied and filled with the bar.
 * @param windowH [Number] hours either side of real time the slider can reach.
 *   Default two days, which is roughly how long a satellite element set stays
 *   honest; an orbit page can afford a year.
 * @param speeds  [Array] the speed ladder, ascending through zero.
 * @param onScrub [Function] called when the user moves time by hand, so the
 *   page can repaint on the spot instead of on the next frame — a control that
 *   answers a beat late reads as a control that did not work.
 * @param hint    [String] shown in the caption while the clock is at real time.
 * @param rateLabel [Function] names a speed. "2592000×" tells you nothing you
 *   can picture; "1 mo/s" does. Defaults to the multiplier.
 */
export function createClock({ mount, windowH = 48, speeds = SPEEDS, onScrub, hint = "",
                              rateLabel = (w) => `${w < 0 ? "−" : ""}${Math.abs(w)}×`,
                              startSpeed = 1 } = {}) {
  injectCss();
  const windowMs = windowH * 3600000;
  const minutes = Math.round(windowMs / 60000);

  mount.classList.add("tc");
  mount.innerHTML =
    `<div class="tc-bar">
      <div class="tc-keys">
        <button class="tc-k" data-tc="rew" type="button" title="backwards, faster" aria-label="rewind">◀◀</button>
        <button class="tc-k" data-tc="play" type="button" aria-pressed="true" title="play or pause" aria-label="play or pause">❚❚</button>
        <button class="tc-k" data-tc="ff" type="button" title="forwards, faster" aria-label="fast forward">▶▶</button>
      </div>
      <span class="tc-rate" data-tc="rate" aria-live="polite">1×</span>
      <input class="tc-scrub" data-tc="scrub" type="range" min="${-minutes}" max="${minutes}" step="1" value="0"
        aria-label="time offset from now, in minutes">
      <button data-tc="reset" type="button" title="back to real time at 1× speed">reset</button>
    </div>
    <div class="tc-cap" data-tc="cap"></div>`;

  const el = (k) => mount.querySelector(`[data-tc="${k}"]`);
  const scrub = el("scrub"), rate = el("rate"), play = el("play"), cap = el("cap");

  let simTime = Date.now();
  let lastReal = Date.now();
  const home = speeds.indexOf(1) >= 0 ? speeds.indexOf(1) : Math.floor(speeds.length / 2);
  // A page whose whole point is motion should not open standing still.
  let speedIx = speeds.indexOf(startSpeed) >= 0 ? speeds.indexOf(startSpeed) : home;
  let playing = true, scrubbing = false;

  const api = {
    now: () => new Date(simTime),
    get playing() { return playing; },
    get warp() { return speeds[speedIx]; },
    get scrubbing() { return scrubbing; },
    get offset() { return simTime - Date.now(); },

    // Advance the clock. Call once per frame, before reading now().
    step() {
      const t = Date.now();
      if (playing) simTime += (t - lastReal) * api.warp;
      lastReal = t;
      // Running to the end of the window stops rather than silently pinning: a
      // clock that has quit telling the truth while the button still says
      // "playing" is worse than one that stops.
      const off = simTime - Date.now();
      if (Math.abs(off) > windowMs) {
        simTime = Date.now() + Math.sign(off) * windowMs;
        setPlaying(false);
      }
    },

    // Repaint the slider and caption. Cheap; call it whenever the page does.
    render() {
      const off = simTime - Date.now();
      if (!scrubbing) scrub.value = String(Math.round(off / 60000));
      const span = saySpan(off);
      cap.innerHTML = span
        ? `<b>${span} ${off > 0 ? "ahead of" : "behind"}</b> real time${playing ? "" : " · paused"}`
        : `real time${playing ? "" : " · paused"}${hint && playing ? ` · ${hint}` : ""}`;
    },

    setTime(ms) { simTime = ms; lastReal = Date.now(); }
  };

  function showRate() {
    rate.textContent = rateLabel(api.warp);
    rate.classList.toggle("tc-held", !playing);
    el("rew").setAttribute("aria-pressed", String(playing && api.warp < 0));
    el("ff").setAttribute("aria-pressed", String(playing && api.warp > 1));
  }
  function setPlaying(on) {
    playing = on;
    play.textContent = on ? "❚❚" : "▶";
    play.setAttribute("aria-pressed", String(on));
    showRate();
    api.render();
  }
  function setSpeed(ix) {
    speedIx = Math.max(0, Math.min(speeds.length - 1, ix));
    setPlaying(true);
  }

  el("play").onclick = () => setPlaying(!playing);
  el("rew").onclick = () => setSpeed(speedIx - 1);
  el("ff").onclick = () => setSpeed(speedIx + 1);
  el("reset").onclick = () => {
    api.setTime(Date.now());
    scrub.value = "0";
    setSpeed(speeds.indexOf(startSpeed) >= 0 ? speeds.indexOf(startSpeed) : home);
    onScrub?.();
  };

  // While the pointer is down the slider is the authority; the rest of the
  // time it follows the clock. Without that the frame loop fights the drag.
  const grab = () => { scrubbing = true; };
  const drop = () => { scrubbing = false; lastReal = Date.now(); };
  scrub.addEventListener("pointerdown", grab);
  scrub.addEventListener("pointerup", drop);
  scrub.addEventListener("pointercancel", drop);
  scrub.addEventListener("change", drop);       // a keyboard user never fires pointerup
  scrub.addEventListener("input", () => {
    api.setTime(Date.now() + Number(scrub.value) * 60000);
    api.render();
    onScrub?.();
  });

  // The same three keys from the keyboard, skipped while a control has focus
  // so the slider keeps its own arrows.
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest("input, button, select, textarea")) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "ArrowLeft") setSpeed(speedIx - 1);
    else if (e.key === "ArrowRight") setSpeed(speedIx + 1);
  });

  showRate();
  api.render();
  return api;
}
