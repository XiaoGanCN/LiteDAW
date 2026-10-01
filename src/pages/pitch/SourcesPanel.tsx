/* ============================================================================
   LiteDAW · PITCH PAGE — sound sources
   Built-in timbre multi-select (grouped by family) plus the user sample bay:
   drop target, file input, root-note editing and full library management.
   ========================================================================= */

import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { playSample, samples, type SampleEntry } from '../../audio/sampler';
import { INSTRUMENTS, type InstrumentId } from '../../audio/synth';
import { Btn, Chip, Field, IconBtn, Led, NumDrag, Panel, Well } from '../../components/ui/kit';
import { usePitch } from '../../state/pitch';
import { FAMILIES, fileSize, noteName, secs } from './shared';

export function SourcesPanel({ onToast }: { onToast: (text: string, tone?: 'info' | 'ok' | 'warn' | 'error') => void }) {
  const cfg = usePitch((s) => s.cfg);
  const setCfg = usePitch((s) => s.setCfg);
  const [, bump] = useState(0);
  const [hot, setHot] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    /* Only prune when the library actually changes — `samples.restore()` is
       asynchronous at boot and an eager prune would wipe the armed set. */
    const off = samples.subscribe(() => {
      bump((n) => n + 1);
      const ids = new Set(samples.entries.map((e) => e.id));
      const live = usePitch.getState().cfg.sampleIds.filter((id) => ids.has(id));
      if (live.length !== usePitch.getState().cfg.sampleIds.length) setCfg('sampleIds', live);
    });
    return () => {
      off();
    };
  }, [setCfg]);

  const toggleInstrument = (id: InstrumentId) => {
    const has = cfg.instruments.includes(id);
    setCfg('instruments', has ? cfg.instruments.filter((x) => x !== id) : [...cfg.instruments, id]);
  };

  const toggleSample = (id: string) => {
    const has = cfg.sampleIds.includes(id);
    setCfg('sampleIds', has ? cfg.sampleIds.filter((x) => x !== id) : [...cfg.sampleIds, id]);
  };

  const ingest = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    for (const f of files) {
      try {
        const entry = await samples.import(f);
        setCfg('sampleIds', [...usePitch.getState().cfg.sampleIds, entry.id]);
        onToast(
          entry.detectedHz > 0
            ? `${entry.name} · root ${noteName(entry.rootMidi)} (${entry.detectedHz.toFixed(1)} Hz)`
            : `${entry.name} imported · root defaulted to C4, set it manually`,
          entry.detectedHz > 0 ? 'ok' : 'warn',
        );
      } catch {
        onToast(`Could not decode ${f.name}`, 'error');
      }
    }
    setBusy(false);
  };

  return (
    <Panel
      variant="alu"
      icon="speaker"
      title="Sound Sources"
      tag={`${cfg.instruments.length} OSC · ${cfg.sampleIds.length} SMP`}
      actions={<Chip tone={cfg.instruments.length + cfg.sampleIds.length ? 'cyan' : 'red'}>{cfg.instruments.length + cfg.sampleIds.length ? 'ARMED' : 'EMPTY'}</Chip>}
    >
      <Field label="Built-in timbres" icon="piano" hint="A question picks one at random from the armed set.">
        <div className="col pt-srcs">
          {FAMILIES.map(({ family, items }) => (
            <div key={family} className="pt-fam">
              <span className="t-micro">{family}</span>
              <div className="row row--wrap pt-chips">
                {items.map((i) => {
                  const on = cfg.instruments.includes(i.id);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      className="chip pt-chip"
                      data-on={on}
                      aria-pressed={on}
                      title={i.character}
                      onClick={() => toggleInstrument(i.id)}
                    >
                      {i.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Field>

      <div className="row pt-srcbtns">
        <Btn size="sm" variant="ghost" icon="check" onClick={() => setCfg('instruments', INSTRUMENTS.map((i) => i.id))}>
          All
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          icon="pointer"
          onClick={() => setCfg('instruments', ['piano', 'sine'] as InstrumentId[])}
        >
          Piano + sine
        </Btn>
        <Btn size="sm" variant="ghost" icon="close" onClick={() => setCfg('instruments', [])}>
          None
        </Btn>
      </div>

      <Field
        label="Sample bay"
        icon="fileAudio"
        hint="Drop audio files — the root note is auto-detected and can be corrected."
      >
        <div
          className="pt-drop"
          data-hot={hot || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setHot(true);
          }}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHot(false);
            void ingest([...e.dataTransfer.files]);
          }}
        >
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept="audio/*"
            multiple
            onChange={(e) => {
              const list = e.target.files ? [...e.target.files] : [];
              e.target.value = '';
              void ingest(list);
            }}
          />
          <span className="pt-drop__ico" aria-hidden="true">
            {busy ? '···' : '⇣'}
          </span>
          <span className="pt-drop__txt">
            <b>{busy ? 'Decoding…' : 'Drop audio here'}</b>
            <em>wav · mp3 · ogg · flac · m4a</em>
          </span>
          <Btn size="sm" icon="upload" variant="alu" disabled={busy} onClick={() => fileRef.current?.click()}>
            Browse
          </Btn>
        </div>
      </Field>

      {samples.entries.length === 0 ? (
        <Well className="pt-nowell">
          <span className="t-micro">No user samples loaded</span>
        </Well>
      ) : (
        <ul className="pt-samps">
          {samples.entries.map((e) => (
            <SampleRow
              key={e.id}
              entry={e}
              armed={cfg.sampleIds.includes(e.id)}
              onToggle={() => toggleSample(e.id)}
              onRoot={(m) => samples.setRoot(e.id, m)}
              onDelete={() => {
                void samples.remove(e.id);
                setCfg('sampleIds', usePitch.getState().cfg.sampleIds.filter((x) => x !== e.id));
              }}
              onToast={onToast}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SampleRow({
  entry,
  armed,
  onToggle,
  onRoot,
  onDelete,
  onToast,
}: {
  entry: SampleEntry;
  armed: boolean;
  onToggle: () => void;
  onRoot: (midi: number) => void;
  onDelete: () => void;
  onToast: (text: string, tone?: 'info' | 'ok' | 'warn' | 'error') => void;
}) {
  const defaulted = entry.detectedHz <= 0 && entry.rootMidi === 60;

  const audition = async () => {
    try {
      const ctx = await engine.init();
      playSample(ctx, engine.bus('pitch'), entry, {
        midi: entry.rootMidi,
        when: ctx.currentTime + 0.02,
        duration: Math.min(2.2, entry.duration),
        velocity: 0.8,
      });
    } catch {
      onToast('Audio engine unavailable', 'error');
    }
  };

  return (
    <li className="pt-samp" data-armed={armed || undefined}>
      <div className="pt-samp__top">
        <button type="button" className="pt-samp__name marquee" onClick={onToggle} title={entry.name}>
          <Led on={armed} color={armed ? 'green' : 'cyan'} size="sm" />
          {entry.name}
        </button>
        <IconBtn icon="play" label="Audition" size="sm" variant="ghost" onClick={() => void audition()} />
        <IconBtn icon="trash" label="Delete sample" size="sm" variant="ghost" onClick={onDelete} />
      </div>
      <div className="pt-samp__meta">
        <span className="t-micro">{secs(entry.duration)}</span>
        <span className="t-micro">
          {(entry.sampleRate / 1000).toFixed(1)}k · {entry.channels}ch
        </span>
        <span className="t-micro">{entry.source}</span>
        {entry.buffer.length ? <span className="t-micro">{fileSize(entry.buffer.length * 4)}</span> : null}
      </div>
      <div className="row pt-samp__root">
        <span className="t-micro">Root</span>
        <NumDrag value={entry.rootMidi} min={12} max={108} step={1} onChange={onRoot} format={(v) => noteName(v)} width={92} />
        {entry.detectedHz > 0 ? (
          <Chip tone="green" icon="tuner">
            {entry.detectedHz.toFixed(1)} Hz
          </Chip>
        ) : (
          <Chip tone="amber" icon="alert">
            {defaulted ? 'Defaulted C4' : 'No pitch'}
          </Chip>
        )}
      </div>
    </li>
  );
}
