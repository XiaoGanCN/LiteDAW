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
  snapValue: (t: number, excludeClipIds?: string[]) => number;
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

      /** Snaps a time to the grid and/or nearby clip edges. */
      snapValue: (t, excludeClipIds = []) => {
        const s = get();
        const { snap, gridDivision, pxPerSec } = s.view;
        const beat = 60 / Math.max(20, s.bpm);
        const grid = beat * (4 / gridDivision);
        const threshold = 8 / pxPerSec;
        const candidates: number[] = [];
        if (snap === 'grid' || snap === 'both') candidates.push(Math.round(t / grid) * grid);
        if (snap === 'clips' || snap === 'both') {
          const ex = new Set(excludeClipIds);
          s.clips.forEach((c) => {
            if (ex.has(c.id)) return;
            candidates.push(c.start, c.start + c.duration);
          });
          candidates.push(0, s.position);
        }
        if (!candidates.length) return t;
        let best = candidates[0];
        let bestD = Math.abs(candidates[0] - t);
        candidates.forEach((c) => {
          const d = Math.abs(c - t);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        });
        return bestD <= threshold ? Math.max(0, best) : Math.max(0, t);
      },
    }),
    {
      name: 'litedaw.project',
      version: 3,
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
