/* ============================================================================
   LiteDAW · MIXER
   One channel strip per track: fader, pan, meter, mute / solo / arm, plus a
   master strip fed from the engine's master tap.
   ========================================================================= */

import { useEffect, useRef } from 'react';
import { Icon } from '../../design/Icon';
import { Chip, Panel, Readout } from '../../components/ui/kit';
import { Fader, Knob } from '../../components/ui/Hardware';
import { engine } from '../../audio/engine';
import { useDaw } from '../../state/daw';

export function Mixer() {
  const tracks = useDaw((s) => s.tracks);
  const masterVolume = useDaw((s) => s.masterVolume);
  const selectedTrackId = useDaw((s) => s.view.selectedTrackId);
  const anySolo = tracks.some((t) => t.solo);
  const update = useDaw((s) => s.updateTrack);

  return (
    <Panel
      title="Mixer"
      icon="eq"
      tag={`${tracks.length} CH`}
      flush
      actions={
        <span className="row" style={{ gap: 5 }}>
          <Chip tone="cyan">{engine.sampleRate / 1000} kHz</Chip>
          {anySolo && <Chip tone="green" icon="headphones">SOLO</Chip>}
        </span>
      }
    >
      <div className="mixer">
        {tracks.map((t) => (
          <div
            key={t.id}
            className="chan"
            data-selected={selectedTrackId === t.id}
            style={{ ['--chan-color' as string]: t.color }}
            onPointerDown={() => useDaw.getState().setView({ selectedTrackId: t.id })}
          >
            <span className="chan__name" title={t.name}>
              {t.name}
            </span>
            <div className="chan__fader-row">
              <Fader
                value={t.volume}
                onChange={(v) => update(t.id, { volume: v })}
                min={0}
                max={1.4}
                height={104}
                width={26}
                resetTo={0.85}
                accent={t.color}
                label=""
              />
              <TrackMeter trackId={t.id} dim={anySolo ? !t.solo : t.mute} />
            </div>
            <Knob
              value={t.pan}
              onChange={(v) => update(t.id, { pan: v })}
              min={-1}
              max={1}
              step={0.01}
              size={34}
              bipolar
              resetTo={0}
              accent="var(--cyan)"
              format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
              label="pan"
            />
            <div className="chan__buttons">
              <button
                type="button"
                className="trk__btn"
                data-kind="mute"
                data-on={t.mute}
                title="Mute"
                onClick={() => update(t.id, { mute: !t.mute })}
              >
                M
              </button>
              <button
                type="button"
                className="trk__btn"
                data-kind="solo"
                data-on={t.solo}
                title="Solo"
                onClick={() => update(t.id, { solo: !t.solo })}
              >
                S
              </button>
              <button
                type="button"
                className="trk__btn"
                data-kind="arm"
                data-on={t.armed}
                title="Record arm"
                onClick={() => update(t.id, { armed: !t.armed })}
              >
                <Icon name="record" size={9} solid />
              </button>
            </div>
            <span className="t-micro" style={{ color: t.eqOn ? 'var(--green)' : 'var(--ink-ghost)' }}>
              {t.eqOn ? 'EQ ON' : 'EQ BYP'}
            </span>
          </div>
        ))}

        <div className="chan" style={{ ['--chan-color' as string]: 'var(--amber)', marginLeft: 'auto' }}>
          <span className="chan__name">MASTER</span>
          <div className="chan__fader-row">
            <Fader
              value={masterVolume}
              onChange={(v) => useDaw.getState().setTransport({ masterVolume: v })}
              min={0}
              max={1.4}
              height={104}
              width={30}
              resetTo={0.9}
              accent="var(--amber)"
              label=""
            />
            <MasterMeter />
          </div>
          <Readout value={masterVolume <= 0.001 ? '-∞' : (20 * Math.log10(masterVolume)).toFixed(1)} unit="dB" size="sm" tone="amber" />
        </div>
      </div>
    </Panel>
  );
}

function TrackMeter({ trackId, dim }: { trackId: string; dim: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    let peak = 0;
    let peakAt = 0;
    const tick = (t: number) => {
      const l = dim ? 0 : engine.level(`track:${trackId}`);
      smooth = l > smooth ? l * 0.6 + smooth * 0.4 : smooth * 0.88 + l * 0.12;
      if (smooth >= peak) {
        peak = smooth;
        peakAt = t;
      } else if (t - peakAt > 800) peak = Math.max(smooth, peak - 0.01);
      if (ref.current) ref.current.style.transform = `scaleY(${smooth.toFixed(4)})`;
      if (peakRef.current) peakRef.current.style.transform = `translateY(${(-peak * 104).toFixed(1)}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackId, dim]);
  return (
    <span className="meter meter--vert" style={{ width: 7, height: 104 }}>
      <span className="meter__fill" ref={ref} />
      <span className="meter__scale" />
      <span className="meter__peak" ref={peakRef} style={{ top: 'auto', bottom: 0, left: 0, right: 0, height: 2, width: 'auto' }} />
    </span>
  );
}

function MasterMeter() {
  const ref = useRef<HTMLSpanElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    let peak = 0;
    let peakAt = 0;
    const tick = (t: number) => {
      const l = engine.masterLevel();
      smooth = l > smooth ? l * 0.6 + smooth * 0.4 : smooth * 0.9 + l * 0.1;
      if (smooth >= peak) {
        peak = smooth;
        peakAt = t;
      } else if (t - peakAt > 900) peak = Math.max(smooth, peak - 0.008);
      if (ref.current) ref.current.style.transform = `scaleY(${smooth.toFixed(4)})`;
      if (peakRef.current) peakRef.current.style.transform = `translateY(${(-peak * 104).toFixed(1)}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="meter meter--vert" style={{ width: 9, height: 104 }}>
      <span className="meter__fill" ref={ref} />
      <span className="meter__scale" />
      <span className="meter__peak" ref={peakRef} style={{ top: 'auto', bottom: 0, left: 0, right: 0, height: 2, width: 'auto' }} />
    </span>
  );
}
