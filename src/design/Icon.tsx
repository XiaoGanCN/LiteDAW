/* ============================================================================
   LiteDAW · VECTOR ICON SET
   Single-stroke technical glyphs on a 24×24 grid, 1.6 stroke, butt caps —
   drawn to read like panel silk-screen legends rather than app-store icons.
   ========================================================================= */

import type { SVGProps, ReactNode } from 'react';

export type IconName = keyof typeof GLYPHS;

const P = (d: string, extra?: Record<string, unknown>) => <path d={d} {...extra} />;

const GLYPHS = {
  /* ── Brand & modules ─────────────────────────────────────────────────── */
  logo: (
    <>
      <path d="M3 17.5 12 3l9 14.5" fill="none" />
      <path d="M7.4 17.5 12 10.2l4.6 7.3" fill="none" />
      <path d="M4.6 20.6h14.8" fill="none" />
    </>
  ),
  pitch: (
    <>
      <path d="M4 12h2.2l1.8-5.4L10.6 18l2-9.4L14.4 13H20" fill="none" />
      <circle cx="12" cy="12" r="9.2" fill="none" opacity=".35" />
    </>
  ),
  bpm: (
    <>
      <path d="M9 3h6l4.6 17.4H4.4L9 3Z" fill="none" />
      <path d="M16.6 8.4 7.4 16.6" fill="none" />
      <circle cx="12" cy="12.5" r="1.3" />
    </>
  ),
  daw: (
    <>
      <path d="M3 6h18M3 12h18M3 18h18" fill="none" opacity=".4" />
      <rect x="3.6" y="4" width="7" height="4" rx="1" fill="none" />
      <rect x="9" y="10" width="9" height="4" rx="1" fill="none" />
      <rect x="6" y="16" width="6" height="4" rx="1" fill="none" />
    </>
  ),

  /* ── Transport ───────────────────────────────────────────────────────── */
  play: P('M7 4.8 19.4 12 7 19.2V4.8Z', { strokeLinejoin: 'round' }),
  pause: (
    <>
      <path d="M8 4.6h3.2v14.8H8zM12.8 4.6H16v14.8h-3.2z" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.4" />,
  record: <circle cx="12" cy="12" r="6" />,
  rewind: (
    <>
      <path d="M12 5.5 4.5 12 12 18.5V5.5Z" fill="none" />
      <path d="M20 5.5 12.5 12 20 18.5V5.5Z" fill="none" />
    </>
  ),
  forward: (
    <>
      <path d="M12 5.5 19.5 12 12 18.5V5.5Z" fill="none" />
      <path d="M4 5.5 11.5 12 4 18.5V5.5Z" fill="none" />
    </>
  ),
  toStart: (
    <>
      <path d="M6 5v14" fill="none" />
      <path d="M19 5.5 8.5 12 19 18.5V5.5Z" fill="none" />
    </>
  ),
  toEnd: (
    <>
      <path d="M18 5v14" fill="none" />
      <path d="M5 5.5 15.5 12 5 18.5V5.5Z" fill="none" />
    </>
  ),
  loop: (
    <>
      <path d="M4.5 10.5A5 5 0 0 1 9.5 5.5h9" fill="none" />
      <path d="M16 2.8 19.2 5.5 16 8.2" fill="none" />
      <path d="M19.5 13.5a5 5 0 0 1-5 5h-9" fill="none" />
      <path d="M8 15.8 4.8 18.5 8 21.2" fill="none" />
    </>
  ),

  /* ── Editing ─────────────────────────────────────────────────────────── */
  plus: P('M12 5v14M5 12h14', { fill: 'none' }),
  minus: P('M5 12h14', { fill: 'none' }),
  trash: (
    <>
      <path d="M4.5 7h15" fill="none" />
      <path d="M9.5 7V4.6h5V7" fill="none" />
      <path d="M6.4 7l1 12.4h9.2l1-12.4" fill="none" />
      <path d="M10.4 10.6v5.8M13.6 10.6v5.8" fill="none" opacity=".55" />
    </>
  ),
  copy: (
    <>
      <rect x="8.6" y="8.6" width="10.8" height="10.8" rx="1.6" fill="none" />
      <path d="M15.4 8.6V6.2a1.6 1.6 0 0 0-1.6-1.6H6.2A1.6 1.6 0 0 0 4.6 6.2v7.6a1.6 1.6 0 0 0 1.6 1.6h2.4" fill="none" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.4" cy="6.4" r="2.4" fill="none" />
      <circle cx="6.4" cy="17.6" r="2.4" fill="none" />
      <path d="M8.5 7.8 20 17.4M8.5 16.2 20 6.6" fill="none" />
    </>
  ),
  magnet: (
    <>
      <path d="M5.5 4.5v8a6.5 6.5 0 0 0 13 0v-8" fill="none" />
      <path d="M5.5 9.5h4.6M13.9 9.5h4.6" fill="none" />
    </>
  ),
  pointer: P('M6 3.4 18.4 12 12.6 13.2 15 19.6l-2.4 1-2.4-6.4L6 17.4V3.4Z', { strokeLinejoin: 'round' }),
  hand: (
    <>
      <path d="M8 12V5.8a1.5 1.5 0 0 1 3 0V11" fill="none" />
      <path d="M11 10.6V4.6a1.5 1.5 0 0 1 3 0v6" fill="none" />
      <path d="M14 10.8V6.4a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5v-3.4a1.5 1.5 0 0 1 3 0" fill="none" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9.5h11.5a4.5 4.5 0 0 1 0 9H9" fill="none" />
      <path d="M7.4 5.6 3.5 9.5l3.9 3.9" fill="none" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9.5H8.5a4.5 4.5 0 0 0 0 9H15" fill="none" />
      <path d="M16.6 5.6l3.9 3.9-3.9 3.9" fill="none" />
    </>
  ),

  /* ── View / zoom ─────────────────────────────────────────────────────── */
  zoomIn: (
    <>
      <circle cx="10.6" cy="10.6" r="6.2" fill="none" />
      <path d="M15.2 15.2 20.4 20.4M10.6 7.8v5.6M7.8 10.6h5.6" fill="none" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.6" cy="10.6" r="6.2" fill="none" />
      <path d="M15.2 15.2 20.4 20.4M7.8 10.6h5.6" fill="none" />
    </>
  ),
  grid: (
    <>
      <path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17" fill="none" opacity=".65" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.6" fill="none" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.4 21 8l-9 4.6L3 8l9-4.6Z" fill="none" />
      <path d="M4.4 12.4 12 16.2l7.6-3.8" fill="none" opacity=".7" />
      <path d="M4.6 16.2 12 20l7.4-3.8" fill="none" opacity=".4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z" fill="none" />
      <circle cx="12" cy="12" r="2.8" fill="none" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 12s3.8-6.2 9-6.2c1.5 0 2.8.4 4 1" fill="none" />
      <path d="M20.4 9.4c.7 1 1 1.9 1 1.9s-3.8 6.2-9 6.2c-1.3 0-2.5-.3-3.5-.8" fill="none" />
      <path d="M4 4l16 16" fill="none" />
    </>
  ),

  /* ── Audio ───────────────────────────────────────────────────────────── */
  waveform: (
    <>
      <path d="M3 12h1.6M7.2 12h.8" fill="none" />
      <path d="M5.6 6.6v10.8M9.6 3.8v16.4M13.6 7.6v8.8M17.6 5.2v13.6M20.6 9.8v4.4" fill="none" />
    </>
  ),
  spectrum: (
    <>
      <path d="M4 19V9.6M8 19V4.4M12 19v-9.2M16 19V6.2M20 19v-6" fill="none" strokeWidth="2.1" />
    </>
  ),
  vectorscope: (
    <>
      <circle cx="12" cy="12" r="8.6" fill="none" />
      <circle cx="12" cy="12" r="4.4" fill="none" opacity=".45" />
      <path d="M12 3.4v17.2M3.4 12h17.2" fill="none" opacity=".3" />
    </>
  ),
  speaker: (
    <>
      <path d="M4.4 9.4h3.2L12 5.6v12.8L7.6 14.6H4.4V9.4Z" fill="none" />
      <path d="M15.4 9a4.4 4.4 0 0 1 0 6M18 6.4a8 8 0 0 1 0 11.2" fill="none" opacity=".7" />
    </>
  ),
  speakerOff: (
    <>
      <path d="M4.4 9.4h3.2L12 5.6v12.8L7.6 14.6H4.4V9.4Z" fill="none" />
      <path d="M16 9.6l4.8 4.8M20.8 9.6 16 14.4" fill="none" />
    </>
  ),
  headphones: (
    <>
      <path d="M4.6 15v-3a7.4 7.4 0 0 1 14.8 0v3" fill="none" />
      <rect x="2.8" y="13.6" width="4.4" height="6.4" rx="1.6" fill="none" />
      <rect x="16.8" y="13.6" width="4.4" height="6.4" rx="1.6" fill="none" />
    </>
  ),
  mic: (
    <>
      <rect x="9.2" y="3" width="5.6" height="10.4" rx="2.8" fill="none" />
      <path d="M5.6 11.6a6.4 6.4 0 0 0 12.8 0M12 18v3.2M8.8 21.2h6.4" fill="none" />
    </>
  ),
  piano: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.6" fill="none" />
      <path d="M8 5v9M12 5v9M16 5v9M3 14h18" fill="none" />
    </>
  ),
  dial: (
    <>
      <circle cx="12" cy="12" r="8.6" fill="none" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3.4v3.4M18.4 15.6l-2.9-1.7M5.6 15.6l2.9-1.7" fill="none" opacity=".55" />
    </>
  ),
  metronomeArm: (
    <>
      <path d="M12 21V4.6" fill="none" />
      <path d="M9.4 6.6 12 3l2.6 3.6" fill="none" />
      <path d="M7 21h10" fill="none" />
    </>
  ),
  tuner: (
    <>
      <path d="M3.4 15.6a9 9 0 0 1 17.2 0" fill="none" />
      <path d="M12 15.6 16.4 9" fill="none" />
      <circle cx="12" cy="15.6" r="1.6" />
    </>
  ),

  /* ── Files ───────────────────────────────────────────────────────────── */
  upload: (
    <>
      <path d="M12 15.6V4.2" fill="none" />
      <path d="M7.6 8.6 12 4.2l4.4 4.4" fill="none" />
      <path d="M4.4 15v3.4a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6V15" fill="none" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.6v11.4" fill="none" />
      <path d="M7.6 10.6 12 15l4.4-4.4" fill="none" />
      <path d="M4.4 15v3.4a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6V15" fill="none" />
    </>
  ),
  fileAudio: (
    <>
      <path d="M13.4 3.4H7a1.6 1.6 0 0 0-1.6 1.6v14a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6V8.6l-5.2-5.2Z" fill="none" />
      <path d="M13.2 3.6v5.2h5.2" fill="none" />
      <path d="M10.4 16.6v-3.4l4-1v3.4" fill="none" />
      <circle cx="9.4" cy="16.8" r="1.2" />
      <circle cx="13.4" cy="15.8" r="1.2" />
    </>
  ),
  folder: (
    <>
      <path d="M3.4 6.6a1.6 1.6 0 0 1 1.6-1.6h4l2 2.4h8a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6V6.6Z" fill="none" />
    </>
  ),
  save: (
    <>
      <path d="M5 3.6h11.2L20.4 7.8V19a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 19V5.2A1.6 1.6 0 0 1 5 3.6Z" fill="none" />
      <path d="M7.6 3.6v6h8v-6M7.6 20.4v-6.2h8.8v6.2" fill="none" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.4" fill="none" />
      <circle cx="18" cy="6" r="2.4" fill="none" />
      <circle cx="18" cy="18" r="2.4" fill="none" />
      <path d="M8.2 10.8 15.8 7.2M8.2 13.2l7.6 3.6" fill="none" />
    </>
  ),

  /* ── System ──────────────────────────────────────────────────────────── */
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" fill="none" />
      <path
        d="M12 2.6l1.3 2.6 2.9-.5.6 2.9 2.5 1.5-1.5 2.5 1.5 2.5-2.5 1.5-.6 2.9-2.9-.5L12 21.4l-1.3-2.6-2.9.5-.6-2.9-2.5-1.5L6.2 12 4.7 9.5l2.5-1.5.6-2.9 2.9.5L12 2.6Z"
        fill="none"
      />
    </>
  ),
  cpu: (
    <>
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" fill="none" />
      <rect x="10" y="10" width="4" height="4" rx="0.8" fill="none" opacity=".6" />
      <path d="M9.4 3v3.4M14.6 3v3.4M9.4 17.6V21M14.6 17.6V21M3 9.4h3.4M3 14.6h3.4M17.6 9.4H21M17.6 14.6H21" fill="none" />
    </>
  ),
  activity: P('M2.6 12h4l2.4-6.4L13 18.4 15.4 12h6', { fill: 'none' }),
  power: (
    <>
      <path d="M12 3.4v7.2" fill="none" />
      <path d="M17.4 6.2a7.6 7.6 0 1 1-10.8 0" fill="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.4A8 8 0 1 0 18 17" fill="none" />
      <path d="M20.4 5.6V11h-5.4" fill="none" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.4" width="14" height="10" rx="1.8" fill="none" />
      <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" fill="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.8" fill="none" />
      <path d="M12 10.6v6" fill="none" />
      <circle cx="12" cy="7.6" r="1.1" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.6 21.4 20H2.6L12 3.6Z" fill="none" />
      <path d="M12 9.6v4.6" fill="none" />
      <circle cx="12" cy="17" r="1.1" />
    </>
  ),
  check: P('M4.6 12.6 9.6 17.6 19.6 6.6', { fill: 'none', strokeLinejoin: 'round' }),
  close: P('M6 6l12 12M18 6 6 18', { fill: 'none' }),
  chevronDown: P('M5.6 9.2 12 15.6l6.4-6.4', { fill: 'none' }),
  chevronUp: P('M5.6 14.8 12 8.4l6.4 6.4', { fill: 'none' }),
  chevronLeft: P('M14.8 5.6 8.4 12l6.4 6.4', { fill: 'none' }),
  chevronRight: P('M9.2 5.6 15.6 12l-6.4 6.4', { fill: 'none' }),
  menu: P('M4 7h16M4 12h16M4 17h16', { fill: 'none' }),
  target: (
    <>
      <circle cx="12" cy="12" r="8.6" fill="none" />
      <circle cx="12" cy="12" r="3.4" fill="none" />
      <path d="M12 1.6v3.6M12 18.8v3.6M1.6 12h3.6M18.8 12h3.6" fill="none" />
    </>
  ),
  trend: (
    <>
      <path d="M3.4 17.6 9 11l4 4 7.6-8.4" fill="none" />
      <path d="M15.4 6.2h5.2v5.2" fill="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" fill="none" />
      <path d="M12 6.8V12l3.6 2.4" fill="none" />
    </>
  ),
  hourglass: (
    <>
      <path d="M7 3.4h10M7 20.6h10" fill="none" />
      <path d="M8 3.4v3.8L12 12l4-4.8V3.4M8 20.6v-3.8L12 12l4 4.8v3.8" fill="none" />
    </>
  ),
  layersStack: (
    <>
      <rect x="3.6" y="3.6" width="10" height="10" rx="1.4" fill="none" />
      <rect x="10.4" y="10.4" width="10" height="10" rx="1.4" fill="none" />
    </>
  ),
  note: (
    <>
      <path d="M9 18V5.4l9-1.8v12.6" fill="none" />
      <circle cx="6.6" cy="18.2" r="2.6" fill="none" />
      <circle cx="15.6" cy="16.4" r="2.6" fill="none" />
    </>
  ),
  sharp: P('M9.6 3.6 7.6 20.4M16.4 3.6l-2 16.8M4.6 9h15M3.6 15h15', { fill: 'none' }),
  flat: (
    <>
      <path d="M9 4.6v13.8" fill="none" />
      <path d="M9 13.4c3.2-2.4 5.6-1 5.6 1.6 0 2.2-2.4 3.4-5.6 2.6" fill="none" />
    </>
  ),
  eq: (
    <>
      <path d="M6 3.6v6.8M6 14.6v5.8M12 3.6v3.4M12 11.2v9.2M18 3.6v9.6M18 17.4v3" fill="none" />
      <circle cx="6" cy="12.4" r="1.9" fill="none" />
      <circle cx="12" cy="8.8" r="1.9" fill="none" />
      <circle cx="18" cy="15.2" r="1.9" fill="none" />
    </>
  ),
  pan: (
    <>
      <path d="M3.6 12h16.8" fill="none" />
      <path d="M7 8.6v6.8M17 8.6v6.8" fill="none" opacity=".5" />
      <circle cx="12" cy="12" r="2.6" fill="none" />
    </>
  ),
  speed: (
    <>
      <path d="M4.4 18a9 9 0 1 1 15.2 0" fill="none" />
      <path d="M12 18l5-6" fill="none" />
    </>
  ),
  pitchShift: (
    <>
      <path d="M4 16.4V9.6M8 19V6M12 16.4V9.6M16 19V6M20 16.4V9.6" fill="none" />
    </>
  ),
  download2: (
    <>
      <path d="M12 3.6v11.4" fill="none" />
      <path d="M7.6 10.6 12 15l4.4-4.4" fill="none" />
      <path d="M4.4 15v3.4a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6V15" fill="none" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.4 13.8 9l5.6 1.8-5.6 1.8L12 18.2l-1.8-5.6L4.6 10.8 10.2 9 12 3.4Z" fill="none" />
    </>
  ),
  wrench: (
    <>
      <path d="M15.4 3.6a5.2 5.2 0 0 0-4.6 7.6L3.6 18.4l2 2 7.2-7.2a5.2 5.2 0 0 0 7.6-4.6l-2.6 2.6-2.6-.6-.6-2.6 2.8-2.4Z" fill="none" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Renders the glyph filled instead of stroked (used for transport shapes). */
  solid?: boolean;
}

export function Icon({ name, size = 18, solid = false, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** Icons whose shapes are drawn as outlines and must never receive a fill. */
export const OUTLINE_ONLY: IconName[] = ['logo', 'speaker', 'headphones', 'piano', 'dial'];
