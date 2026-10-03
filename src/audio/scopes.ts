/* ============================================================================
   LiteDAW · SCOPE PAINTERS
   Behaviour ported from the sibling LiteScope instrument (see
   docs/LITESCOPE-SCOPE-SPEC.md) and re-skinned in LiteDAW's design language.

   What "ported" means here, concretely:
     · spectrum  — stroked trace with a gradient under-fill and a glow pass,
                   logarithmic frequency axis, 1-2-5 decade ticks, spectral
                   tilt anchored at 1 kHz, and a peak-hold that decays in
                   dB per SECOND (time-based, not per-frame).
     · waveform  — AC-coupled, rising-edge triggered, with the trigger placed
                   20 % in from the left so the trace stands still, and a
                   min/max envelope once the sweep exceeds the raw-plot budget.
     · vector    — the ±45° M/S goniometer, drawn into a persistent phosphor
                   layer that fades per frame, so the trace has afterglow.

   Everything is a pure painter over analyser data, so the same code serves the
   realtime deck and any offline snapshot.
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
    gridBright: 'rgba(120,170,200,.20)',
    trace: '#22e07c',
    traceAlt: '#1fd0e6',
    fill: 'rgba(34,224,124,.16)',
    peak: '#ffae1a',
    glow: 1,
  },
  amber: {
    grid: 'rgba(255,190,90,.10)',
    gridBright: 'rgba(255,190,90,.19)',
    trace: '#ffae1a',
    traceAlt: '#ff7a1a',
    fill: 'rgba(255,174,26,.16)',
    peak: '#ff2d47',
    glow: 1,
  },
  mono: {
    grid: 'rgba(200,220,235,.08)',
    gridBright: 'rgba(200,220,235,.17)',
    trace: '#e8eef4',
    traceAlt: '#a7b2bd',
    fill: 'rgba(232,238,244,.1)',
    peak: '#c70f28',
    glow: 0.5,
  },
  aqua: {
    grid: 'rgba(140,240,255,.10)',
    gridBright: 'rgba(140,240,255,.2)',
    trace: '#7fe3ff',
    traceAlt: '#2e86ff',
    fill: 'rgba(127,227,255,.16)',
    peak: '#ff3dce',
    glow: 1.2,
  },
};

/** LiteScope's default spectral tilt: +3 dB per octave, anchored at 1 kHz. */
export const DEFAULT_TILT_DB_PER_OCT = 3;
/** Peak-hold decay, in dB per second. */
export const PEAK_DECAY_DB_PER_S = 14;
/** Where the trigger sits horizontally, as a fraction of the plot width. */
export const TRIGGER_X_FRACTION = 0.2;
/** Above this many frames a waveform switches to a min/max envelope. */
export const RAW_WAVE_BUDGET = 8192;
/** Hard cap on envelope columns, so a long sweep stays O(width). */
export const ENVELOPE_MAX_COLUMNS = 1400;

export interface ScopePaintOpts {
  width: number;
  height: number;
  theme: ScopeTheme;
  /** 0 = pristine flat, 1 = full semi-realism. */
  fx: number;
  /** Bottom of the dB scale. */
  floorDb?: number;
  /** Top of the dB scale (0 dBFS by convention). */
  ceilingDb?: number;
  /** Peak-hold store, one normalised entry per column. Mutated in place. */
  peaks?: Float32Array;
  /** Seconds since the previous frame — drives time-based decay. */
  dt?: number;
  tiltDbPerOct?: number;
  minHz?: number;
  maxHz?: number;
  /** Linear gain applied to a waveform, or the vector scope's radius gain. */
  scale?: number;
  trigger?: boolean;
  color?: string;
  /** Draw the graticule (turn off for a bare trace). */
  grid?: boolean;
  /** Vector scope: weight of the PREVIOUS frame, 0..1. Higher = longer glow. */
  phosphor?: number;
}

/* ── Shared furniture ──────────────────────────────────────────────────── */

/**
 * CRT backdrop and graticule. Division counts are deliberately sparse: the
 * earlier 10x6 mesh read as visual noise at small heights, which is what made
 * the Pitch signal monitor look like a striped block.
 */
export function paintScopeFrame(ctx: CanvasRenderingContext2D, o: ScopePaintOpts) {
  const { width: w, height: h, theme, fx } = o;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.72);
  bg.addColorStop(0, 'rgba(16,26,32,.85)');
  bg.addColorStop(1, 'rgba(4,7,10,.96)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (o.grid !== false) {
    const cols = w < 260 ? 4 : 8;
    const rows = h < 90 ? 2 : 4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (let i = 1; i < cols; i++) {
      const x = Math.round((i / cols) * w) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let i = 1; i < rows; i++) {
      const y = Math.round((i / rows) * h) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    ctx.strokeStyle = theme.gridBright;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(h / 2) + 0.5);
    ctx.lineTo(w, Math.round(h / 2) + 0.5);
    ctx.stroke();
  }

  if (fx > 0.02) {
    ctx.save();
    ctx.globalAlpha = 0.05 * fx;
    ctx.fillStyle = '#fff';
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  }
}

function strokeTrace(ctx: CanvasRenderingContext2D, theme: ScopeTheme, fx: number, color?: string) {
  ctx.strokeStyle = color ?? theme.trace;
  ctx.lineJoin = 'round';
  if (fx > 0.02 && theme.glow > 0) {
    ctx.shadowColor = color ?? theme.trace;
    ctx.shadowBlur = 9 * theme.glow * fx;
  } else {
    ctx.shadowBlur = 0;
  }
}

/** 1-2-5 ticks per decade inside a frequency window — LiteScope's log ruler. */
export function logTicks(minHz: number, maxHz: number): number[] {
  const out: number[] = [];
  const d0 = Math.floor(Math.log10(Math.max(1, minHz)));
  const d1 = Math.ceil(Math.log10(Math.max(10, maxHz)));
  for (let d = d0; d <= d1; d++) {
    for (const m of [1, 2, 5]) {
      const f = m * 10 ** d;
      if (f >= minHz && f <= maxHz) out.push(f);
    }
  }
  return out;
}

export function formatHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(Math.round(hz));
}

/* ── Spectrum ──────────────────────────────────────────────────────────── */

/**
 * Log-frequency spectrum from an FFT in dBFS (`getFloatFrequencyData` already
 * applies the transform's normalisation, so no coherent-gain correction is
 * needed here). Draws a filled trace, a glow pass, and a time-decaying
 * peak-hold staircase.
 */
export function paintSpectrum(
  c: CanvasRenderingContext2D,
  freq: Float32Array,
  sampleRate: number,
  o: ScopePaintOpts & { bars?: boolean },
) {
  const { width: w, height: h, theme, fx } = o;
  paintScopeFrame(c, o);

  const floor = o.floorDb ?? -96;
  const ceiling = o.ceilingDb ?? 0;
  const span = Math.max(1, ceiling - floor);
  const fMin = Math.max(1, o.minHz ?? 20);
  const fMax = Math.min(sampleRate / 2, o.maxHz ?? 20000);
  const tilt = o.tiltDbPerOct ?? DEFAULT_TILT_DB_PER_OCT;
  const bins = freq.length;
  const nyquist = sampleRate / 2;
  const dt = Math.max(0, Math.min(0.5, o.dt ?? 1 / 30));
  const logRange = Math.log10(fMax / fMin);

  const hzToX = (hz: number) => (Math.log10(Math.max(fMin, hz) / fMin) / logRange) * w;
  const xToHz = (x: number) => fMin * 10 ** ((x / w) * logRange);
  const dbToY = (db: number) => h - Math.max(0, Math.min(1, (db - floor) / span)) * h;

  /* Sample the trace once per pixel with linear interpolation between bins. */
  const cols = Math.max(2, Math.floor(w));
  const xs = new Float32Array(cols);
  const ys = new Float32Array(cols);
  const vals = new Float32Array(cols);
  for (let i = 0; i < cols; i++) {
    const hz = xToHz((i / (cols - 1)) * w);
    const bin = (hz / nyquist) * bins;
    const b0 = Math.max(0, Math.min(bins - 1, Math.floor(bin)));
    const b1 = Math.min(bins - 1, b0 + 1);
    const t = Math.max(0, Math.min(1, bin - b0));
    const raw = freq[b0] * (1 - t) + freq[b1] * t;
    /* Tilt lifts the top end so a natural spectrum reads as a flat plateau
       instead of a cliff — the same 3 dB/oct anchored at 1 kHz as LiteScope. */
    const db = raw + tilt * Math.log2(Math.max(hz, 20) / 1000);
    xs[i] = (i / (cols - 1)) * w;
    ys[i] = dbToY(db);
    vals[i] = Math.max(0, Math.min(1, (db - floor) / span));
  }

  /* Gradient under-fill. */
  if (o.bars !== false) {
    c.save();
    c.beginPath();
    c.moveTo(xs[0], h);
    for (let i = 0; i < cols; i++) c.lineTo(xs[i], ys[i]);
    c.lineTo(xs[cols - 1], h);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.fill);
    g.addColorStop(0.55, 'rgba(0,0,0,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fill();
    c.restore();
  }

  /* Glow pass, then the crisp trace on top. */
  c.save();
  c.beginPath();
  for (let i = 0; i < cols; i++) {
    if (i === 0) c.moveTo(xs[i], ys[i]);
    else c.lineTo(xs[i], ys[i]);
  }
  strokeTrace(c, theme, fx);
  c.globalAlpha = 0.22;
  c.lineWidth = 3.4;
  c.stroke();
  c.globalAlpha = 1;
  c.lineWidth = 1.6;
  c.shadowBlur = 0;
  c.stroke();
  c.restore();

  /* Peak-hold: decays in dB per second, drawn as a staircase. */
  const peaks = o.peaks;
  if (peaks && peaks.length) {
    const decay = (PEAK_DECAY_DB_PER_S / span) * dt;
    for (let i = 0; i < peaks.length; i++) {
      const src = Math.min(cols - 1, Math.round((i / (peaks.length - 1)) * (cols - 1)));
      peaks[i] = Math.max(peaks[i] - decay, vals[src]);
    }
    c.save();
    c.strokeStyle = theme.peak;
    c.globalAlpha = 0.85;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / (peaks.length - 1)) * w;
      const y = h - peaks[i] * h;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.restore();
  }

  /* Frequency ruler, 1-2-5 per decade. */
  c.save();
  c.font = '9px "Share Tech Mono", monospace';
  let lastLabel = Number.NEGATIVE_INFINITY;
  for (const hz of logTicks(fMin, fMax)) {
    const x = hzToX(hz);
    c.fillStyle = theme.gridBright;
    c.fillRect(Math.round(x), h - 5, 1, 5);
    if (x - lastLabel >= 30) {
      c.fillStyle = 'rgba(160,185,205,.5)';
      c.fillText(formatHz(hz), x + 3, h - 7);
      lastLabel = x;
    }
  }
  c.restore();
}

/* ── Waveform ──────────────────────────────────────────────────────────── */

/**
 * AC-coupled, rising-edge triggered oscilloscope. The trigger is placed
 * `TRIGGER_X_FRACTION` in from the left and the window rolls around it, which
 * is what makes the trace stand still instead of sliding.
 */
export function paintWaveform(c: CanvasRenderingContext2D, data: Float32Array, o: ScopePaintOpts) {
  const { width: w, height: h, theme, fx } = o;
  paintScopeFrame(c, o);

  const n = data.length;
  if (n < 4) return;
  const scale = o.scale ?? 1;

  /* AC coupling: remove the window mean so a DC offset cannot push the trace
     off-screen. */
  let mean = 0;
  for (let i = 0; i < n; i++) mean += data[i];
  mean /= n;
  const mid = h / 2;
  const amp = h / 2 - 3;
  const yOf = (v: number) => mid - Math.max(-2.5, Math.min(2.5, (v - mean) * scale)) * amp;

  /* Trigger: the most recent rising crossing of the mean, inside the search
     window. `trig === 0` means free-run. */
  let trig = 0;
  if (o.trigger !== false) {
    const search = Math.min(n, 32768);
    for (let i = Math.max(1, n - search); i < n - 1; i++) {
      if (data[i - 1] <= mean && data[i] > mean) trig = i;
    }
  }
  const startX = w * TRIGGER_X_FRACTION;

  c.save();
  strokeTrace(c, theme, fx, o.color ?? theme.traceAlt);
  c.lineWidth = 1.5;

  if (n <= RAW_WAVE_BUDGET) {
    /* Raw polyline, rolled around the trigger so the trace stands still. */
    c.beginPath();
    const offset = Math.floor(startX);
    let first = true;
    for (let x = 0; x <= w; x++) {
      const k = x - offset;
      const idx = (((trig + k) % n) + n) % n;
      const y = yOf(data[idx]);
      if (first) {
        c.moveTo(x, y);
        first = false;
      } else c.lineTo(x, y);
    }
    c.stroke();
  } else {
    /* Min/max envelope, capped at ENVELOPE_MAX_COLUMNS columns. */
    const cols = Math.max(2, Math.min(Math.floor(w), ENVELOPE_MAX_COLUMNS));
    const per = n / cols;
    const stepX = w / (cols - 1);
    c.beginPath();
    for (let i = 0; i < cols; i++) {
      const s0 = Math.floor(i * per);
      const s1 = Math.min(n, Math.max(s0 + 1, Math.floor((i + 1) * per)));
      let mn = 1;
      let mx = -1;
      for (let s = s0; s < s1; s++) {
        const v = data[s] - mean;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx < mn) continue;
      const x = i * stepX;
      c.moveTo(x, mid - Math.max(-2.5, Math.min(2.5, mx * scale)) * amp);
      c.lineTo(x, mid - Math.max(-2.5, Math.min(2.5, mn * scale)) * amp);
    }
    c.stroke();
  }
  c.restore();

  if (fx > 0.02) {
    c.save();
    c.globalAlpha = 0.07 * fx;
    c.fillStyle = o.color ?? theme.traceAlt;
    for (let y = 0; y < h; y += 5) c.fillRect(0, y, w, 1);
    c.restore();
  }
}

/* ── Vector scope (goniometer) ─────────────────────────────────────────── */

/** Persistent phosphor layers, one per destination canvas. */
const PHOSPHOR = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function phosphorFor(c: CanvasRenderingContext2D, w: number, h: number): HTMLCanvasElement {
  const key = c.canvas as HTMLCanvasElement;
  let layer = PHOSPHOR.get(key);
  if (!layer) {
    layer = document.createElement('canvas');
    PHOSPHOR.set(key, layer);
  }
  if (layer.width !== Math.max(1, Math.floor(w)) || layer.height !== Math.max(1, Math.floor(h))) {
    layer.width = Math.max(1, Math.floor(w));
    layer.height = Math.max(1, Math.floor(h));
  }
  return layer;
}

/**
 * ±45° M/S goniometer with phosphor afterglow.
 *
 * x = (L − R)/√2, y = (L + R)/√2 with the screen Y inverted, so mono content
 * is a vertical line and a hard-panned source lies on a diagonal. The trace is
 * accumulated into a persistent layer that fades per frame (LiteScope's
 * phosphor model), which is what gives the instrument its afterglow.
 */
export function paintVectorscope(
  c: CanvasRenderingContext2D,
  left: Float32Array,
  right: Float32Array,
  o: ScopePaintOpts,
) {
  const { width: w, height: h, theme, fx } = o;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 6;
  const r2 = Math.SQRT1_2;
  const gain = (o.scale ?? 1) * r * 0.92;

  /* Phosphor layer: fade what is already there, then add this frame's trace. */
  const layer = phosphorFor(c, w, h);
  const lctx = layer.getContext('2d');
  if (lctx) {
    const fade = Math.max(6, Math.min(110, Math.round((1 - (o.phosphor ?? 0.72)) * 110)));
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'destination-out';
    lctx.fillStyle = `rgba(0,0,0,${(fade / 255).toFixed(3)})`;
    lctx.fillRect(0, 0, layer.width, layer.height);
    lctx.globalCompositeOperation = 'lighter';

    const n = Math.min(left.length, right.length);
    const step = Math.max(1, Math.floor(n / 1400));
    lctx.strokeStyle = theme.trace;
    lctx.lineWidth = 1.4;
    lctx.lineJoin = 'round';
    lctx.beginPath();
    let first = true;
    for (let i = 0; i < n; i += step) {
      const l = left[i];
      const rr = right[i];
      const x = cx + (l - rr) * r2 * gain;
      const y = cy - (l + rr) * r2 * gain;
      if (first) {
        lctx.moveTo(x, y);
        first = false;
      } else lctx.lineTo(x, y);
    }
    lctx.stroke();
  }

  /* Frame first, then the accumulated phosphor on top of it. */
  paintScopeFrame(c, o);

  c.save();
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
  /* ±45° axes: the mono (vertical) and side (horizontal) diagonals. */
  c.strokeStyle = 'rgba(199,15,40,.26)';
  c.beginPath();
  c.moveTo(cx - r * r2, cy - r * r2);
  c.lineTo(cx + r * r2, cy + r * r2);
  c.moveTo(cx + r * r2, cy - r * r2);
  c.lineTo(cx - r * r2, cy + r * r2);
  c.stroke();
  c.restore();

  c.save();
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.9;
  c.drawImage(layer, 0, 0, w, h);
  c.restore();

  c.save();
  c.fillStyle = 'rgba(160,185,205,.5)';
  c.font = '9px "Share Tech Mono", monospace';
  c.fillText('L', cx - r + 2, cy - 3);
  c.fillText('R', cx + r - 8, cy - 3);
  c.fillText('M', cx + 3, cy - r + 10);
  c.fillText('S', cx + 3, cy + r - 4);
  c.restore();

  /* A faint lens vignette keeps the phosphor from looking pasted on. */
  if (fx > 0.02) {
    c.save();
    const v = c.createRadialGradient(cx, cy, r * 0.4, cx, cy, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.35 * fx})`);
    c.fillStyle = v;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
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
