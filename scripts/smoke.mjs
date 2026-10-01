/**
 * Headless smoke test for LiteDAW.
 *
 *   node scripts/smoke.mjs [--keep]
 *
 * Boots the production bundle in the locally installed Google Chrome, walks all
 * three module routes, exercises the core interactions of each, and fails on any
 * console error, page exception or failed request. Screenshots land in
 * `.smoke/` for visual inspection.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, '.smoke');
const PORT = 5399;

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
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      if (!existsSync(file) || url.pathname.endsWith('/')) file = path.join(DIST, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const problems = [];
const notes = [];

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist/index.html missing — run `npm run build` first');
  }
  await mkdir(SHOTS, { recursive: true });
  const server = await serve();

  const browser = await chromium.launch({
    channel: 'chrome',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--mute-audio',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
    if (msg.type() === 'warning' && /react|key|act\(/i.test(msg.text())) notes.push(`warn: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('favicon')) return;
    problems.push(`requestfailed: ${url} — ${req.failure()?.errorText}`);
  });

  const base = `http://127.0.0.1:${PORT}/`;

  /* ── Pitch ─────────────────────────────────────────────────────────── */
  await page.goto(`${base}#/pitch`, { waitUntil: 'load' });
  await page.waitForSelector('.navbtn', { timeout: 20000 });
  await page.waitForSelector('.pt', { timeout: 20000 });
  await page.waitForTimeout(700);
  await shot(page, '01-pitch-idle');

  // The red primary is always "the one thing to press" — drive the drill with it.
  await pressPrimary(page);
  await page.waitForTimeout(900);
  await shot(page, '02-pitch-listening');
  await pressPrimary(page);
  await page.waitForTimeout(1100);
  await shot(page, '03-pitch-revealed');

  // Piano-keyboard answer entry, then the radial dial variant.
  await pressPrimary(page); // next question
  await page.waitForTimeout(900);
  const key = page.locator('.pkey').nth(12);
  if (await key.count()) {
    await key.click({ force: true });
    await page.waitForTimeout(350);
    await shot(page, '04a-pitch-keys');
  }
  // Wait until the answer surface has actually armed SUBMIT, then grade it so
  // the reveal state is exercised.
  const armed = await page
    .waitForFunction(
      () => {
        const b = [...document.querySelectorAll('.btn--primary')].find((x) => /submit/i.test(x.textContent || ''));
        return !!b && !b.disabled;
      },
      null,
      { timeout: 12000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!armed) notes.push('pitch SUBMIT never armed after a key press');
  else {
    await page.locator('.btn--primary', { hasText: /submit/i }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1100);
    await shot(page, '04a2-pitch-graded');
  }
  await pressPrimary(page);
  await page.waitForTimeout(700);
  const dialTab = page.locator('.seg__opt', { hasText: /^\s*(Dial|Radial)\s*$/i }).first();
  if (await dialTab.count()) {
    await dialTab.click();
    await page.waitForTimeout(450);
    const dial = page.locator('.dial__svg');
    if (await dial.count()) {
      const db = await dial.boundingBox();
      if (db) {
        await page.mouse.move(db.x + db.width * 0.5, db.y + 8);
        await page.mouse.down();
        await page.mouse.move(db.x + db.width * 0.82, db.y + db.height * 0.3, { steps: 12 });
        await page.mouse.up();
      }
    }
    await page.waitForTimeout(400);
    await shot(page, '04b-pitch-dial');
  }
  await pressPrimary(page);
  await page.waitForTimeout(900);
  await shot(page, '04c-pitch-dial-revealed');

  /* ── Tempo ─────────────────────────────────────────────────────────── */
  await page.goto(`${base}#/bpm`, { waitUntil: 'load' });
  await page.waitForSelector('.bpm-page', { timeout: 20000 });
  await page.waitForTimeout(600);
  await shot(page, '05-bpm-idle');

  // Start → listen (the beat visualiser runs) → answer on the wheel → lock in.
  await pressPrimary(page);
  await page.waitForTimeout(2200);
  await shot(page, '06-bpm-listening');
  await clickByText(page, 'button', /answer now|tap now|i'?m ready|set answer/i);
  await page.waitForTimeout(900);
  const wheel = page.locator('.wheel__scroll');
  if (await wheel.count()) {
    const wb = await wheel.boundingBox();
    if (wb) {
      await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
      await page.mouse.down();
      await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2 - 60, { steps: 14 });
      await page.mouse.up();
    }
    await page.waitForTimeout(700);
  }
  await shot(page, '07-bpm-answering');
  await pressPrimary(page);
  await page.waitForTimeout(900);
  await shot(page, '08-bpm-revealed');

  /* ── Studio ────────────────────────────────────────────────────────── */
  await page.goto(`${base}#/daw`, { waitUntil: 'load' });
  await page.waitForSelector('.tl__canvas', { timeout: 20000 });
  await page.waitForTimeout(700);
  await shot(page, '09-daw-empty');

  // Add a track and press play so the transport + meters run.
  await clickByText(page, 'button', /^TRACK$/i);
  await page.waitForTimeout(250);
  await page.locator('.tbtn--play').click();
  await page.waitForTimeout(1500);
  await shot(page, '10-daw-playing');
  await page.locator('.tbtn', { hasText: '' }).nth(3).click().catch(() => {});
  await page.waitForTimeout(300);

  // Import a generated WAV so clips, waveforms and the mixer get exercised.
  const wav = makeWav(2.4, 44100);
  await writeFile(path.join(SHOTS, 'tone.wav'), wav);
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles(path.join(SHOTS, 'tone.wav'));
  await page.waitForTimeout(2200);
  await shot(page, '11-daw-clip');

  // Select the clip and open each inspector tab.
  const canvas = page.locator('.tl__lanes canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + 60, box.y + 30);
    await page.waitForTimeout(250);
  }
  for (const tab of ['Track', 'EQ', 'Session']) {
    const t = page.locator('.tab', { hasText: new RegExp(`^${tab}$`, 'i') }).first();
    if (await t.count()) {
      await t.click();
      await page.waitForTimeout(350);
      await shot(page, `12-daw-inspector-${tab.toLowerCase()}`);
    }
  }

  // Scopes.
  const scopesBtn = page.locator('.seg__opt', { hasText: /instruments/i }).first();
  if (await scopesBtn.count()) {
    await scopesBtn.click();
    await page.waitForTimeout(900);
    await shot(page, '13-daw-scopes');
  }

  // Settings bay + pristine mode.
  await page.locator('.rail__foot button, .topbar button[aria-label*="configuration" i]').first().click();
  await page.waitForTimeout(600);
  await shot(page, '14-settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* ── Mobile layout ────────────────────────────────────────────────── */
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${base}#/daw`, { waitUntil: 'load' });
  await mobile.waitForTimeout(900);
  await shot(mobile, '15-mobile-daw', true);
  await mobile.goto(`${base}#/pitch`, { waitUntil: 'load' });
  await mobile.waitForTimeout(900);
  await shot(mobile, '16-mobile-pitch', true);

  await browser.close();
  server.close();

  /* ── Report ────────────────────────────────────────────────────────── */
  console.log('\n──────── LiteDAW smoke test ────────');
  if (notes.length) {
    console.log(`\n${notes.length} note(s):`);
    notes.slice(0, 10).forEach((n) => console.log('  ·', n));
  }
  if (problems.length) {
    console.log(`\n✗ ${problems.length} problem(s):`);
    problems.forEach((p) => console.log('  ✗', p));
    process.exitCode = 1;
  } else {
    console.log('\n✓ no console errors, page exceptions or failed requests');
  }
  console.log(`screenshots → ${path.relative(process.cwd(), SHOTS)}/`);
}

async function shot(page, name, quiet = false) {
  try {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    if (!quiet) console.log('  ·', name);
  } catch (e) {
    problems.push(`screenshot ${name} failed: ${e.message}`);
  }
}

/** Clicks whichever button currently carries the red primary treatment. */
async function pressPrimary(page) {
  const primary = page.locator('.btn--primary').first();
  if ((await primary.count()) === 0) {
    notes.push('no primary button present');
    return false;
  }
  try {
    await primary.click({ timeout: 5000 });
    return true;
  } catch (e) {
    notes.push(`primary click failed: ${e.message}`);
    return false;
  }
}

async function clickByText(page, selector, re, optional = false) {
  const loc = page.locator(selector, { hasText: re }).first();
  if ((await loc.count()) === 0) {
    if (!optional) notes.push(`no ${selector} matching ${re}`);
    return false;
  }
  try {
    await loc.click({ timeout: 4000 });
    return true;
  } catch (e) {
    if (!optional) notes.push(`click failed for ${re}: ${e.message}`);
    return false;
  }
}

/** Minimal 16-bit PCM WAV writer for the import test. */
function makeWav(seconds, rate) {
  const frames = Math.floor(seconds * rate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 8) * Math.min(1, (seconds - t) * 4);
    const v = (Math.sin(2 * Math.PI * 220 * t) * 0.5 + Math.sin(2 * Math.PI * 660 * t) * 0.2) * env;
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

main().catch((err) => {
  console.error('\nsmoke test crashed:', err);
  process.exit(1);
});
