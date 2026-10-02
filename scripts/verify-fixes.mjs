/**
 * Behavioural regression check for the reported UI bugs.
 *
 *   npm run build && node scripts/verify-fixes.mjs
 *
 * Boots the production bundle in the locally installed Chrome and asserts, from the
 * DOM, that each reported defect is actually gone — the smoke script proves the app
 * still runs, this proves the specific fixes hold. Screenshots for the purely visual
 * items land in `.smoke/verify-*.png`.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, '.smoke');
const PORT = 5398;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      if (!file.startsWith(DIST)) return void res.writeHead(403).end();
      if (!existsSync(file) || url.pathname.endsWith('/')) file = path.join(DIST, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const skip = (name, why) => console.log(`  skip  ${name} — ${why}`);

const timerSeconds = (text) =>
  [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*s\b/g)].map((m) => Number(m[1]));

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html missing — run `npm run build` first');
  await mkdir(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome', args: ['--mute-audio', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage();
  const base = `http://127.0.0.1:${PORT}/`;
  const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `verify-${name}.png`) });
  const primary = (p) =>
    p.locator('.btn--primary').first().click({ timeout: 5000 }).catch(() => {});

  /* ── A. Pitch timer survives a module switch ───────────────────────── */
  console.log('\nA. Pitch timer after switching modules');
  await page.goto(`${base}#/pitch`, { waitUntil: 'load' });
  await page.waitForSelector('.pt', { timeout: 20000 });
  await page.waitForTimeout(600);
  await primary(page);
  await page.waitForTimeout(1400);
  const before = await page.locator('.ticker__body, .ticker, body').first().innerText();
  await page.goto(`${base}#/daw`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.goto(`${base}#/pitch`, { waitUntil: 'load' });
  await page.waitForSelector('.pt', { timeout: 20000 });
  await page.waitForTimeout(1600);
  const after = await page.locator('.ticker__body, .ticker, body').first().innerText();
  const vals = [...timerSeconds(before), ...timerSeconds(after)];
  const worst = vals.length ? Math.max(...vals) : 0;
  check('timer never shows an epoch-sized value', vals.length > 0 && worst < 3600, `max ${worst}s over ${vals.length} readings`);
  await shot(page, 'A-pitch-after-module-switch');

  /* ── B. Playhead follows the drag ──────────────────────────────────── */
  console.log('\nB. Studio playhead follows the pointer');
  await page.goto(`${base}#/daw`, { waitUntil: 'load' });
  await page.waitForSelector('.tl__canvas', { timeout: 20000 });
  const trackBtn = page.locator('button', { hasText: /^TRACK$/i }).first();
  if (await trackBtn.count()) await trackBtn.click().catch(() => {});
  await page.waitForTimeout(500);
  const ruler = page.locator('.tl__ruler').first();
  const posRead = page.locator('.transport__pos').first();
  const rb = await ruler.boundingBox();
  if (rb && (await posRead.count())) {
    const readPos = async () => (await posRead.innerText()).trim();
    const y = rb.y + rb.height / 2;
    const x1 = rb.x + rb.width * 0.2;
    const x2 = rb.x + rb.width * 0.5;
    const x3 = rb.x + rb.width * 0.8;
    const t0 = await readPos();
    await page.mouse.move(x1, y);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const t1 = await readPos();
    await page.mouse.move(x2, y, { steps: 8 });
    await page.waitForTimeout(120);
    const t2 = await readPos();
    await page.mouse.move(x3, y, { steps: 8 });
    await page.waitForTimeout(120);
    const t3 = await readPos();
    await page.mouse.up();
    await page.waitForTimeout(200);
    const t4 = await readPos();
    const num = (s) => {
      const m = s.match(/(\d+):(\d+)(?:\.(\d+))?/);
      return m ? Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] ?? 0}`) : NaN;
    };
    const seq = [t0, t1, t2, t3].map(num);
    const followsDuringDrag = seq.every((v) => !Number.isNaN(v)) && seq[3] > seq[1] && seq[2] > seq[1];
    check('readout advances while the pointer is still down', followsDuringDrag, `${t1} → ${t2} → ${t3} during drag`);
    check('release does not snap the playhead back', t4 === t3, `held ${t3}, released ${t4}`);
  } else {
    skip('playhead drag', 'ruler or transport readout not found');
  }

  /* ── C/D. Pitch dial: clipping and highlight agreement ─────────────── */
  console.log('\nC. Pitch dial is not clipped');
  await page.goto(`${base}#/pitch`, { waitUntil: 'load' });
  await page.waitForSelector('.pt', { timeout: 20000 });
  const dialTab = page.locator('.seg__opt', { hasText: /^\s*(Dial|Radial)\s*$/i }).first();
  if (await dialTab.count()) await dialTab.click().catch(() => {});
  await page.waitForTimeout(600);
  const dial = page.locator('.dial').first();
  const svg = page.locator('.dial__svg').first();
  if (await dial.count() && await svg.count()) {
    const dbox = await dial.boundingBox();
    const sbox = await svg.boundingBox();
    if (dbox && sbox) {
      const square = Math.abs(sbox.width - sbox.height) <= 2;
      const inside = sbox.x >= dbox.x - 2 && sbox.y >= dbox.y - 2 &&
        sbox.x + sbox.width <= dbox.x + dbox.width + 2 &&
        sbox.y + sbox.height <= dbox.y + dbox.height + 2;
      check('dial renders square', square, `${sbox.width.toFixed(0)}x${sbox.height.toFixed(0)}`);
      check('dial is fully inside its wrapper', inside,
        `dial ${sbox.width.toFixed(0)}x${sbox.height.toFixed(0)} in wrapper ${dbox.width.toFixed(0)}x${dbox.height.toFixed(0)}`);
      const clipped = await page.evaluate(() => {
        const el = document.querySelector('.dial__svg');
        let node = el?.parentElement ?? null;
        const bad = [];
        while (node && node !== document.body) {
          const cs = getComputedStyle(node);
          if (/(hidden|clip|scroll|auto)/.test(cs.overflow + cs.overflowY + cs.overflowX)) {
            if (node.clientHeight + 1 < (el?.getBoundingClientRect().height ?? 0)) {
              bad.push(`${node.className || node.tagName}: overflow ${cs.overflowY}, clientH ${node.clientHeight}`);
            }
          }
          node = node.parentElement;
        }
        return bad;
      });
      check('no ancestor clips the dial', clipped.length === 0, clipped.join(' | ') || 'clean');
    }
  } else {
    skip('dial geometry', '.dial / .dial__svg not found');
  }

  console.log('\nD. Dial highlight agrees with the selected item');
  const geo = await page.evaluate(() => {
    const dial = document.querySelector('.dial');
    const svg = dial?.querySelector('svg');
    if (!dial || !svg) return null;
    const selectedLabels = [...dial.querySelectorAll('.dial__lab[data-sel]')];
    const arcs = [...svg.querySelectorAll('path')].filter((p) => /^M[\d.]+ [\d.]+A/.test(p.getAttribute('d') ?? ''));
    if (!arcs.length) return { arcs: 0, labels: selectedLabels.length };
    const widths = arcs.map((a) => Number(a.getAttribute('stroke-width') ?? 0));
    const maxW = Math.max(...widths);
    const lit = arcs.filter((a) => Number(a.getAttribute('stroke-width') ?? 0) === maxW);
    // Dial centre is (r, r); recover it from the viewBox.
    const vb = (svg.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number);
    const cx = vb[2] / 2;
    const cy = vb[3] / 2;
    const angleOf = (x, y) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
    const litAngles = lit.map((a) => {
      const pt = a.getPointAtLength(a.getTotalLength() / 2);
      return angleOf(pt.x, pt.y);
    });
    const labelAngles = selectedLabels.map((t) =>
      angleOf(Number(t.getAttribute('x')), Number(t.getAttribute('y'))),
    );
    return { arcs: arcs.length, labels: selectedLabels.length, lit: litAngles, label: labelAngles, maxW };
  });
  if (!geo) skip('dial highlight', '.dial svg not found');
  else if (geo.arcs === 0) skip('dial highlight', 'no arc segments found');
  else {
    const delta = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    check('exactly one segment is highlighted', geo.lit.length === 1, `${geo.lit.length} lit of ${geo.arcs} arcs (stroke ${geo.maxW})`);
    check('exactly one label is marked selected', geo.labels === 1, `${geo.labels} labels with data-sel`);
    if (geo.lit.length === 1 && geo.label.length === 1) {
      const d = delta(geo.lit[0], geo.label[0]);
      check('lit segment is centred on the selected label', d <= 3,
        `segment mid ${geo.lit[0].toFixed(1)}° vs label ${geo.label[0].toFixed(1)}° (Δ${d.toFixed(1)}°)`);
    }
  }
  await shot(page, 'D-dial');

  /* ── E. Signal monitor height ──────────────────────────────────────── */
  console.log('\nE. Signal monitor height');
  const screenH = await page.evaluate(() => {
    const el = document.querySelector('.pt-scope__screen');
    return el ? { h: el.clientHeight, canvas: el.querySelector('canvas')?.clientHeight ?? 0 } : null;
  });
  if (screenH) check('monitor screen has usable height', screenH.h >= 110 && screenH.canvas >= 100, `screen ${screenH.h}px, canvas ${screenH.canvas}px`);
  else skip('monitor height', '.pt-scope__screen not found');

  /* ── H. Defect layer: no flashing at the frame edge ────────────────── */
  console.log('\nH. Defect layer always covers the frame edge');
  // The edge flicker was the jittering grain layer stepping off the frame edge, so the
  // layer must cover the whole viewport at every step of its animation — not merely
  // produce identical frames (the grain, roll bar and scanlines animate by design).
  const coverage = await page.evaluate(async () => {
    const el = document.querySelector('.fx-noise') ?? document.querySelector('.fx-stack > *:nth-child(2)');
    if (!el) return null;
    const samples = [];
    for (let i = 0; i < 12; i += 1) {
      const r = el.getBoundingClientRect();
      samples.push({
        l: Math.round(r.left), t: Math.round(r.top),
        rr: Math.round(window.innerWidth - r.right), b: Math.round(window.innerHeight - r.bottom),
      });
      await new Promise((res) => setTimeout(res, 120));
    }
    return samples;
  });
  if (!coverage) skip('defect layer coverage', '.fx-noise not found');
  else {
    const worstL = Math.max(...coverage.map((c) => c.l));
    const worstT = Math.max(...coverage.map((c) => c.t));
    const worstR = Math.max(...coverage.map((c) => c.rr));
    const worstB = Math.max(...coverage.map((c) => c.b));
    const covered = [worstL, worstT, worstR, worstB].every((v) => v <= 1);
    check('grain layer covers the frame at every animation step', covered,
      `worst gaps l/t/r/b = ${worstL}/${worstT}/${worstR}/${worstB}px over ${coverage.length} samples`);
  }

  /* ── I. Text-labelled switch margins ───────────────────────────────── */
  console.log('\nI. Switch label margins');
  const gaps = await page.evaluate(() => {
    // A label and its control are commonly pushed apart by a wide row (space-between),
    // so the meaningful number is the row's declared gap, which one token now owns.
    const rows = [...document.querySelectorAll('.field, .toggle-row, .knob, .fader')];
    const out = [];
    for (const row of rows) {
      const cs = getComputedStyle(row);
      const gap = cs.columnGap && cs.columnGap !== 'normal' ? cs.columnGap : cs.gap;
      if (!gap || gap === 'normal') continue;
      const label = row.querySelector('.field__label, .t-label, .toggle-row__label, .knob__label, .fader__label');
      if (!label) continue;
      out.push({ label: (label.textContent ?? '').trim().slice(0, 18), gap: Math.round(parseFloat(gap)) });
    }
    return out;
  });
  if (gaps.length === 0) skip('switch margins', 'no label + .seg pairs found');
  else {
    const values = gaps.map((g) => g.gap);
    const spread = Math.max(...values) - Math.min(...values);
    check('switch label gaps are consistent', spread <= 1, `gaps ${values.join(', ')} (spread ${spread}px)`);
    check('switch label gaps are positive', Math.min(...values) > 0, `min ${Math.min(...values)}px`);
  }

  /* ── J. Double-click reset must not select text ────────────────────── */
  console.log('\nJ. Double-click reset leaves no text selection');
  const knob = page.locator('.knob__dial').first();
  if (await knob.count()) {
    await knob.dblclick({ force: true }).catch(() => {});
    await page.waitForTimeout(250);
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    check('no selection after double-click reset', sel.trim() === '', sel ? `selected "${sel.slice(0, 40)}"` : 'selection empty');
  } else skip('double-click selection', '.knob__dial not found');

  /* ── K. Pressed button keeps its corner radius ─────────────────────── */
  console.log('\nK. Button corner roundness while pressed');
  const btn = page.locator('.btn', { hasText: /\w/ }).first();
  if (await btn.count()) {
    const rest = await btn.evaluate((el) => getComputedStyle(el).borderRadius);
    const bb = await btn.boundingBox();
    if (bb) {
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(160);
      const pressed = await btn.evaluate((el) => getComputedStyle(el).borderRadius);
      await page.mouse.up();
      await page.waitForTimeout(120);
      check('pressed radius matches released radius', rest === pressed, `rest ${rest} vs pressed ${pressed}`);
    } else skip('button radius', 'no bounding box');
  } else skip('button radius', '.btn not found');

  /* ── F/G. Portrait: weakness model reachable ──────────────────────── */
  console.log('\nF/G. Weakness model in portrait');
  // Grade one answer on the desktop surface (the piano keys are the desktop default) so the
  // model has data, then resize the *same* session to a phone — exactly the reported scenario.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}#/pitch`, { waitUntil: 'load' });
  await page.waitForSelector('.pt', { timeout: 20000 });
  await page.waitForTimeout(800);
  // The answer surface is persisted, and an earlier check selected the dial — put it back on
  // the piano keys so the desktop drill below is deterministic.
  const keysTab = page.locator('.seg__opt', { hasText: /^\s*Keyboard\s*$/i }).first();
  if (await keysTab.count()) {
    await keysTab.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await primary(page);
  await page.waitForTimeout(1100);
  const seedKey = page.locator('.pkey').nth(8);
  if (await seedKey.count()) await seedKey.click({ force: true });
  await page.waitForTimeout(500);
  const armed = await page
    .waitForFunction(() => {
      const b = [...document.querySelectorAll('.btn--primary')].find((x) => /submit/i.test(x.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (armed) {
    await page.locator('.btn--primary', { hasText: /submit/i }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  check('a graded attempt reaches the model', armed, armed ? 'SUBMIT armed and used' : 'SUBMIT never armed');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  const weak = await page.evaluate(() => {
    const el = document.querySelector('.pt-weak') ?? document.querySelector('.pt-wm');
    if (!el) return { found: false };
    const box = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll('.pt-weakrow')].map((r) => r.getBoundingClientRect().height);
    return {
      found: true,
      visible: el.offsetParent !== null && box.width > 40 && box.height > 40,
      w: Math.round(box.width), h: Math.round(box.height),
      rows: rows.length,
      rowH: rows.length ? Math.round(rows.reduce((a, b) => a + b, 0) / rows.length) : 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (!weak.found) check('weakness model present in portrait', false, '.pt-weak / .pt-wm not in the DOM');
  else {
    check('weakness model visible in portrait', weak.visible, `${weak.w}x${weak.h}px, ${weak.rows} rows`);
    check('no horizontal overflow in portrait', weak.overflow <= 1, `${weak.overflow}px`);
    if (weak.rows >= 3) check('weakness rows are not wasteful', weak.rowH <= 64, `${weak.rows} rows, avg ${weak.rowH}px tall`);
    else skip('weakness density', `only ${weak.rows} row(s) after one drill — a single row stretches to its container (${weak.rowH}px)`);
  }
  await shot(page, 'F-portrait-pitch-weakness');
  await page.setViewportSize({ width: 1440, height: 900 });

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('failing:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
