/* ============================================================================
   LiteDAW · PROJECT STATE
   Tracks, clips, transport, view, selection and the undo stack. Everything
   that defines a session lives here so it can be persisted to localStorage and
   replayed identically by the offline renderer at export time.
   ========================================================================= */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SnapMode = 'off' | 'grid' | 'clips' | 'both';
export type EqBandType = 'lowshelf' | 'peaking' | 'highshelf';

export interface EqBand {
  id: string;
  type: EqBandType;
  freq: number;
  gain: number;
  q: number;
  on: boolean;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  volume: number; // linear, 0..1.5
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
  armed: boolean;
  eqOn: boolean;
  eq: EqBand[];
  /** Track-level pitch offset in semitones applied to every clip. */
  pitch: number;
  /** Track-level tape-speed multiplier applied to every clip. */
  speed: number;
  height: number;
  inputMonitor: boolean;
}

export interface Clip {
  id: string;
  trackId: string;
  bufferId: string;
  name: string;
  /** Timeline position, seconds. */
  start: number;
  /** Offset into the source buffer, seconds. */
  offset: number;
  /** Length on the timeline, seconds. */
  duration: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
  /** Clip pitch offset in semitones (granular, duration preserved). */
  pitch: number;
  /** Clip tape-speed multiplier (changes duration + pitch, like a vari-speed). */
  speed: number;
  color?: string;
}

export interface ScopeConfig {
  spectrum: boolean;
  wave: boolean;
  vector: boolean;
  docked: boolean;
  gain: number;
}

export interface DawState {
  projectName: string;
  bpm: number;
  numerator: number;
  denominator: number;
  tracks: Track[];
  clips: Clip[];
  /** Transport position in seconds. */
  position: number;
  playing: boolean;
  recording: boolean;
  loopOn: boolean;
  loopStart: number;
  loopEnd: number;
  metronomeOn: boolean;
  countIn: boolean;
  masterVolume: number;

  view: {
    pxPerSec: number;
    scroll: number;
    autoScroll: boolean;
    snap: SnapMode;
    gridDivision: number;
    /** Derive the grid step from zoom (true) or pin it to `gridDivision`. */
    gridAuto: boolean;
    waveformZoom: number;
    selectedTrackId: string | null;
  };
  selection: string[];
  /** Id of the clip whose inspector is focused (single-selection case). */
  focusedClipId: string | null;
  scope: ScopeConfig;

  history: { past: Snapshot[]; future: Snapshot[] };

  /* ── actions ─────────────────────────────────────────────────────────── */
  setProject: (patch: Partial<Pick<DawState, 'projectName' | 'bpm' | 'numerator' | 'denominator'>>) => void;
  setTransport: (patch: Partial<Pick<DawState, 'position' | 'playing' | 'recording' | 'loopOn' | 'loopStart' | 'loopEnd' | 'metronomeOn' | 'countIn' | 'masterVolume'>>) => void;
  setView: (patch: Partial<DawState['view']>) => void;
  setScope: (patch: Partial<ScopeConfig>) => void;

  addTrack: (name?: string) => Track;
  removeTrack: (id: string) => string[];
  updateTrack: (id: string, patch: Partial<Track>) => void;
  reorderTrack: (id: string, dir: -1 | 1) => void;

  addClip: (clip: Omit<Clip, 'id'>) => Clip;
  addClips: (clips: Omit<Clip, 'id'>[]) => Clip[];
  updateClip: (id: string, patch: Partial<Clip>) => void;
  updateClips: (ids: string[], patch: Partial<Clip>) => void;
  removeClips: (ids: string[]) => void;
  splitClips: (ids: string[], atSeconds: number) => void;
  duplicateClips: (ids: string[]) => void;

  select: (ids: string[], additive?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setFocusedClip: (id: string | null) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  newProject: () => void;
  /** True when a track is audible given mute/solo state. */
  trackAudible: (id: string) => boolean;
  projectDuration: () => number;
  snapValue: (t: number, excludeClipIds?: string[], opts?: { includePlayhead?: boolean }) => number;
  /** Playhead snapping: always the grid, magnetically clip edges and zero. */
  snapPlayhead: (t: number) => number;
  /** Trims overlaps on the given tracks, keeping `priorityIds` intact. */
  settleOverlaps: (trackIds: string[], priorityIds?: string[]) => void;
  /** First gap on a track able to hold `duration`, at or after `from`. */
  freeSlot: (trackId: string, from: number, duration: number, ignoreIds?: string[]) => number;
}

interface Snapshot {
  label: string;
  tracks: Track[];
  clips: Clip[];
}

const TRACK_COLORS = [
  '#c70f28',
  '#ffae1a',
  '#22e07c',
  '#1fd0e6',
  '#2e86ff',
  '#8a6bff',
  '#ff3dce',
  '#7fe3ff',
  '#ff7a1a',
  '#9be36a',
];

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const makeEq = (): EqBand[] => [
  { id: uid('eq'), type: 'lowshelf', freq: 90, gain: 0, q: 0.7, on: false },
  { id: uid('eq'), type: 'peaking', freq: 420, gain: 0, q: 1.1, on: false },
  { id: uid('eq'), type: 'peaking', freq: 2400, gain: 0, q: 1.3, on: false },
  { id: uid('eq'), type: 'highshelf', freq: 9000, gain: 0, q: 0.7, on: false },
];

export const makeTrack = (index: number, name?: string): Track => ({
  id: uid('trk'),
  name: name ?? `TRK ${String(index + 1).padStart(2, '0')}`,
  color: TRACK_COLORS[index % TRACK_COLORS.length],
  volume: 0.85,
  pan: 0,
  mute: false,
  solo: false,
  armed: false,
  eqOn: false,
  eq: makeEq(),
  pitch: 0,
  speed: 1,
  height: 74,
  inputMonitor: false,
});

const MAX_HISTORY = 60;

/**
 * The grid step actually in force, in SECONDS — shared by the painter and by
 * snapping so the two can never disagree.
 *
 * The timeline coarsens its drawn grid as you zoom out (a 1/16 grid at 0.6 px/s
 * would be a solid block), but snapping kept using the raw `gridDivision`, so at
 * a wide zoom the playhead landed on lines that were not on screen and the grid
 * appeared sparser than the thing it snapped to.
 *
 * `gridAuto` (default) derives the step from the zoom. Switching it off pins the
 * grid to `gridDivision` at every zoom — the "make it customizable" half.
 */
export function gridStepSeconds(s: Pick<DawState, 'bpm' | 'view'>): number {
  const beat = 60 / Math.max(20, s.bpm);
  const base = beat * (4 / Math.max(1, s.view.gridDivision));
  if (!s.view.gridAuto) return base;
  const beatPx = beat * s.view.pxPerSec;
  if (beatPx > 260) return base / 4;
  if (beatPx < 0.7) return beat * 64;
  if (beatPx < 3) return beat * 16;
  if (beatPx < 12) return beat * 4;
  return base;
}

export const useDaw = create<DawState>()(
  persist(
    (set, get) => ({
      projectName: 'Untitled Session',
      bpm: 120,
      numerator: 4,
      denominator: 4,
      tracks: [makeTrack(0, 'TRK 01'), makeTrack(1, 'TRK 02')],
      clips: [],
      position: 0,
      playing: false,
      recording: false,
      loopOn: false,
      loopStart: 0,
      loopEnd: 16,
      metronomeOn: false,
      countIn: false,
      masterVolume: 0.9,

      view: {
        pxPerSec: 70,
        scroll: 0,
        autoScroll: true,
        snap: 'grid',
        gridDivision: 4,
        gridAuto: true,
        waveformZoom: 1,
        selectedTrackId: null,
      },
      selection: [],
      focusedClipId: null,
      scope: { spectrum: true, wave: true, vector: false, docked: true, gain: 1 },

      history: { past: [], future: [] },

      /* ── project / transport / view ────────────────────────────────────── */
      setProject: (patch) => set((s) => ({ ...s, ...patch })),
      setTransport: (patch) => set((s) => ({ ...s, ...patch })),
      setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
      setScope: (patch) => set((s) => ({ scope: { ...s.scope, ...patch } })),

      /* ── tracks ───────────────────────────────────────────────────────── */
      addTrack: (name) => {
        const t = makeTrack(get().tracks.length, name);
        get().pushHistory();
        set((s) => ({ tracks: [...s.tracks, t], view: { ...s.view, selectedTrackId: s.view.selectedTrackId ?? t.id } }));
        return t;
      },

      /** Returns the buffer ids that became orphaned by this removal. */
      removeTrack: (id) => {
        const s = get();
        const doomed = s.clips.filter((c) => c.trackId === id);
        const remaining = s.clips.filter((c) => c.trackId !== id);
        const stillUsed = new Set(remaining.map((c) => c.bufferId));
        const orphans = [...new Set(doomed.map((c) => c.bufferId))].filter((b) => !stillUsed.has(b));
        s.pushHistory();
        set((st) => ({
          tracks: st.tracks.filter((t) => t.id !== id),
          clips: remaining,
          selection: st.selection.filter((cid) => !doomed.some((d) => d.id === cid)),
          view: { ...st.view, selectedTrackId: st.view.selectedTrackId === id ? null : st.view.selectedTrackId },
        }));
        return orphans;
      },

      updateTrack: (id, patch) =>
        set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      reorderTrack: (id, dir) =>
        set((s) => {
          const i = s.tracks.findIndex((t) => t.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= s.tracks.length) return s;
          const next = s.tracks.slice();
          [next[i], next[j]] = [next[j], next[i]];
          return { tracks: next };
        }),

      /* ── clips ────────────────────────────────────────────────────────── */
      addClip: (clip) => {
        const c: Clip = { ...clip, id: uid('clip') };
        get().pushHistory();
        set((s) => ({ clips: [...s.clips, c], selection: [c.id], focusedClipId: c.id }));
        return c;
      },

      addClips: (clips) => {
        const made = clips.map((c) => ({ ...c, id: uid('clip') }));
        get().pushHistory();
        set((s) => ({ clips: [...s.clips, ...made], selection: made.map((m) => m.id), focusedClipId: made[0]?.id ?? null }));
        return made;
      },

      updateClip: (id, patch) =>
        set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

      updateClips: (ids, patch) =>
        set((s) => {
          const idSet = new Set(ids);
          return { clips: s.clips.map((c) => (idSet.has(c.id) ? { ...c, ...patch } : c)) };
        }),

      removeClips: (ids) => {
        if (!ids.length) return;
        get().pushHistory();
        const idSet = new Set(ids);
        set((s) => ({
          clips: s.clips.filter((c) => !idSet.has(c.id)),
          selection: s.selection.filter((id) => !idSet.has(id)),
          focusedClipId: s.focusedClipId && idSet.has(s.focusedClipId) ? null : s.focusedClipId,
        }));
      },

      splitClips: (ids, atSeconds) => {
        const s = get();
        const targetIds = new Set(
          s.clips
            .filter((c) => ids.includes(c.id) && atSeconds > c.start + 0.005 && atSeconds < c.start + c.duration - 0.005)
            .map((c) => c.id),
        );
        if (!targetIds.size) return;
        s.pushHistory();
        const created: string[] = [];
        set((st) => {
          const next: Clip[] = [];
          st.clips.forEach((c) => {
            if (!targetIds.has(c.id)) {
              next.push(c);
              return;
            }
            const leftDur = atSeconds - c.start;
            next.push({ ...c, duration: leftDur, fadeOut: Math.min(c.fadeOut, leftDur) });
            const rightId = uid('clip');
            created.push(rightId);
            next.push({
              ...c,
              id: rightId,
              start: atSeconds,
              offset: c.offset + leftDur * c.speed,
              duration: c.duration - leftDur,
              fadeIn: 0,
            });
          });
          return { clips: next, selection: created, focusedClipId: created[0] ?? st.focusedClipId };
        });
      },

      duplicateClips: (ids) => {
        const s = get();
        const sel = s.clips.filter((c) => ids.includes(c.id));
        if (!sel.length) return;
        s.pushHistory();
        const span = Math.max(...sel.map((c) => c.start + c.duration)) - Math.min(...sel.map((c) => c.start));
        const made = sel.map((c) => ({ ...c, id: uid('clip'), start: c.start + span }));
        set((st) => ({ clips: [...st.clips, ...made], selection: made.map((m) => m.id), focusedClipId: made[0].id }));
      },

      /* ── selection ────────────────────────────────────────────────────── */
      select: (ids, additive = false) =>
        set((s) => {
          const next = additive ? [...new Set([...s.selection, ...ids])] : ids;
          return { selection: next, focusedClipId: next.length ? next[next.length - 1] : null };
        }),
      selectAll: () => set((s) => ({ selection: s.clips.map((c) => c.id) })),
      clearSelection: () => set({ selection: [], focusedClipId: null }),
      setFocusedClip: (id) => set({ focusedClipId: id }),

      /* ── undo / redo ──────────────────────────────────────────────────── */
      pushHistory: () =>
        set((s) => ({
          history: {
            past: [...s.history.past.slice(-MAX_HISTORY), { label: 'edit', tracks: s.tracks, clips: s.clips }],
            future: [],
          },
        })),

      undo: () =>
        set((s) => {
          const prev = s.history.past[s.history.past.length - 1];
          if (!prev) return s;
          return {
            tracks: prev.tracks,
            clips: prev.clips,
            history: {
              past: s.history.past.slice(0, -1),
              future: [{ label: 'redo', tracks: s.tracks, clips: s.clips }, ...s.history.future].slice(0, MAX_HISTORY),
            },
          };
        }),

      redo: () =>
        set((s) => {
          const nxt = s.history.future[0];
          if (!nxt) return s;
          return {
            tracks: nxt.tracks,
            clips: nxt.clips,
            history: {
              past: [...s.history.past, { label: 'undo', tracks: s.tracks, clips: s.clips }].slice(-MAX_HISTORY),
              future: s.history.future.slice(1),
            },
          };
        }),

      canUndo: () => get().history.past.length > 0,
      canRedo: () => get().history.future.length > 0,

      newProject: () =>
        set({
          projectName: 'Untitled Session',
          tracks: [makeTrack(0, 'TRK 01'), makeTrack(1, 'TRK 02')],
          clips: [],
          selection: [],
          focusedClipId: null,
          position: 0,
          playing: false,
          recording: false,
          loopOn: false,
          history: { past: [], future: [] },
        }),

      /* ── helpers ──────────────────────────────────────────────────────── */
      trackAudible: (id) => {
        const s = get();
        const t = s.tracks.find((x) => x.id === id);
        if (!t) return false;
        const anySolo = s.tracks.some((x) => x.solo);
        if (anySolo && !t.solo) return false;
        return !t.mute;
      },

      projectDuration: () => {
        const s = get();
        return s.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
      },

      /**
       * Enforces the "no overlapping clips on a track" rule.
       *
       * Clips in `priorityIds` keep their geometry (they are what the user just
       * dragged); anything they now overlap is trimmed back, and a neighbour
       * trimmed to nothing is dropped. Trimming preserves the neighbour's
       * source offset on the side that survives, so no audio is re-timed.
       */
      settleOverlaps: (trackIds, priorityIds = []) => {
        if (!trackIds.length) return;
        const pri = new Set(priorityIds);
        const tracks = new Set(trackIds);
        const MIN = 0.02;
        set((s) => {
          const kept: Clip[] = [];
          let changed = false;
          const byTrack = new Map<string, Clip[]>();
          s.clips.forEach((c) => {
            if (!tracks.has(c.trackId)) {
              kept.push(c);
              return;
            }
            const arr = byTrack.get(c.trackId) ?? [];
            arr.push(c);
            byTrack.set(c.trackId, arr);
          });

          byTrack.forEach((list) => {
            // The priority clips win ties, so they settle last and stay put.
            const ordered = [...list].sort((a, b) => a.start - b.start || (pri.has(a.id) ? 1 : 0) - (pri.has(b.id) ? 1 : 0));
            const out: Clip[] = [];
            for (const c of ordered) {
              let cur = c;
              for (const prev of out) {
                const prevEnd = prev.start + prev.duration;
                const curEnd = cur.start + cur.duration;
                if (cur.start >= prevEnd - 1e-6 || curEnd <= prev.start + 1e-6) continue;
                const prevWins = pri.has(prev.id) || (!pri.has(cur.id) && prev.start <= cur.start);
                if (prevWins) {
                  const newDur = prevEnd - cur.start;
                  if (newDur <= MIN) {
                    cur = { ...cur, duration: 0 };
                  } else {
                    const delta = cur.duration - newDur;
                    cur = { ...cur, start: prevEnd, offset: cur.offset + delta * cur.speed, duration: newDur };
                  }
                } else {
                  const newDur = cur.start - prev.start;
                  if (newDur <= MIN) {
                    prev.duration = 0;
                  } else {
                    prev.duration = newDur;
                    prev.fadeOut = Math.min(prev.fadeOut, newDur);
                  }
                }
                changed = true;
              }
              if (cur.duration > MIN) out.push(cur);
              else changed = true;
            }
            out.forEach((c) => kept.push(c));
          });

          if (!changed) return s;
          const ids = new Set(kept.map((c) => c.id));
          return {
            clips: kept,
            selection: s.selection.filter((id) => ids.has(id)),
            focusedClipId: s.focusedClipId && ids.has(s.focusedClipId) ? s.focusedClipId : null,
          };
        });
      },

      /** First gap on a track that can hold `duration`, at or after `from`. */
      freeSlot: (trackId, from, duration, ignoreIds = []) => {
        const ig = new Set(ignoreIds);
        const busy = get()
          .clips.filter((c) => c.trackId === trackId && !ig.has(c.id))
          .map((c) => [c.start, c.start + c.duration] as [number, number])
          .sort((a, b) => a[0] - b[0]);
        let t = Math.max(0, from);
        for (const [s0, s1] of busy) {
          if (t + duration <= s0 + 1e-6) return t;
          if (t < s1) t = s1;
        }
        return t;
      },

      /**
       * Where the playhead lands. Grid snapping is unconditional; clip edges,
       * zero and the loop bounds are magnets within a pixel threshold, so the
       * playhead can be parked exactly on a clip boundary.
       */
      snapPlayhead: (t) => {
        const s = get();
        if (s.view.snap === 'off') return Math.max(0, t);
        const step = gridStepSeconds(s);
        const gridT = Math.max(0, Math.round(t / step) * step);
        const threshold = 10 / s.view.pxPerSec;
        const magnets = [gridT, 0];
        s.clips.forEach((c) => magnets.push(c.start, c.start + c.duration));
        if (s.loopOn) magnets.push(s.loopStart, s.loopEnd);
        let best = gridT;
        let bestD = Math.abs(gridT - t);
        magnets.forEach((m) => {
          const d = Math.abs(m - t);
          if (d < bestD) {
            bestD = d;
            best = m;
          }
        });
        return Math.max(0, bestD <= threshold ? best : gridT);
      },

      /** Snaps a time to the grid and/or nearby clip edges. */
      snapValue: (t, excludeClipIds = [], opts) => {
        const s = get();
        const { snap, pxPerSec } = s.view;
        if (snap === 'off') return Math.max(0, t);
        const grid = gridStepSeconds(s);
        const threshold = 8 / pxPerSec;
        /* Grid snapping is unconditional: a grid line is always the closest
           legal position, so quantising to the nearest one is the whole point
           of the mode. Previously a pixel-derived threshold let a drag land
           between lines whenever the pointer was more than ~8 px away. */
        const gridT = Math.max(0, Math.round(t / grid) * grid);

        if (snap === 'grid') return gridT;

        const candidates: number[] = [];
        const ex = new Set(excludeClipIds);
        s.clips.forEach((c) => {
          if (ex.has(c.id)) return;
          candidates.push(c.start, c.start + c.duration);
        });
        candidates.push(0);
        if (opts?.includePlayhead !== false) candidates.push(s.position);

        let best = candidates[0];
        let bestD = Number.POSITIVE_INFINITY;
        candidates.forEach((c) => {
          const d = Math.abs(c - t);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        });

        /* Clip/playhead edges are a magnetic assist, so they keep a tolerance;
           when nothing is near, `both` still lands on the grid. */
        if (bestD <= threshold) return Math.max(0, best);
        return snap === 'both' ? gridT : Math.max(0, t);
      },
    }),
    {
      name: 'litedaw.project',
      version: 4,
      partialize: (s) => ({
        projectName: s.projectName,
        bpm: s.bpm,
        numerator: s.numerator,
        denominator: s.denominator,
        tracks: s.tracks,
        clips: s.clips,
        loopOn: s.loopOn,
        loopStart: s.loopStart,
        loopEnd: s.loopEnd,
        metronomeOn: s.metronomeOn,
        masterVolume: s.masterVolume,
        view: s.view,
        scope: s.scope,
      }),
    },
  ),
);

export const trackIndex = (s: DawState, id: string) => s.tracks.findIndex((t) => t.id === id);
export const clipsOfTrack = (s: DawState, id: string) => s.clips.filter((c) => c.trackId === id);
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 40000;
