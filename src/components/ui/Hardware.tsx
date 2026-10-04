/* ============================================================================
   LiteDAW · HARDWARE CONTROLS — rotary knob, fader, level meter
   All three are SVG/CSS so they stay crisp at any DPI and animate cheaply.
   ========================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react';
import { clearTextSelection } from './kit';

/* ══════════════════════════════════════════════════════════════════════════
   KNOB — 270° rotary with pointer-drag, fine mode and snap-back
   ══════════════════════════════════════════════════════════════════════════ */

export interface KnobProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: number;
  label?: string;
  unit?: string;
  /** Bipolar knobs (pan, tilt) fill outward from the 12 o'clock position. */
  bipolar?: boolean;
  /** Value that a double-click snaps to. */
  resetTo?: number;
  format?: (v: number) => string;
  accent?: string;
  disabled?: boolean;
}

const SWEEP = 270; // degrees of travel
const START = -135;

export function Knob({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  size = 52,
  label,
  unit,
  bipolar = false,
  resetTo,
  format,
  accent = 'var(--red)',
  disabled = false,
}: KnobProps) {
  const drag = useRef<{ y: number; v: number; fine: boolean } | null>(null);
  const [live, setLive] = useState(false);

  const norm = (value - min) / (max - min || 1);
  const angle = START + norm * SWEEP;

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const quant = (v: number) => {
    const q = Math.round(v / step) * step;
    return Number.parseFloat(q.toFixed(6));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value, fine: e.shiftKey };
    setLive(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    const fine = d.fine || e.shiftKey;
    const speed = fine ? 0.0012 : 0.006;
    onChange(clamp(quant(d.v + dy * speed * (max - min))));
  };
  const end = () => {
    drag.current = null;
    setLive(false);
  };

  const r = size / 2;
  const track = r - 4.5;
  const arcPath = (from: number, to: number) => {
    const pol = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return [r + track * Math.cos(rad), r + track * Math.sin(rad)];
    };
    const [x1, y1] = pol(from);
    const [x2, y2] = pol(to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const dir = to > from ? 1 : 0;
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${track} ${track} 0 ${large} ${dir} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };

  const zero = bipolar ? START + SWEEP / 2 : START;
  const fillFrom = bipolar ? Math.min(zero, angle) : START;
  const fillTo = bipolar ? Math.max(zero, angle) : angle;
  const active = Math.abs(angle - zero) > 0.6;

  const pol = (deg: number, radius: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [r + radius * Math.cos(rad), r + radius * Math.sin(rad)];
  };
  const [px, py] = pol(angle, track - 5);
  const [ox, oy] = pol(angle, track - 12.5);
  const display = format ? format(value) : Number.isInteger(step) ? String(value) : value.toFixed(2);

  return (
    <div className="knob" style={{ width: size, opacity: disabled ? 0.4 : 1 }}>
      <div
        className="knob__dial"
        style={{ width: size, height: size, cursor: disabled ? 'not-allowed' : 'ns-resize' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => {
          if (resetTo === undefined) return;
          /* The double-click may have selected the nearest label text. */
          clearTextSelection();
          onChange(resetTo);
        }}
        role="slider"
        aria-label={label ?? 'knob'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(quant(value + step)));
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(quant(value - step)));
        }}
      >
        {/* The value arc and pointer carry a drop-shadow (an SVG filter) that
            reaches past the 270° travel radius, and the default 0..size viewport
            cropped it at the edges — most visibly on the smallest knobs.
            `overflow: visible` lets the glow paint outside the viewBox while the
            viewBox itself stays 1:1, so the dial is not scaled down. */}
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
          <defs>
            <radialGradient id={`kb-${size}-${label ?? ''}`} cx="38%" cy="26%" r="82%">
              <stop offset="0%" stopColor="#5c666f" />
              <stop offset="46%" stopColor="#2c343b" />
              <stop offset="100%" stopColor="#12171b" />
            </radialGradient>
            <linearGradient id={`kr-${size}-${label ?? ''}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* travel track */}
          <path d={arcPath(START, START + SWEEP)} fill="none" stroke="rgba(0,0,0,.72)" strokeWidth={3.4} strokeLinecap="butt" />
          <path d={arcPath(START, START + SWEEP)} fill="none" stroke="rgba(210,225,238,.13)" strokeWidth={1.4} strokeLinecap="butt" />

          {/* value arc */}
          {active && (
            <path
              d={arcPath(fillFrom, fillTo)}
              fill="none"
              stroke={accent}
              strokeWidth={3.2}
              strokeLinecap="butt"
              style={{ filter: `drop-shadow(0 0 5px ${accent})` }}
            />
          )}

          {/* machined body */}
          <circle cx={r} cy={r} r={track - 6} fill={`url(#kb-${size}-${label ?? ''})`} stroke="rgba(0,0,0,.8)" strokeWidth={1} />
          <circle cx={r} cy={r} r={track - 7.5} fill="none" stroke={`url(#kr-${size}-${label ?? ''})`} strokeWidth={1} />
          {/* knurl ticks */}
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * 360;
            const [x1, y1] = pol(a, track - 8.6);
            const [x2, y2] = pol(a, track - 10.4);
            return <path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} stroke="rgba(0,0,0,.5)" strokeWidth={0.8} />;
          })}
          {/* pointer */}
          <path
            d={`M${ox} ${oy}L${px} ${py}`}
            stroke={live || active ? accent : 'var(--alu-300)'}
            strokeWidth={2.2}
            strokeLinecap="butt"
            style={live || active ? { filter: `drop-shadow(0 0 6px ${accent})` } : undefined}
          />
          <circle cx={r} cy={r} r={2.4} fill="rgba(0,0,0,.6)" />
        </svg>
      </div>
      {label && <span className="knob__label">{label}</span>}
      <span className="knob__value" data-live={live || undefined}>
        {display}
        {unit && <em>{unit}</em>}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   FADER — linear travel with machined cap and centre detent
   ══════════════════════════════════════════════════════════════════════════ */

export interface FaderProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  height?: number;
  width?: number;
  bipolar?: boolean;
  resetTo?: number;
  label?: string;
  format?: (v: number) => string;
  accent?: string;
  disabled?: boolean;
}

export function Fader({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.005,
  height = 130,
  width = 34,
  bipolar = false,
  resetTo = 0,
  label,
  format,
  accent = 'var(--red)',
  disabled = false,
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const norm = (value - min) / (max - min || 1);
  const pct = Math.min(1, Math.max(0, norm));

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const setFromEvent = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const t = 1 - (clientY - rect.top) / rect.height;
      const raw = min + Math.min(1, Math.max(0, t)) * (max - min);
      onChange(clamp(Number.parseFloat((Math.round(raw / step) * step).toFixed(6))));
    },
    [min, max, step, onChange],
  );

  const capH = 22;
  const travel = height - capH;
  const top = (1 - pct) * travel;
  const zeroPct = bipolar ? (0 - min) / (max - min) : 0;

  return (
    <div className="fader" style={{ width, opacity: disabled ? 0.4 : 1 }}>
      <div
        ref={trackRef}
        className="fader__track"
        style={{ height, cursor: disabled ? 'not-allowed' : 'ns-resize' }}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setLive(true);
          setFromEvent(e.clientY);
        }}
        onPointerMove={(e) => live && setFromEvent(e.clientY)}
        onPointerUp={() => setLive(false)}
        onPointerCancel={() => setLive(false)}
        onDoubleClick={() => {
          /* The double-click may have selected the nearest label text. */
          clearTextSelection();
          onChange(clamp(resetTo));
        }}
        role="slider"
        aria-label={label ?? 'fader'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') onChange(clamp(value + step * 10));
          if (e.key === 'ArrowDown') onChange(clamp(value - step * 10));
        }}
      >
        <span className="fader__slot" />
        <span className="fader__ticks" />
        {bipolar && <span className="fader__zero" style={{ top: `${(1 - zeroPct) * travel + capH / 2}px` }} />}
        <span
          className="fader__fill"
          style={{
            /* The fill is anchored by its own top edge in both modes: bipolar
               grows outward from the zero detent, unipolar from the bottom of
               the travel (min) up to the underside of the cap. Anchoring the
               unipolar fill with `bottom: travel - top` reused the cap-to-floor
               distance as a floor offset, which mirrored the lit travel above
               the handle instead of below it. */
            top: `${bipolar ? top + capH / 2 : top + capH}px`,
            height: `${bipolar ? Math.abs(pct - zeroPct) * travel : travel - top}px`,
            background: `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 45%, black))`,
            boxShadow: `0 0 8px ${accent}`,
          }}
        />
        <span className="fader__cap" style={{ top, height: capH }}>
          <i />
        </span>
      </div>
      {label && <span className="knob__label">{label}</span>}
      {format && <span className="knob__value" data-live={live || undefined}>{format(value)}</span>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   METER — RAF-driven, peak-hold, works from an analyser or a plain getter
   ══════════════════════════════════════════════════════════════════════════ */

export interface MeterProps {
  getLevel: () => number;
  orientation?: 'h' | 'v';
  length?: number;
  thickness?: number;
  peakHold?: number;
  dbScale?: boolean;
}

export function Meter({ getLevel, orientation = 'h', length = 120, thickness = 8 }: MeterProps) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);
  const state = useRef({ peak: 0, peakAt: 0, smooth: 0 });

  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const s = state.current;
      const raw = Math.min(1, Math.max(0, getLevel()));
      // fast attack, slow release — mechanical VU ballistics
      s.smooth = raw > s.smooth ? raw * 0.66 + s.smooth * 0.34 : s.smooth * 0.88 + raw * 0.12;
      if (s.smooth >= s.peak) {
        s.peak = s.smooth;
        s.peakAt = t;
      } else if (t - s.peakAt > 900) {
        s.peak = Math.max(s.smooth, s.peak - 0.008);
      }
      const f = fillRef.current;
      if (f) f.style.transform = orientation === 'h' ? `scaleX(${s.smooth.toFixed(4)})` : `scaleY(${s.smooth.toFixed(4)})`;
      const p = peakRef.current;
      if (p) p.style.transform = orientation === 'h' ? `translateX(${(s.peak * length).toFixed(1)}px)` : `translateY(${(-s.peak * length).toFixed(1)}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, orientation, length]);

  return (
    <span
      className={`meter ${orientation === 'v' ? 'meter--vert' : ''}`}
      style={orientation === 'h' ? { width: length, height: thickness } : { width: thickness, height: length }}
    >
      <span className="meter__fill" ref={fillRef} />
      <span className="meter__scale" />
      {orientation === 'h' ? (
        <span className="meter__peak" ref={peakRef} />
      ) : (
        <span className="meter__peak" ref={peakRef} style={{ top: 'auto', bottom: 0, left: 0, right: 0, height: 2, width: 'auto' }} />
      )}
    </span>
  );
}

/** Static bar used for non-realtime values (scores, confidence, load). */
export function Bar({
  value,
  max = 1,
  length = 100,
  thickness = 6,
  color = 'var(--cyan)',
  showTrack = true,
}: {
  value: number;
  max?: number;
  length?: number | string;
  thickness?: number;
  color?: string;
  showTrack?: boolean;
}) {
  const pct = Math.min(1, Math.max(0, value / max));
  return (
    <span
      className="bar"
      style={{
        width: typeof length === 'number' ? length : length,
        height: thickness,
        background: showTrack ? 'rgba(0,0,0,.6)' : 'transparent',
      }}
    >
      <span
        className="bar__fill"
        style={{
          transform: `scaleX(${pct})`,
          background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, black), ${color})`,
          boxShadow: pct > 0.02 ? `0 0 8px ${color}` : 'none',
        }}
      />
    </span>
  );
}
