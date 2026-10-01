/* ============================================================================
   LiteDAW · SCOPES
   Spectrum, waveform and vector (goniometer) displays fed from the master bus.
   They can be docked into the lower deck or floated as a translucent overlay,
   and each one toggles independently.
   ========================================================================= */

import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { SCOPE_THEMES, paintSpectrum, paintVectorscope, paintWaveform } from '../../audio/scopes';
import { currentFxLevel, useSettings } from '../../state/settings';
import { useDaw } from '../../state/daw';
import { Panel, Segmented } from '../../components/ui/kit';
import { Knob } from '../../components/ui/Hardware';

/** Shared analyser bank: master + an L/R split for the goniometer. */
function useScopeAnalysers(enabled: boolean) {
  const ref = useRef<{
    master: AnalyserNode;
    left: AnalyserNode;
    right: AnalyserNode;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || ref.current) return;
    let cancelled = false;
    void engine.init().then((ctx) => {
      if (cancelled) return;
      const master = ctx.createAnalyser();
      master.fftSize = 4096;
      master.smoothingTimeConstant = 0.68;
      engine.masterIn.connect(master);

      const splitter = ctx.createChannelSplitter(2);
      engine.masterIn.connect(splitter);
      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      left.fftSize = 2048;
      right.fftSize = 2048;
      splitter.connect(left, 0);
      splitter.connect(right, 1);

      ref.current = { master, left, right };
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(
    () => () => {
      const r = ref.current;
      if (!r) return;
      try {
        r.master.disconnect();
        r.left.disconnect();
        r.right.disconnect();
      } catch {
        /* noop */
      }
      ref.current = null;
    },
    [],
  );

  return { analysers: ref.current, ready };
}

export function Scopes() {
  const scope = useDaw((s) => s.scope);
  const setScope = useDaw((s) => s.setScope);
  const themeId = useSettings((s) => s.scopeTheme);
  const theme = SCOPE_THEMES[themeId];
  const enabled = scope.spectrum || scope.wave || scope.vector;
  const { analysers, ready } = useScopeAnalysers(enabled);

  return (
    <Panel
      title="Instruments"
      icon="activity"
      tag={scope.docked ? 'DOCKED' : 'FLOATING'}
      flush
      actions={
        <span className="row" style={{ gap: 4 }}>
          <Segmented
            value={scope.docked ? 'dock' : 'float'}
            onChange={(v) => setScope({ docked: v === 'dock' })}
            options={[
              { value: 'dock', label: 'Dock' },
              { value: 'float', label: 'Float' },
            ]}
          />
        </span>
      }
    >
      <div className="row row--wrap" style={{ gap: 6, padding: 'var(--sp-2) var(--sp-2) 0' }}>
        <ToggleChip label="Spectrum" on={scope.spectrum} onClick={() => setScope({ spectrum: !scope.spectrum })} />
        <ToggleChip label="Wave" on={scope.wave} onClick={() => setScope({ wave: !scope.wave })} />
        <ToggleChip label="Vector" on={scope.vector} onClick={() => setScope({ vector: !scope.vector })} />
        <span className="panel__spacer" />
        <Knob
          value={scope.gain}
          onChange={(v) => setScope({ gain: v })}
          min={0.25}
          max={4}
          step={0.05}
          size={34}
          label="Zoom"
          accent="var(--cyan)"
          resetTo={1}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </div>
      <div className="scopes" data-docked={scope.docked} style={{ padding: 'var(--sp-2)' }}>
        {!enabled && (
          <div className="empty" style={{ padding: 'var(--sp-4)' }}>
            All instruments off
          </div>
        )}
        {scope.spectrum && <ScopeCanvas kind="spectrum" theme={theme} gain={scope.gain} analysers={ready ? analysers : null} />}
        {scope.wave && <ScopeCanvas kind="wave" theme={theme} gain={scope.gain} analysers={ready ? analysers : null} />}
        {scope.vector && <ScopeCanvas kind="vector" theme={theme} gain={scope.gain} analysers={ready ? analysers : null} />}
      </div>
    </Panel>
  );
}

function ToggleChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="chip"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        background: on ? 'rgba(199,15,40,.2)' : undefined,
        borderColor: on ? 'rgba(199,15,40,.5)' : undefined,
        color: on ? 'var(--red-hi)' : undefined,
        boxShadow: on ? 'var(--glow-red)' : undefined,
        transition: 'border-radius var(--t-base) var(--ease-snap), box-shadow var(--t-base) var(--ease-out)',
      }}
      aria-pressed={on}
    >
      <span
        className="led led--sm"
        style={{
          background: on ? 'radial-gradient(circle at 35% 30%, #fff, var(--red) 60%, #05070a)' : 'radial-gradient(circle at 35% 30%, #2a3238, #05070a)',
          boxShadow: on ? '0 0 8px var(--red)' : 'none',
        }}
      />
      {label}
    </button>
  );
}

type Analysers = { master: AnalyserNode; left: AnalyserNode; right: AnalyserNode } | null;

const SCOPE_HEIGHTS = { spectrum: 118, wave: 96, vector: 168 } as const;
const SCOPE_LABELS = { spectrum: 'FFT · 4096 · LOG', wave: 'TIME DOMAIN · TRIG', vector: 'GONIOMETER · M/S' } as const;

function ScopeCanvas({
  kind,
  theme,
  gain,
  analysers,
}: {
  kind: 'spectrum' | 'wave' | 'vector';
  theme: (typeof SCOPE_THEMES)[keyof typeof SCOPE_THEMES];
  gain: number;
  analysers: Analysers;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const h = SCOPE_HEIGHTS[kind];

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const freq = new Float32Array(2048);
    const wave = new Float32Array(4096);
    const l = new Float32Array(2048);
    const r = new Float32Array(2048);
    const scaled = new Float32Array(2048);
    const peaks = new Float32Array(360);

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth || 320;
      if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
        cv.width = Math.floor(w * dpr);
        cv.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const o = { width: w, height: h, theme, fx: currentFxLevel() };

      if (analysers) {
        if (kind === 'spectrum') {
          const n = Math.min(freq.length, analysers.master.frequencyBinCount);
          const view = freq.subarray(0, n);
          analysers.master.getFloatFrequencyData(view);
          paintSpectrum(ctx, view, engine.sampleRate, { ...o, floorDb: -96, peaks });
        } else if (kind === 'wave') {
          const n = Math.min(wave.length, analysers.master.fftSize);
          const view = wave.subarray(0, n);
          analysers.master.getFloatTimeDomainData(view);
          paintWaveform(ctx, view, { ...o, scale: gain });
        } else {
          const n = Math.min(l.length, analysers.left.fftSize);
          const lv = l.subarray(0, n);
          const rv = r.subarray(0, n);
          analysers.left.getFloatTimeDomainData(lv);
          analysers.right.getFloatTimeDomainData(rv);
          for (let i = 0; i < n; i++) scaled[i] = Math.max(-1.4, Math.min(1.4, lv[i] * gain));
          const lScaled = scaled.subarray(0, n);
          for (let i = 0; i < n; i++) scaled[i] = Math.max(-1.4, Math.min(1.4, rv[i] * gain));
          const rScaled = scaled.subarray(0, n);
          paintVectorscope(ctx, lScaled, rScaled, o);
        }
      } else {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(4,7,10,.9)';
        ctx.fillRect(0, 0, w, h);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analysers, gain, h, kind, theme]);

  return (
    <div className="scope">
      <canvas ref={ref} style={{ height: h }} />
      <span className="scope__badge">{SCOPE_LABELS[kind]}</span>
    </div>
  );
}
