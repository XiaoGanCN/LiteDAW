/* ============================================================================
   LiteDAW · SAMPLE LIBRARY
   User-uploaded instruments for the pitch trainer plus a small autocorrelation
   pitch detector that guesses the root note of a dropped sample.
   Samples persist as original blobs in IndexedDB so nothing is re-encoded.
   ========================================================================= */

import { decodeAudioFile, type DecodedAudio } from './decode';
import { freqToMidi, midiToFreq } from './dsp';

export interface SampleEntry {
  id: string;
  name: string;
  /** MIDI note the sample sounds at its native rate. */
  rootMidi: number;
  /** Detected fundamental in Hz (0 when detection failed). */
  detectedHz: number;
  buffer: AudioBuffer;
  sampleRate: number;
  channels: number;
  duration: number;
  source: string;
  builtIn?: boolean;
}

export interface SampleHandle {
  stop: (when?: number) => void;
  endsAt: number;
}

/* ── Pitch detection ───────────────────────────────────────────────────── */

/**
 * Autocorrelation + parabolic interpolation. Returns 0 when the signal is too
 * quiet or too noisy to be a single pitched tone.
 */
export function detectPitch(buffer: AudioBuffer, maxSeconds = 1.2): number {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const start = Math.floor(Math.min(data.length * 0.25, sr * 0.08));
  const len = Math.min(data.length - start, Math.floor(sr * maxSeconds));
  if (len < 512) return 0;

  let rms = 0;
  for (let i = 0; i < len; i++) rms += data[start + i] * data[start + i];
  rms = Math.sqrt(rms / len);
  if (rms < 0.004) return 0;

  const minLag = Math.floor(sr / 2000);
  const maxLag = Math.floor(sr / 40);
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag < maxLag; lag++) {
    let corr = 0;
    let norm = 0;
    for (let i = 0; i < len - lag; i += 2) {
      const a = data[start + i];
      const b = data[start + i + lag];
      corr += a * b;
      norm += a * a + b * b;
    }
    const n = norm > 0 ? (2 * corr) / norm : 0;
    if (n > bestCorr) {
      bestCorr = n;
      bestLag = lag;
    }
    if (n > 0.94) break;
  }
  if (bestLag < 0 || bestCorr < 0.32) return 0;

  // parabolic refinement around the best lag
  const c0 = bestLag > minLag ? bestLag - 1 : bestLag;
  const c2 = bestLag < maxLag - 1 ? bestLag + 1 : bestLag;
  const corrAt = (lag: number) => {
    let corr = 0;
    let norm = 0;
    for (let i = 0; i < len - lag; i += 2) {
      const a = data[start + i];
      const b = data[start + i + lag];
      corr += a * b;
      norm += a * a + b * b;
    }
    return norm > 0 ? (2 * corr) / norm : 0;
  };
  const y0 = corrAt(c0);
  const y1 = bestCorr;
  const y2 = corrAt(c2);
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const lag = bestLag + Math.max(-0.5, Math.min(0.5, shift));
  return sr / lag;
}

/* ── Playback ──────────────────────────────────────────────────────────── */

export function playSample(
  ctx: BaseAudioContext,
  dest: AudioNode,
  entry: SampleEntry,
  opts: {
    midi: number;
    when: number;
    duration?: number;
    velocity?: number;
    loop?: boolean;
    detuneCents?: number;
    gain?: number;
  },
): SampleHandle {
  const src = ctx.createBufferSource();
  src.buffer = entry.buffer;
  src.playbackRate.value = Math.pow(2, (opts.midi - entry.rootMidi) / 12);
  if (opts.detuneCents) src.detune.value = opts.detuneCents;
  src.loop = opts.loop ?? false;
  if (src.loop) {
    src.loopStart = 0;
    src.loopEnd = entry.buffer.duration;
  }

  const g = ctx.createGain();
  const v = Math.max(0.02, Math.min(1, opts.velocity ?? 0.8)) * (opts.gain ?? 1);
  const start = Math.max(ctx.currentTime, opts.when);
  const natural = entry.duration / src.playbackRate.value;
  const dur = opts.duration ?? natural;

  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(v, start + 0.004);
  if (!src.loop && dur < natural) {
    g.gain.setValueAtTime(v, start + Math.max(0.01, dur - 0.02));
    g.gain.linearRampToValueAtTime(0, start + dur);
  } else {
    g.gain.setValueAtTime(v, start + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, start + dur + 0.02);
  }

  src.connect(g).connect(dest);
  src.start(start);
  const endsAt = src.loop ? Infinity : start + dur + 0.03;
  if (src.loop) src.stop(start + dur + 0.03);
  else src.stop(endsAt);

  return {
    endsAt,
    stop: (when?: number) => {
      try {
        src.stop(Math.max(ctx.currentTime, when ?? ctx.currentTime + 0.02));
      } catch {
        /* already stopped */
      }
    },
  };
}

/* ── IndexedDB persistence ─────────────────────────────────────────────── */

const DB_NAME = 'litedaw';
const STORE = 'samples';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredSample {
  id: string;
  name: string;
  rootMidi: number;
  blob: Blob;
  type: string;
  addedAt: number;
}

async function putStored(rec: StoredSample) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function allStored(): Promise<StoredSample[]> {
  const db = await openDb();
  const out = await new Promise<StoredSample[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredSample[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

async function deleteStored(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/* ── Library ───────────────────────────────────────────────────────────── */

const uid = () => `smp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export class SampleLibrary {
  entries: SampleEntry[] = [];
  private listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  get(id: string | null | undefined) {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  /** Imports a file, auto-detecting the root note unless one is supplied. */
  async import(file: File, rootMidi?: number): Promise<SampleEntry> {
    const decoded: DecodedAudio = await decodeAudioFile(file, 1024);
    const hz = rootMidi === undefined ? detectPitch(decoded.buffer) : 0;
    const root =
      rootMidi ??
      (hz > 0 ? Math.round(freqToMidi(hz)) : 60);

    const entry: SampleEntry = {
      id: uid(),
      name: decoded.name,
      rootMidi: root,
      detectedHz: hz,
      buffer: decoded.buffer,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      duration: decoded.duration,
      source: decoded.source,
    };
    this.entries = [...this.entries, entry];
    this.emit();
    void putStored({
      id: entry.id,
      name: entry.name,
      rootMidi: root,
      blob: file,
      type: file.type,
      addedAt: Date.now(),
    }).catch(() => {});
    return entry;
  }

  /** Rehydrates persisted samples at boot. */
  async restore(): Promise<number> {
    try {
      const rows = await allStored();
      let added = 0;
      for (const row of rows) {
        if (this.entries.some((e) => e.id === row.id)) continue;
        try {
          const file = new File([row.blob], row.name, { type: row.type || 'audio/wav' });
          const decoded = await decodeAudioFile(file, 512);
          this.entries = [
            ...this.entries,
            {
              id: row.id,
              name: row.name,
              rootMidi: row.rootMidi,
              detectedHz: 0,
              buffer: decoded.buffer,
              sampleRate: decoded.sampleRate,
              channels: decoded.channels,
              duration: decoded.duration,
              source: decoded.source,
            },
          ];
          added++;
        } catch {
          /* skip unreadable entry */
        }
      }
      if (added) this.emit();
      return added;
    } catch {
      return 0;
    }
  }

  async remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
    await deleteStored(id).catch(() => {});
  }

  setRoot(id: string, rootMidi: number) {
    this.entries = this.entries.map((e) => (e.id === id ? { ...e, rootMidi } : e));
    this.emit();
  }

  /** Suggested root as a MIDI number for a freshly dropped file. */
  static suggestRoot(hz: number) {
    return hz > 0 ? Math.round(freqToMidi(hz)) : 60;
  }
}

export const samples = new SampleLibrary();

/** Reference frequency table for the trainer's readout. */
export const noteHz = midiToFreq;
