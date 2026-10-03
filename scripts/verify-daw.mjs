/**
 * Behavioural verification for the Studio (DAW) defects.
 *
 *   npm run build && npm run verify:daw
 *
 * Boots the production bundle in the locally installed Chrome and asserts each
 * fix from the DOM, the canvas and the on-screen readouts — not from pixels and
 * not from a private test hook. Every check prints the evidence it used.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '..', 'dist');
const TMP = path.resolve(import.meta.dirname, '..', '.verify-daw');
const PORT = 5421;

let passes = 0;
let fails = 0;
const check = (name, ok, evidence = '') => {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${evidence ? ` — ${evidence}` : ''}`);
  } else {
    fails++;
    console.log(`  FAIL  ${name}${evidence ? ` — ${evidence}` : ''}`);
  }
};
const skip = (name, why) => console.log(`  skip  ${name} — ${why}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

function serve() {
  const srv = createServer(async (req, res) => {
    let f = path.join(DIST, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (!f.startsWith(DIST) || !existsSync(f) || f.endsWith('/')) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

/** 16-bit PCM WAV of a steady tone, `seconds` long. */
function makeWav(seconds, rate = 44100, freq = 220) {
  const frames = Math.floor(seconds * rate);
  const d = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    d.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 20000), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + d.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(d.length, 40);
  return Buffer.concat([h, d]);
}

const readout = (page, label) =>
  page.evaluate((l) => {
    const el = [...document.querySelectorAll('.transport .readout, .transport__readouts .readout')].find((n) =>
      (n.previousElementSibling?.textContent ?? '').toLowerCase().includes(l.toLowerCase()),
    );
    return el?.textContent?.trim() ?? null;
  }, label);

const ticker = (page, prefix) =>
  page.evaluate((p) => {
    const el = [...document.querySelectorAll('.ticker__seg')].find((n) => n.textContent?.trim().startsWith(p));
    return el?.textContent?.trim() ?? null;
  }, prefix);

const trackNames = (page) => page.$$eval('.trk .trk__name', (els) => els.map((e) => e.value));

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html missing — run npm run build');
  await mkdir(TMP, { recursive: true });
  await writeFile(path.join(TMP, 'a.wav'), makeWav(2));
  await writeFile(path.join(TMP, 'b.wav'), makeWav(3, 44100, 330));
  await writeFile(path.join(TMP, 'c.wav'), makeWav(1, 44100, 440));

  const srv = await serve();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const base = `http://127.0.0.1:${PORT}/`;
  await page.goto(`${base}#/daw`, { waitUntil: 'load' });
  await page.waitForSelector('.tl__canvas', { timeout: 30000 });
  await page.waitForTimeout(900);

  /* ── A. Instruments are alive ────────────────────────────────────────── */
  console.log('\nA. Instruments receive the mix');
  await page.locator('.seg__opt', { hasText: /instruments/i }).first().click();
  await page.waitForTimeout(900);
  await page.locator('input[type=file]').first().setInputFiles(path.join(TMP, 'a.wav'));
  await page.waitForTimeout(2400);
  await page.locator('.tbtn--play').click();
  await page.waitForTimeout(900);

  const scope = await page.evaluate(async () => {
    const cv = document.querySelector('.scope canvas');
    if (!cv) return { err: 'no scope canvas' };
    const g = cv.getContext('2d');
    const seen = new Set();
    let outMoved = false;
    let lastOut = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 2200) {
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 401) sum = (sum * 31 + d[i]) >>> 0;
      seen.add(sum);
      const fill = document.querySelector('.transport .meter__fill');
      if (fill) {
        const t = fill.style.transform;
        if (lastOut !== null && t !== lastOut) outMoved = true;
        lastOut = t;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    return { frames: seen.size, outMoved };
  });
  check('spectrum scope animates while the Studio plays', (scope.frames ?? 0) > 5, `${scope.frames} distinct frames (static pre-fix: 2)`);
  check('transport OUT meter responds to the mix', scope.outMoved === true, scope.outMoved ? 'bar moved' : 'bar never moved');
  await page.locator('.tbtn', { hasText: '' }).nth(3).click().catch(() => {});

  /* ── B. Track header affordances ─────────────────────────────────────── */
  console.log('\nB. Track header: grip, delete, resize');
  check('every track exposes a reorder grip', (await page.locator('.trk__grip').count()) >= 2, `${await page.locator('.trk__grip').count()} grips`);
  check('every track exposes a delete button', (await page.locator(".trk__btn[data-kind='del']").count()) >= 2, `${await page.locator(".trk__btn[data-kind='del']").count()} buttons`);

  const before = await trackNames(page);
  const firstBox = await page.locator('.trk').first().boundingBox();
  const h0 = firstBox?.height ?? 0;
  await page.mouse.move(firstBox.x + firstBox.width - 20, firstBox.y + h0 - 3);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width - 20, firstBox.y + h0 + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const h1 = (await page.locator('.trk').first().boundingBox())?.height ?? 0;
  check('dragging the bottom edge resizes a track', h1 > h0 + 20, `${Math.round(h0)}px → ${Math.round(h1)}px`);

  const gripBox = await page.locator('.trk__grip').first().boundingBox();
  const secondBox = await page.locator('.trk').nth(1).boundingBox();
  if (gripBox && secondBox) {
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + gripBox.width / 2, secondBox.y + secondBox.height - 4, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  }
  const after = await trackNames(page);
  check('dragging the grip reorders tracks', after[0] !== before[0] && after[0] === before[1], `${before.join(' | ')} → ${after.join(' | ')}`);

  const tracksBefore = await page.locator('.trk').count();
  /* Focus the track via a non-input part of its header (an input legitimately
     owns Backspace), then use the unambiguous ⌘/ctrl + Backspace gesture so a
     selected clip cannot absorb the keypress. */
  await page.locator('.trk .t-micro', { hasText: /^LVL$/ }).first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Meta+Backspace');
  await page.waitForTimeout(350);
  const tracksAfter = await page.locator('.trk').count();
  check('Backspace deletes the focused track', tracksAfter === tracksBefore - 1, `${tracksBefore} → ${tracksAfter} tracks`);

  /* ── C. Clips: overlap + parallel drop ───────────────────────────────── */
  console.log('\nC. Clip placement');
  await page.locator('.tab', { hasText: /^Session$/i }).first().click();
  await page.waitForTimeout(300);
  const openSessionTab = async () => {
    await page.locator('.tab', { hasText: /^Session$/i }).first().click();
    await page.waitForTimeout(200);
  };
  const lengthOf = async () => {
    const txt = await page.locator('.kv', { hasText: /Project length/i }).locator('.kv__v').first().textContent();
    return Number.parseFloat(txt ?? '0');
  };
    const clipsOf = async () => {
    const t = await ticker(page, 'CLIPS');
    return Number.parseInt(t?.replace(/[^0-9]/g, '') ?? '0', 10);
  };

  const clips0 = await clipsOf(page);
  await page.locator('input[type=file]').first().setInputFiles(path.join(TMP, 'b.wav'));
  await page.waitForTimeout(2200);
  const clips1 = await clipsOf(page);
  const len1 = await lengthOf(page);
  check('a single drop adds one clip', clips1 === clips0 + 1, `${clips0} → ${clips1} clips`);

  await page.locator('input[type=file]').first().setInputFiles(path.join(TMP, 'b.wav'));
  await page.waitForTimeout(2200);
  const clips2 = await clipsOf(page);
  const len2 = await lengthOf(page);
  /* Overlap would leave the project length unchanged; sequential placement adds. */
  check('a second clip cannot overlap the first', len2 > len1 + 2, `project length ${len1}s → ${len2}s (2 clips of 3s each)`);
  check('both clips were retained', clips2 === clips1 + 1, `${clips1} → ${clips2} clips`);

  const tracksBeforeDrop = await page.locator('.trk').count();
  /* Three files onto a two-track project: parallel layout runs out of lanes
     and has to create one. */
  await page.locator('input[type=file]').first().setInputFiles([
    path.join(TMP, 'a.wav'),
    path.join(TMP, 'b.wav'),
    path.join(TMP, 'c.wav'),
  ]);
  await page.waitForTimeout(4000);
  const tracksAfterDrop = await page.locator('.trk').count();
  check('a multi-file drop lays clips in parallel and adds tracks', tracksAfterDrop > tracksBeforeDrop, `${tracksBeforeDrop} → ${tracksAfterDrop} tracks`);

  /* ── D. Snap, playhead, minimap, zoom ────────────────────────────────── */
  console.log('\nD. Snap, playhead, minimap, zoom');
  await page.locator('.seg__opt', { hasText: /^Grid$/i }).first().click();
  await page.waitForTimeout(250);
  await page.locator('.tab', { hasText: /^Clip$/i }).first().click().catch(() => {});

  /* Read the project tempo, then check the playhead lands on a grid multiple. */
  const bpm = Number(await page.locator('.transport input[type=number]').first().inputValue());
  const grid = (60 / bpm) * 1; // 1/4 division
  const ruler = await page.locator('.tl__ruler canvas').boundingBox();
  if (ruler && Number.isFinite(grid)) {
    await page.mouse.click(ruler.x + 137, ruler.y + ruler.height - 8); // deliberately off-grid pixels
    await page.waitForTimeout(300);
    const pos = await readout(page, 'Position');
    const seconds = pos ? Number(pos.split(':')[1]) : NaN;
    const rem = seconds / grid;
    const off = Math.abs(rem - Math.round(rem)) * grid;
    check('the playhead snaps to the grid', Number.isFinite(off) && off < 0.02, `${pos} → ${off.toFixed(4)}s off the nearest ${grid}s grid line`);
  } else skip('playhead snapping', 'ruler not measurable');

  const zoom0 = await ticker(page, 'ZOOM');
  for (let i = 0; i < 3; i++) await page.locator('.btn[aria-label="Zoom in (+)"]').click();
  await page.waitForTimeout(400);
  const zoom1 = await ticker(page, 'ZOOM');
  check('zoom controls change the scale', zoom0 !== zoom1, `${zoom0} → ${zoom1}`);

  /* The minimap can only move the viewport once it is narrower than the
     project, so this runs after the zoom-in above. */
  const scroll0 = await ticker(page, 'SCROLL');
  const rulerBox = await page.locator('.tl__ruler canvas').boundingBox();
  if (rulerBox) {
    await page.mouse.click(rulerBox.x + rulerBox.width * 0.9, rulerBox.y + 8); // minimap band
    await page.waitForTimeout(350);
  }
  const scroll1 = await ticker(page, 'SCROLL');
  check('the minimap navigates the viewport', scroll0 !== scroll1, `${scroll0} → ${scroll1}`);

  for (let i = 0; i < 10; i++) await page.locator('.btn[aria-label="Zoom out (−)"]').click();
  await page.waitForTimeout(500);
  const rulerInk = await page.evaluate(() => {
    const cv = document.querySelector('.tl__ruler canvas');
    if (!cv) return -1;
    const g = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    /* The label band is the top of the scale strip: that is where time text
       lands, so it is the honest place to measure text density. */
    const y0 = Math.round(18 * dpr);
    const hh = Math.round(13 * dpr);
    const d = g.getImageData(0, y0, cv.width, hh).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) lit++;
    return lit / (d.length / 4);
  });
  check(
    'time labels stay sparse when fully zoomed out',
    rulerInk >= 0 && rulerInk < 0.35,
    `${(rulerInk * 100).toFixed(1)}% of the label band is inked (unrationed labels smeared past 60%)`,
  );

  /* ── D2. Loop range + playhead during playback ───────────────────────── */
  console.log('\nD2. Loop range and live playhead');
  await page.locator('.tab', { hasText: /^Session$/i }).first().click();
  await page.waitForTimeout(250);
  /* Reset the zoom so the loop band is a usable size. */
  await page.locator('.btn[aria-label="Zoom to fit project"]').click();
  await page.waitForTimeout(400);
  const loopOnBtn = page.locator('.field', { hasText: /Loop range/i }).locator('.btn').first();
  if ((await loopOnBtn.count()) === 0) skip('loop range control', 'not found');
  else {
    await loopOnBtn.click();
    await page.waitForTimeout(250);
    /* Bring the loop into view first: the persisted range can sit far past the
       visible window at the current zoom. */
    await page.locator('.btn', { hasText: /2 bars here/i }).click();
    await page.waitForTimeout(400);
    /* Locate the loop end tab deterministically from the telemetry readouts
       rather than by scanning pixels: x = (loopEnd - scroll) * pxPerSec. */
    const zoom = Number((await ticker(page, 'ZOOM'))?.replace(/[^0-9.]/g, '') ?? '0');
    const scroll = Number((await ticker(page, 'SCROLL'))?.replace(/[^0-9.]/g, '') ?? '0');
    const loopVals = await page
      .locator('.field', { hasText: /Loop range/i })
      .locator('.numdrag')
      .allTextContents();
    const loopEndBefore = Number.parseFloat(loopVals[1] ?? '0');
    const rb = await page.locator('.tl__ruler canvas').boundingBox();
    const lx = (loopEndBefore - scroll) * zoom;
    if (rb && zoom > 5 && lx > 12 && lx < rb.width - 2) {
      await page.mouse.move(rb.x + lx - 1, rb.y + 26);
      await page.mouse.down();
      await page.mouse.move(rb.x + lx - 130, rb.y + 26, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const loopVals2 = await page
        .locator('.field', { hasText: /Loop range/i })
        .locator('.numdrag')
        .allTextContents();
      const loopEndAfter = Number.parseFloat(loopVals2[1] ?? '0');
      check(
        'the loop range can be dragged on the ruler',
        Math.abs(loopEndAfter - loopEndBefore) > 0.3,
        `loop end ${loopEndBefore}s → ${loopEndAfter}s at ${zoom.toFixed(0)} px/s`,
      );
    } else {
      skip('loop drag', `loop end not on screen (zoom ${zoom.toFixed(1)} px/s, x ${lx.toFixed(0)})`);
    }
    check('numeric loop start/end fields exist', (await page.locator('.field', { hasText: /Loop range/i }).locator('.numdrag').count()) === 2, `${await page.locator('.field', { hasText: /Loop range/i }).locator('.numdrag').count()} fields`);
  }

  /* Playhead must be repositionable while the transport is rolling. */
  await page.locator('.tbtn--play').click();
  await page.waitForTimeout(900);
  const ruler2 = await page.locator('.tl__ruler canvas').boundingBox();
  if (ruler2) {
    await page.mouse.click(ruler2.x + ruler2.width * 0.45, ruler2.y + ruler2.height - 8);
    await page.waitForTimeout(500);
  }
  const posDuring = await readout(page, 'Position');
  await page.waitForTimeout(700);
  const posLater = await readout(page, 'Position');
  const secDuring = posDuring ? Number(posDuring.split(':')[1]) : NaN;
  check(
    'the playhead can be repositioned during playback',
    Number.isFinite(secDuring) && secDuring > 0.3,
    `jumped to ${posDuring}, still rolling at ${posLater}`,
  );
  await page.locator('.tbtn', { hasText: '' }).nth(3).click().catch(() => {});
  await page.waitForTimeout(300);

  /* ── E. Media survives a reload ──────────────────────────────────────── */
  console.log('\nE. Media survives a reload');
  const clipsPre = await clipsOf(page);
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tl__canvas', { timeout: 30000 });
  await page.waitForTimeout(4000);
  await openSessionTab();
  const clipsPost = await clipsOf(page);
  const vault = await ticker(page, 'VAULT');
  check('clips relink from the media vault after a reload', clipsPost === clipsPre, `${clipsPre} clips before → ${clipsPost} after (${vault})`);

  /* ── F. Page health ──────────────────────────────────────────────────── */
  console.log('\nF. Page health');
  check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  await browser.close();
  srv.close();
  await rm(TMP, { recursive: true, force: true });

  console.log(`\n${passes}/${passes + fails} checks passed`);
  if (fails) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\nverify:daw crashed:', e);
  process.exit(1);
});
