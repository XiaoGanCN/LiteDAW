/* ============================================================================
   LiteDAW · DIAL PICKER
   Rotary selector in the idiom of the Android alarm-clock dial: drag the head
   around the ring and release to commit. Snaps to detents, glows on approach.
   Supports single-select and multi-select (chord building).
   ========================================================================= */

import { useCallback, useMemo, useRef, useState } from 'react';

export interface DialItem<T extends string | number> {
  value: T;
  label: string;
  /** Optional secondary caption drawn inside the tick. */
  sub?: string;
  /** Dim the detent (used for out-of-range notes). */
  muted?: boolean;
}

export interface DialPickerProps<T extends string | number> {
  items: DialItem<T>[];
  /** Single mode */
  value?: T;
  onChange?: (v: T) => void;
  /** Multi mode */
  values?: T[];
  onToggle?: (v: T) => void;
  mode?: 'single' | 'multi';
  size?: number;
  label?: string;
  /** Renders notes as a continuous ring with no gap at the top. */
  ring?: boolean;
  accent?: string;
  disabled?: boolean;
  /** Called whenever the head plays a note while scrubbing. */
  onPreview?: (v: T) => void;
}


export function DialPicker<T extends string | number>({
  items,
  value,
  onChange,
  values = [],
  onToggle,
  mode = 'single',
  size = 260,
  label,
  ring = true,
  accent = 'var(--red)',
  disabled = false,
  onPreview,
}: DialPickerProps<T>) {
  const ref = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hotIdx, setHotIdx] = useState<number | null>(null);
  const lastPreview = useRef<number | null>(null);
  const n = items.length;

  const r = size / 2;
  /**
   * The outer label ring carries a 12px note name with an 8px caption below it,
   * so the text needs ~15px of room past the label centre. Inset the whole ring
   * by that much and the viewBox can never clip its own bottom detents (or the
   * tick marks that sit outside the track).
   */
  const ringR = Math.max(20, r - 46);
  const tickOuter = ringR + 11;
  const tickInner = ringR - 8;
  const labelR = ringR + 22;
  /** Angular width of one detent; every segment is centred on its own index. */
  const step = n > 0 ? 360 / n : 360;

  /** index 0 sits at 12 o'clock, increasing clockwise. */
  const angleOf = useCallback((i: number) => (i / n) * 360 - 90, [n]);
  const pointAt = (deg: number, radius: number) => {
    const rad = (deg * Math.PI) / 180;
    return [r + radius * Math.cos(rad), r + radius * Math.sin(rad)] as const;
  };

  const idxFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const cx = clientX - (rect.left + rect.width / 2);
      const cy = clientY - (rect.top + rect.height / 2);
      let deg = (Math.atan2(cy, cx) * 180) / Math.PI + 90; // 0 at top, cw
      deg = ((deg % 360) + 360) % 360;
      return Math.round((deg / 360) * n) % n;
    },
    [n],
  );

  const commit = useCallback(
    (i: number) => {
      const it = items[i];
      if (!it || it.muted) return;
      if (mode === 'multi') onToggle?.(it.value);
      else onChange?.(it.value);
    },
    [items, mode, onChange, onToggle],
  );

  const scrub = (i: number) => {
    if (lastPreview.current === i) return;
    lastPreview.current = i;
    const it = items[i];
    if (it && !it.muted) onPreview?.(it.value);
  };

  const activeIdx = useMemo(() => {
    if (dragIdx !== null) return dragIdx;
    if (mode === 'multi') return -1;
    return Math.max(0, items.findIndex((x) => x.value === value));
  }, [dragIdx, items, mode, value]);

  const selectedSet = useMemo(() => new Set(values.map(String)), [values]);

  const handleAngle = activeIdx >= 0 ? angleOf(activeIdx) : -90;
  const [hx, hy] = pointAt(handleAngle, ringR);
  const [nx, ny] = pointAt(handleAngle, tickInner - 4);

  /* ── Arc segments: one per detent, drawn as a thin annulus slice. ─────── */
  const gap = ring ? 0.9 : 3.2;

  /**
   * `fromDeg`/`toDeg` use the same frame as `angleOf` (degrees with 0 at
   * 12 o'clock, increasing clockwise). Subtracting another quarter turn here
   * used to rotate every segment three detents away from its own tick and from
   * the head — the lit arc never matched the committed value.
   */
  const arcPath = (fromDeg: number, toDeg: number) => {
    const a0 = (fromDeg * Math.PI) / 180;
    const a1 = (toDeg * Math.PI) / 180;
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    const x0 = r + ringR * Math.cos(a0);
    const y0 = r + ringR * Math.sin(a0);
    const x1 = r + ringR * Math.cos(a1);
    const y1 = r + ringR * Math.sin(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${ringR} ${ringR} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  return (
    <div className="dial" style={{ position: 'relative', width: size, maxWidth: '100%', opacity: disabled ? 0.45 : 1 }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${size} ${size}`}
        className="dial__svg"
        style={{
          width: '100%',
          height: 'auto',
          maxWidth: size,
          /* The CSS drop-shadow / glow of the head must be able to paint past
             the viewBox instead of being shaved by the SVG viewport. */
          overflow: 'visible',
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'grab',
        }}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          const i = idxFromEvent(e.clientX, e.clientY);
          setDragIdx(i);
          scrub(i);
        }}
        onPointerMove={(e) => {
          if (disabled) return;
          const i = idxFromEvent(e.clientX, e.clientY);
          setHotIdx(i);
          if (dragIdx !== null) {
            setDragIdx(i);
            scrub(i);
          }
        }}
        onPointerUp={() => {
          if (dragIdx !== null) commit(dragIdx);
          setDragIdx(null);
          lastPreview.current = null;
        }}
        onPointerCancel={() => {
          setDragIdx(null);
          lastPreview.current = null;
        }}
        onPointerLeave={() => setHotIdx(null)}
        role="listbox"
        aria-label={label ?? 'dial picker'}
      >
        <defs>
          <radialGradient id="dial-face" cx="50%" cy="34%" r="76%">
            <stop offset="0%" stopColor="#1a2026" />
            <stop offset="62%" stopColor="#10151a" />
            <stop offset="100%" stopColor="#080b0e" />
          </radialGradient>
          <filter id="dial-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* face */}
        <circle cx={r} cy={r} r={r - 2} fill="url(#dial-face)" />
        <circle cx={r} cy={r} r={r - 2} fill="none" stroke="rgba(255,255,255,.07)" />
        <circle cx={r} cy={r} r={ringR + 15} fill="none" stroke="rgba(0,0,0,.7)" strokeWidth={1} />
        <circle cx={r} cy={r} r={ringR + 15} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth={1} transform={`translate(0,1)`} />

        {/* detent track */}
        <circle
          cx={r}
          cy={r}
          r={ringR}
          fill="none"
          stroke="rgba(0,0,0,.78)"
          strokeWidth={15}
        />
        <circle
          cx={r}
          cy={r}
          r={ringR}
          fill="none"
          stroke="rgba(190,210,225,.09)"
          strokeWidth={13}
        />

        {items.map((it, i) => {
          /* Segment i spans ± half a detent around the exact angle of item i,
             the same angle the tick, the label, the head and `value` use. */
          const a0 = angleOf(i) - step / 2 + gap / 2;
          const a1 = angleOf(i) + step / 2 - gap / 2;
          const isSel = mode === 'multi' ? selectedSet.has(String(it.value)) : i === activeIdx;
          const isHot = hotIdx === i || dragIdx === i;
          const tickA = angleOf(i);
          const [tx0, ty0] = pointAt(tickA, tickInner);
          const [tx1, ty1] = pointAt(tickA, tickOuter);
          const [lx, ly] = pointAt(tickA, labelR);
          return (
            <g key={String(it.value)} onPointerDown={() => !disabled && commit(i)} style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
              <path
                d={arcPath(a0, a1)}
                fill="none"
                stroke={isSel ? accent : isHot ? 'rgba(210,230,245,.28)' : 'rgba(255,255,255,.045)'}
                strokeWidth={isSel ? 15 : 11}
                strokeLinecap="butt"
                style={isSel ? { filter: `drop-shadow(0 0 7px ${accent})` } : undefined}
                opacity={it.muted ? 0.25 : 1}
              />
              <path
                d={`M${tx0} ${ty0}L${tx1} ${ty1}`}
                stroke={isSel ? '#fff' : 'rgba(190,210,225,.32)'}
                strokeWidth={isSel ? 2 : 1.2}
                opacity={it.muted ? 0.3 : 1}
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                className="dial__lab"
                data-sel={isSel || undefined}
                opacity={it.muted ? 0.35 : 1}
              >
                {it.label}
              </text>
              {it.sub && (
                <text
                  x={lx}
                  y={ly + 11}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="dial__sub"
                  opacity={it.muted ? 0.3 : 0.75}
                >
                  {it.sub}
                </text>
              )}
            </g>
          );
        })}

        {/* head */}
        {activeIdx >= 0 && (
          <g
            style={{
              transform: `translate(${hx}px, ${hy}px)`,
              transition: dragIdx === null ? 'transform 260ms var(--ease-snap)' : 'none',
            }}
            filter="url(#dial-glow)"
          >
            <circle r={11} fill="#0b0f13" stroke={accent} strokeWidth={2.4} />
            <circle r={4} fill={accent} />
            <path d={`M${nx - hx} ${ny - hy}L0 0`} stroke={accent} strokeWidth={1.6} opacity={0.6} />
          </g>
        )}

        {/* hub */}
        <circle cx={r} cy={r} r={ringR - 30} fill="rgba(0,0,0,.35)" stroke="rgba(255,255,255,.05)" />
      </svg>

      <div className="dial__center" style={{ inset: 0 }}>
        <span className="dial__center-val">
          {mode === 'multi'
            ? values.length
              ? items
                  .filter((i) => selectedSet.has(String(i.value)))
                  .map((i) => i.label)
                  .join(' ')
              : '—'
            : items[activeIdx]?.label ?? '—'}
        </span>
        {label && <span className="dial__center-lab">{label}</span>}
      </div>
    </div>
  );
}
