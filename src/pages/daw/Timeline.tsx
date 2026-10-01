/* ============================================================================
   LiteDAW · TIMELINE
   A single hardware-accelerated canvas draws the ruler, overview strip, lanes,
   clip bodies, waveforms, fades, grid, loop region and playhead. Static content
   is cached to an offscreen plate and only re-rasterised when the project or
   the view actually changes, so the playhead animates at display refresh rate
   even with heavy projects and extreme zoom levels.
   ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../design/Icon';
import { engine } from '../../audio/engine';
import { transport } from '../../audio/dawEngine';
import { buffers } from '../../daw/buffers';
import { paintClipWave } from '../../audio/scopes';
import { currentFxLevel } from '../../state/settings';
import { useDaw, ZOOM_MAX, ZOOM_MIN, type Clip, type Track } from '../../state/daw';
import { formatBarsBeats } from '../../audio/engine';

const RULER_H = 50;
const OVERVIEW_H = 18;
const SCALE_H = RULER_H - OVERVIEW_H;
const EDGE_GRAB = 7;
const FADE_GRAB = 13;

export interface LaneLayout {
  track: Track;
  y: number;
  h: number;
  index: number;
}

type DragKind = 'move' | 'trimL' | 'trimR' | 'fadeIn' | 'fadeOut' | 'marquee' | 'scrub' | 'pan' | null;

interface DragState {
  kind: DragKind;
  startX: number;
  startY: number;
  startTime: number;
  origin: Clip[];
  /** Track index the pointer started on. */
  fromTrack: number;
  toTrack: number;
  scrollStart: number;
  moved: boolean;
  additive: boolean;
}

interface Props {
  /** Called when a new buffer is dropped in, with the decoded data. */
  onFilesDropped: (files: File[], trackId: string, atSeconds: number) => void;
  onSeek: (t: number) => void;
  onScrub: (t: number) => void;
}

const fmtTime = (t: number, pxPerSec: number) => {
  if (pxPerSec > 6000) return `${(t * 1000).toFixed(2)}ms`;
  if (pxPerSec > 260) return `${t.toFixed(3)}s`;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export function Timeline({ onFilesDropped, onSeek, onScrub }: Props) {
  const state = useDaw();
  const { tracks, clips, view, selection } = state;
  const lanesRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const laneCanvasRef = useRef<HTMLCanvasElement>(null);
  const plateRef = useRef<HTMLCanvasElement | null>(null);
  /* Reference-based dirty tracking — cheaper than hashing the project every
     frame, which matters at 60 fps on large sessions. */
  const plateKey = useRef<{
    clips: unknown;
    tracks: unknown;
    selection: unknown;
    viewKey: string;
  }>({ clips: null, tracks: null, selection: null, viewKey: '' });
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef(0);
  const [w, setW] = useState(900);
  const [hover, setHover] = useState<{ clipId: string | null; edge: DragKind; trackIndex: number }>({
    clipId: null,
    edge: null,
    trackIndex: -1,
  });
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; clipId: string | null; time: number; trackId: string } | null>(null);
  const scrubLast = useRef(0);

  /* ── Layout ───────────────────────────────────────────────────────────── */
  const layout: LaneLayout[] = useMemo(() => {
    let y = 0;
    return tracks.map((t, i) => {
      const h = t.height;
      const row = { track: t, y, h, index: i };
      y += h + 1;
      return row;
    });
  }, [tracks]);

  const contentH = layout.length ? layout[layout.length - 1].y + layout[layout.length - 1].h + 1 : 120;

  useEffect(() => {
    const el = lanesRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = view.pxPerSec;
  const timeToX = useCallback((t: number) => (t - view.scroll) * pxPerSec, [pxPerSec, view.scroll]);
  const xToTime = useCallback((x: number) => view.scroll + x / pxPerSec, [pxPerSec, view.scroll]);

  const trackAtY = useCallback(
    (y: number) => layout.find((l) => y >= l.y && y < l.y + l.h) ?? null,
    [layout],
  );

  const clipsByTrack = useMemo(() => {
    const m = new Map<string, Clip[]>();
    tracks.forEach((t) => m.set(t.id, []));
    clips.forEach((c) => {
      const arr = m.get(c.trackId);
      if (arr) arr.push(c);
      else m.set(c.trackId, [c]);
    });
    return m;
  }, [clips, tracks]);

  /* ══════════════════════════════════════════════════════════════════════
     PAINTING
     ══════════════════════════════════════════════════════════════════════ */

  const paintPlate = useCallback(
    (ctx: CanvasRenderingContext2D, wCss: number, hCss: number) => {
      const fx = currentFxLevel();
      const beat = 60 / Math.max(20, state.bpm);
      const gridSec = beat * (4 / state.view.gridDivision);

      /* lane beds */
      layout.forEach((l, i) => {
        ctx.fillStyle =
          l.track.id === view.selectedTrackId
            ? 'rgba(199,15,40,0.055)'
            : i % 2
              ? 'rgba(255,255,255,0.012)'
              : 'rgba(0,0,0,0.16)';
        ctx.fillRect(0, l.y, wCss, l.h);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, l.y + l.h, wCss, 1);
      });

      /* grid: choose a division that stays legible at the current zoom */
      const beatPx = beat * pxPerSec;
      let div = gridSec;
      if (beatPx > 260) div = gridSec / 4;
      if (beatPx < 12) div = beat * 4;
      if (beatPx < 3) div = beat * 16;
      if (beatPx < 0.7) div = beat * 64;
      const divPx = div * pxPerSec;
      const t0 = Math.floor(view.scroll / div) * div;
      const t1 = view.scroll + wCss / pxPerSec;

      if (divPx > 5) {
        for (let t = t0; t <= t1; t += div) {
          const x = Math.round(timeToX(t)) + 0.5;
          const isBar = Math.abs(t / (beat * state.numerator) - Math.round(t / (beat * state.numerator))) < 1e-6;
          const isBeat = Math.abs(t / beat - Math.round(t / beat)) < 1e-6;
          ctx.strokeStyle = isBar
            ? 'rgba(190,215,235,0.20)'
            : isBeat
              ? 'rgba(190,215,235,0.11)'
              : 'rgba(190,215,235,0.05)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, hCss);
          ctx.stroke();
        }
      }

      /* bar numbers on the beds */
      const barSec = beat * state.numerator;
      const barPx = barSec * pxPerSec;
      if (barPx > 34) {
        ctx.fillStyle = 'rgba(160,185,205,0.16)';
        ctx.font = '600 10px "Barlow Condensed", sans-serif';
        const b0 = Math.floor(view.scroll / barSec);
        const b1 = Math.ceil((view.scroll + wCss / pxPerSec) / barSec);
        for (let b = b0; b <= b1; b++) {
          const x = timeToX(b * barSec);
          if (x < -30 || x > wCss + 30) continue;
          ctx.fillText(String(b + 1), x + 4, hCss - 5);
        }
      }

      /* loop region band */
      if (state.loopOn) {
        const x0 = timeToX(state.loopStart);
        const x1 = timeToX(state.loopEnd);
        ctx.fillStyle = 'rgba(31,208,230,0.055)';
        ctx.fillRect(x0, 0, Math.max(2, x1 - x0), hCss);
        ctx.fillStyle = 'rgba(31,208,230,0.5)';
        ctx.fillRect(x0, 0, 1, hCss);
        ctx.fillRect(x1 - 1, 0, 1, hCss);
      }

      /* clips */
      layout.forEach((l) => {
        const list = clipsByTrack.get(l.track.id) ?? [];
        list.forEach((clip) => {
          const x = timeToX(clip.start);
          const cw = Math.max(2, clip.duration * pxPerSec);
          if (x + cw < -40 || x > wCss + 40) return;
          const y = l.y + 2;
          const ch = l.h - 5;
          const sel = selection.includes(clip.id);
          const color = clip.color ?? l.track.color;
          const rec = buffers.get(clip.bufferId);
          const dim = clip.muted || l.track.mute || (tracks.some((t) => t.solo) && !l.track.solo);

          ctx.save();
          ctx.beginPath();
          roundRect(ctx, x, y, cw, ch, Math.min(5, cw / 2, ch / 2));
          ctx.clip();

          const g = ctx.createLinearGradient(0, y, 0, y + ch);
          g.addColorStop(0, hexA(color, dim ? 0.1 : 0.28));
          g.addColorStop(0.36, hexA(color, dim ? 0.06 : 0.14));
          g.addColorStop(1, 'rgba(6,9,12,0.92)');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, cw, ch);

          /* header */
          ctx.fillStyle = hexA(color, dim ? 0.18 : 0.72);
          ctx.fillRect(x, y, cw, 13);
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.fillRect(x, y + 12, cw, 1);

          /* waveform */
          if (rec && ch > 16) {
            const offsetRatio = Math.max(0, clip.offset / rec.duration);
            const spanRatio = Math.min(1 - offsetRatio, (clip.duration * clip.speed) / rec.duration);
            const waveTop = y + 14;
            const waveH = ch - 17;
            if (pxPerSec > 900 && cw > 60) {
              /* sample-accurate view at extreme zoom */
              paintSamples(ctx, rec.buffer, clip, x, waveTop, cw, waveH, pxPerSec, dim ? 0.35 : 0.9, color);
            } else {
              paintClipWave(
                ctx,
                rec.peak,
                x,
                waveTop,
                cw,
                waveH,
                hexA(color, dim ? 0.35 : 0.95),
                hexA(color, dim ? 0.08 : 0.2),
                offsetRatio,
                Math.max(0.0005, spanRatio),
              );
            }
          }

          /* fade ramps */
          if (clip.fadeIn > 0) {
            const fw = Math.min(cw, clip.fadeIn * pxPerSec);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath();
            ctx.moveTo(x, y + 13);
            ctx.lineTo(x + fw, y + 13);
            ctx.lineTo(x, y + ch);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.beginPath();
            ctx.moveTo(x, y + ch);
            ctx.lineTo(x + fw, y + 13);
            ctx.stroke();
          }
          if (clip.fadeOut > 0) {
            const fw = Math.min(cw, clip.fadeOut * pxPerSec);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath();
            ctx.moveTo(x + cw, y + 13);
            ctx.lineTo(x + cw - fw, y + 13);
            ctx.lineTo(x + cw, y + ch);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.beginPath();
            ctx.moveTo(x + cw, y + ch);
            ctx.lineTo(x + cw - fw, y + 13);
            ctx.stroke();
          }

          /* name + badges */
          if (cw > 26) {
            ctx.font = '600 10px "Barlow Condensed", sans-serif';
            ctx.fillStyle = dim ? 'rgba(230,240,248,0.4)' : 'rgba(255,255,255,0.94)';
            const label = clip.name.toUpperCase();
            ctx.fillText(fit(ctx, label, cw - 10), x + 4, y + 9.6);
          }
          if (cw > 96 && (clip.pitch !== 0 || clip.speed !== 1)) {
            ctx.font = '9px "Share Tech Mono", monospace';
            ctx.fillStyle = 'rgba(127,227,255,0.85)';
            ctx.fillText(
              `${clip.pitch > 0 ? '+' : ''}${clip.pitch}st ×${clip.speed.toFixed(2)}`,
              x + 4,
              y + ch - 4,
            );
          }

          if (dim) {
            ctx.fillStyle = 'rgba(4,7,10,0.5)';
            ctx.fillRect(x, y, cw, ch);
          }

          /* selection / hover chrome */
          if (sel) {
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 1.4;
            roundRect(ctx, x + 0.7, y + 0.7, cw - 1.4, ch - 1.4, Math.min(5, cw / 2, ch / 2));
            ctx.stroke();
          }
          if (hover.clipId === clip.id) {
            ctx.strokeStyle = 'rgba(199,15,40,0.85)';
            ctx.lineWidth = 1.2;
            roundRect(ctx, x + 0.6, y + 0.6, cw - 1.2, ch - 1.2, Math.min(5, cw / 2, ch / 2));
            ctx.stroke();
          }
          ctx.restore();

          /* outer rim */
          ctx.strokeStyle = sel ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.75)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          roundRect(ctx, x + 0.5, y + 0.5, cw - 1, ch - 1, Math.min(5, cw / 2, ch / 2));
          ctx.stroke();
        });
      });

      /* scanline film over the whole plate */
      if (fx > 0.02) {
        ctx.save();
        ctx.globalAlpha = 0.035 * fx;
        ctx.fillStyle = '#fff';
        for (let y = 0; y < hCss; y += 3) ctx.fillRect(0, y, wCss, 1);
        ctx.restore();
      }
    },
    [clipsByTrack, hover.clipId, layout, pxPerSec, selection, state.bpm, state.loopEnd, state.loopOn, state.loopStart, state.numerator, state.view.gridDivision, timeToX, tracks, view.scroll, view.selectedTrackId],
  );

  const paintRuler = useCallback(() => {
    const cv = rulerRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.floor(w * dpr));
    cv.height = Math.floor(RULER_H * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, RULER_H);

    /* overview strip */
    const total = Math.max(8, state.projectDuration() * 1.08, 8);
    const ox = (t: number) => (t / total) * w;
    const og = ctx.createLinearGradient(0, 0, 0, OVERVIEW_H);
    og.addColorStop(0, 'rgba(24,32,40,0.95)');
    og.addColorStop(1, 'rgba(10,14,18,0.95)');
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, w, OVERVIEW_H);
    tracks.forEach((t) => {
      const list = clipsByTrack.get(t.id) ?? [];
      list.forEach((c) => {
        const x = ox(c.start);
        const cw = Math.max(1, (c.duration / total) * w);
        ctx.fillStyle = hexA(c.color ?? t.color, 0.55);
        ctx.fillRect(x, 2, cw, OVERVIEW_H - 4);
      });
    });
    /* viewport window */
    const vx0 = ox(view.scroll);
    const vx1 = ox(view.scroll + w / pxPerSec);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, Math.max(0, vx0), OVERVIEW_H);
    ctx.fillRect(vx1, 0, Math.max(0, w - vx1), OVERVIEW_H);
    ctx.strokeStyle = 'rgba(31,208,230,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx0 + 0.5, 0.5, Math.max(2, vx1 - vx0) - 1, OVERVIEW_H - 1);

    /* time scale */
    ctx.save();
    ctx.translate(0, OVERVIEW_H);
    const beat = 60 / Math.max(20, state.bpm);
    const beatPx = beat * pxPerSec;
    const stepSec = beatPx > 90 ? beat : beatPx > 26 ? beat * 2 : beatPx > 9 ? beat * 4 : beat * 16;
    const stepPx = stepSec * pxPerSec;
    const t0 = Math.floor(view.scroll / stepSec) * stepSec;
    const t1 = view.scroll + w / pxPerSec;

    ctx.fillStyle = 'rgba(190,215,235,0.06)';
    ctx.fillRect(0, 0, w, SCALE_H);
    for (let t = t0; t <= t1; t += stepSec) {
      const x = Math.round(timeToX(t)) + 0.5;
      const barSec = beat * state.numerator;
      const isBar = Math.abs(t / barSec - Math.round(t / barSec)) < 1e-6;
      ctx.strokeStyle = isBar ? 'rgba(199,15,40,0.75)' : 'rgba(190,215,235,0.3)';
      ctx.beginPath();
      ctx.moveTo(x, isBar ? 4 : SCALE_H - 9);
      ctx.lineTo(x, SCALE_H);
      ctx.stroke();
      if (stepPx > 46 || isBar) {
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.fillStyle = isBar ? 'rgba(255,120,140,0.95)' : 'rgba(160,185,205,0.7)';
        ctx.fillText(fmtTime(t, pxPerSec), x + 3, 13);
      }
    }
    /* bar.beat readout line */
    ctx.font = '9px "Share Tech Mono", monospace';
    ctx.fillStyle = 'rgba(127,227,255,0.55)';
    ctx.fillText(`${state.numerator}/${state.denominator} · ${state.bpm} BPM`, 4, SCALE_H - 4);
    ctx.restore();
  }, [clipsByTrack, pxPerSec, state, timeToX, tracks, view.scroll, w]);

  const paintFrame = useCallback(() => {
    const cv = laneCanvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wpx = Math.max(1, Math.floor(w * dpr));
    const hpx = Math.max(1, Math.floor(contentH * dpr));
    if (cv.width !== wpx || cv.height !== hpx) {
      cv.width = wpx;
      cv.height = hpx;
      cv.style.height = `${contentH}px`;
      plateKey.current.viewKey = '';
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* plate cache */
    const viewKey = [
      view.scroll,
      pxPerSec,
      view.gridDivision,
      view.selectedTrackId,
      state.loopOn,
      state.loopStart,
      state.loopEnd,
      state.bpm,
      state.numerator,
      w,
      contentH,
      currentFxLevel(),
      buffers.version,
      hover.clipId,
    ].join('|');
    const k = plateKey.current;
    if (k.clips !== clips || k.tracks !== tracks || k.selection !== selection || k.viewKey !== viewKey) {
      k.clips = clips;
      k.tracks = tracks;
      k.selection = selection;
      k.viewKey = viewKey;
      let plate = plateRef.current;
      if (!plate) {
        plate = document.createElement('canvas');
        plateRef.current = plate;
      }
      plate.width = wpx;
      plate.height = hpx;
      const pctx = plate.getContext('2d');
      if (pctx) {
        pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        pctx.clearRect(0, 0, w, contentH);
        paintPlate(pctx, w, contentH);
      }
    }
    ctx.clearRect(0, 0, w, contentH);
    if (plateRef.current) ctx.drawImage(plateRef.current, 0, 0, w, contentH);

    /* marquee */
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      const mw = Math.abs(marquee.x1 - marquee.x0);
      const mh = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = 'rgba(199,15,40,0.14)';
      ctx.fillRect(x, y, mw, mh);
      ctx.strokeStyle = 'rgba(255,45,71,0.8)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, mw, mh);
      ctx.setLineDash([]);
    }

    /* playhead */
    const pos = transport.playing ? transport.position() : state.position;
    const px = timeToX(pos);
    if (px >= -2 && px <= w + 2) {
      const g = ctx.createLinearGradient(px - 7, 0, px + 7, 0);
      g.addColorStop(0, 'rgba(255,45,71,0)');
      g.addColorStop(0.5, 'rgba(255,45,71,0.22)');
      g.addColorStop(1, 'rgba(255,45,71,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - 7, 0, 14, contentH);
      ctx.fillStyle = '#ff2d47';
      ctx.fillRect(Math.round(px) - 0.5, 0, 1.4, contentH);
      ctx.save();
      ctx.shadowColor = '#ff2d47';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ff2d47';
      ctx.fillRect(Math.round(px) - 0.5, 0, 1.4, contentH);
      ctx.restore();
    }
  }, [clips, contentH, hover.clipId, marquee, paintPlate, pxPerSec, selection, state, timeToX, tracks, view.gridDivision, view.scroll, view.selectedTrackId, w]);

  /* repaint on any relevant change */
  useEffect(() => {
    paintRuler();
  }, [paintRuler]);

  useEffect(() => {
    paintFrame();
  }, [paintFrame]);

  /* animation loop: only while the transport is rolling */
  useEffect(() => {
    const loop = () => {
      paintFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    if (state.playing) rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.playing, paintFrame]);

  /* ══════════════════════════════════════════════════════════════════════
     HIT TESTING
     ══════════════════════════════════════════════════════════════════════ */

  const hitTest = useCallback(
    (x: number, y: number): { clip: Clip; kind: DragKind; lane: LaneLayout } | null => {
      const lane = trackAtY(y);
      if (!lane) return null;
      const list = clipsByTrack.get(lane.track.id) ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        const cx = timeToX(c.start);
        const cw = Math.max(2, c.duration * pxPerSec);
        if (x < cx || x > cx + cw) continue;
        const localY = y - lane.y;
        if (localY < 14) {
          const fadeInPx = Math.min(cw * 0.5, c.fadeIn * pxPerSec);
          const fadeOutPx = Math.min(cw * 0.5, c.fadeOut * pxPerSec);
          if (Math.abs(x - (cx + fadeInPx)) < FADE_GRAB) return { clip: c, kind: 'fadeIn', lane };
          if (Math.abs(x - (cx + cw - fadeOutPx)) < FADE_GRAB) return { clip: c, kind: 'fadeOut', lane };
        }
        if (x - cx < EDGE_GRAB) return { clip: c, kind: 'trimL', lane };
        if (cx + cw - x < EDGE_GRAB) return { clip: c, kind: 'trimR', lane };
        return { clip: c, kind: 'move', lane };
      }
      return null;
    },
    [clipsByTrack, pxPerSec, timeToX, trackAtY],
  );

  /* ══════════════════════════════════════════════════════════════════════
     POINTER INTERACTION
     ══════════════════════════════════════════════════════════════════════ */

  const localPoint = (e: React.PointerEvent | PointerEvent) => {
    const rect = lanesRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    setMenu(null);
    const { x, y } = localPoint(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const hit = hitTest(x, y);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startTime: view.scroll,
        origin: [],
        fromTrack: 0,
        toTrack: 0,
        scrollStart: view.scroll,
        moved: false,
        additive,
      };
      return;
    }

    if (hit) {
      const store = useDaw.getState();
      let sel = store.selection;
      if (!sel.includes(hit.clip.id)) {
        sel = additive ? [...sel, hit.clip.id] : [hit.clip.id];
        store.select(sel, false);
      } else if (additive) {
        sel = sel.filter((id) => id !== hit.clip.id);
        store.select(sel, false);
        return;
      }
      store.setView({ selectedTrackId: hit.clip.trackId });
      store.pushHistory();
      dragRef.current = {
        kind: hit.kind,
        startX: x,
        startY: y,
        startTime: xToTime(x),
        origin: store.clips.filter((c) => sel.includes(c.id)).map((c) => ({ ...c })),
        fromTrack: layout.findIndex((l) => l.track.id === hit.clip.trackId),
        toTrack: layout.findIndex((l) => l.track.id === hit.clip.trackId),
        scrollStart: view.scroll,
        moved: false,
        additive,
      };
      return;
    }

    if (additive) {
      dragRef.current = null;
      setMarquee({ x0: x, y0: y, x1: x, y1: y });
      return;
    }
    useDaw.getState().clearSelection();
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
    dragRef.current = {
      kind: 'marquee',
      startX: x,
      startY: y,
      startTime: xToTime(x),
      origin: [],
      fromTrack: -1,
      toTrack: -1,
      scrollStart: view.scroll,
      moved: false,
      additive,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localPoint(e);
    const d = dragRef.current;
    if (!d) {
      const hit = hitTest(x, y);
      setHover({ clipId: hit?.clip.id ?? null, edge: hit?.kind ?? null, trackIndex: trackAtY(y)?.index ?? -1 });
      return;
    }
    if (Math.abs(x - d.startX) > 2 || Math.abs(y - d.startY) > 2) d.moved = true;

    if (d.kind === 'pan') {
      const dt = (d.startX - e.clientX) / pxPerSec;
      useDaw.getState().setView({ scroll: Math.max(0, d.scrollStart + dt) });
      return;
    }
    if (d.kind === 'marquee') {
      setMarquee({ x0: d.startX, y0: d.startY, x1: x, y1: y });
      return;
    }
    if (!d.moved || !d.origin.length) return;

    const dt = (x - d.startX) / pxPerSec;
    const store = useDaw.getState();
    const ids = d.origin.map((c) => c.id);
    const lane = trackAtY(y);
    d.toTrack = lane ? lane.index : d.toTrack;
    const trackDelta = d.toTrack - d.fromTrack;

    if (d.kind === 'move') {
      /* horizontal move, snapped on the primary clip */
      const primary = d.origin[0];
      const rawStart = Math.max(0, primary.start + dt);
      const snapped = store.snapValue(rawStart, ids);
      const delta = snapped - primary.start;
      const trackFor = (c: Clip) => {
        const idx = layout.findIndex((l) => l.track.id === c.trackId);
        const target = Math.max(0, Math.min(layout.length - 1, idx + trackDelta));
        return layout[target]?.track.id ?? c.trackId;
      };
      const patch = new Map<string, Partial<Clip>>();
      d.origin.forEach((c) => patch.set(c.id, { start: Math.max(0, c.start + delta), trackId: trackFor(c) }));
      useDaw.setState((s) => ({
        clips: s.clips.map((c) => (patch.has(c.id) ? { ...c, ...patch.get(c.id)! } : c)),
      }));
      return;
    }

    if (d.kind === 'trimL') {
      d.origin.forEach((c) => {
        const maxShift = c.duration - 0.02;
        let shift = dt;
        /* cannot trim beyond the start of the source material */
        shift = Math.max(shift, -c.offset / Math.max(0.05, c.speed));
        shift = Math.min(shift, maxShift);
        const rawStart = Math.max(0, c.start + shift);
        const snapped = store.snapValue(rawStart, ids);
        const s2 = Math.max(-c.offset / Math.max(0.05, c.speed), Math.min(maxShift, snapped - c.start));
        useDaw.getState().updateClip(c.id, {
          start: c.start + s2,
          offset: Math.max(0, c.offset + s2 * c.speed),
          duration: c.duration - s2,
          fadeIn: Math.min(c.fadeIn, Math.max(0, c.duration - s2)),
        });
      });
      return;
    }

    if (d.kind === 'trimR') {
      d.origin.forEach((c) => {
        const rec = buffers.get(c.bufferId);
        const avail = rec ? Math.max(0, (rec.duration - c.offset) / Math.max(0.05, c.speed)) : Infinity;
        let dur = c.duration + dt;
        dur = Math.max(0.02, Math.min(avail, dur));
        const rawEnd = c.start + dur;
        const snapped = store.snapValue(rawEnd, ids);
        const dur2 = Math.max(0.02, Math.min(avail, snapped - c.start));
        useDaw.getState().updateClip(c.id, {
          duration: dur2,
          fadeOut: Math.min(c.fadeOut, dur2),
        });
      });
      return;
    }

    if (d.kind === 'fadeIn' || d.kind === 'fadeOut') {
      d.origin.forEach((c) => {
        const raw = d.kind === 'fadeIn' ? c.fadeIn + dt : c.fadeOut - dt;
        const v = Math.max(0, Math.min(c.duration * 0.9, raw));
        useDaw.getState().updateClip(c.id, d.kind === 'fadeIn' ? { fadeIn: v } : { fadeOut: v });
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d?.kind === 'marquee' && marquee) {
      const x0 = Math.min(marquee.x0, marquee.x1);
      const x1 = Math.max(marquee.x0, marquee.x1);
      const y0 = Math.min(marquee.y0, marquee.y1);
      const y1 = Math.max(marquee.y0, marquee.y1);
      const t0 = xToTime(x0);
      const t1 = xToTime(x1);
      const picked = clips.filter((c) => {
        const lane = layout.find((l) => l.track.id === c.trackId);
        if (!lane) return false;
        const cy = lane.y + lane.h / 2;
        return c.start < t1 && c.start + c.duration > t0 && cy > y0 && cy < y1;
      });
      if (picked.length) useDaw.getState().select(picked.map((c) => c.id), d.additive);
    }
    dragRef.current = null;
    setMarquee(null);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  /* ruler scrubbing */
  const rulerScrubbing = useRef(false);
  const scrubFromEvent = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = Math.max(0, xToTime(e.clientX - rect.left));
    const now = performance.now();
    if (now - scrubLast.current > 55) {
      scrubLast.current = now;
      onScrub(t);
    }
    onSeek(t);
  };

  /* wheel: ctrl = zoom to cursor, shift = horizontal pan */
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const store = useDaw.getState();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const tAt = store.view.scroll + px / store.view.pxPerSec;
        const factor = Math.exp(-e.deltaY * 0.0022);
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, store.view.pxPerSec * factor));
        store.setView({ pxPerSec: next, scroll: Math.max(0, tAt - px / next) });
        return;
      }
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const dx = Math.abs(e.deltaX) > 0.5 ? e.deltaX : e.deltaY;
        store.setView({ scroll: Math.max(0, store.view.scroll + dx / store.view.pxPerSec) });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* auto-scroll to follow the playhead */
  useEffect(() => {
    if (!state.playing || !view.autoScroll) return;
    let raf = 0;
    const follow = () => {
      const pos = transport.position();
      const store = useDaw.getState();
      const x = (pos - store.view.scroll) * store.view.pxPerSec;
      const margin = 120;
      if (x > w - margin || x < 0) {
        const target = Math.max(0, pos - (w * 0.25) / store.view.pxPerSec);
        store.setView({ scroll: target });
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, view.autoScroll, w]);

  /* ══════════════════════════════════════════════════════════════════════
     DROP TARGET
     ══════════════════════════════════════════════════════════════════════ */

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const rect = lanesRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const lane = trackAtY(y) ?? layout[0];
    if (!lane) return;
    onFilesDropped(files, lane.track.id, Math.max(0, xToTime(x)));
  };

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */

  const emptyProject = clips.length === 0;

  return (
    <div className="tl" data-dropping={dropping || undefined} style={{ gridTemplateRows: `${RULER_H}px minmax(0,1fr)` }}>
      <div className="tl__corner tex-bezel">
        <Icon name="layers" size={13} />
        <span className="t-label" style={{ color: 'var(--alu-300)' }}>
          Tracks
        </span>
        <span className="panel__spacer" />
        <span className="t-micro">{tracks.length}</span>
      </div>

      <div className="tl__ruler">
        <canvas
          ref={rulerRef}
          style={{ width: '100%', height: RULER_H, display: 'block', touchAction: 'none', cursor: 'ew-resize' }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            rulerScrubbing.current = true;
            scrubFromEvent(e);
          }}
          onPointerMove={(e) => rulerScrubbing.current && scrubFromEvent(e)}
          onPointerUp={(e) => {
            rulerScrubbing.current = false;
            (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
          }}
          onPointerCancel={() => {
            rulerScrubbing.current = false;
          }}
          onDoubleClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const t = Math.max(0, xToTime(e.clientX - rect.left));
            const store = useDaw.getState();
            if (!store.loopOn) {
              const barSec = (60 / store.bpm) * store.numerator;
              store.setTransport({ loopOn: true, loopStart: Math.floor(t / barSec) * barSec, loopEnd: Math.floor(t / barSec) * barSec + barSec * 2 });
            } else {
              store.setTransport({ loopOn: false });
            }
          }}
          title="Drag to scrub · double-click to set a 2-bar loop"
        />
      </div>

      <div
        className="tl__scroll"
        onWheel={(e) => {
          /* Let the browser scroll vertically; convert plain wheel over the
             canvas into horizontal motion when the user holds shift. */
          if (e.shiftKey) e.stopPropagation();
        }}
      >
        <div className="tl__heads tex-carbon">
          {tracks.map((t) => (
            <TrackHeader key={t.id} track={t} />
          ))}
          <div style={{ flex: '1 1 auto', minHeight: 40 }} />
        </div>

        <div
          ref={lanesRef}
          className="tl__lanes"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => {
            e.preventDefault();
            const rect = lanesRef.current!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const hit = hitTest(x, y);
            const lane = hit?.lane ?? trackAtY(y) ?? layout[0];
            if (!lane) return;
            if (hit && !selection.includes(hit.clip.id)) useDaw.getState().select([hit.clip.id]);
            setMenu({ x: e.clientX, y: e.clientY, clipId: hit?.clip.id ?? null, time: xToTime(x), trackId: lane.track.id });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!dropping) setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
          style={{ minHeight: contentH }}
        >
          <canvas ref={laneCanvasRef} className="tl__canvas" style={{ cursor: hover.clipId ? 'grab' : 'default' }} />
          {emptyProject && (
            <div className="tl__drop">
              <div className="tl__drop-inner">
                <Icon name="upload" size={30} />
                <span className="t-display" style={{ fontSize: 'var(--fs-md)', color: 'var(--alu-100)' }}>
                  Drop audio to begin
                </span>
                <span className="t-hint" style={{ maxWidth: 320 }}>
                  WAV · MP3 · M4A/AAC · OGG/Opus · FLAC — mixed sample rates are resampled on the fly.
                  Drop onto any lane to create a clip at that position.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {menu && (
        <TimelineMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onFilesDropped={onFilesDropped}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TRACK HEADER
   ══════════════════════════════════════════════════════════════════════════ */

function TrackHeader({ track }: { track: Track }) {
  const selected = useDaw((s) => s.view.selectedTrackId === track.id);
  const anySolo = useDaw((s) => s.tracks.some((t) => t.solo));
  const volume = useDaw((s) => s.tracks.find((t) => t.id === track.id)?.volume ?? 0);
  const update = useDaw((s) => s.updateTrack);
  const audible = anySolo ? track.solo : !track.mute;

  return (
    <div
      className="trk"
      data-selected={selected}
      style={{ ['--trk-color' as string]: track.color, height: track.height }}
      onPointerDown={() => useDaw.getState().setView({ selectedTrackId: track.id })}
    >
      <div className="trk__row">
        <input
          className="trk__name"
          value={track.name}
          onChange={(e) => update(track.id, { name: e.target.value })}
          onFocus={() => useDaw.getState().setView({ selectedTrackId: track.id })}
          aria-label="Track name"
        />
        <button
          type="button"
          className="trk__btn"
          data-kind="arm"
          data-on={track.armed}
          title="Record arm"
          onClick={() => update(track.id, { armed: !track.armed })}
        >
          <Icon name="record" size={10} solid />
        </button>
      </div>
      <div className="trk__row">
        <button
          type="button"
          className="trk__btn"
          data-kind="mute"
          data-on={track.mute}
          title="Mute"
          onClick={() => update(track.id, { mute: !track.mute })}
        >
          M
        </button>
        <button
          type="button"
          className="trk__btn"
          data-kind="solo"
          data-on={track.solo}
          title="Solo"
          onClick={() => update(track.id, { solo: !track.solo })}
        >
          S
        </button>
        <button
          type="button"
          className="trk__btn"
          data-on={track.eqOn}
          title="Equaliser"
          onClick={() => update(track.id, { eqOn: !track.eqOn })}
        >
          <Icon name="eq" size={11} />
        </button>
        <span className="trk__meter grow">
          <MeterBar trackId={track.id} dim={!audible} />
        </span>
      </div>
      <div className="trk__row">
        <span className="t-micro" style={{ width: 22 }}>
          LVL
        </span>
        <input
          className="range range--slim grow"
          type="range"
          min={0}
          max={1.4}
          step={0.01}
          value={volume}
          onChange={(e) => update(track.id, { volume: Number(e.target.value) })}
          aria-label={`${track.name} level`}
        />
        <span className="t-micro" style={{ width: 30, textAlign: 'right' }}>
          {volume <= 0.001 ? '-∞' : (20 * Math.log10(volume)).toFixed(0)}dB
        </span>
      </div>
    </div>
  );
}

function MeterBar({ trackId, dim }: { trackId: string; dim: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const l = engine.level(`track:${trackId}`);
      smooth = l > smooth ? l : smooth * 0.9 + l * 0.1;
      if (ref.current) ref.current.style.transform = `scaleX(${(dim ? 0 : smooth).toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackId, dim]);
  return (
    <span className="meter" style={{ width: '100%', height: 6, display: 'block' }}>
      <span
        className="meter__fill"
        ref={ref}
        style={{ background: 'linear-gradient(90deg, var(--green-lo), var(--green) 55%, var(--amber) 82%, var(--red-hi))' }}
      />
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CONTEXT MENU
   ══════════════════════════════════════════════════════════════════════════ */

function TimelineMenu({
  menu,
  onClose,
  onFilesDropped,
}: {
  menu: { x: number; y: number; clipId: string | null; time: number; trackId: string };
  onClose: () => void;
  onFilesDropped: (files: File[], trackId: string, at: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  const s = useDaw.getState();
  const hasSel = s.selection.length > 0;

  const item = (icon: Parameters<typeof Icon>[0]['name'], label: string, fn: () => void, danger = false, disabled = false) => (
    <button type="button" className={`menu-item ${danger ? 'menu-item--danger' : ''}`} disabled={disabled} onClick={() => { fn(); onClose(); }}>
      <Icon name={icon} size={13} />
      {label}
    </button>
  );

  return (
    <div
      className="popover tl__menu"
      style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 340) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {item('upload', 'Import audio…', () => fileRef.current?.click())}
      {hasSel && item('scissors', 'Split at playhead', () => useDaw.getState().splitClips(useDaw.getState().selection, useDaw.getState().position), false, !hasSel)}
      {hasSel && item('copy', 'Duplicate', () => useDaw.getState().duplicateClips(useDaw.getState().selection), false, !hasSel)}
      {hasSel && item('trash', 'Delete clips', () => useDaw.getState().removeClips(useDaw.getState().selection), true)}
      <div className="divider" style={{ margin: '4px 0' }} />
      {item('target', 'Set playhead here', () => useDaw.getState().setTransport({ position: menu.time }))}
      {item('loop', 'Loop 2 bars from here', () => {
        const st = useDaw.getState();
        const barSec = (60 / st.bpm) * st.numerator;
        const b0 = Math.floor(menu.time / barSec) * barSec;
        st.setTransport({ loopOn: true, loopStart: b0, loopEnd: b0 + barSec * 2 });
      })}
      {item('plus', 'Add track', () => useDaw.getState().addTrack())}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.opus,.aac"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFilesDropped(files, menu.trackId, menu.time);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PAINT HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function fit(c: CanvasRenderingContext2D, text: string, maxW: number) {
  if (c.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Sample-accurate rendering used once zoom passes roughly 900 px/second. */
function paintSamples(
  c: CanvasRenderingContext2D,
  buffer: AudioBuffer,
  clip: Clip,
  x: number,
  y: number,
  w: number,
  h: number,
  pxPerSec: number,
  alpha: number,
  color: string,
) {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const startSample = Math.floor(clip.offset * sr);
  const samplesPerPx = sr / pxPerSec;
  const mid = y + h / 2;
  const amp = h / 2 - 1;

  c.strokeStyle = hexA(color, alpha);
  c.lineWidth = 1;
  c.beginPath();
  const cols = Math.min(Math.ceil(w), 6000);
  for (let i = 0; i < cols; i++) {
    const s0 = startSample + Math.floor(i * samplesPerPx);
    const s1 = Math.min(data.length, s0 + Math.max(1, Math.floor(samplesPerPx)));
    let mn = 1;
    let mx = -1;
    for (let s = s0; s < s1; s++) {
      const v = data[s];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx < mn) continue;
    const px = x + i;
    c.moveTo(px, mid - mx * amp);
    c.lineTo(px, mid - mn * amp);
  }
  c.stroke();

  /* zero crossing dots when a pixel covers less than a sample */
  if (samplesPerPx < 1) {
    c.fillStyle = hexA('#7fe3ff', 0.85);
    const step = Math.max(1, Math.floor(1 / samplesPerPx));
    for (let i = 0; i < cols; i += step) {
      const s = startSample + Math.floor(i * samplesPerPx);
      if (s < 0 || s >= data.length) continue;
      c.fillRect(x + i - 1, mid - data[s] * amp - 1, 2, 2);
    }
    c.fillStyle = 'rgba(127,227,255,0.5)';
    c.font = '8px "Share Tech Mono", monospace';
    c.fillText('SAMPLE VIEW', x + 4, y + 9);
  }
}

export { RULER_H };
export const timelineBarLabel = formatBarsBeats;
