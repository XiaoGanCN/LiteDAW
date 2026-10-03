/* ============================================================================
   LiteDAW · UI KIT — panels, buttons, selectors, lamps, readouts
   ========================================================================= */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../../design/Icon';

/* ══════════════════════════════════════════════════════════════════════════
   SELECTION HYGIENE — shared by every double-click-to-reset control
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Drop a text selection the browser created around a control gesture (the two
 * mousedowns of a double-click reset select the nearest word before the reset
 * handler runs). Selections inside real text fields are left untouched.
 */
export function clearTextSelection(): void {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  for (let i = 0; i < sel.rangeCount; i += 1) {
    const node: Node = sel.getRangeAt(i).startContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (el?.closest('input, textarea, [contenteditable="true"]')) return;
  }
  sel.removeAllRanges();
}

/* ══════════════════════════════════════════════════════════════════════════
   PANEL
   ══════════════════════════════════════════════════════════════════════════ */

export interface PanelProps {
  title?: ReactNode;
  icon?: IconName;
  tag?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  variant?: 'default' | 'alu' | 'carbon';
  flush?: boolean;
  tight?: boolean;
  rivets?: boolean;
  style?: React.CSSProperties;
}

export function Panel({
  title,
  icon,
  tag,
  actions,
  children,
  className = '',
  bodyClassName = '',
  variant = 'default',
  flush = false,
  tight = false,
  rivets = false,
  style,
}: PanelProps) {
  return (
    <section
      className={`panel ${variant === 'carbon' ? 'tex-carbon' : ''} ${rivets ? 'rivets' : ''} ${className}`}
      style={style}
    >
      {(title || actions) && (
        <header className={`panel__head ${variant === 'alu' ? 'panel__head--alu' : ''}`}>
          {title && (
            <h2 className="panel__title">
              {icon && <Icon name={icon} size={13} />}
              {title}
            </h2>
          )}
          {tag && <span className="panel__tag">{tag}</span>}
          <span className="panel__spacer" />
          {actions}
        </header>
      )}
      <div
        className={`panel__body ${flush ? 'panel__body--flush' : ''} ${tight ? 'panel__body--tight' : ''} ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  );
}

export function Well({
  children,
  className = '',
  flush = false,
  style,
}: {
  children?: ReactNode;
  className?: string;
  flush?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`well tex-well ${flush ? 'well--flush' : ''} ${className}`} style={style}>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   BUTTONS
   ══════════════════════════════════════════════════════════════════════════ */

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  iconRight?: IconName;
  variant?: 'default' | 'primary' | 'go' | 'alu' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  active?: boolean;
  block?: boolean;
  solidIcon?: boolean;
}

export function Btn({
  icon,
  iconRight,
  variant = 'default',
  size = 'md',
  active = false,
  block = false,
  solidIcon = false,
  className = '',
  children,
  ...rest
}: BtnProps) {
  const cls = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    active ? 'btn--active' : '',
    block ? 'btn--block' : '',
    !children && icon ? 'btn--icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const isz = size === 'sm' ? 12 : size === 'lg' ? 18 : size === 'xl' ? 21 : 15;
  return (
    <button type="button" className={cls} data-active={active || undefined} {...rest}>
      <span className="btn__cap">
        {icon && <Icon name={icon} size={isz} solid={solidIcon} />}
        {children}
        {iconRight && <Icon name={iconRight} size={isz} />}
      </span>
    </button>
  );
}

/**
 * Tooltip anchored to its trigger and clamped to the viewport.
 *
 * A purely CSS tooltip cannot do this: inside the transport bar it was painted
 * under the top bar (different stacking context) and near a window edge it ran
 * off-screen. Measuring the trigger and positioning a fixed-layer bubble keeps
 * every tooltip legible wherever its trigger happens to sit.
 */
export function Tip({ children, label }: { children: ReactNode; label: ReactNode }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = () => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const half = Math.min(130, Math.max(60, String(label).length * 3.6));
    const left = Math.max(half + 8, Math.min(window.innerWidth - half - 8, r.left + r.width / 2));
    const above = r.top > 46;
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8 });
    host.dataset.above = above ? 'true' : 'false';
  };

  return (
    <span
      ref={hostRef}
      className="tip"
      onPointerEnter={place}
      onFocus={place}
      onPointerLeave={() => setPos(null)}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && (
        <span className="tip__body" role="tooltip" style={{ left: pos.left, top: pos.top }}>
          {label}
        </span>
      )}
    </span>
  );
}

export function IconBtn({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  active = false,
  ...rest
}: Omit<BtnProps, 'children'> & { label: string }) {
  return (
    <Tip label={label}>
      <Btn icon={icon} size={size} variant={variant} active={active} aria-label={label} {...rest} />
    </Tip>
  );
}

export function BtnGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`btn-group ${className}`}>{children}</div>;
}

/* ══════════════════════════════════════════════════════════════════════════
   SEGMENTED SELECTOR — indicator physically slides between options
   ══════════════════════════════════════════════════════════════════════════ */

export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  title?: string;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  accent = false,
  className = '',
  ariaLabel,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  accent?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const el = wrap.children[idx + 1] as HTMLElement | undefined;
      if (!el) return;
      setInd({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [idx, options.length]);

  return (
    <div
      ref={wrapRef}
      className={`seg ${accent ? 'seg--accent' : ''} ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      <span
        className="seg__ind"
        style={{
          transform: `translate3d(${ind?.x ?? 0}px,0,0)`,
          width: ind?.w ?? 0,
          opacity: ind ? 1 : 0,
        }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="seg__opt"
          data-on={o.value === value}
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ROCKER SWITCH
   ══════════════════════════════════════════════════════════════════════════ */

export function Rocker({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="rocker"
      data-on={on}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="rocker__knob" />
    </button>
  );
}

export interface ToggleRowProps {
  label: ReactNode;
  hint?: ReactNode;
  on: boolean;
  onChange: (v: boolean) => void;
  icon?: IconName;
  disabled?: boolean;
}

export function ToggleRow({ label, hint, on, onChange, icon, disabled }: ToggleRowProps) {
  return (
    <div className="row toggle-row" data-disabled={disabled || undefined}>
      <span className="toggle-row__text">
        <span className="toggle-row__label">
          {icon && <Icon name={icon} size={13} />}
          {label}
        </span>
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <Rocker on={on} onChange={onChange} label={String(label)} disabled={disabled} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LAMPS & LEGENDS
   ══════════════════════════════════════════════════════════════════════════ */

export type LampColor = 'red' | 'green' | 'amber' | 'cyan' | 'blue' | 'violet';

export function Led({
  on = true,
  color = 'red',
  size = 'md',
  pulse = false,
}: {
  on?: boolean;
  color?: LampColor;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
}) {
  const cls = [
    'led',
    on ? 'led--on' : 'led--off',
    color !== 'red' ? `led--${color}` : '',
    size === 'lg' ? 'led--lg' : size === 'sm' ? 'led--sm' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return <span className={cls} style={pulse && on ? { animation: 'pulse-glow 1.1s var(--ease-in-out) infinite' } : undefined} />;
}

export function Legend({
  children,
  on = true,
  color = 'red',
  size = 'md',
  title,
}: {
  children: ReactNode;
  on?: boolean;
  color?: LampColor;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}) {
  return (
    <span className="legend" title={title}>
      <Led on={on} color={color} size={size === 'md' ? 'md' : size} />
      <span className="t-label" style={{ color: on ? 'var(--alu-300)' : 'var(--ink-ghost)' }}>
        {children}
      </span>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   READOUT
   ══════════════════════════════════════════════════════════════════════════ */

export function Readout({
  value,
  unit,
  tone = 'cyan',
  size = 'md',
  ghost,
  className = '',
  title,
}: {
  value: ReactNode;
  unit?: ReactNode;
  tone?: 'cyan' | 'red' | 'amber' | 'green' | 'plain';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  ghost?: string;
  className?: string;
  title?: string;
}) {
  const cls = [
    'readout',
    tone !== 'cyan' ? `readout--${tone}` : '',
    size === 'lg' ? 'readout--lg' : size === 'xl' ? 'readout--xl' : '',
    ghost ? 'readout--ghosted' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} data-ghost={ghost} title={title}>
      <span>{value}</span>
      {unit && <span className="readout__u">{unit}</span>}
    </span>
  );
}

export function Chip({
  children,
  tone = 'default',
  icon,
}: {
  children: ReactNode;
  tone?: 'default' | 'red' | 'green' | 'cyan' | 'amber';
  icon?: IconName;
}) {
  return (
    <span className={`chip ${tone !== 'default' ? `chip--${tone}` : ''}`}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   NUMERIC DRAG FIELD — click-drag to scrub, double-click to type
   ══════════════════════════════════════════════════════════════════════════ */

export interface NumDragProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
  sensitivity?: number;
  accent?: string;
  width?: number;
}

export function NumDrag({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  format,
  sensitivity = 0.35,
  width,
}: NumDragProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const quant = (v: number) => Math.round(v / step) * step;
  const shown = format ? format(value) : Number.isInteger(value) ? String(value) : value.toFixed(2);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 2) d.moved = true;
    const range = max - min;
    const next = clamp(quant(d.v + dx * sensitivity * (range > 200 ? 2 : 1)));
    if (next !== value) onChange(next);
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) {
      setDraft(String(value));
      setEditing(true);
    }
    drag.current = null;
  };

  useEffect(() => {
    if (!editing) return;
    const el = ref.current?.querySelector('input');
    el?.focus();
    el?.select();
  }, [editing]);

  return (
    <div
      ref={ref}
      className="numdrag"
      style={width ? { width } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {editing ? (
        <input
          className="input numdrag__input"
          value={draft}
          inputMode="decimal"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number.parseFloat(draft);
            if (Number.isFinite(n)) onChange(clamp(quant(n)));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="numdrag__val">{shown}</span>
      )}
      {unit && <span className="numdrag__u">{unit}</span>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TABS
   ══════════════════════════════════════════════════════════════════════════ */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: { value: T; label: ReactNode; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          className="tab"
          data-on={t.value === value}
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
        >
          <span className="row" style={{ gap: 6 }}>
            {t.icon && <Icon name={t.icon} size={12} />}
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   STRUCTURE HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

export function Divider({ vertical = false }: { vertical?: boolean }) {
  return <div className={vertical ? 'divider divider--v' : 'divider'} />;
}

export function Field({
  label,
  icon,
  hint,
  children,
  className = '',
}: {
  label: ReactNode;
  icon?: IconName;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <span className="field__label">
        {icon && <Icon name={icon} size={12} />}
        {label}
      </span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function Empty({ icon = 'info', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      <span className="t-label">{children}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════════════════════ */

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`panel modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="panel__head panel__head--alu">
          <h2 className="panel__title" id={titleId}>
            {icon && <Icon name={icon} size={13} />}
            {title}
          </h2>
          <span className="panel__spacer" />
          <Btn icon="close" size="sm" variant="ghost" onClick={onClose} aria-label="Close" />
        </header>
        <div className="panel__body">{children}</div>
        {footer && (
          <footer className="modal__foot">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TOASTS — transient system messages
   ══════════════════════════════════════════════════════════════════════════ */

interface ToastMsg {
  id: number;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
}

const ToastCtx = createContext<(text: string, tone?: ToastMsg['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const seq = useRef(0);

  const push = (text: string, tone: ToastMsg['tone'] = 'info') => {
    const id = ++seq.current;
    setItems((p) => [...p.slice(-4), { id, text, tone }]);
    window.setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 4200);
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            <Icon
              name={t.tone === 'ok' ? 'check' : t.tone === 'error' ? 'alert' : t.tone === 'warn' ? 'alert' : 'info'}
              size={14}
            />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
