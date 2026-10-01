/* ============================================================================
   LiteDAW · BPM TRAINER · LOCAL CONTROLS
   Small primitives the shared kit does not carry: a multi-select chip bank, a
   live (rAF-written) readout and a token-styled range slider. All of them live
   in this page folder — the shared files are owned by the integrator.
   ========================================================================= */

import { type ReactNode, type RefObject } from 'react';
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
}: {
  innerRef: RefObject<HTMLSpanElement | null>;
  initial?: string;
  unit?: ReactNode;
  tone?: 'cyan' | 'red' | 'amber' | 'green' | 'plain';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  title?: string;
}) {
  const cls = [
    'readout',
    tone !== 'cyan' ? `readout--${tone}` : '',
    size === 'lg' ? 'readout--lg' : size === 'xl' ? 'readout--xl' : '',
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
   RANGE SLIDER — token-styled, keyboard accessible
   ══════════════════════════════════════════════════════════════════════════ */

export function RangeSlider({
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
      className="bpm-range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ accentColor: 'var(--cyan)' }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
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
