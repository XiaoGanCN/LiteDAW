/* ============================================================================
   LiteDAW · BPM TRAINER · LOCAL CONTROLS
   Small primitives the shared kit does not carry: a multi-select chip bank, a
   live (rAF-written) readout and a token-styled range slider. All of them live
   in this page folder — the shared files are owned by the integrator.
   ========================================================================= */

import { type ReactNode, type RefObject, useCallback, useRef, useState } from 'react';
import { Icon, type IconName } from '../../design/Icon';

/* ══════════════════════════════════════════════════════════════════════════
   MULTI-SELECT CHIP BANK — settable sets (numerators, denominators, sounds).
   Deliberately NOT the red primary: selection is aluminium + cyan.
   ══════════════════════════════════════════════════════════════════════════ */

export interface MultiOption<T extends string | number> {
  value: T;
  label: string;
  sub?: string;
  icon?: IconName;
}

export function MultiToggle<T extends string | number>({
  options,
  values,
  onChange,
  disabled = false,
  columns = 4,
  ariaLabel,
  audition,
}: {
  options: MultiOption<T>[];
  values: T[];
  onChange: (next: T[]) => void;
  disabled?: boolean;
  columns?: number;
  ariaLabel: string;
  /** Optional per-option audition hook (renders a speaker button). */
  audition?: (v: T) => void;
}) {
  const has = (v: T) => values.includes(v);
  const toggle = (v: T) => {
    const next = has(v) ? values.filter((x) => x !== v) : [...values, v];
    if (next.length === 0) return; // never leave a set empty
    onChange(next);
  };

  return (
    <div className="bpm-chips" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <span key={String(o.value)} className={`bpm-chip-cell ${audition ? 'bpm-chip-cell--aud' : ''}`}>
          <button
            type="button"
            className="bpm-chip"
            data-on={has(o.value) ? 'true' : 'false'}
            aria-pressed={has(o.value)}
            disabled={disabled}
            onClick={() => toggle(o.value)}
            title={o.sub}
          >
            {o.icon && <Icon name={o.icon} size={11} />}
            <span>{o.label}</span>
          </button>
          {audition && (
            <button
              type="button"
              className="bpm-chip__aud"
              aria-label={`Audition ${o.label}`}
              disabled={disabled}
              onClick={() => audition(o.value)}
            >
              <Icon name="speaker" size={11} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LIVE READOUT — a .readout whose digits are written by the rAF timer loop
   (no per-frame React render).
   ══════════════════════════════════════════════════════════════════════════ */

export function LiveReadout({
  innerRef,
  initial = '--:--.-',
  unit,
  tone = 'cyan',
  size = 'md',
  title,
  className = '',
}: {
  innerRef: RefObject<HTMLSpanElement | null>;
  initial?: string;
  unit?: ReactNode;
  tone?: 'cyan' | 'red' | 'amber' | 'green' | 'plain';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  title?: string;
  className?: string;
}) {
  const cls = [
    'readout',
    tone !== 'cyan' ? `readout--${tone}` : '',
    size === 'lg' ? 'readout--lg' : size === 'xl' ? 'readout--xl' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} title={title}>
      <span ref={innerRef}>{initial}</span>
      {unit && <span className="readout__u">{unit}</span>}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TIME CELL — Round / Window / Session share ONE presentation so the three
   readouts line up exactly (same width, type size, padding, label treatment).
   The digits are written by the rAF loop through `innerRef`.
   ══════════════════════════════════════════════════════════════════════════ */

export function TimeCell({
  label,
  innerRef,
  initial,
  tone = 'plain',
  title,
}: {
  label: string;
  innerRef: RefObject<HTMLSpanElement | null>;
  initial: string;
  tone?: 'cyan' | 'red' | 'amber' | 'green' | 'plain';
  title?: string;
}) {
  return (
    <span className="bpm-time">
      <span className="t-micro bpm-time__label">{label}</span>
      <LiveReadout innerRef={innerRef} initial={initial} tone={tone} className="bpm-time__val" title={title} />
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   RATE SLIDER — the shared `.range` treatment from styles/pages.css.
   Used for unbounded "how much" settings (adaptivity, level).
   ══════════════════════════════════════════════════════════════════════════ */

export function RateSlider({
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <input
      className="range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DUAL RANGE — two thumbs on one track for the tempo range (min … max).
   Pointer-driven (mouse, pen and touch all arrive as pointer events), with a
   `role="group"` wrapper holding two `role="slider"` thumbs so the keyboard
   can drive either end. The thumbs can never cross and never sit closer than
   `gap` BPM apart.
   ══════════════════════════════════════════════════════════════════════════ */

export function DualRange({
  low,
  high,
  min,
  max,
  step = 1,
  gap = 1,
  onChange,
  disabled = false,
  ariaLabel,
  lowLabel = 'Minimum',
  highLabel = 'Maximum',
}: {
  low: number;
  high: number;
  min: number;
  max: number;
  step?: number;
  /** Minimum allowed distance between the two thumbs, in value units. */
  gap?: number;
  onChange: (low: number, high: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  lowLabel?: string;
  highLabel?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<'low' | 'high' | null>(null);
  const span = Math.max(1, max - min);
  const pct = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / span) * 100;

  const quant = useCallback(
    (v: number) => {
      const q = Math.round(v / step) * step;
      return Math.max(min, Math.min(max, q));
    },
    [max, min, step],
  );

  const valueAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return min;
      const r = el.getBoundingClientRect();
      const t = r.width > 0 ? (clientX - r.left) / r.width : 0;
      return quant(min + t * span);
    },
    [min, quant, span],
  );

  const commit = useCallback(
    (which: 'low' | 'high', v: number) => {
      if (which === 'low') onChange(Math.min(quant(v), high - gap), high);
      else onChange(low, Math.max(quant(v), low + gap));
    },
    [gap, high, low, onChange, quant],
  );

  /** Which thumb is nearer the press — so a tap on the track grabs the right one. */
  const nearest = (v: number) => (Math.abs(v - low) <= Math.abs(v - high) ? 'low' : 'high');

  const startDrag = (which: 'low' | 'high') => (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(which);
  };

  const onTrackDown = (e: React.PointerEvent) => {
    if (disabled) return;
    const v = valueAt(e.clientX);
    const which = nearest(v);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(which);
    commit(which, v);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging || disabled) return;
    commit(dragging, valueAt(e.clientX));
  };

  const endDrag = () => setDragging(null);

  const onKey = (which: 'low' | 'high') => (e: React.KeyboardEvent) => {
    if (disabled) return;
    const stepN = e.shiftKey ? step * 5 : step;
    let next: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = (which === 'low' ? low : high) - stepN;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = (which === 'low' ? low : high) + stepN;
    if (e.key === 'PageDown') next = (which === 'low' ? low : high) - step * 10;
    if (e.key === 'PageUp') next = (which === 'low' ? low : high) + step * 10;
    if (e.key === 'Home') next = which === 'low' ? min : low + gap;
    if (e.key === 'End') next = which === 'low' ? high - gap : max;
    if (next === null) return;
    e.preventDefault();
    commit(which, next);
  };

  /* Drag bookkeeping is deliberately local: the committed value always lives
     in the store, so a re-render mid-drag cannot desynchronise the thumbs. */

  const thumb = (which: 'low' | 'high') => {
    const v = which === 'low' ? low : high;
    return (
      <span
        className="bpm-dual__thumb"
        data-end={which}
        data-drag={dragging === which ? 'true' : undefined}
        style={{ left: `${pct(v)}%` }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${ariaLabel} · ${which === 'low' ? lowLabel : highLabel}`}
        aria-valuemin={which === 'low' ? min : low + gap}
        aria-valuemax={which === 'low' ? high - gap : max}
        aria-valuenow={v}
        aria-valuetext={`${v} BPM`}
        aria-disabled={disabled || undefined}
        onPointerDown={startDrag(which)}
        onKeyDown={onKey(which)}
      >
        <i className="bpm-dual__grip" />
      </span>
    );
  };

  return (
    <div
      className="bpm-dual"
      role="group"
      aria-label={ariaLabel}
      data-disabled={disabled ? 'true' : undefined}
      data-drag={dragging ?? undefined}
    >
      <div
        className="bpm-dual__track"
        ref={trackRef}
        onPointerDown={onTrackDown}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="bpm-dual__rail" />
        <span className="bpm-dual__fill" style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }} />
        {thumb('low')}
        {thumb('high')}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   STEP LABEL — engraved caption + hairline used between config rows
   ══════════════════════════════════════════════════════════════════════════ */

export function Cap({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <span className="field__label">
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
