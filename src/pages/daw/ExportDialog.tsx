/* ============================================================================
   LiteDAW · EXPORT BAY
   Offline render → encode → download, with full container / codec / bitrate /
   sample-rate / channel control and a live encode progress readout.
   ========================================================================= */

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../design/Icon';
import { Btn, Chip, Divider, Field, Modal, Readout, Segmented, ToggleRow, Well } from '../../components/ui/kit';
import { Knob } from '../../components/ui/Hardware';
import { peakOf, renderProject } from '../../audio/dawEngine';
import {
  BITRATES,
  CONTAINERS,
  SAMPLE_RATES,
  downloadAudioBuffer,
  formatBytes,
  probeCapabilities,
  type ExportFormat,
} from '../../audio/encode';
import { buffers } from '../../daw/buffers';
import { useDaw } from '../../state/daw';
import type { AudioCodec } from 'mediabunny';

type Phase = 'idle' | 'rendering' | 'encoding' | 'done' | 'error';

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useDaw();
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [codec, setCodec] = useState<AudioCodec>('pcm-s24');
  const [channels, setChannels] = useState<1 | 2>(2);
  const [sampleRate, setSampleRate] = useState(48000);
  const [bitrate, setBitrate] = useState(320);
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(24);
  const [normalize, setNormalize] = useState(false);
  const [rangeOnly, setRangeOnly] = useState(false);
  const [caps, setCaps] = useState<Record<string, AudioCodec[]> | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<{ bytes: number; name: string; peak: number } | null>(null);

  const spec = CONTAINERS.find((c) => c.id === format)!;
  const usableCodecs = useMemo(() => {
    const probe = caps?.[format];
    if (probe && probe.length) return spec.codecs.filter((c) => probe.includes(c.id)).length ? spec.codecs.filter((c) => probe.includes(c.id)) : spec.codecs;
    return spec.codecs;
  }, [caps, format, spec.codecs]);

  useEffect(() => {
    if (!open) return;
    void probeCapabilities().then(setCaps).catch(() => setCaps(null));
  }, [open]);

  /* Keep codec valid whenever the container changes. */
  useEffect(() => {
    const list = usableCodecs;
    if (!list.some((c) => c.id === codec)) {
      setCodec(list[0].id);
      if (list[0].id.startsWith('pcm-')) setBitDepth(list[0].id === 'pcm-s16' ? 16 : list[0].id === 'pcm-s24' ? 24 : 32);
    }
  }, [usableCodecs, codec]);

  const duration = project.projectDuration();
  const audioSeconds = rangeOnly && project.loopOn ? project.loopEnd - project.loopStart : duration;
  const estimated = spec.lossy ? (bitrate * 1000 * audioSeconds) / 8 : audioSeconds * sampleRate * channels * (bitDepth / 8) * (format === 'flac' ? 0.62 : 1);

  const run = async () => {
    try {
      setPhase('rendering');
      setProgress(0);
      setStatus('Rendering offline mix…');
      setResult(null);
      const rendered = await renderProject(project, {
        sampleRate,
        channels,
        tail: 0.4,
        range: rangeOnly && project.loopOn ? { start: project.loopStart, end: project.loopEnd } : undefined,
        onProgress: (r) => setProgress(r * 0.4),
      });

      if (normalize) {
        let peak = 0;
        for (let c = 0; c < rendered.numberOfChannels; c++) {
          const d = rendered.getChannelData(c);
          for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        }
        if (peak > 0.0001) {
          const g = 0.98 / peak;
          for (let c = 0; c < rendered.numberOfChannels; c++) {
            const d = rendered.getChannelData(c);
            for (let i = 0; i < d.length; i++) d[i] *= g;
          }
        }
      }

      const peak = peakOf(rendered);
      setPhase('encoding');
      setStatus('Encoding…');
      const res = await downloadAudioBuffer(rendered, {
        format,
        codec,
        channels,
        sampleRate,
        bitrate,
        bitDepth,
        onProgress: (p, r) => {
          setStatus(p);
          setProgress(0.4 + r * 0.6);
        },
      });
      setResult({ bytes: res.bytes, name: res.filename, peak });
      setPhase('done');
      setProgress(1);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const busy = phase === 'rendering' || phase === 'encoding';

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Render & Export"
      icon="download"
      wide
      footer={
        <>
          {phase === 'done' && result && <Chip tone="green" icon="check">{formatBytes(result.bytes)} written</Chip>}
          <Btn variant="ghost" icon="close" onClick={onClose} disabled={busy}>
            Close
          </Btn>
          <Btn variant="primary" icon="download" onClick={run} disabled={busy || project.clips.length === 0}>
            {busy ? 'Working…' : phase === 'done' ? 'Export again' : 'Render & download'}
          </Btn>
        </>
      }
    >
      <div className="exp__grid">
        <div className="exp__formats">
          <span className="field__label">
            <Icon name="fileAudio" size={12} /> Container
          </span>
          {CONTAINERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="fmt"
              data-on={c.id === format}
              onClick={() => setFormat(c.id)}
              disabled={busy}
            >
              <span className="col" style={{ gap: 1, alignItems: 'flex-start' }}>
                <span className="fmt__id">{c.label}</span>
                <span className="fmt__note">{c.note}</span>
              </span>
              <span className="fmt__ext">.{c.extension}</span>
            </button>
          ))}
        </div>

        <div className="col" style={{ gap: 'var(--sp-3)' }}>
          <Field label="Codec" icon="cpu" hint={caps === null ? 'probing device encoders…' : undefined}>
            <div className="row row--wrap" style={{ gap: 5 }}>
              {usableCodecs.map((c) => (
                <button
                  key={String(c.id)}
                  type="button"
                  className="chip"
                  aria-pressed={codec === c.id}
                  disabled={busy}
                  onClick={() => {
                    setCodec(c.id);
                    if (c.id === 'pcm-s16') setBitDepth(16);
                    if (c.id === 'pcm-s24') setBitDepth(24);
                    if (c.id === 'pcm-f32') setBitDepth(32);
                  }}
                  style={{
                    cursor: 'pointer',
                    background: codec === c.id ? 'rgba(199,15,40,.22)' : undefined,
                    borderColor: codec === c.id ? 'rgba(199,15,40,.55)' : undefined,
                    color: codec === c.id ? 'var(--red-hi)' : undefined,
                    boxShadow: codec === c.id ? 'var(--glow-red)' : undefined,
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Channels" icon="pan">
            <Segmented
              value={channels}
              onChange={(v) => setChannels(v)}
              options={[
                { value: 1, label: 'Mono' },
                { value: 2, label: 'Stereo' },
              ]}
            />
          </Field>

          <Field label="Sample rate" icon="waveform">
            <select className="input" value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))} disabled={busy}>
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r >= 1000 ? `${(r / 1000).toFixed(r % 1000 ? 1 : 0)} kHz` : `${r} Hz`}
                </option>
              ))}
            </select>
          </Field>

          {format === 'wav' ? (
            <Field label="Bit depth" icon="activity">
              <Segmented
                value={bitDepth}
                onChange={(v) => {
                  setBitDepth(v);
                  setCodec(v === 16 ? 'pcm-s16' : v === 24 ? 'pcm-s24' : 'pcm-f32');
                }}
                options={[
                  { value: 16, label: '16' },
                  { value: 24, label: '24' },
                  { value: 32, label: '32f' },
                ]}
              />
            </Field>
          ) : (
            <Field label="Bitrate" icon="activity">
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="range grow"
                  type="range"
                  min={0}
                  max={BITRATES.length - 1}
                  step={1}
                  value={Math.max(0, BITRATES.indexOf(bitrate))}
                  onChange={(e) => setBitrate(BITRATES[Number(e.target.value)])}
                  disabled={busy}
                />
                <Readout value={bitrate} unit="kbps" size="sm" />
              </div>
            </Field>
          )}

          <ToggleRow
            label="Normalise output"
            icon="trend"
            hint="Scale the mix so the loudest peak sits at −0.2 dBFS"
            on={normalize}
            onChange={setNormalize}
            disabled={busy}
          />
          <ToggleRow
            label="Loop region only"
            icon="loop"
            hint={project.loopOn ? 'Render just the active loop' : 'Enable a loop on the timeline first'}
            on={rangeOnly}
            onChange={setRangeOnly}
            disabled={busy || !project.loopOn}
          />
        </div>

        <div className="col" style={{ gap: 'var(--sp-2)' }}>
          <span className="field__label">
            <Icon name="info" size={12} /> Estimate
          </span>
          <Well className="col" style={{ gap: 3 }}>
            <div className="kv">
              <span className="kv__k">Length</span>
              <span className="kv__v">{audioSeconds.toFixed(2)} s</span>
            </div>
            <div className="kv">
              <span className="kv__k">Clips</span>
              <span className="kv__v">
                {project.clips.length} ({project.clips.filter((c) => c.muted).length} muted)
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">Sources</span>
              <span className="kv__v">{buffers.all().length}</span>
            </div>
            <div className="kv">
              <span className="kv__k">Bitrate</span>
              <span className="kv__v">{spec.lossy ? `${bitrate} kbps` : 'lossless'}</span>
            </div>
            <div className="kv">
              <span className="kv__k">Est. size</span>
              <span className="kv__v">{formatBytes(Math.max(1, estimated))}</span>
            </div>
          </Well>
          <div className="row" style={{ gap: 10 }}>
            <Knob
              value={project.masterVolume}
              onChange={(v) => project.setTransport({ masterVolume: v })}
              min={0}
              max={1.4}
              step={0.01}
              size={46}
              label="Master"
              unit="dB"
              resetTo={0.9}
              format={(v) => (v <= 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1))}
            />
            <p className="field__hint" style={{ margin: 0 }}>
              The master knob is baked into the render. Muted tracks are excluded; soloed tracks replace the mix.
            </p>
          </div>
        </div>
      </div>

      {(busy || phase === 'done' || phase === 'error') && (
        <>
          <Divider />
          <div className="col" style={{ gap: 6 }}>
            <div className="row">
              <Icon name={phase === 'error' ? 'alert' : phase === 'done' ? 'check' : 'hourglass'} size={13} />
              <span className="t-label" style={{ color: phase === 'error' ? 'var(--red-hi)' : 'var(--alu-300)' }}>
                {phase === 'error' ? 'Export failed' : status}
              </span>
              <span className="panel__spacer" />
              <Readout value={Math.round(progress * 100)} unit="%" size="sm" tone={phase === 'error' ? 'red' : 'cyan'} />
            </div>
            <div className="exp__bar">
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            {phase === 'error' && <span className="field__hint">{status}</span>}
            {phase === 'done' && result && (
              <div className="row row--wrap" style={{ gap: 6 }}>
                <Chip tone="cyan" icon="fileAudio">
                  {result.name}
                </Chip>
                <Chip tone={result.peak > 0.999 ? 'amber' : 'green'}>
                  peak {result.peak <= 0.0001 ? '-∞' : (20 * Math.log10(result.peak)).toFixed(1)} dBFS
                </Chip>
                {result.peak > 0.999 && <Chip tone="amber" icon="alert">clipping — consider normalising</Chip>}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
