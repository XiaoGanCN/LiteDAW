/**
 * Generates the LiteDAW launcher / PWA icon set with a dependency-free PNG
 * encoder (zlib + manual chunks). The mark is the same delta-chevron as the
 * in-app vector logo, rendered with 4× supersampling for clean edges.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'public', 'icons');

/* ── PNG writer ────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ── Geometry ──────────────────────────────────────────────────────────── */

const insideTriangle = (px, py, [ax, ay], [bx, by], [cx, cy]) => {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
};

const insideRect = (px, py, x0, y0, x1, y1) => px >= x0 && px <= x1 && py >= y0 && py <= y1;

/** Renders the mark at unit coordinates (0..1) — returns true if inside. */
function markAt(px, py) {
  // outer chevron
  const outer =
    insideTriangle(px, py, [0.5, 0.13], [0.075, 0.775], [0.925, 0.775]) &&
    !insideTriangle(px, py, [0.5, 0.375], [0.255, 0.775], [0.745, 0.775]);
  // inner chevron
  const inner =
    insideTriangle(px, py, [0.5, 0.44], [0.245, 0.79], [0.755, 0.79]) &&
    !insideTriangle(px, py, [0.5, 0.575], [0.355, 0.79], [0.645, 0.79]);
  // base rail
  const rail = insideRect(px, py, 0.155, 0.845, 0.845, 0.888);
  return outer || inner || rail;
}

/* ── Renderer ──────────────────────────────────────────────────────────── */

function render(size, { padding = 0, maskable = false } = {}) {
  const SS = 4; // supersample factor
  const out = Buffer.alloc(size * size * 4);
  const scale = 1 - padding * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;

          // plate: rounded square carbon ground
          const cu = (u - 0.5) / scale;
          const cv = (v - 0.5) / scale;
          const cornerR = maskable ? 0.5 : 0.22;
          const qx = Math.max(0, Math.abs(cu) - (0.5 - cornerR));
          const qy = Math.max(0, Math.abs(cv) - (0.5 - cornerR));
          const corner = Math.hypot(qx, qy) <= cornerR;
          const inPlate = Math.abs(cu) <= 0.5 && Math.abs(cv) <= 0.5 && corner;
          if (!inPlate) continue;

          // carbon weave
          const weave = (Math.sin((cu * 46 + cv * 46) * Math.PI) + Math.sin((cu * 46 - cv * 46) * Math.PI)) * 0.5;
          let pr = 10 + weave * 5 + (0.5 - cv) * 9;
          let pg = 13 + weave * 6 + (0.5 - cv) * 10;
          let pb = 16 + weave * 7 + (0.5 - cv) * 12;

          // red signal glow behind the mark
          const d = Math.hypot(cu * 0.9, (cv + 0.06) * 1.15);
          const glow = Math.max(0, 1 - d / 0.72);
          pr += glow * glow * 92;
          pg += glow * glow * 10;
          pb += glow * glow * 22;

          // the mark itself (aluminium gradient with hot top edge)
          const mx = (cu + 0.5);
          const my = (cv + 0.5);
          if (markAt(mx, my)) {
            const t = my;
            const alu = 0.62 + 0.38 * (1 - t);
            pr = 205 * alu + 40;
            pg = 214 * alu + 40;
            pb = 224 * alu + 44;
            const edge = markAt(mx - 0.012, my - 0.012);
            if (!edge) {
              pr = 255;
              pg = 250;
              pb = 252;
            }
          }

          r += Math.min(255, pr);
          g += Math.min(255, pg);
          b += Math.min(255, pb);
          a += 255;
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      if (alpha <= 0) continue;
      // premultiplied average → straight alpha
      out[i] = Math.round((r / n) * (255 / alpha) * 1);
      out[i + 1] = Math.round((g / n) * (255 / alpha));
      out[i + 2] = Math.round((b / n) * (255 / alpha));
      out[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, out);
}

/* ── Vector twin of the raster mark ────────────────────────────────────── */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171d22"/><stop offset="55%" stop-color="#0b0f12"/><stop offset="100%" stop-color="#10151a"/>
    </linearGradient>
    <linearGradient id="alu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="42%" stop-color="#d5dee6"/><stop offset="100%" stop-color="#8f9aa5"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="58%" r="52%">
      <stop offset="0%" stop-color="#ff2d47" stop-opacity=".55"/><stop offset="100%" stop-color="#c70f28" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#plate)"/>
  <rect width="512" height="512" rx="112" fill="url(#glow)"/>
  <g fill="none" stroke="url(#alu)" stroke-width="30" stroke-linejoin="miter">
    <path d="M256 78 76 400h96l84-142 84 142h96L256 78Z"/>
  </g>
  <g fill="none" stroke="url(#alu)" stroke-width="26" stroke-linejoin="miter">
    <path d="M256 238 148 400h60l48-82 48 82h60L256 238Z"/>
  </g>
  <rect x="88" y="430" width="336" height="22" rx="4" fill="url(#alu)"/>
</svg>
`;

async function main() {
  await mkdir(OUT, { recursive: true });
  const jobs = [
    ['icon-192.png', render(192)],
    ['icon-512.png', render(512)],
    ['icon-1024.png', render(1024)],
    ['maskable-512.png', render(512, { padding: 0.14, maskable: true })],
    ['maskable-1024.png', render(1024, { padding: 0.14, maskable: true })],
  ];
  for (const [name, buf] of jobs) {
    await writeFile(path.join(OUT, name), buf);
    console.log(`${name.padEnd(20)} ${(buf.length / 1024).toFixed(1)} KB`);
  }
  await writeFile(path.join(OUT, 'icon.svg'), SVG, 'utf8');
  console.log('icon.svg             written');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
