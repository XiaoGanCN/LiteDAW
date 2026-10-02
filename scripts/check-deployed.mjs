/**
 * Verifies a DEPLOYED LiteDAW against a real origin.
 *
 *   node scripts/check-deployed.mjs [url]
 *
 * Defaults to the GitHub Pages build. This is the test that proves sub-path
 * hosting works: relative asset URLs, the self-hosted font stack, the PWA
 * manifest and the service-worker scope all have to resolve under a
 * repository prefix rather than a domain root.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
await mkdir('.smoke', { recursive: true });
const BASE = process.argv[2] ?? 'https://xiaogancn.github.io/LiteDAW/';
const SHOTS = '.smoke';
const problems = [];
const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 820 }, permissions: [] });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200)); });
p.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 200)));
p.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) problems.push('requestfailed: ' + r.url()); });

for (const [route, sel] of [['pitch', '.pt'], ['bpm', '.bpm-page'], ['daw', '.tl__canvas']]) {
  await p.goto(`${BASE}#/${route}`, { waitUntil: 'load' });
  await p.waitForSelector(sel, { timeout: 30000 });
  await p.waitForTimeout(1200);
  const info = await p.evaluate(() => ({
    fonts: document.fonts ? document.fonts.size : -1,
    barlow: document.fonts ? document.fonts.check('13px Barlow') : false,
    chakra: document.fonts ? document.fonts.check('13px "Chakra Petch"') : false,
    sw: !!navigator.serviceWorker.controller || !!navigator.serviceWorker,
  }));
  console.log(`${route.padEnd(6)} ok  fonts=${info.fonts} barlow=${info.barlow} chakra=${info.chakra}`);
  await p.screenshot({ path: `${SHOTS}/live-${route}.png` });
}

await p.goto(BASE, { waitUntil: 'load' });
await p.waitForTimeout(2500);
const sw = await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.map((r) => ({ scope: r.scope, active: !!r.active }));
});
console.log('service workers:', JSON.stringify(sw));
console.log('manifest:', await p.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href')));
await b.close();
console.log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nno errors from the live GitHub Pages deployment');
