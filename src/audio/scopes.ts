/* ============================================================================
   LiteDAW · SCOPE PAINTERS
   Pure canvas painters for spectrum, waveform and vector (goniometer) scopes.
   They take raw analyser data so the same code drives both the realtime view
   and any offline snapshot. All of them respect the global FX level.
   ========================================================================= */

import type { PeakEnvelope } from './dsp';

export interface ScopeTheme {
  grid: string;
  gridBright: string;
  trace: string;
  traceAlt: string;
  fill: string;
  peak: string;
  glow: number;
}

export const SCOPE_THEMES: Record<'avionics' | 'amber' | 'mono' | 'aqua', ScopeTheme> = {
  avionics: {
    grid: 'rgba(120,170,200,.10)',
    gridBright: 'rgba(120,170,200,.22)',
    trace: '#22e07c',
    traceAlt: '#1fd0e6',
    fill: 'rgba(34,224,124,.16)',
    peak: '#ffae1a',
    glow: 1,
  },
  amber: {
    grid: 'rgba(255,190,90,.10)',
    gridBright: 'rgba(255,190,90,.2)',
    trace: '#ffae1a',
    traceAlt: '#ff7a1a',
    fill: 'rgba(255,174,26,.16)',
    peak: '#ff2d47',
    glow: 1,
  },
  mono: {
    grid: 'rgba(200,220,235,.08)',
    gridBright: 'rgba(200,220,235,.18)',
    trace: '#e8eef4',
    traceAlt: '#a7b2bd',
    fill: 'rgba(232,238,244,.1)',
    peak: '#c70f28',
    glow: 0.5,
  },
  aqua: {
    grid: 'rgba(140,240,255,.10)',
    gridBright: 'rgba(140,240,255,.22)',
    trace: '#7fe3ff',
    traceAlt: '#2e86ff',
    fill: 'rgba(127,227,255,.16)',
    peak: '#ff3dce',
    glow: 1.2,
  },
};

export interface ScopePaintOpts {
  width: number;
  height: number;
  theme: ScopeTheme;
  /** 0 = pristine flat, 1 = full semi-realism (scanlines + grain + bloom). */
  fx: number;
  /** dB floor for the spectrum, e.g. -96. */
  floorDb?: number;
  /** Paint a peak-hold overlay and decay it across frames. */
  peaks?: Float32Array;
}

/* ── Shared furniture ──────────────────────────────────────────────────── */

export function paintScopeFrame(ctx: CanvasRenderingContext2D, o: ScopePaintOpts) {
  const { width: w, height: h, theme, fx } = o;
  ctx.clearRect(0, 0, w, h);

  // CRT-style inner glow
  const bg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.72);
  bg.addColorStop(0, 'rgba(16,26,32,.85)');
  bg.addColorStop(1, 'rgba(4,7,10,.96)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // graticule
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.grid;
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    const x = Math.round((i / 10) * w) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let i = 1; i < 6; i++) {
    const y = Math.round((i / 6) * h) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  ctx.strokeStyle = theme.gridBright;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(h / 2) + 0.5);
  ctx.lineTo(w, Math.round(h / 2) + 0.5);
  ctx.moveTo(Math.round(w / 2) + 0.5, 0);
  ctx.lineTo(Math.round(w / 2) + 0.5, h);
  ctx.stroke();

  if (fx > 0.02) {
    ctx.save();
    ctx.globalAlpha = 0.06 * fx;
    ctx.fillStyle = '#fff';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  }
}

function trace(ctx: CanvasRenderingContext2D, theme: ScopeTheme, fx: number, color?: string) {
  ctx.strokeStyle = color ?? theme.trace;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  if (fx > 0.02 && theme.glow > 0) {
    ctx.shadowColor = color ?? theme.trace;
    ctx.shadowBlur = 9 * theme.glow * fx;
  } else {
    ctx.shadowBlur = 0;
  }
}

/* ── Spectrum ──────────────────────────────────────────────────────────── */

/**
 * Log-frequency FFT with peak-hold. `freq` is the FFT magnitude in dB,
 * `sampleRate` maps bins to hertz.
 */
export function paintSpectrum(
  c: CanvasRenderingContext2D,
  freq: Float32Array,
  sampleRate: number,
  o: ScopePaintOpts & { minHz?: number; maxHz?: number; bars?: boolean },
) {
  const { width: w, height: h, theme, fx } = o;
  paintScopeFrame(c, o);
  const floor = o.floorDb ?? -100;
  const fMin = o.minHz ?? 20;
  const fMax = o.maxHz ?? Math.min(20000, sampleRate / 2);
  const bins = freq.length;
  const nyquist = sampleRate / 2;

  const hzToX = (hz: number) =>
    (Math.log10(hz / fMin) / Math.log10(fMax / fMin)) * w;

  if (o.peaks) {
    for (let i = 0; i < o.peaks.length; i++) o.peaks[i] = Math.max(o.peaks[i] - 0.006, 0);
  }

  c.save();
  c.beginPath();
  let started = false;
  const points: [number, number][] = [];
  for (let i = 1; i < bins; i++) {
    const hz = (i / bins) * nyquist;
    if (hz < fMin || hz > fMax) continue;
    const db = freq[i];
    const norm = Math.max(0, Math.min(1, (db - floor) / -floor));
    const x = hzToX(hz);
    const y = h - norm * h;
    points.push([x, y]);
    if (!started) {
      c.moveTo(x, y);
      started = true;
    } else c.lineTo(x, y);
    if (o.peaks) {
      const pi = Math.min(o.peaks.length - 1, Math.round((x / w) * (o.peaks.length - 1)));
      o.peaks[pi] = Math.max(o.peaks[pi], norm);
    }
  }
  if (o.bars !== false && points.length) {
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.fill);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fill();
  }
  c.restore();

  trace(c, theme, fx);
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.stroke();
  c.shadowBlur = 0;

  if (o.peaks) {
    c.strokeStyle = theme.peak;
    c.lineWidth = 1;
    c.globalAlpha = 0.75;
    c.beginPath();
    for (let px = 0; px < o.peaks.length; px++) {
      const x = (px / (o.peaks.length - 1)) * w;
      const y = h - o.peaks[px] * h;
      if (px === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  // frequency ruler
  c.fillStyle = 'rgba(160,185,205,.42)';
  c.font = '9px "Share Tech Mono", monospace';
  [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((hz) => {
    if (hz < fMin || hz > fMax) return;
    const x = hzToX(hz);
    c.fillRect(x, h - 5, 1, 5);
    c.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x + 2, h - 6);
  });
}

/* ── Waveform (oscilloscope, trigger-synced) ───────────────────────────── */

export function paintWaveform(
  c: CanvasRenderingContext2D,
  data: Float32Array,
  o: ScopePaintOpts & { trigger?: boolean; scale?: number; color?: string },
) {
  const { width: w, height: h, theme, fx } = o;
  paintScopeFrame(c, o);

  // rising-edge trigger so the trace stands still like a real scope
  let start = 0;
  if (o.trigger !== false) {
    const mid = data.length >> 1;
    for (let i = 1; i < mid; i++) {
      if (data[i - 1] <= 0 && data[i] > 0) {
        start = i;
        break;
      }
    }
  }
  const span = data.length - start;
  const scale = o.scale ?? 1;

  c.save();
  c.beginPath();
  for (let i = 0; i < span; i++) {
    const x = (i / span) * w;
    const y = h / 2 - Math.max(-1.4, Math.min(1.4, data[start + i] * scale)) * (h / 2 - 3);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  trace(c, theme, fx, o.color ?? theme.traceAlt);
  c.stroke();
  c.restore();

  if (fx > 0.02) {
    c.save();
    c.globalAlpha = 0.1 * fx;
    c.fillStyle = o.color ?? theme.traceAlt;
    for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
    c.restore();
  }
}

/* ── Vector scope (goniometer / Lissajous) ─────────────────────────────── */

export function paintVectorscope(
  c: CanvasRenderingContext2D,
  left: Float32Array,
  right: Float32Array,
  o: ScopePaintOpts,
) {
  const { width: w, height: h, theme, fx } = o;
  paintScopeFrame(c, o);

  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 6;

  // polar graticule
  c.strokeStyle = theme.gridBright;
  c.lineWidth = 1;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = theme.grid;
  [0.25, 0.5, 0.75].forEach((f) => {
    c.beginPath();
    c.arc(cx, cy, r * f, 0, Math.PI * 2);
    c.stroke();
  });
  c.beginPath();
  c.moveTo(cx - r, cy);
  c.lineTo(cx + r, cy);
  c.moveTo(cx, cy - r);
  c.lineTo(cx, cy + r);
  c.stroke();
  // ±45° axes (L/R and M/S)
  c.strokeStyle = 'rgba(199,15,40,.28)';
  c.beginPath();
  c.moveTo(cx - r * 0.707, cy - r * 0.707);
  c.lineTo(cx + r * 0.707, cy + r * 0.707);
  c.moveTo(cx + r * 0.707, cy - r * 0.707);
  c.lineTo(cx - r * 0.707, cy + r * 0.707);
  c.stroke();

  const n = Math.min(left.length, right.length);
  c.save();
  c.globalCompositeOperation = 'lighter';
  const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  c.strokeStyle = theme.trace;
  grad.addColorStop(0, 'rgba(34,224,124,.05)');
  grad.addColorStop(1, 'rgba(34,224,124,.22)');
  c.fillStyle = grad;
  c.beginPath();
  const step = Math.max(1, Math.floor(n / 1400));
  for (let i = 0; i < n; i += step) {
    // M/S rotation: +45° puts mono content on the vertical axis
    const l = left[i];
    const rr = right[i];
    const x = cx + ((l - rr) * 0.7071) * r;
    const y = cy - ((l + rr) * 0.7071) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  c.globalAlpha = 0.35 * fx + 0.2;
  c.stroke();
  c.restore();

  c.fillStyle = 'rgba(160,185,205,.5)';
  c.font = '9px "Share Tech Mono", monospace';
  c.fillText('L', cx - r + 2, cy - 3);
  c.fillText('R', cx + r - 8, cy - 3);
  c.fillText('M', cx + 3, cy - r + 10);
  c.fillText('S', cx + 3, cy + r - 4);
}

/* ── Clip waveform (timeline rendering) ────────────────────────────────── */

export function paintClipWave(
  c: CanvasRenderingContext2D,
  env: PeakEnvelope,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  fill: string,
  sourceOffsetRatio = 0,
  sourceSpanRatio = 1,
) {
  const mid = y + h / 2;
  const amp = h / 2 - 1;
  const start = Math.floor(sourceOffsetRatio * env.buckets);
  const end = Math.min(env.buckets, Math.ceil((sourceOffsetRatio + sourceSpanRatio) * env.buckets));
  const count = Math.max(1, end - start);

  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(x, mid);
  for (let i = 0; i < count; i++) {
    const b = start + i;
    const px = x + (i / count) * w;
    c.lineTo(px, mid - (env.data[b * 2 + 1] ?? 0) * amp);
  }
  for (let i = count - 1; i >= 0; i--) {
    const b = start + i;
    const px = x + (i / count) * w;
    c.lineTo(px, mid - (env.data[b * 2] ?? 0) * amp);
  }
  c.closePath();
  c.fill();

  c.strokeStyle = color;
  c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i < count; i++) {
    const b = start + i;
    const px = x + (i / count) * w;
    const mx = env.data[b * 2 + 1] ?? 0;
    const mn = env.data[b * 2] ?? 0;
    c.moveTo(px, mid - mx * amp);
    c.lineTo(px, mid - mn * amp);
  }
  c.stroke();
}
