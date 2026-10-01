/* ============================================================================
   LiteDAW · WHEEL PICKER
   Inertial, snapping selection drum — the interaction used for the BPM answer.
   Renders in a recessed well with a machined selection gate across the middle.
   ========================================================================= */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface WheelItem<T extends string | number> {
  value: T;
  label: string;
  sub?: string;
}

export interface WheelPickerProps<T extends string | number> {
  items: WheelItem<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Height of one row, px. */
  itemHeight?: number;
  /** Number of visible rows (odd numbers read best). */
  visible?: number;
  width?: number | string;
  className?: string;
  /** Fires continuously while the drum moves — use for live preview. */
  onLive?: (v: T) => void;
  ariaLabel?: string;
}

export function WheelPicker<T extends string | number>({
  items,
  value,
  onChange,
  itemHeight = 34,
  visible = 5,
  width = 120,
  className = '',
  onLive,
  ariaLabel,
}: WheelPickerProps<T>) {
  const viewport = itemHeight * visible;
  const pad = (viewport - itemHeight) / 2;
  const scroller = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<(HTMLDivElement | null)[]>([]);
  const settle = useRef<number>(0);
  const [activeIdx, setActiveIdx] = useState(() => Math.max(0, items.findIndex((i) => i.value === value)));
  const programmatic = useRef(false);

  /* ── Paint the drum: rotate + fade each row according to its distance
        from the selection gate. No library, no 3-D context, just transforms. */
  const paint = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const offset = el.scrollTop / itemHeight;
    const radius = itemHeight * 2.6;
    rowsRef.current.forEach((row, i) => {
      if (!row) return;
      const d = i - offset;
      const clamped = Math.max(-3.2, Math.min(3.2, d));
      const rot = (clamped / (visible / 2 + 0.6)) * 52;
      const scale = 1 - Math.min(0.34, Math.abs(clamped) * 0.11);
      const fade = 1 - Math.min(0.82, Math.abs(clamped) * 0.33);
      row.style.transform = `perspective(${radius * 3}px) rotateX(${(-rot).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      row.style.opacity = String(Math.max(0, fade));
      row.dataset.near = Math.abs(clamped) < 0.5 ? 'true' : 'false';
    });
    const idx = Math.round(offset);
    setActiveIdx(idx);
    if (onLive && items[idx]) onLive(items[idx].value);
  }, [itemHeight, items, onLive, visible]);

  /* ── Commit on settle so taps never fire a value mid-flight. */
  const onScroll = () => {
    paint();
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = scroller.current;
      if (!el || programmatic.current) return;
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / itemHeight)));
      const target = idx * itemHeight;
      if (Math.abs(el.scrollTop - target) > 1) el.scrollTo({ top: target, behavior: 'smooth' });
      const it = items[idx];
      if (it && it.value !== value) onChange(it.value);
    }, 110);
  };

  /* ── Keep the drum in sync when the value changes from elsewhere. */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const idx = Math.max(0, items.findIndex((i) => i.value === value));
    const target = idx * itemHeight;
    if (Math.abs(el.scrollTop - target) > 0.5) {
      programmatic.current = true;
      el.scrollTo({ top: target, behavior: 'smooth' });
      window.setTimeout(() => {
        programmatic.current = false;
      }, 260);
    }
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items.length, itemHeight]);

  useEffect(() => {
    paint();
    const ro = new ResizeObserver(paint);
    if (scroller.current) ro.observe(scroller.current);
    return () => {
      ro.disconnect();
      window.clearTimeout(settle.current);
    };
  }, [paint]);

  /* ── Mouse / pen drag-to-spin (touch uses native momentum scrolling). */
  const drag = useRef<{ y: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`wheel ${className}`}
      style={{ height: viewport, width }}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`wheel-opt-${activeIdx}`}
    >
      <div className="wheel__glass" />
      <div
        ref={scroller}
        className="wheel__scroll"
        data-dragging={dragging || undefined}
        onScroll={onScroll}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch') return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, top: e.currentTarget.scrollTop };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          e.currentTarget.scrollTop = d.top - (e.clientY - d.y);
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
          onScroll();
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          const idx = Math.max(0, items.findIndex((i) => i.value === value));
          if (e.key === 'ArrowUp' && idx > 0) onChange(items[idx - 1].value);
          if (e.key === 'ArrowDown' && idx < items.length - 1) onChange(items[idx + 1].value);
        }}
      >
        <div style={{ height: pad }} />
        {items.map((it, i) => (
          <div
            key={String(it.value)}
            id={`wheel-opt-${i}`}
            ref={(n) => {
              rowsRef.current[i] = n;
            }}
            className="wheel__row"
            style={{ height: itemHeight }}
            role="option"
            aria-selected={it.value === value}
            onClick={() => onChange(it.value)}
          >
            <span className="wheel__label">{it.label}</span>
            {it.sub && <span className="wheel__sub">{it.sub}</span>}
          </div>
        ))}
        <div style={{ height: pad }} />
      </div>
      <div className="wheel__gate" aria-hidden="true">
        <i className="wheel__gate-l" />
        <i className="wheel__gate-r" />
      </div>
      <div className="wheel__fade wheel__fade--t" aria-hidden="true" />
      <div className="wheel__fade wheel__fade--b" aria-hidden="true" />
    </div>
  );
}
