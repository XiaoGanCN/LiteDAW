/* ============================================================================
   LiteDAW · PITCH PAGE — live scope
   A dedicated analyser tap on the pitch bus so the trainee can *see* that
   sound is being produced even when they are not sure they heard it.
   ========================================================================= */

import { useEffect, useMemo, useRef, useState } from 'react';
import { engine, type MeterTap } from '../../audio/engine';
import { Meter } from '../../components/ui/Hardware';
import { Btn, Legend, Panel, Segmented } from '../../components/ui/kit';
import { SCOPE_THEMES, paintSpectrum, paintWaveform } from '../../audio/scopes';
import { currentFxLevel, useSettings } from '../../state/settings';

const FFT = 2048;
const BINS = FFT / 2;

type ScopeMode = 'wave' | 'fft';

export function ScopeStrip({ live, questionLabel }: { live: boolean; questionLabel: string }) {
  const themeId = useSettings((s) => s.scopeTheme);
  const fps = useSettings((s) => s.scopeFps);
  const [mode, setMode] = useState<ScopeMode>('wave');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tapRef = useRef<MeterTap | null>(null);
  const boxRef = useRef<{ w: number; h: number }>({ w: 300, h: 68 });

  const waveBuf = useMemo(() => new Float32Array(FFT), []);
  const freqBuf = useMemo(() => new Float32Array(BINS), []);
  const peakBuf = useMemo(() => new Float32Array(220), []);

  /* One tap for the lifetime of the page — created once the graph exists. */
  useEffect(() => {
    let alive = true;
    void engine
      .init()
      .then(() => {
        if (!alive) return;
        try {
          tapRef.current = engine.createTap('pitch-vis', engine.bus('pitch'), FFT);
        } catch {
          tapRef.current = null;
        }
      })
      .catch(() => {
        tapRef.current = null;
      });
    return () => {
      alive = false;
      tapRef.current = null;
      engine.releaseTap('pitch-vis');
    };
  }, []);

  /* Track the CSS box without reading layout inside the paint loop. */
  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      boxRef.current = { w: Math.max(40, el.clientWidth), h: Math.max(40, el.clientHeight) };
    });
    ro.observe(el);
    boxRef.current = { w: Math.max(40, el.clientWidth), h: Math.max(40, el.clientHeight) };
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = -1e9;
    const minGap = fps === 30 ? 1000 / 30 : 0;
    const theme = SCOPE_THEMES[themeId];

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < minGap) return;
      last = t;
      const c = canvasRef.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const { w, h } = boxRef.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const opts = { width: w, height: h, theme, fx: currentFxLevel() };
      const tap = tapRef.current;
      if (mode === 'fft') {
        if (tap) tap.node.getFloatFrequencyData(freqBuf);
        else freqBuf.fill(-140);
        paintSpectrum(g, freqBuf, engine.sampleRate, { ...opts, floorDb: -104, peaks: peakBuf, minHz: 40, maxHz: 12000 });
      } else {
        if (tap) tap.node.getFloatTimeDomainData(waveBuf);
        else waveBuf.fill(0);
        paintWaveform(g, waveBuf, { ...opts, scale: 1.7, trigger: true });
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fps, themeId, mode, waveBuf, freqBuf, peakBuf]);

  return (
    <Panel
      className="pt-scope"
      variant="alu"
      icon="waveform"
      title="Signal Monitor"
      tag="TAP · PITCH BUS"
      actions={
        <div className="row" style={{ gap: 8 }}>
          <Legend color={live ? 'green' : 'cyan'} size="sm">
            {live ? 'Live' : 'Armed'}
          </Legend>
          <Segmented<ScopeMode>
            value={mode}
            onChange={setMode}
            ariaLabel="Scope mode"
            options={[
              { value: 'wave', label: 'Wave', icon: 'waveform' },
              { value: 'fft', label: 'FFT', icon: 'spectrum' },
            ]}
          />
        </div>
      }
      bodyClassName="pt-scope__body"
      tight
    >
      <div className="pt-scope__grid">
        <div className="pt-scope__screen">
          <canvas ref={canvasRef} className="pt-scope__canvas" />
          <span className="pt-scope__frame" />
        </div>
        <div className="pt-scope__side">
          <span className="t-micro">Out</span>
          <Meter getLevel={masterLevel} orientation="v" length={54} thickness={7} />
          <span className="pt-scope__src marquee" title={questionLabel}>
            {questionLabel}
          </span>
          <Btn
            size="sm"
            variant="ghost"
            icon="refresh"
            aria-label="Reset peak hold"
            onClick={() => peakBuf.fill(0)}
          />
        </div>
      </div>
    </Panel>
  );
}

const masterLevel = () => engine.masterLevel();
