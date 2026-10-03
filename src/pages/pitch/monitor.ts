/* ============================================================================
   LiteDAW · PITCH PAGE — signal-monitor painter
   A page-local variant of the shared scope painters. The shared frame draws a
   fixed graticule (9 vertical + 5 horizontal rules) *and* two overlapping
   scanline layers (one every 3px, one every 4px); at the monitor's 142–178px
   height those rules read as noise instead of as an instrument scale.

   The graticule here is derived from the canvas box: rules are spaced by a
   target pitch (never a fixed count), the alpha is lower, and there is exactly
   one scanline layer whose period also follows the height. The CRT look — dark
   radial face, glowing trace, film grain — is kept.
   ========================================================================= */

import type { ScopeTheme } from '../../audio/scopes';

export interface MonitorPaintOpts {
  width: number;
  height: number;
  theme: ScopeTheme;
  /** 0 = pristine flat, 1 = full semi-realism (scanlines + grain + glow). */
  fx: number;
  /** dB floor for the spectrum, e.g. -96. */
  floorDb?: number;
  /** Paint a peak-hold overlay and decay it across frames. */
  peaks?: Float32Array;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rule count for a given span: proportional, but never a striped block. */
const rulesFor = (span: number, pitch: number, max: number) => clamp(Math.round(span / pitch), 1, max);

/** Shared furniture: face, adaptive graticule, one scanline layer. */
function paintFrame(c: CanvasRenderingContext2D, o: MonitorPaintOpts) {
  const { width: w, height: h, theme, fx } = o;
  c.clearRect(0, 0, w, h);

  const bg = c.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.72);
  bg.addColorStop(0, 'rgba(16,26,32,.85)');
  bg.addColorStop(1, 'rgba(4,7,10,.96)');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);

  /* Graticule: one rule every ~46px vertically and ~92px horizontally, so a
     short monitor gets two or three lines instead of five. Weight is halved
     against the shared painter (alpha on top of the theme's own alpha). */
  const hRules = rulesFor(h, 46, 4);
  const vRules = rulesFor(w, 92, 8);
  c.save();
  c.lineWidth = 1;
  c.globalAlpha = 0.62;
  c.strokeStyle = theme.grid;
  c.beginPath();
  for (let i = 1; i <= vRules; i++) {
    const x = Math.round((i / (vRules + 1)) * w) + 0.5;
    c.moveTo(x, 0);
    c.lineTo(x, h);
  }
  for (let i = 1; i <= hRules; i++) {
    const y = Math.round((i / (hRules + 1)) * h) + 0.5;
    c.moveTo(0, y);
    c.lineTo(w, y);
  }
  c.stroke();

  /* Zero axis: the trace baseline is the one line that must stay readable. */
  c.globalAlpha = 0.8;
  c.strokeStyle = theme.gridBright;
  const mid = Math.round(h / 2) + 0.5;
  c.beginPath();
  c.moveTo(0, mid);
  c.lineTo(w, mid);
  c.stroke();
  c.restore();

  /* CRT texture — a single, coarse layer. The shared painter stacks a 3px and
     a 4px layer, and the beat between them is what turned a 145px face into a
     striped block; here the line count is capped and follows the height. */
  if (fx > 0.02) {
    const lines = clamp(Math.round(h / 22), 3, 12);
    const step = h / lines;
    c.save();
    c.globalAlpha = 0.03 * fx;
    c.fillStyle = '#fff';
    for (let i = 1; i < lines; i++) c.fillRect(0, Math.round(i * step), w, 1);
    c.restore();
  }
}

function trace(c: CanvasRenderingContext2D, theme: ScopeTheme, fx: number, color?: string) {
  c.strokeStyle = color ?? theme.trace;
  c.lineWidth = 1.6;
  c.lineJoin = 'round';
  if (fx > 0.02 && theme.glow > 0) {
    c.shadowColor = color ?? theme.trace;
    c.shadowBlur = 9 * theme.glow * fx;
  } else {
    c.shadowBlur = 0;
  }
}

/* ── Oscilloscope ──────────────────────────────────────────────────────── */

export function paintMonitorWave(
  c: CanvasRenderingContext2D,
  data: Float32Array,
  o: MonitorPaintOpts & { trigger?: boolean; scale?: number; color?: string },
) {
  const { width: w, height: h, theme, fx } = o;
  paintFrame(c, o);

  /* Rising-edge trigger so the trace stands still like a real scope. */
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
  const amp = h / 2 - 3;

  c.save();
  c.beginPath();
  for (let i = 0; i < span; i++) {
    const x = (i / span) * w;
    const y = h / 2 - clamp(data[start + i] * scale, -1.4, 1.4) * amp;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  trace(c, theme, fx, o.color ?? theme.traceAlt);
  c.stroke();
  c.restore();
}

/* ── Spectrum ──────────────────────────────────────────────────────────── */

export function paintMonitorSpectrum(
  c: CanvasRenderingContext2D,
  freq: Float32Array,
  sampleRate: number,
  o: MonitorPaintOpts & { minHz?: number; maxHz?: number; bars?: boolean },
) {
  const { width: w, height: h, theme, fx } = o;
  paintFrame(c, o);

  const floor = o.floorDb ?? -100;
  const fMin = o.minHz ?? 20;
  const fMax = o.maxHz ?? Math.min(20000, sampleRate / 2);
  const bins = freq.length;
  const nyquist = sampleRate / 2;
  const hzToX = (hz: number) => (Math.log10(hz / fMin) / Math.log10(fMax / fMin)) * w;

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
    const norm = clamp((freq[i] - floor) / -floor, 0, 1);
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

  /* Frequency ruler. On a short monitor the labels crowd the trace, so only
     the ticks survive below 118px. */
  const labels = h >= 118;
  c.fillStyle = 'rgba(160,185,205,.42)';
  c.font = '9px "Share Tech Mono", monospace';
  [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((hz) => {
    if (hz < fMin || hz > fMax) return;
    const x = hzToX(hz);
    c.fillRect(x, h - 5, 1, 5);
    if (labels) c.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x + 2, h - 6);
  });
}
