/* ============================================================================
   LiteDAW · INSPECTOR
   Context-sensitive parameter bay: clip, track, parametric EQ and session.
   ========================================================================= */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Icon } from '../../design/Icon';
import { Btn, Chip, Divider, Empty, Field, NumDrag, Panel, Segmented, Tabs, ToggleRow, Well, useToast } from '../../components/ui/kit';
import { Knob, Bar } from '../../components/ui/Hardware';
import { audioBufferToWavBlob } from './wavExport';
import { buffers } from '../../daw/buffers';
import { applyFades, normalize as normalizeData, peakDb, rmsDb } from '../../audio/dsp';
import { transport } from '../../audio/dawEngine';
import { useDaw, type EqBand, type EqBandType } from '../../state/daw';

type Tab = 'clip' | 'track' | 'eq' | 'session';

const EQ_COLORS = ['#2e86ff', '#22e07c', '#ffae1a', '#ff3dce'];

/** Stable empty array so the EQ response memo never re-computes needlessly. */
const EMPTY_BANDS: EqBand[] = [];

export function Inspector({ onExport }: { onExport: () => void }) {
  const s = useDaw();
  const [tab, setTab] = useState<Tab>('clip');
  const focused = s.clips.find((c) => c.id === s.focusedClipId) ?? null;
  const track = s.tracks.find((t) => t.id === (s.view.selectedTrackId ?? focused?.trackId)) ?? s.tracks[0] ?? null;

  const selCount = s.selection.length;

  return (
    <Panel
      title="Inspector"
      icon="wrench"
      tag={focused ? 'CLIP' : 'TRACK'}
      className="grow"
      flush
      actions={
        <span className="row" style={{ gap: 4 }}>
          {selCount > 1 && <Chip tone="red">{selCount} SEL</Chip>}
          <Chip tone="cyan">{s.tracks.length} TRK</Chip>
        </span>
      }
    >
      <div className="insp__tabs">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'clip', label: 'Clip', icon: 'scissors' },
            { value: 'track', label: 'Track', icon: 'layers' },
            { value: 'eq', label: 'EQ', icon: 'eq' },
            { value: 'session', label: 'Session', icon: 'cpu' },
          ]}
        />
      </div>
      <div className="panel__body" style={{ gap: 'var(--sp-3)' }}>
        {tab === 'clip' && <ClipTab />}
        {tab === 'track' && (track ? <TrackTab trackId={track.id} /> : <Empty icon="layers">No tracks</Empty>)}
        {tab === 'eq' && (track ? <EqTab trackId={track.id} /> : <Empty icon="eq">No tracks</Empty>)}
        {tab === 'session' && <SessionTab onExport={onExport} />}
      </div>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CLIP
   ══════════════════════════════════════════════════════════════════════════ */

function ClipTab() {
  const s = useDaw();
  const toast = useToast();
  const clip = s.clips.find((c) => c.id === s.focusedClipId) ?? null;
  const rec = clip ? buffers.get(clip.bufferId) : null;

  const stats = useMemo(() => {
    if (!rec || !clip) return null;
    const sr = rec.sampleRate;
    const ch = rec.buffer.getChannelData(0);
    const from = Math.floor(clip.offset * sr);
    const to = Math.min(ch.length, Math.floor((clip.offset + clip.duration * clip.speed) * sr));
    const slice = ch.subarray(from, Math.max(from + 1, to));
    return { peak: peakDb(slice), rms: rmsDb(slice), samples: slice.length };
  }, [rec, clip]);

  if (!clip) {
    return (
      <Empty icon="pointer">
        Select a clip on the timeline
        <br />
        to inspect and process it
      </Empty>
    );
  }

  const update = (patch: Partial<typeof clip>) => useDaw.getState().updateClip(clip.id, patch);

  const applyNormalize = () => {
    if (!rec) return;
    const copy = new AudioBuffer({
      numberOfChannels: rec.buffer.numberOfChannels,
      length: rec.buffer.length,
      sampleRate: rec.sampleRate,
    });
    for (let c = 0; c < rec.buffer.numberOfChannels; c++) {
      const src = new Float32Array(rec.buffer.getChannelData(c));
      normalizeData(src, 0.98);
      copy.getChannelData(c).set(src);
    }
    const added = buffers.add(`${rec.name} (norm)`, copy, 'process');
    useDaw.getState().pushHistory();
    update({ bufferId: added.id, name: added.name });
    toast('Clip normalised to −0.2 dBFS', 'ok');
  };

  const applyFade = (kind: 'in' | 'out') => {
    if (kind === 'in') update({ fadeIn: Math.min(clip.duration * 0.5, 0.35) });
    else update({ fadeOut: Math.min(clip.duration * 0.5, 0.35) });
  };

  const bakeFades = () => {
    if (!rec) return;
    const copy = new AudioBuffer({
      numberOfChannels: rec.buffer.numberOfChannels,
      length: rec.buffer.length,
      sampleRate: rec.sampleRate,
    });
    for (let c = 0; c < rec.buffer.numberOfChannels; c++) {
      const src = new Float32Array(rec.buffer.getChannelData(c));
      applyFades(src, rec.sampleRate, clip.fadeIn, clip.fadeOut);
      copy.getChannelData(c).set(src);
    }
    /* The baked copy covers the whole source; keep the same trim window. */
    const added = buffers.add(`${rec.name} (fades)`, copy, 'process');
    useDaw.getState().pushHistory();
    update({ bufferId: added.id, fadeIn: 0, fadeOut: 0 });
    toast('Fades printed into the audio', 'ok');
  };

  return (
    <>
      <div className="row">
        <Icon name="fileAudio" size={14} />
        <input
          className="input grow"
          value={clip.name}
          onChange={(e) => update({ name: e.target.value })}
          aria-label="Clip name"
        />
      </div>

      <Well className="col" style={{ gap: 3 }}>
        <div className="kv">
          <span className="kv__k">Source</span>
          <span className="kv__v">{rec?.source ?? 'missing'}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Rate / layout</span>
          <span className="kv__v">
            {rec ? `${(rec.sampleRate / 1000).toFixed(1)} kHz · ${rec.channels === 1 ? 'MONO' : 'STEREO'}` : '—'}
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">Source length</span>
          <span className="kv__v">{rec ? `${rec.duration.toFixed(3)} s` : '—'}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Peak / RMS</span>
          <span className="kv__v">
            {stats ? `${stats.peak.toFixed(1)} / ${stats.rms.toFixed(1)} dB` : '—'}
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">Timeline</span>
          <span className="kv__v">
            {clip.start.toFixed(3)} → {(clip.start + clip.duration).toFixed(3)} s
          </span>
        </div>
        {rec && (
          <div style={{ marginTop: 4 }}>
            <span className="t-micro">Level</span>
            <Bar value={Math.max(0, (stats?.peak ?? -60) + 60)} max={60} length="100%" color={stats && stats.peak > -0.5 ? 'var(--red)' : 'var(--green)'} />
          </div>
        )}
      </Well>

      <div className="insp__grid">
        <Knob
          value={clip.gainDb}
          onChange={(v) => update({ gainDb: v })}
          min={-24}
          max={12}
          step={0.1}
          size={52}
          label="Gain"
          unit="dB"
          resetTo={0}
          format={(v) => v.toFixed(1)}
        />
        <Knob
          value={clip.pitch}
          onChange={(v) => update({ pitch: v })}
          min={-24}
          max={24}
          step={1}
          size={52}
          label="Pitch"
          unit="st"
          resetTo={0}
          bipolar
          format={(v) => (v > 0 ? `+${v}` : String(v))}
        />
        <Knob
          value={clip.speed}
          onChange={(v) => update({ speed: v })}
          min={0.25}
          max={4}
          step={0.01}
          size={52}
          label="Speed"
          unit="×"
          resetTo={1}
          accent="var(--cyan)"
          format={(v) => v.toFixed(2)}
        />
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Field label="Fade in" className="grow">
          <NumDrag value={clip.fadeIn} onChange={(v) => update({ fadeIn: v })} min={0} max={clip.duration} step={0.01} unit="s" />
        </Field>
        <Field label="Fade out" className="grow">
          <NumDrag value={clip.fadeOut} onChange={(v) => update({ fadeOut: v })} min={0} max={clip.duration} step={0.01} unit="s" />
        </Field>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Field label="Offset" className="grow">
          <NumDrag
            value={clip.offset}
            onChange={(v) => update({ offset: Math.max(0, Math.min((rec?.duration ?? 0) - 0.02, v)) })}
            min={0}
            max={rec?.duration ?? 0}
            step={0.001}
            unit="s"
          />
        </Field>
        <Field label="Length" className="grow">
          <NumDrag
            value={clip.duration}
            onChange={(v) => update({ duration: Math.max(0.02, v) })}
            min={0.02}
            max={Math.max(0.02, (rec?.duration ?? 1) * 4)}
            step={0.001}
            unit="s"
          />
        </Field>
      </div>

      <Divider />

      <div className="row row--wrap" style={{ gap: 6 }}>
        <Btn icon="pitchShift" size="sm" variant="ghost" onClick={() => transport.audition(clip, s.tracks.find((t) => t.id === clip.trackId))}>
          Audition
        </Btn>
        <Btn icon="sparkle" size="sm" variant="ghost" onClick={applyNormalize} disabled={!rec}>
          Normalise
        </Btn>
        <Btn icon="trend" size="sm" variant="ghost" onClick={() => applyFade('in')}>
          +Fade in
        </Btn>
        <Btn icon="trend" size="sm" variant="ghost" onClick={() => applyFade('out')}>
          +Fade out
        </Btn>
        <Btn icon="save" size="sm" variant="ghost" onClick={bakeFades} disabled={!rec || (!clip.fadeIn && !clip.fadeOut)}>
          Print fades
        </Btn>
        <Btn
          icon="download"
          size="sm"
          variant="ghost"
          disabled={!rec}
          onClick={() => {
            if (!rec) return;
            const url = URL.createObjectURL(audioBufferToWavBlob(rec.buffer, 24));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${rec.name}.wav`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Save clip
        </Btn>
      </div>

      <div className="row row--wrap" style={{ gap: 6 }}>
        <Btn
          icon="copy"
          size="sm"
          variant="ghost"
          onClick={() => useDaw.getState().duplicateClips(s.selection.length ? s.selection : [clip.id])}
        >
          Duplicate
        </Btn>
        <Btn
          icon="scissors"
          size="sm"
          variant="ghost"
          onClick={() => useDaw.getState().splitClips(s.selection.length ? s.selection : [clip.id], s.position)}
        >
          Split @ playhead
        </Btn>
        <Btn icon="speakerOff" size="sm" variant={clip.muted ? 'primary' : 'ghost'} onClick={() => update({ muted: !clip.muted })}>
          {clip.muted ? 'Unmute' : 'Mute'}
        </Btn>
        <Btn
          icon="trash"
          size="sm"
          variant="danger"
          onClick={() => useDaw.getState().removeClips(s.selection.length ? s.selection : [clip.id])}
        >
          Delete
        </Btn>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TRACK
   ══════════════════════════════════════════════════════════════════════════ */

const PALETTE = ['#c70f28', '#ffae1a', '#22e07c', '#1fd0e6', '#2e86ff', '#8a6bff', '#ff3dce', '#7fe3ff', '#ff7a1a', '#9be36a'];

function TrackTab({ trackId }: { trackId: string }) {
  const track = useDaw((s) => s.tracks.find((t) => t.id === trackId));
  // NOTE: the selector must return a stable reference. Selecting the clips
  // array and filtering in a memo — rather than filtering inside the selector —
  // is what keeps useSyncExternalStore from re-rendering forever.
  const allClips = useDaw((s) => s.clips);
  const clips = useMemo(() => allClips.filter((c) => c.trackId === trackId), [allClips, trackId]);
  const update = useDaw((s) => s.updateTrack);
  if (!track) return <Empty icon="layers">Track removed</Empty>;

  const total = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);

  return (
    <>
      <div className="row">
        <Icon name="layers" size={14} />
        <input className="input grow" value={track.name} onChange={(e) => update(trackId, { name: e.target.value })} aria-label="Track name" />
        <Btn icon="chevronUp" size="sm" variant="ghost" onClick={() => useDaw.getState().reorderTrack(trackId, -1)} aria-label="Move up" />
        <Btn icon="chevronDown" size="sm" variant="ghost" onClick={() => useDaw.getState().reorderTrack(trackId, 1)} aria-label="Move down" />
      </div>

      <Field label="Colour" icon="sparkle">
        <div className="row row--wrap" style={{ gap: 5 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => update(trackId, { color: c })}
              style={{
                width: 20,
                height: 20,
                borderRadius: 'var(--r-sm)',
                background: c,
                border: track.color === c ? '2px solid #fff' : '1px solid rgba(0,0,0,.7)',
                boxShadow: track.color === c ? `0 0 10px ${c}` : 'none',
                transition: 'border-radius var(--t-base) var(--ease-snap), box-shadow var(--t-base) var(--ease-out)',
              }}
            />
          ))}
        </div>
      </Field>

      <div className="insp__grid">
        <Knob
          value={track.volume}
          onChange={(v) => update(trackId, { volume: v })}
          min={0}
          max={1.4}
          step={0.005}
          size={56}
          label="Level"
          unit="dB"
          resetTo={0.85}
          format={(v) => (v <= 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1))}
        />
        <Knob
          value={track.pan}
          onChange={(v) => update(trackId, { pan: v })}
          min={-1}
          max={1}
          step={0.01}
          size={56}
          label="Pan"
          bipolar
          resetTo={0}
          accent="var(--cyan)"
          format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        />
        <Knob
          value={track.pitch}
          onChange={(v) => update(trackId, { pitch: v })}
          min={-24}
          max={24}
          step={1}
          size={56}
          label="Pitch"
          unit="st"
          bipolar
          resetTo={0}
          format={(v) => (v > 0 ? `+${v}` : String(v))}
        />
        <Knob
          value={track.speed}
          onChange={(v) => update(trackId, { speed: v })}
          min={0.25}
          max={4}
          step={0.01}
          size={56}
          label="Speed"
          unit="×"
          resetTo={1}
          accent="var(--amber)"
          format={(v) => v.toFixed(2)}
        />
      </div>

      <ToggleRow label="Mute" icon="speakerOff" on={track.mute} onChange={(v) => update(trackId, { mute: v })} />
      <ToggleRow label="Solo" icon="headphones" on={track.solo} onChange={(v) => update(trackId, { solo: v })} />
      <ToggleRow label="Record arm" icon="record" on={track.armed} onChange={(v) => update(trackId, { armed: v })} />
      <ToggleRow
        label="EQ active"
        icon="eq"
        hint="Four-band parametric, pre-pan"
        on={track.eqOn}
        onChange={(v) => update(trackId, { eqOn: v })}
      />
      <ToggleRow
        label="Input monitor"
        icon="mic"
        hint="Hear the live input through this track"
        on={track.inputMonitor}
        onChange={(v) => update(trackId, { inputMonitor: v })}
      />

      <Well className="col" style={{ gap: 3 }}>
        <div className="kv">
          <span className="kv__k">Clips</span>
          <span className="kv__v">{clips.length}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Content length</span>
          <span className="kv__v">{total.toFixed(2)} s</span>
        </div>
        <div className="kv">
          <span className="kv__k">Strip height</span>
          <span className="kv__v">{track.height} px</span>
        </div>
      </Well>

      <Field label="Strip height" icon="layers">
        <input
          className="range"
          type="range"
          min={46}
          max={190}
          step={2}
          value={track.height}
          onChange={(e) => update(trackId, { height: Number(e.target.value) })}
        />
      </Field>

      <Btn
        icon="trash"
        variant="danger"
        size="sm"
        onClick={() => {
          const orphans = useDaw.getState().removeTrack(trackId);
          orphans.forEach((b) => buffers.remove(b, []));
        }}
      >
        Delete track
      </Btn>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PARAMETRIC EQ
   ══════════════════════════════════════════════════════════════════════════ */

const F_MIN = 20;
const F_MAX = 20000;
const DB_RANGE = 18;

function eqResponse(bands: EqBand[], freqs: number[], sr: number): number[] {
  return freqs.map((f) => {
    const w = (2 * Math.PI * f) / sr;
    const cosw = Math.cos(w);
    const sinw = Math.sin(w);
    let total = 0;
    for (const b of bands) {
      if (!b.on || b.gain === 0) continue;
      const A = Math.pow(10, b.gain / 40);
      const w0 = (2 * Math.PI * b.freq) / sr;
      const alpha = Math.sin(w0) / (2 * Math.max(0.05, b.q));
      const cosw0 = Math.cos(w0);
      let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
      if (b.type === 'peaking') {
        b0 = 1 + alpha * A;
        b1 = -2 * cosw0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw0;
        a2 = 1 - alpha / A;
      } else if (b.type === 'lowshelf') {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cosw0 + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
        b2 = A * (A + 1 - (A - 1) * cosw0 - s);
        a0 = A + 1 + (A - 1) * cosw0 + s;
        a1 = -2 * (A - 1 + (A + 1) * cosw0);
        a2 = A + 1 + (A - 1) * cosw0 - s;
      } else {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cosw0 + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
        b2 = A * (A + 1 + (A - 1) * cosw0 - s);
        a0 = A + 1 - (A - 1) * cosw0 + s;
        a1 = 2 * (A - 1 - (A + 1) * cosw0);
        a2 = A + 1 - (A - 1) * cosw0 - s;
      }
      const numRe = b0 + b1 * cosw + b2 * Math.cos(2 * w);
      const numIm = -(b1 * sinw + b2 * Math.sin(2 * w));
      const denRe = a0 + a1 * cosw + a2 * Math.cos(2 * w);
      const denIm = -(a1 * sinw + a2 * Math.sin(2 * w));
      const mag = Math.sqrt(numRe * numRe + numIm * numIm) / Math.max(1e-9, Math.sqrt(denRe * denRe + denIm * denIm));
      total += 20 * Math.log10(Math.max(1e-6, mag));
    }
    return total;
  });
}

function EqTab({ trackId }: { trackId: string }) {
  const track = useDaw((s) => s.tracks.find((t) => t.id === trackId));
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragBand, setDragBand] = useState<number | null>(null);

  const W = 300;
  const H = 150;
  const freqs = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < 180; i++) out.push(F_MIN * Math.pow(F_MAX / F_MIN, i / 179));
    return out;
  }, []);
  const bands = track?.eq ?? EMPTY_BANDS;
  const resp = useMemo(() => eqResponse(bands, freqs, 48000), [bands, freqs]);

  const update = (bandId: string, patch: Partial<EqBand>) =>
    useDaw.setState((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, eq: t.eq.map((b) => (b.id === bandId ? { ...b, ...patch } : b)) } : t,
      ),
    }));

  const onPointer = useCallback(
    (e: React.PointerEvent) => {
      if (dragBand === null) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      const f = F_MIN * Math.pow(F_MAX / F_MIN, Math.max(0, Math.min(1, px / W)));
      const db = Math.max(-DB_RANGE, Math.min(DB_RANGE, ((H / 2 - py) / (H / 2 - 6)) * DB_RANGE));
      const band = bands[dragBand];
      if (band) update(band.id, { freq: Math.round(f), gain: Number(db.toFixed(1)), on: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragBand, bands],
  );

  if (!track) return <Empty icon="eq">Track removed</Empty>;

  const fx = (f: number) => (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * W;
  const fy = (db: number) => H / 2 - (db / DB_RANGE) * (H / 2 - 6);
  const path = resp
    .map((db, i) => `${i ? 'L' : 'M'}${fx(freqs[i]).toFixed(1)} ${fy(Math.max(-DB_RANGE, Math.min(DB_RANGE, db))).toFixed(1)}`)
    .join(' ');

  return (
    <>
      <div className="row">
        <span className="t-label">Parametric</span>
        <span className="panel__spacer" />
        <Chip tone={track.eqOn ? 'green' : 'default'}>{track.eqOn ? 'ACTIVE' : 'BYPASS'}</Chip>
      </div>

      <div className="eqgrab">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
          onPointerMove={onPointer}
          onPointerUp={() => setDragBand(null)}
          onPointerLeave={() => setDragBand(null)}
        >
          <defs>
            <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(34,224,124,.35)" />
              <stop offset="50%" stopColor="rgba(34,224,124,.05)" />
              <stop offset="100%" stopColor="rgba(34,224,124,0)" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={fx(F_MIN * Math.pow(F_MAX / F_MIN, f))} y1={0} x2={fx(F_MIN * Math.pow(F_MAX / F_MIN, f))} y2={H} stroke="rgba(190,210,225,.08)" />
          ))}
          {[-12, -6, 6, 12].map((d) => (
            <line key={d} x1={0} y1={fy(d)} x2={W} y2={fy(d)} stroke="rgba(190,210,225,.07)" />
          ))}
          <line x1={0} y1={fy(0)} x2={W} y2={fy(0)} stroke="rgba(190,210,225,.24)" />
          <path d={`${path} L${W} ${H / 2} L0 ${H / 2} Z`} fill="url(#eqfill)" />
          <path d={path} fill="none" stroke={track.eqOn ? 'var(--green)' : 'var(--alu-600)'} strokeWidth={1.6} style={track.eqOn ? { filter: 'drop-shadow(0 0 5px rgba(34,224,124,.7))' } : undefined} />
          {track.eq.map((b, i) =>
            b.on ? (
              <g key={b.id} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragBand(i); }} style={{ cursor: 'grab' }}>
                <circle cx={fx(b.freq)} cy={fy(b.gain)} r={8} fill="transparent" />
                <circle cx={fx(b.freq)} cy={fy(b.gain)} r={4.4} fill={EQ_COLORS[i % EQ_COLORS.length]} stroke="#04070a" strokeWidth={1.4} />
              </g>
            ) : null,
          )}
        </svg>
        <span className="eqgrab__hint">DRAG NODES · 20Hz–20kHz</span>
      </div>

      <div className="bandlist">
        {track.eq.map((b, i) => (
          <div className="bandrow" key={b.id} data-on={b.on}>
            <button
              type="button"
              className="bandrow__dot"
              aria-label={`Toggle band ${i + 1}`}
              style={{ background: b.on ? EQ_COLORS[i % EQ_COLORS.length] : 'transparent', boxShadow: b.on ? `0 0 8px ${EQ_COLORS[i % EQ_COLORS.length]}` : 'none' }}
              onClick={() => update(b.id, { on: !b.on })}
            />
            <select
              className="input"
              style={{ height: 22, padding: '0 4px', fontSize: 10 }}
              value={b.type}
              onChange={(e) => update(b.id, { type: e.target.value as EqBandType })}
              aria-label={`Band ${i + 1} type`}
            >
              <option value="lowshelf">LO SH</option>
              <option value="peaking">PEAK</option>
              <option value="highshelf">HI SH</option>
            </select>
            <NumDrag value={b.freq} onChange={(v) => update(b.id, { freq: v })} min={20} max={20000} step={10} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}k` : String(Math.round(v)))} />
            <NumDrag value={b.gain} onChange={(v) => update(b.id, { gain: v })} min={-DB_RANGE} max={DB_RANGE} step={0.1} unit="dB" format={(v) => v.toFixed(1)} />
            <NumDrag value={b.q} onChange={(v) => update(b.id, { q: v })} min={0.2} max={12} step={0.05} format={(v) => v.toFixed(2)} />
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <Btn
          size="sm"
          variant="ghost"
          icon="refresh"
          onClick={() =>
            useDaw.setState((s) => ({
              tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, eq: t.eq.map((b) => ({ ...b, gain: 0 })) } : t)),
            }))
          }
        >
          Flatten
        </Btn>
        <Btn size="sm" variant={track.eqOn ? 'primary' : 'ghost'} icon="eq" onClick={() => useDaw.getState().updateTrack(trackId, { eqOn: !track.eqOn })}>
          {track.eqOn ? 'EQ on' : 'EQ off'}
        </Btn>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SESSION
   ══════════════════════════════════════════════════════════════════════════ */

function SessionTab({ onExport }: { onExport: () => void }) {
  const s = useDaw();
  const toast = useToast();
  const totalBytes = buffers.totalBytes();
  const dur = s.projectDuration();

  return (
    <>
      <Field label="Session name" icon="save">
        <input className="input" value={s.projectName} onChange={(e) => s.setProject({ projectName: e.target.value })} />
      </Field>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Field label="Tempo" icon="bpm" className="grow">
          <NumDrag value={s.bpm} onChange={(v) => s.setProject({ bpm: v })} min={20} max={400} unit="BPM" />
        </Field>
        <Field label="Signature" icon="grid" className="grow">
          <div className="row" style={{ gap: 4 }}>
            <NumDrag value={s.numerator} onChange={(v) => s.setProject({ numerator: v })} min={1} max={16} />
            <span className="t-readout">/</span>
            <Segmented
              value={s.denominator}
              onChange={(v) => s.setProject({ denominator: v })}
              options={[
                { value: 2, label: '2' },
                { value: 4, label: '4' },
                { value: 8, label: '8' },
              ]}
            />
          </div>
        </Field>
      </div>

      <Field label="Grid division" icon="magnet" hint="Snap resolution in note values per beat">
        <Segmented
          value={s.view.gridDivision}
          onChange={(v) => s.setView({ gridDivision: v })}
          options={[
            { value: 1, label: '1/1' },
            { value: 2, label: '1/2' },
            { value: 4, label: '1/4' },
            { value: 8, label: '1/8' },
            { value: 16, label: '1/16' },
          ]}
        />
      </Field>

      <Well className="col" style={{ gap: 3 }}>
        <div className="kv">
          <span className="kv__k">Tracks / clips</span>
          <span className="kv__v">
            {s.tracks.length} / {s.clips.length}
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">Project length</span>
          <span className="kv__v">{dur.toFixed(2)} s</span>
        </div>
        <div className="kv">
          <span className="kv__k">Bars</span>
          <span className="kv__v">{((dur / (60 / s.bpm)) / s.numerator).toFixed(2)}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Audio in memory</span>
          <span className="kv__v">{(totalBytes / (1024 * 1024)).toFixed(1)} MB</span>
        </div>
        <div className="kv">
          <span className="kv__k">Loaded sources</span>
          <span className="kv__v">{buffers.all().length}</span>
        </div>
      </Well>

      <Divider />

      <Btn variant="primary" icon="download" block onClick={onExport} disabled={s.clips.length === 0}>
        Render &amp; export mixdown
      </Btn>
      <div className="row" style={{ gap: 6 }}>
        <Btn
          size="sm"
          variant="ghost"
          icon="refresh"
          className="grow"
          onClick={() => {
            s.newProject();
            toast('New session created', 'ok');
          }}
        >
          New
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          icon="layersStack"
          className="grow"
          onClick={() => {
            buffers.clearPitchCache();
            toast('Pitch cache cleared', 'ok');
          }}
        >
          Flush cache
        </Btn>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Btn
          size="sm"
          variant="ghost"
          icon="undo"
          className="grow"
          disabled={!s.canUndo()}
          onClick={() => s.undo()}
        >
          Undo
        </Btn>
        <Btn size="sm" variant="ghost" icon="redo" className="grow" disabled={!s.canRedo()} onClick={() => s.redo()}>
          Redo
        </Btn>
      </div>
      <p className="field__hint">
        Sessions persist automatically. Audio buffers are re-imported per session — drop your files again after a
        reload, or keep them open in the same tab.
      </p>
    </>
  );
}

/* Re-exported for the transport bar's icon needs. */
