// Browser regression for the landing tour. Start `npm run serve`, then
// `npx playwright install chromium webkit` and `npm run test:tour`.
// CHROME=/path/to/Chrome uses an installed Chromium instead. Optional:
// MAPPO_TOUR_SOURCE=/path/to/old/hero-tour.js proves the checks catch the bug.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const base = process.env.MAPPO_URL || 'http://localhost:8099';
const out = process.env.MAPPO_TOUR_OUT || '.cache/tour-regression';
await mkdir(out, { recursive: true });
const source = process.env.MAPPO_TOUR_SOURCE && await readFile(process.env.MAPPO_TOUR_SOURCE, 'utf8');
const results = [];
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch(name === 'chromium' && process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    for (const [width, height] of [[390, 664], [844, 390], [1300, 900]]) {
      const id = `${name}-${width}x${height}`;
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 900 ? 3 : 1,
        isMobile: width < 900, hasTouch: width < 900 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      if (source) await page.route('**/assets/hero-tour.js*', route => route.fulfill({ contentType: 'text/javascript', body: source }));
      try {
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.mappo-tour.title.on', { state: 'attached' });
        // The title has a fixed anchor. Hold the clock so test speed cannot
        // accidentally turn a scroll assertion into an arc/rotation assertion.
        await page.evaluate(() => { document.getElementById('hero').tour.state.held = true; });
        await page.waitForTimeout(400); // let the intentional entrance transition finish
        const before = await readAnchor(page);
        const samples = [before];
        for (const y of [220, 480, 1100, 0]) {
          await scroll(page, y);
          samples.push(await readAnchor(page));
          sameAnchor(samples.at(-1), before, `scroll ${y}`);
        }
        await captureHero(page, `${out}/${id}-light.png`);
        // Same-width viewport changes reproduce the layout half of Safari's
        // toolbar behavior. Desktop WebKit cannot reproduce iOS compositing.
        await page.setViewportSize({ width, height: height + 180 });
        await page.waitForTimeout(100);
        sameAnchor(await readAnchor(page), before, 'height-only viewport change');
        await scroll(page, 480);
        await nextTitle(page);
        sameAnchor(await readAnchor(page), before, 'new step after viewport change + scroll');
        await scroll(page, 0);
        await page.locator('#theme').click();
        await captureHero(page, `${out}/${id}-dark.png`);
        sameAnchor(await readAnchor(page), before, 'theme change');

        // Resize while the title is active: its complete pill, not its zero-
        // sized positioning node, must still fit horizontally.
        await page.setViewportSize({ width: width === 390 ? 844 : 390, height: width === 390 ? 390 : 844 });
        await page.waitForTimeout(200);
        const resized = await readAnchor(page);
        assert.ok(resized.card.left >= 7 && resized.card.right <= resized.viewport.width - 7, `rotated card fits: ${JSON.stringify(resized)}`);
        await page.setViewportSize({ width, height });
        await scroll(page, 0);
        await nextTitle(page);

        // Choose the real pins step (all projection/drawing code is unchanged).
        await page.evaluate(() => {
          const s = document.getElementById('hero').tour.state;
          s.i = 2; s.step = null; s.held = false;
        });
        await page.waitForFunction(() => document.getElementById('hero').tour.state.subject?.kind === 'pins');
        await page.evaluate(() => {
          const s = document.getElementById('hero').tour.state;
          s.held = true; s.t0 = performance.now() / 1000 - 2;
        });
        await page.waitForSelector('.mappo-tour-label.on .in');
        await page.waitForTimeout(300); // finish the label entrance, not just its positioning node
        for (const y of [0, 220, 480, 0]) {
          await scroll(page, y);
          const pins = await page.evaluate(() => {
            const el = document.getElementById('hero'), b = el.getBoundingClientRect();
            return [...el.querySelectorAll('.mappo-tour-label')].slice(0, el.tour.state.subject.pins.length).map((label, i) => {
              const p = el.tour.state.subject.pins[i], q = el.map.locate(p.lat, p.lon), r = label.getBoundingClientRect();
              return { name: p.name, dx: r.left - b.left - q.x, dy: r.top - b.top - q.y };
            });
          });
          assert.ok(pins.length, 'pins test must actually exercise labels');
          assert.ok(pins.every(p => Math.abs(p.dx) < 0.15 && Math.abs(p.dy) < 0.15), `pin anchors at scroll ${y}: ${JSON.stringify(pins)}`);
        }
        await captureHero(page, `${out}/${id}-pins.png`);
        // A canceled touch resumes the tour; reset restarts at its home view.
        await page.locator('#hero').dispatchEvent('pointerdown', { pointerId: 1 });
        await page.locator('#hero').dispatchEvent('pointercancel', { pointerId: 1 });
        assert.equal(await page.evaluate(() => document.getElementById('hero').tour.state.held), false);
        await page.locator('.mappo-tour-reset').dispatchEvent('click');
        await page.waitForSelector('.mappo-tour.title.on', { state: 'attached', timeout: 15000 });
        // WebKit emits this deferred-observation notification on the unchanged
        // landing page too (verified by substituting the pre-fix tour). Record
        // it explicitly; fail on any other exception or a persistent loop.
        const warnings = name === 'webkit' ? errors.filter(e => e === 'ResizeObserver loop completed with undelivered notifications.') : [];
        assert.deepEqual(errors.filter(e => !warnings.includes(e)), [], 'no uncaught page exceptions');
        assert.ok(warnings.length <= 2, `persistent resize loop: ${warnings.length} notifications`);
        results.push({ id, passed: true, warnings, scrollSamples: samples.map(s => ({ scroll: s.scroll, x: s.x, y: s.y })) });
        console.log(`PASS ${id}: scroll, toolbar height, next step, theme, resize, pins, cancel/reset`);
      } catch (e) {
        results.push({ id, passed: false, error: e.message, stack: e.stack, errors });
        await page.screenshot({ path: `${out}/${id}-failure.png` }).catch(() => {});
        console.error(`FAIL ${id}: ${e.message}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n');
if (results.some(r => !r.passed)) process.exitCode = 1;

async function scroll(page, y) {
  await page.evaluate(y => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo({ top: y, behavior: 'instant' }); }, y);
  await page.waitForFunction(y => Math.abs(scrollY - y) < 2, y);
  await page.waitForTimeout(100);
}
async function captureHero(page, path) {
  const y = await page.evaluate(() => {
    const r = document.querySelector('.mappo-tour-card').getBoundingClientRect();
    return Math.max(0, Math.round(scrollY + r.top + r.height / 2 - innerHeight / 2));
  });
  await scroll(page, y);
  await page.screenshot({ path });
  await scroll(page, 0);
}
async function nextTitle(page) {
  const old = await page.evaluate(() => {
    const s = document.getElementById('hero').tour.state, old = s.t0;
    s.i = -1; s.step = null; s.held = false;
    return old;
  });
  await page.waitForFunction(old => { const s = document.getElementById('hero').tour.state; return s.step?.style === 'title' && s.t0 !== old; }, old);
  await page.evaluate(() => { document.getElementById('hero').tour.state.held = true; });
  await page.waitForTimeout(400);
}
async function readAnchor(page) {
  return page.evaluate(() => {
    const el = document.getElementById('hero'), b = el.getBoundingClientRect();
    const root = el.querySelector('.mappo-tour'), r = root.getBoundingClientRect(), card = root.firstElementChild.getBoundingClientRect();
    return { x: r.left - b.left, y: r.top - b.top, scroll: scrollY, card: card.toJSON(),
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight } };
  });
}
function sameAnchor(a, b, reason) {
  assert.ok(Math.abs(a.x - b.x) < 0.15 && Math.abs(a.y - b.y) < 0.15,
    `${reason}: globe-local anchor moved (${b.x}, ${b.y}) → (${a.x}, ${a.y})`);
}
