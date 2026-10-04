/* ============================================================================
   LiteDAW · STUDIO PAGE
   Transport, timeline, mixer, inspector, scopes and the import/record paths.
   ========================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../design/Icon';
import { Btn, Chip, IconBtn, Legend, Led, Readout, Segmented, useToast } from '../../components/ui/kit';
import { engine, formatBarsBeats, formatTime } from '../../audio/engine';
import { metronome } from '../../audio/metronome';
import { Recorder, recorder } from '../../audio/recorder';
import { renderProject, transport } from '../../audio/dawEngine';
import { buffers } from '../../daw/buffers';
import { decodeAudioFile, isAudioFile } from '../../audio/decode';
import { dbToGain } from '../../audio/dsp';
import { normalize as normalizeData } from '../../audio/dsp';
import { useDaw, ZOOM_MAX, ZOOM_MIN, type Clip, type SnapMode } from '../../state/daw';
import { allMedia, putMedia, totalBytes as totalMediaBytes } from '../../daw/media';
import { Timeline } from './Timeline';
import { Mixer } from './Mixer';
import { Inspector } from './Inspector';
import { Scopes } from './Scopes';
import { ExportDialog } from './ExportDialog';
import './daw.css';

export function DawPage() {
  const s = useDaw();
  const toast = useToast();
  const [exportOpen, setExportOpen] = useState(false);
  const [deviceList, setDeviceList] = useState<{ deviceId: string; label: string }[]>([]);
  const [inputId, setInputId] = useState<string>('');
  const [recordingArmed, setRecordingArmed] = useState(false);
  const [deck, setDeck] = useState<'mixer' | 'scopes'>('mixer');
  const [timelineH, setTimelineH] = useState(360);
  const [mediaBytes, setMediaBytes] = useState(0);
  const recStartPos = useRef(0);

  const anySolo = s.tracks.some((t) => t.solo);

  /** Reads the live transport position without subscribing the page to it. */
  const currentPosition = useCallback(
    () => (transport.playing ? transport.position() : useDaw.getState().position),
    [],
  );

  /* ══════════════════════════════════════════════════════════════════════
     TRANSPORT
     ══════════════════════════════════════════════════════════════════════ */

  const startPlayback = useCallback(
    async (from: number) => {
      const st = useDaw.getState();
      await engine.init();
      await transport.start(st, from);
      if (st.metronomeOn) {
        metronome.cfg.bpm = st.bpm;
        metronome.cfg.beatsPerBar = st.numerator;
        metronome.cfg.beatUnit = st.denominator;
        metronome.start();
      }
      useDaw.getState().setTransport({ playing: true, position: from });
    },
    [],
  );

  const stopPlayback = useCallback((landAt?: number) => {
    const pos = landAt ?? transport.position();
    transport.stop();
    metronome.stop();
    useDaw.getState().setTransport({ playing: false, position: Math.max(0, pos) });
  }, []);

  const togglePlay = useCallback(async () => {
    if (useDaw.getState().playing) stopPlayback();
    else await startPlayback(useDaw.getState().position);
  }, [startPlayback, stopPlayback]);

  /** Live transport sync while the project changes under the playhead. */
  useEffect(
    () =>
      useDaw.subscribe((next, prev) => {
        if (!transport.playing) return;
        if (next.tracks.length !== prev.tracks.length || next.tracks.some((t, i) => prev.tracks[i]?.id !== t.id)) {
          const at = transport.position();
          void transport.start(next, at);
          return;
        }
        const timingChanged = next.tracks.some((t, i) => {
          const p = prev.tracks[i];
          return !p || p.pitch !== t.pitch || p.speed !== t.speed;
        });
        transport.update(next, { reschedule: next.clips !== prev.clips || timingChanged });
        if (next.bpm !== prev.bpm) metronome.setBpm(next.bpm);
        if (next.metronomeOn !== prev.metronomeOn) {
          if (next.metronomeOn) {
            metronome.cfg.bpm = next.bpm;
            metronome.cfg.beatsPerBar = next.numerator;
            metronome.start();
          } else metronome.stop();
        }
      }),
    [],
  );

  useEffect(
    () => () => {
      transport.stop();
      metronome.stop();
    },
    [],
  );

  /* ══════════════════════════════════════════════════════════════════════
     IMPORT
     ══════════════════════════════════════════════════════════════════════ */

  const importFiles = useCallback(
    async (files: File[], trackId: string, at: number, stacked = true) => {
      const audio = files.filter(isAudioFile);
      if (!audio.length) {
        toast('No decodable audio in that drop', 'warn');
        return;
      }
      /* Decode everything first so placement can consider the whole batch. */
      const decodedList: { file: File; decoded: Awaited<ReturnType<typeof decodeAudioFile>> }[] = [];
      for (const file of audio) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const decoded = await decodeAudioFile(file);
          decodedList.push({ file, decoded });
        } catch {
          toast(`Could not decode ${file.name}`, 'error');
        }
      }
      if (!decodedList.length) return;

      /* A multi-file drop lays the clips out in PARALLEL — one per track,
         starting at the same instant — adding tracks when it runs out, rather
         than queueing them end to end down a single lane. A single file still
         lands where it was dropped. */
      const parallel = stacked && decodedList.length > 1;
      let tracks = [...useDaw.getState().tracks];
      const startIndex = Math.max(0, tracks.findIndex((t) => t.id === trackId));
      const addedTracks: string[] = [];
      if (parallel) {
        const needed = startIndex + decodedList.length - tracks.length;
        for (let i = 0; i < needed; i++) addedTracks.push(useDaw.getState().addTrack().id);
        tracks = [...useDaw.getState().tracks];
      }

      let cursor = at;
      let placed = 0;
      let persisted = 0;
      const made: { clip: Clip; file: File }[] = [];

      for (let i = 0; i < decodedList.length; i++) {
        const { file, decoded } = decodedList[i];
        const rec = buffers.add(decoded.name, decoded.buffer, decoded.source);
        const target = parallel
          ? tracks[Math.min(tracks.length - 1, startIndex + i)]
          : tracks.find((t) => t.id === trackId) ?? tracks[0];
        if (!target) break;

        /* Never drop a clip on top of another: find the first free slot. */
        const start = useDaw.getState().freeSlot(target.id, parallel ? at : cursor, decoded.duration);
        const clip = useDaw.getState().addClip({
          trackId: target.id,
          bufferId: rec.id,
          name: decoded.name,
          start,
          offset: 0,
          duration: decoded.duration,
          gainDb: 0,
          fadeIn: 0,
          fadeOut: 0,
          muted: false,
          pitch: 0,
          speed: 1,
        });
        made.push({ clip, file });
        if (!parallel) cursor = start + decoded.duration;
        placed++;

        // Persist the SOURCE file so the clip survives a reload.
        // eslint-disable-next-line no-await-in-loop
        const ok = await putMedia({ id: rec.id, name: decoded.name, blob: file, type: file.type || 'audio/wav' });
        if (ok) persisted++;
      }

      if (!parallel && made.length) {
        /* Overlaps can only appear when clips share a lane. */
        useDaw.getState().settleOverlaps(
          [...new Set(made.map((m) => m.clip.trackId))],
          made.map((m) => m.clip.id),
        );
      }

      if (placed) {
        const bits = [`${placed} clip${placed > 1 ? 's' : ''} imported`];
        if (addedTracks.length) bits.push(`${addedTracks.length} track${addedTracks.length > 1 ? 's' : ''} added`);
        if (persisted < placed) bits.push(`${placed - persisted} too large to persist`);
        toast(bits.join(' · '), persisted === placed ? 'ok' : 'warn');
        void totalMediaBytes().then(setMediaBytes);
      }
    },
    [toast],
  );

  const fileInput = useRef<HTMLInputElement>(null);

  /* ══════════════════════════════════════════════════════════════════════
     RECORDING
     ══════════════════════════════════════════════════════════════════════ */

  /* ── Media restore ─────────────────────────────────────────────────────
     Rebuilds every persisted source under its ORIGINAL buffer id, so clips
     saved in the project JSON relink instead of coming back empty. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await allMedia();
      if (!rows.length || cancelled) return;
      let restored = 0;
      for (const row of rows) {
        if (buffers.has(row.id)) continue;
        try {
          const file = new File([row.blob], row.name, { type: row.type || 'audio/wav' });
          // eslint-disable-next-line no-await-in-loop
          const decoded = await decodeAudioFile(file);
          buffers.addWithId(row.id, row.name, decoded.buffer, decoded.source);
          restored++;
        } catch {
          /* skip unreadable media rather than blocking the rest */
        }
      }
      if (cancelled) return;
      setMediaBytes(await totalMediaBytes());
      if (restored) {
        const st = useDaw.getState();
        /* Drop clips whose media genuinely could not be recovered. */
        const missing = st.clips.filter((c) => !buffers.has(c.bufferId));
        if (missing.length) st.removeClips(missing.map((c) => c.id));
        toast(`${restored} media file${restored > 1 ? 's' : ''} relinked`, 'ok');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    void Recorder.listDevices().then((d) => {
      setDeviceList(d);
      if (d.length && !inputId) setInputId(d[0].deviceId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRecord = useCallback(async () => {
    const st = useDaw.getState();
    const armed = st.tracks.find((t) => t.armed);
    if (!recordingArmed) {
      if (!armed) {
        toast('Arm a track first (the red dot on a track header)', 'warn');
        return;
      }
      try {
        await recorder.open(inputId || undefined, armed.inputMonitor);
      } catch {
        toast('Microphone permission denied', 'error');
        return;
      }
      recStartPos.current = st.position;
      recorder.start();
      setRecordingArmed(true);
      if (!st.playing) await startPlayback(st.position);
      toast('Recording', 'ok');
      return;
    }

    const take = recorder.stop();
    setRecordingArmed(false);
    stopPlayback();
    if (!take) {
      toast('Nothing was captured', 'warn');
      return;
    }
    const t = useDaw.getState().tracks.find((x) => x.armed) ?? useDaw.getState().tracks[0];
    if (!t) return;
    let buffer = take.buffer;
    if (take.peakLinear < 0.05) {
      buffer = new AudioBuffer({
        numberOfChannels: buffer.numberOfChannels,
        length: buffer.length,
        sampleRate: buffer.sampleRate,
      });
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const src = new Float32Array(take.buffer.getChannelData(c));
        normalizeData(src, 0.9);
        buffer.getChannelData(c).set(src);
      }
    }
    const rec = buffers.add(`Take ${new Date().toLocaleTimeString()}`, buffer, 'record');
    useDaw.getState().addClip({
      trackId: t.id,
      bufferId: rec.id,
      name: rec.name,
      start: recStartPos.current,
      offset: 0,
      duration: rec.duration,
      gainDb: 0,
      fadeIn: 0.005,
      fadeOut: 0.02,
      muted: false,
      pitch: 0,
      speed: 1,
    });
    toast(`Take captured · ${take.seconds.toFixed(2)} s`, 'ok');
  }, [inputId, recordingArmed, startPlayback, stopPlayback, toast]);

  /* ══════════════════════════════════════════════════════════════════════
     SCRUB AUDIO
     ══════════════════════════════════════════════════════════════════════ */

  const scrub = useCallback(async (t: number) => {
    const st = useDaw.getState();
    if (transport.playing) return;
    const ctx = await engine.init();
    /* Every audible clip under the playhead, on every track. This used to cap
       the grain count at four, so a busy arrangement scrubbed only its first
       few lanes — which read as "scrubbing does not work for every track". */
    const hits = st.clips.filter(
      (c) => !c.muted && t >= c.start && t < c.start + c.duration && st.trackAudible(c.trackId),
    );
    if (!hits.length) return;

    /* Route each grain through its own track strip when the transport graph is
       live, so level, pan and EQ are honoured; otherwise fall back to the bus
       with the track fader applied manually. */
    const graph = transport.getGraph();
    const now = ctx.currentTime + 0.005;
    const grain = 0.075;
    hits.forEach((c) => {
      const rec = buffers.get(c.bufferId);
      if (!rec) return;
      const track = st.tracks.find((x) => x.id === c.trackId);
      const rate = Math.max(0.05, c.speed * (track?.speed ?? 1));
      const buffer = buffers.pitched(c.bufferId, c.pitch + (track?.pitch ?? 0)) ?? rec.buffer;
      const off = c.offset + (t - c.start) * rate;
      if (off >= buffer.duration) return;

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      const stripGain = graph ? 1 : (track?.volume ?? 1);
      const amp = dbToGain(c.gainDb) * stripGain * 0.6;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.006);
      g.gain.linearRampToValueAtTime(0, now + grain);
      src.connect(g).connect(graph?.strips.get(c.trackId)?.input ?? engine.bus('daw'));
      src.start(now, off, Math.min(grain * rate, buffer.duration - off));
      src.stop(now + grain + 0.03);
    });
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     KEYBOARD
     ══════════════════════════════════════════════════════════════════════ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      const st = useDaw.getState();
      const mod = e.metaKey || e.ctrlKey;
      switch (true) {
        case e.code === 'Space':
          e.preventDefault();
          void togglePlay();
          break;
        case e.key === 'Home':
          st.setTransport({ position: 0 });
          if (st.playing) void startPlayback(0);
          break;
        case e.key === 'End':
          st.setTransport({ position: st.projectDuration() });
          break;
        case mod && (e.key === 'Delete' || e.key === 'Backspace'):
          /* ⌘/ctrl + Backspace always targets the focused TRACK, even with
             clips selected — the unambiguous "remove this lane" gesture. */
          if (st.view.selectedTrackId && st.tracks.length > 1) {
            e.preventDefault();
            const doomed = st.view.selectedTrackId;
            const idx = st.tracks.findIndex((t) => t.id === doomed);
            const orphans = st.removeTrack(doomed);
            orphans.forEach((b) => buffers.remove(b, []));
            const next = useDaw.getState().tracks;
            st.setView({ selectedTrackId: next[Math.max(0, Math.min(next.length - 1, idx))]?.id ?? null });
            toast('Track deleted', 'ok');
          }
          break;

        case e.key === 'Delete' || e.key === 'Backspace':
          if (st.selection.length) {
            e.preventDefault();
            st.removeClips(st.selection);
          } else if (st.view.selectedTrackId && st.tracks.length > 1) {
            /* With nothing selected on the timeline, Backspace removes the
               focused track — the fastest route to "get rid of this lane"
               without hunting for a button. */
            e.preventDefault();
            const doomed = st.view.selectedTrackId;
            const idx = st.tracks.findIndex((t) => t.id === doomed);
            const orphans = st.removeTrack(doomed);
            orphans.forEach((b) => buffers.remove(b, []));
            const next = useDaw.getState().tracks;
            const fallback = next[Math.max(0, Math.min(next.length - 1, idx))];
            st.setView({ selectedTrackId: fallback?.id ?? null });
            toast('Track deleted', 'ok');
          }
          break;
        case mod && e.key.toLowerCase() === 'z' && !e.shiftKey:
          e.preventDefault();
          st.undo();
          break;
        case mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)):
          e.preventDefault();
          st.redo();
          break;
        case mod && e.key.toLowerCase() === 'a':
          e.preventDefault();
          st.selectAll();
          break;
        case mod && e.key.toLowerCase() === 'e':
          e.preventDefault();
          setExportOpen(true);
          break;
        case mod && e.key.toLowerCase() === 'i':
          e.preventDefault();
          fileInput.current?.click();
          break;
        case e.key.toLowerCase() === 's' && !mod:
          if (st.selection.length) st.splitClips(st.selection, st.position);
          break;
        case e.key.toLowerCase() === 'd' && !mod:
          if (st.selection.length) st.duplicateClips(st.selection);
          break;
        case e.key.toLowerCase() === 'l' && !mod:
          st.setTransport({ loopOn: !st.loopOn });
          break;
        case e.key.toLowerCase() === 'c' && !mod:
          st.setTransport({ metronomeOn: !st.metronomeOn });
          break;
        case e.key === '+' || e.key === '=':
          st.setView({ pxPerSec: Math.min(ZOOM_MAX, st.view.pxPerSec * 1.5) });
          break;
        case e.key === '-':
          st.setView({ pxPerSec: Math.max(ZOOM_MIN, st.view.pxPerSec / 1.5) });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startPlayback, togglePlay]);

  /* ══════════════════════════════════════════════════════════════════════
     VIEW HELPERS
     ══════════════════════════════════════════════════════════════════════ */

  const zoomToFit = () => {
    const dur = Math.max(4, s.projectDuration());
    const el = document.querySelector('.tl__lanes');
    const w = el?.clientWidth ?? 900;
    s.setView({ pxPerSec: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (w - 40) / dur)), scroll: 0 });
  };

  const zoomToSelection = () => {
    const sel = s.clips.filter((c) => s.selection.includes(c.id));
    if (!sel.length) return;
    const start = Math.min(...sel.map((c) => c.start));
    const end = Math.max(...sel.map((c) => c.start + c.duration));
    const el = document.querySelector('.tl__lanes');
    const w = el?.clientWidth ?? 900;
    s.setView({ pxPerSec: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (w - 60) / Math.max(0.05, end - start))), scroll: Math.max(0, start - 0.05) });
  };

  /**
   * Jump the transport. While rolling this re-anchors the live scheduler rather
   * than restarting it, so the playhead can be dragged around during playback
   * without the audio glitching or the graph being rebuilt on every move.
   */
  const onScrubSeek = useCallback((t: number) => {
    useDaw.getState().setTransport({ position: t });
    transport.seek(t);
  }, []);

  const totalBytes = buffers.totalBytes();

  return (
    <div className="daw" style={{ ['--tl-h' as string]: `${timelineH}px` }}>
      {/* ── Transport ─────────────────────────────────────────────────── */}
      <div className="transport tex-bezel">
        <TransportClock bpm={s.bpm} numerator={s.numerator} playing={s.playing} staticPosition={s.position} />

        <div className="transport__cluster">
          <button type="button" className="tbtn" title="Return to zero (Home)" onClick={() => { s.setTransport({ position: 0 }); if (s.playing) void startPlayback(0); }}>
            <Icon name="toStart" size={16} />
          </button>
          <button type="button" className="tbtn" title="Rewind one bar" onClick={() => { const bar = (60 / s.bpm) * s.numerator; onScrubSeek(Math.max(0, currentPosition() - bar)); }}>
            <Icon name="rewind" size={16} />
          </button>
          <button
            type="button"
            className="tbtn tbtn--play"
            data-on={s.playing}
            title="Play / pause (Space)"
            onClick={() => void togglePlay()}
          >
            <Icon name={s.playing ? 'pause' : 'play'} size={17} solid={!s.playing} />
          </button>
          <button type="button" className="tbtn" title="Stop" onClick={() => stopPlayback(s.position)}>
            <Icon name="stop" size={14} solid />
          </button>
          <button type="button" className="tbtn" title="Forward one bar" onClick={() => { const bar = (60 / s.bpm) * s.numerator; onScrubSeek(currentPosition() + bar); }}>
            <Icon name="forward" size={16} />
          </button>
          <button
            type="button"
            className="tbtn tbtn--rec"
            data-on={recordingArmed}
            title={recordingArmed ? 'Stop recording' : 'Record to the armed track'}
            onClick={() => void toggleRecord()}
          >
            <Icon name="record" size={14} solid />
          </button>
          <button
            type="button"
            className="tbtn"
            data-on={s.loopOn}
            title="Loop (L) — drag on the ruler and double-click to set"
            onClick={() => s.setTransport({ loopOn: !s.loopOn })}
          >
            <Icon name="loop" size={16} />
          </button>
          <button
            type="button"
            className="tbtn"
            data-on={s.metronomeOn}
            title="Metronome (C)"
            onClick={() => s.setTransport({ metronomeOn: !s.metronomeOn })}
          >
            <Icon name="bpm" size={16} />
          </button>
        </div>

        <div className="transport__cluster">
          <IconBtn icon="undo" label="Undo (⌘Z)" size="sm" onClick={() => s.undo()} disabled={!s.canUndo()} />
          <IconBtn icon="redo" label="Redo (⇧⌘Z)" size="sm" onClick={() => s.redo()} disabled={!s.canRedo()} />
          <span className="divider divider--v" />
          <IconBtn icon="scissors" label="Split at playhead (S)" size="sm" onClick={() => s.splitClips(s.selection, s.position)} disabled={!s.selection.length} />
          <IconBtn icon="copy" label="Duplicate (D)" size="sm" onClick={() => s.duplicateClips(s.selection)} disabled={!s.selection.length} />
          <IconBtn icon="trash" label="Delete selection (Del)" size="sm" onClick={() => s.removeClips(s.selection)} disabled={!s.selection.length} />
          <span className="divider divider--v" />
          <IconBtn icon="zoomOut" label="Zoom out (−)" size="sm" onClick={() => s.setView({ pxPerSec: Math.max(ZOOM_MIN, s.view.pxPerSec / 1.6) })} />
          <IconBtn icon="zoomIn" label="Zoom in (+)" size="sm" onClick={() => s.setView({ pxPerSec: Math.min(ZOOM_MAX, s.view.pxPerSec * 1.6) })} />
          <IconBtn icon="target" label="Zoom to selection" size="sm" onClick={zoomToSelection} disabled={!s.selection.length} />
          <IconBtn icon="grid" label="Zoom to fit project" size="sm" onClick={zoomToFit} />
        </div>

        <div className="transport__cluster">
          <span className="transport__pair">
            <span className="t-micro">Snap</span>
            <Segmented<SnapMode>
              value={s.view.snap}
              onChange={(v) => s.setView({ snap: v })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'grid', label: 'Grid' },
                { value: 'clips', label: 'Clip' },
                { value: 'both', label: 'Both' },
              ]}
            />
          </span>
          <IconBtn
            icon={s.view.autoScroll ? 'eye' : 'eyeOff'}
            label={s.view.autoScroll ? 'Follow playhead: on' : 'Follow playhead: off'}
            size="sm"
            variant={s.view.autoScroll ? 'primary' : 'ghost'}
            onClick={() => s.setView({ autoScroll: !s.view.autoScroll })}
          />
        </div>

        <div className="transport__cluster hide-xl">
          <span className="transport__pair">
            <span className="t-micro">Tempo</span>
            <input
              className="input"
              style={{ width: 64 }}
              type="number"
              min={20}
              max={400}
              value={s.bpm}
              onChange={(e) => s.setProject({ bpm: Math.max(20, Math.min(400, Number(e.target.value) || 120)) })}
              aria-label="Project tempo in BPM"
            />
            <span className="t-micro">BPM</span>
          </span>
        </div>

        <span className="panel__spacer" />

        <div className="transport__cluster hide-xl" title="Master output level, post-limiter">
          <Legend color={engine.running ? 'green' : 'amber'} size="sm">
            {engine.running ? 'ENGINE' : 'ARM'}
          </Legend>
          <MasterStripMeter />
        </div>

        <Btn size="sm" variant="ghost" icon="upload" onClick={() => fileInput.current?.click()}>
          Import
        </Btn>
        <Btn size="sm" variant="ghost" icon="plus" onClick={() => s.addTrack()}>
          Track
        </Btn>
        <Btn size="sm" variant="primary" icon="download" onClick={() => setExportOpen(true)} disabled={!s.clips.length}>
          Export
        </Btn>

        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            const st = useDaw.getState();
            const target = st.tracks.find((t) => t.armed) ?? st.tracks.find((t) => t.id === st.view.selectedTrackId) ?? st.tracks[0];
            if (files.length && target) void importFiles(files, target.id, st.position);
            e.target.value = '';
          }}
        />
      </div>

      {/* Direct manipulation of the deck height: drag the boundary. Complements
          the numeric slider in the deck toolbar. */}
      <div
        className="daw__splitter"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize the timeline"
        title="Drag to resize the timeline"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const startY = e.clientY;
          const startH = timelineH;
          const el = e.currentTarget as HTMLElement;
          const move = (ev: PointerEvent) => {
            setTimelineH(Math.max(180, Math.min(760, Math.round(startH + (ev.clientY - startY)))));
          };
          const up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
          el.addEventListener('pointercancel', up);
        }}
      />

      {/* ── Timeline ──────────────────────────────────────────────────── */}
      <Timeline
        onFilesDropped={(files, trackId, at) => void importFiles(files, trackId, at)}
        onSeek={onScrubSeek}
        onScrub={(t) => void scrub(t)}
      />

      {/* ── Lower deck ────────────────────────────────────────────────── */}
      <div className="daw__deck">
        <div className="row deck__bar" style={{ gap: 6 }}>
          <Segmented
            value={deck}
            onChange={setDeck}
            options={[
              { value: 'mixer', label: 'Mixer', icon: 'eq' },
              { value: 'scopes', label: 'Instruments', icon: 'activity' },
            ]}
          />
          <span className="panel__spacer" />
          {/* Deck height reads left→right as SHORTER→TALLER, matching what the
              control does. The old slider ran the opposite way to its own
              label, so dragging right made the timeline smaller. */}
          <span className="transport__pair deck__size">
            <span className="t-micro">Timeline</span>
            <Icon name="zoomOut" size={12} />
            <input
              className="range range--slim"
              style={{ width: 118 }}
              type="range"
              min={220}
              max={620}
              step={10}
              value={timelineH}
              onChange={(e) => setTimelineH(Number(e.target.value))}
              aria-label="Timeline height in pixels"
              aria-valuetext={`${timelineH} pixels`}
              title="Timeline height — drag right for a taller timeline"
            />
            <Icon name="zoomIn" size={12} />
            <Readout value={timelineH} unit="px" size="sm" tone="plain" />
          </span>
        </div>

        <div className="deck__col">
          {deck === 'mixer' && <Mixer />}
          {deck === 'scopes' && s.scope.docked && <Scopes />}
          {deck === 'scopes' && !s.scope.docked && (
            <div className="deck__floatnote">
              <Icon name="activity" size={14} />
              <span className="t-label">Instruments are floating</span>
              <span className="t-hint">Use Dock in the Instruments panel to bring them back here.</span>
            </div>
          )}
          <div className="ticker">
            <span className="ticker__seg">
              <Led size="sm" color={s.playing ? 'green' : 'cyan'} on={s.playing} />
              {s.playing ? 'ROLLING' : 'IDLE'}
            </span>
            <span className="ticker__seg">ZOOM {s.view.pxPerSec < 10 ? s.view.pxPerSec.toFixed(2) : Math.round(s.view.pxPerSec)} PX/S</span>
            <span className="ticker__seg">SCROLL {s.view.scroll.toFixed(2)} S</span>
            <span className="ticker__seg">CLIPS {s.clips.length}</span>
            <span className="ticker__seg">SEL {s.selection.length}</span>
            <span className="ticker__seg" title="Decoded audio held in memory">
              SRC {(totalBytes / (1024 * 1024)).toFixed(1)} MB
            </span>
            <span className="ticker__seg" title="Source files persisted for reload, in IndexedDB">
              VAULT {(mediaBytes / (1024 * 1024)).toFixed(1)} MB
            </span>
            {anySolo && <span className="ticker__seg" style={{ color: 'var(--green-hi)' }}>SOLO ACTIVE</span>}
            {recordingArmed && <span className="ticker__seg" style={{ color: 'var(--red-hi)' }}>● REC</span>}
            <span className="panel__spacer" />
            <span className="ticker__seg hide-xs">SPACE PLAY · S SPLIT · D DUP · L LOOP · C CLICK · ⌘E EXPORT</span>
          </div>
        </div>

        <div className="deck__col">
          <Inspector onExport={() => setExportOpen(true)} />
          <div className="row row--wrap" style={{ gap: 6 }}>
            <Chip tone={recordingArmed ? 'red' : 'default'} icon="mic">
              {recordingArmed ? 'CAPTURING' : 'INPUT READY'}
            </Chip>
            <select
              className="input grow"
              style={{ height: 24, fontSize: 11 }}
              value={inputId}
              onChange={(e) => setInputId(e.target.value)}
              aria-label="Input device"
            >
              {deviceList.length === 0 && <option value="">Default input</option>}
              {deviceList.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <Btn
              size="sm"
              variant="ghost"
              icon="refresh"
              onClick={() => void Recorder.listDevices().then(setDeviceList)}
              aria-label="Refresh inputs"
            />
          </div>
        </div>
      </div>

      {/* Rendered outside the deck switch so floating instruments survive a
          tab change — previously they unmounted with the deck and vanished. */}
      {!s.scope.docked && <Scopes />}

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LIVE READOUTS
   These two components own their own animation frames so high-frequency
   updates never re-render the timeline or the mixer.
   ══════════════════════════════════════════════════════════════════════════ */

function TransportClock({
  bpm,
  numerator,
  playing,
  staticPosition,
}: {
  bpm: number;
  numerator: number;
  playing: boolean;
  staticPosition: number;
}) {
  const [pos, setPos] = useState(staticPosition);

  useEffect(() => {
    if (!playing) {
      setPos(staticPosition);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 40) {
        last = t;
        setPos(transport.position());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, staticPosition]);

  return (
    <div className="transport__readouts">
      <div className="transport__field">
        <span className="t-micro">Position</span>
        <Readout className="transport__pos" value={formatTime(pos)} tone="red" />
      </div>
      <div className="transport__field">
        <span className="t-micro">Bar · Beat</span>
        <Readout value={formatBarsBeats((pos / 60) * bpm, numerator)} size="sm" />
      </div>
    </div>
  );
}

function MasterStripMeter() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const l = engine.masterLevel();
      smooth = l > smooth ? l : smooth * 0.86 + l * 0.14;
      if (ref.current) ref.current.style.transform = `scaleX(${smooth.toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="transport__pair">
      <span className="t-micro">OUT</span>
      <span className="meter" style={{ width: 78, height: 9, display: 'block' }}>
        <span className="meter__fill" ref={ref} />
        <span className="meter__scale" />
      </span>
    </span>
  );
}

export { renderProject };
