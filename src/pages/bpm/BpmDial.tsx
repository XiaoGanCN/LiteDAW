/* ============================================================================
   LiteDAW · BPM TRAINER · TEMPO DIAL
   A rotary answer surface for the tempo trainer, built in the `.dial` idiom of
   the shared DialPicker (which this page must not modify).

   Interaction — the whole point of this control:
     · drag the head around the ring → COARSE steps, the full 20…400 BPM range
       is never more than one comfortable sweep away;
     · hold still for DWELL_MS → the dial ZOOMS IN: the ring re-scales to a
       ±FINE_SPAN window around where your finger stopped, one BPM per 3° of
       travel, with the window printed on the face;
     · move again and it stays zoomed until you release — lifting the head
       commits and drops back to the coarse scale.

   All pointer events, so mouse / pen / touch behave identically. Keyboard:
   arrows ±1 (shift ±5), PageUp/Down ±10, Home/End to the range ends.
   ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Silence before the dial zooms in for fine adjustment. */
const DWELL_MS = 400;
const SWEEP = 300;
const START = -150;
/** Half-width of the zoom window, in BPM. */
const FINE_SPAN = 15;
/**
 * Degrees of head travel per 1 BPM while zoomed.
 *
 * Derived from the window rather than hand-picked: the zoomed scale has to fill
 * the same 300 degrees that the coarse scale does. The previous fixed value of
 * 3 put 10 BPM across 30 degrees against the coarse scale's 25 — a "zoom" that
 * was barely distinguishable from the scale it was zooming into.
 */
const FINE_DEG_PER_BPM = SWEEP / (FINE_SPAN * 2);
/** Degrees of head travel per 1 BPM while coarse (set per-range below). */
const COARSE_DEG_PER_BPM = 0.82;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Shortest signed angular distance from `a` to `b`, in degrees. */
function shortDelta(a: number, b: number) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** One spoke of the scale, drawn as a rotated group so it can animate. */
function Mark({
  m,
  i,
  fine,
  pointAt,
  tickInner,
  tickOuter,
  labelR,
}: {
  m: { v: number; deg: number };
  i: number;
  fine: boolean;
  pointAt: (deg: number, radius: number) => readonly [number, number];
  tickInner: number;
  tickOuter: number;
  labelR: number;
}) {
  const [x0, y0] = pointAt(m.deg, tickInner);
  const [x1, y1] = pointAt(m.deg, tickOuter);
  const [lx, ly] = pointAt(m.deg, labelR);
  const major = i % 5 === 0;
  return (
    <g
      className="bpm-dial__mark"
      data-fine={fine ? 'true' : undefined}
      style={{ transition: 'opacity 240ms var(--ease-out)' }}
    >
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? 'var(--alu-300)' : 'rgba(190,210,225,.32)'} strokeWidth={major ? 2 : 1.2} />
      <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="dial__lab bpm-dial__tick" data-major={major || undefined}>
        {Math.round(m.v)}
      </text>
    </g>
  );
}

export interface BpmDialProps {
  value: number;
  onChange: (v: number) => void;
  /** Called as the head settles, for auditioning the dialled tempo. */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  size?: number;
  disabled?: boolean;
  /** Caption under the value in the hub. */
  label?: string;
  /** Secondary line under the label (tempo marking, hint, …). */
  sub?: string;
}

export function BpmDial({
  value,
  onChange,
  onCommit,
  min = 20,
  max = 400,
  size = 250,
  disabled = false,
  label = 'your call',
  sub,
}: BpmDialProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fine, setFine] = useState(false);
  /** BPM at the centre of the zoom window — frozen when the dwell fires. */
  const [anchor, setAnchor] = useState(value);

  const drag = useRef<{ angle: number; value: number } | null>(null);
  const dwell = useRef(0);
  const valueRef = useRef(value);
  const fineRef = useRef(false);
  const anchorRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => () => window.clearTimeout(dwell.current), []);

  const span = Math.max(1, max - min);
  const r = size / 2;
  const ringR = Math.max(24, r - 42);
  /** Coarse scale: the whole 20…400 range across the sweep. */
  const coarseAngleOf = useCallback(
    (v: number) => START + ((clamp(v, min, max) - min) / span) * SWEEP,
    [max, min, span],
  );

  /** Fine scale: ±FINE_SPAN BPM across a ±FINE_SPAN*FINE_DEG_PER_BPM window. */
  const fineAngleOf = useCallback(
    (v: number) => clamp((v - anchor) * FINE_DEG_PER_BPM, -SWEEP / 2, SWEEP / 2),
    [anchor],
  );

  const angleOf = fine ? fineAngleOf : coarseAngleOf;
  const headAngle = angleOf(value);

  const pointAt = (deg: number, radius: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [r + radius * Math.cos(rad), r + radius * Math.sin(rad)] as const;
  };

  /** Pointer angle in the dial's frame: 0 at 12 o'clock, increasing clockwise. */
  const pointerAngle = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const cx = clientX - (rect.left + rect.width / 2);
      const cy = clientY - (rect.top + rect.height / 2);
      return (Math.atan2(cy, cx) * 180) / Math.PI + 90;
    },
    [],
  );

  const commitValue = useCallback(
    (v: number) => {
      const n = Math.round(clamp(v, min, max));
      if (n !== valueRef.current) {
        valueRef.current = n;
        onChange(n);
      }
      return n;
    },
    [max, min, onChange],
  );

  const enterFine = useCallback(() => {
    if (fineRef.current) return;
    fineRef.current = true;
    anchorRef.current = valueRef.current;
    setAnchor(valueRef.current);
    setFine(true);
  }, []);

  const leaveFine = useCallback(() => {
    fineRef.current = false;
    setFine(false);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    drag.current = { angle: pointerAngle(e.clientX, e.clientY), value: valueRef.current };
    setDragging(true);
    leaveFine();
    window.clearTimeout(dwell.current);
    /* Arm the zoom: if the finger stops, refine. */
    dwell.current = window.setTimeout(() => {
      if (drag.current) enterFine();
    }, DWELL_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || disabled) return;
    const a = pointerAngle(e.clientX, e.clientY);
    const delta = shortDelta(d.angle, a);
    d.angle = a;
    if (fineRef.current) {
      /* Zoomed: a few degrees of travel is a single BPM, and the value is held
         inside the printed window so the head can never run off the scale. */
      commitValue(
        clamp(valueRef.current + delta / FINE_DEG_PER_BPM, anchorRef.current - FINE_SPAN, anchorRef.current + FINE_SPAN),
      );
    } else {
      commitValue(valueRef.current + delta / COARSE_DEG_PER_BPM);
      window.clearTimeout(dwell.current);
      dwell.current = window.setTimeout(() => {
        if (drag.current) enterFine();
      }, DWELL_MS);
    }
  };

  const finish = () => {
    window.clearTimeout(dwell.current);
    drag.current = null;
    setDragging(false);
    onCommit?.(valueRef.current);
    /* Hold the zoomed scale for a beat so the player can read the window. */
    window.setTimeout(leaveFine, 420);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const s = e.shiftKey ? 5 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = valueRef.current + s;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = valueRef.current - s;
    if (e.key === 'PageUp') next = valueRef.current + 10;
    if (e.key === 'PageDown') next = valueRef.current - 10;
    if (e.key === 'Home') next = min;
    if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    commitValue(next);
    onCommit?.(clamp(Math.round(next), min, max));
  };

  /* ── Scale marks ────────────────────────────────────────────────────────
     Coarse: eleven numbered spokes across the range. Fine: eleven numbered
     spokes across the zoom window, printed on the same ring, which is what
     makes the zoom legible instead of merely slower. */
  const marks = useMemo(() => {
    const out: { v: number; deg: number }[] = [];
    for (let i = 0; i <= 10; i++) {
      if (fine) {
        const v = anchor + (i - 5) * (FINE_SPAN / 5);
        out.push({ v, deg: clamp((v - anchor) * FINE_DEG_PER_BPM, -SWEEP / 2, SWEEP / 2) });
      } else {
        out.push({ v: min + (span * i) / 10, deg: START + (SWEEP * i) / 10 });
      }
    }
    return out;
  }, [anchor, fine, max, min, span]);

  const tickOuter = ringR + 12;
  const tickInner = ringR - 9;
  const labelR = ringR + 26;
  const [hx, hy] = pointAt(headAngle, ringR);
  const [nx, ny] = pointAt(headAngle, tickInner - 3);
  const arcPath = (fromDeg: number, toDeg: number) => {
    const a0 = ((fromDeg - 90) * Math.PI) / 180;
    const a1 = ((toDeg - 90) * Math.PI) / 180;
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M${(r + ringR * Math.cos(a0)).toFixed(2)} ${(r + ringR * Math.sin(a0)).toFixed(2)}A${ringR} ${ringR} 0 ${large} ${toDeg > fromDeg ? 1 : 0} ${(
      r + ringR * Math.cos(a1)
    ).toFixed(2)} ${(r + ringR * Math.sin(a1)).toFixed(2)}`;
  };

  return (
    <div
      className="dial bpm-dial"
      data-fine={fine ? 'true' : 'false'}
      data-drag={dragging ? 'true' : undefined}
      style={{ width: size, maxWidth: '100%', opacity: disabled ? 0.45 : 1 }}
    >
      <svg
        ref={ref}
        viewBox={`0 0 ${size} ${size}`}
        className="dial__svg bpm-dial__svg"
        style={{ width: '100%', height: 'auto', maxWidth: size, overflow: 'visible', touchAction: 'none' }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Tempo answer in BPM"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        aria-valuetext={`${Math.round(value)} BPM${fine ? `, fine adjust, window ${Math.round(anchor - FINE_SPAN)} to ${Math.round(anchor + FINE_SPAN)}` : ''}`}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={onKeyDown}
        onDoubleClick={() => commitValue((min + max) / 2)}
      >
        <defs>
          <radialGradient id="bpm-dial-face" cx="50%" cy="32%" r="78%">
            <stop offset="0%" stopColor="var(--carbon-700)" />
            <stop offset="62%" stopColor="var(--carbon-850)" />
            <stop offset="100%" stopColor="var(--carbon-950)" />
          </radialGradient>
        </defs>

        {/* machined face + bezel */}
        <circle cx={r} cy={r} r={r - 2} fill="url(#bpm-dial-face)" />
        <circle cx={r} cy={r} r={r - 2} fill="none" stroke="rgba(255,255,255,.07)" />
        <circle cx={r} cy={r} r={ringR + 15} fill="none" stroke="rgba(0,0,0,.72)" strokeWidth={1} />

        {/* detent track */}
        <circle cx={r} cy={r} r={ringR} fill="none" stroke="rgba(0,0,0,.8)" strokeWidth={16} />
        <circle cx={r} cy={r} r={ringR} fill="none" stroke="rgba(190,210,225,.09)" strokeWidth={14} />

        {/* swept arc, from the low end of the scale to the head */}
        <path
          d={arcPath(fine ? fineAngleOf(anchor - FINE_SPAN) : START, headAngle)}
          fill="none"
          stroke={fine ? 'var(--amber)' : 'var(--cyan)'}
          strokeWidth={14}
          strokeLinecap="butt"
          className="bpm-dial__arc"
          opacity={0.5}
        />

        {/* the zoom window, when the dial is refined */}
        {fine && (
          <path
            d={arcPath(fineAngleOf(anchor - FINE_SPAN), fineAngleOf(anchor + FINE_SPAN))}
            fill="none"
            stroke="var(--amber-hi)"
            strokeWidth={16}
            strokeLinecap="round"
            className="bpm-dial__window"
            opacity={0.22}
          />
        )}

        {/* Both scales are mounted at once and cross-faded, and their marks
            carry a CSS rotation transition, so coarse → fine reads as the ring
            re-scaling rather than as a hard swap. */}
        <g className="bpm-dial__scale" data-layer="coarse" aria-hidden={fine}>
          {!fine &&
            marks.map((m, i) => (
              <Mark key={`c${i}`} m={m} i={i} fine={false} pointAt={pointAt} tickInner={tickInner} tickOuter={tickOuter} labelR={labelR} />
            ))}
        </g>
        <g className="bpm-dial__scale" data-layer="fine" aria-hidden={!fine}>
          {fine &&
            marks.map((m, i) => (
              <Mark key={`f${i}`} m={m} i={i} fine pointAt={pointAt} tickInner={tickInner} tickOuter={tickOuter} labelR={labelR} />
            ))}
        </g>

        {/* head */}
        <g
          className="bpm-dial__head"
          style={{
            transform: `translate(${hx}px, ${hy}px)`,
            transition: dragging ? 'none' : 'transform 300ms var(--ease-snap)',
          }}
        >
          <path d={`M${nx - hx} ${ny - hy}L0 0`} stroke={fine ? 'var(--amber-hi)' : 'var(--cyan)'} strokeWidth={1.6} opacity={0.6} />
          <circle r={11.5} className="bpm-dial__knob" />
          <circle r={4} className="bpm-dial__dot" />
        </g>

        {/* hub */}
        <circle cx={r} cy={r} r={ringR - 34} className="bpm-dial__hub" />
      </svg>

      <div className="dial__center bpm-dial__center">
        <span className="dial__center-val bpm-dial__val t-num">{Math.round(value)}</span>
        <span className="dial__center-lab">{fine ? `fine · ±${FINE_SPAN}` : label}</span>
        <span className="bpm-dial__sub t-micro">
          {fine ? `${Math.round(anchor - FINE_SPAN)} – ${Math.round(anchor + FINE_SPAN)} bpm` : sub ?? `${min} – ${max} bpm`}
        </span>
      </div>
      <span className="bpm-dial__zoom" data-on={fine ? 'true' : 'false'} aria-hidden="true">
        {fine ? 'zoom' : 'coarse'}
      </span>
    </div>
  );
}
