/* ============================================================================
   LiteDAW · APPLICATION SHELL
   Hash routing (so the same bundle runs from capacitor:// and file://),
   the navigation rail, the status bar and the settings bay.
   ========================================================================= */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { FxDefs, FxStack } from './design/Fx';
import { Icon, type IconName } from './design/Icon';
import { Btn, IconBtn, Legend, Led, Modal, Readout, Segmented, ToggleRow, ToastHost, useToast } from './components/ui/kit';
import { Knob } from './components/ui/Hardware';
import { engine } from './audio/engine';
import { samples } from './audio/sampler';
import { useSettings, type ScopeThemeId } from './state/settings';
import { ErrorBoundary } from './components/ErrorBoundary';

/* Route-level code splitting: the Studio (and with it the mediabunny codec
   stack) is only fetched when that module is actually opened, so the two ear
   trainers stay small and start instantly on a phone. */
const PitchPage = lazy(() => import('./pages/pitch/PitchPage').then((m) => ({ default: m.PitchPage })));
const BpmPage = lazy(() => import('./pages/bpm/BpmPage').then((m) => ({ default: m.BpmPage })));
const DawPage = lazy(() => import('./pages/daw/DawPage').then((m) => ({ default: m.DawPage })));

export type Route = 'pitch' | 'bpm' | 'daw';

const ROUTES: { id: Route; label: string; icon: IconName; sub: string; hash: string }[] = [
  { id: 'pitch', label: 'Pitch', icon: 'pitch', sub: 'EAR · PITCH DISCRIMINATION', hash: '#/pitch' },
  { id: 'bpm', label: 'Tempo', icon: 'bpm', sub: 'EAR · TEMPO ACQUISITION', hash: '#/bpm' },
  { id: 'daw', label: 'Studio', icon: 'daw', sub: 'MULTITRACK RECORDER', hash: '#/daw' },
];

function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES.find((r) => r.id === h)?.id ?? 'pitch') as Route;
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/pitch';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: Route) => {
    window.location.hash = ROUTES.find((x) => x.id === r)?.hash ?? '#/pitch';
  }, []);
  return [route, go];
}

/* ══════════════════════════════════════════════════════════════════════════
   STATUS BAR
   ══════════════════════════════════════════════════════════════════════════ */

function useEngineStatus() {
  const [running, setRunning] = useState(engine.running);
  const [sr, setSr] = useState(engine.sampleRate);
  useEffect(() => {
    const off = engine.onRunningChange((r) => {
      setRunning(r);
      setSr(engine.sampleRate);
    });
    const t = window.setInterval(() => {
      setRunning(engine.running);
      setSr(engine.sampleRate);
    }, 1200);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, []);
  return { running, sr };
}

/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS BAY
   ══════════════════════════════════════════════════════════════════════════ */

function SettingsBay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const { running, sr } = useEngineStatus();
  const [sampleCount, setSampleCount] = useState(samples.entries.length);
  useEffect(() => samples.subscribe(() => setSampleCount(samples.entries.length)), []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="System Configuration"
      icon="gear"
      wide
      footer={
        <>
          <Btn variant="ghost" icon="refresh" onClick={() => s.reset()}>
            Factory reset
          </Btn>
          <Btn variant="primary" icon="check" onClick={onClose}>
            Close
          </Btn>
        </>
      }
    >
      <div className="settings-grid">
        <section className="settings-block">
          <header className="settings-block__head">
            <Icon name="sparkle" size={13} />
            Artifact / Defect Layer
          </header>
          <p className="settings-block__note">
            The semi-realistic film: scanlines, sensor grain, lateral chroma bleed, lens vignette and
            phosphor bloom. Turning it off yields a perfectly flat, pristine panel.
          </p>
          <ToggleRow
            label="Defect layer"
            hint="Master switch for every optical imperfection"
            icon="eye"
            on={s.fxEnabled}
            onChange={(v) => s.set('fxEnabled', v)}
          />
          <div className={s.fxEnabled ? '' : 'dim'}>
            <div className="field" style={{ marginTop: 10 }}>
              <span className="field__label">
                <Icon name="activity" size={12} /> Intensity
              </span>
              <div className="row">
                <input
                  className="range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={s.fxIntensity}
                  disabled={!s.fxEnabled}
                  onChange={(e) => s.set('fxIntensity', Number(e.target.value))}
                />
                <Readout value={`${Math.round(s.fxIntensity * 100)}`} unit="%" size="sm" />
              </div>
            </div>
            <ToggleRow label="Scanlines" icon="grid" on={s.fxScanlines} onChange={(v) => s.set('fxScanlines', v)} disabled={!s.fxEnabled} />
            <ToggleRow label="Sensor grain" icon="spectrum" on={s.fxGrain} onChange={(v) => s.set('fxGrain', v)} disabled={!s.fxEnabled} />
            <ToggleRow label="Chroma bleed" icon="layers" on={s.fxChroma} onChange={(v) => s.set('fxChroma', v)} disabled={!s.fxEnabled} />
            <ToggleRow label="Vignette" icon="vectorscope" on={s.fxVignette} onChange={(v) => s.set('fxVignette', v)} disabled={!s.fxEnabled} />
          </div>
        </section>

        <section className="settings-block">
          <header className="settings-block__head">
            <Icon name="speaker" size={13} />
            Audio &amp; Display
          </header>
          <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
            <Knob
              value={s.masterVolume}
              onChange={(v) => {
                s.set('masterVolume', v);
                engine.setMasterVolume(v);
              }}
              min={0}
              max={1.2}
              step={0.01}
              size={62}
              label="Master"
              format={(v) => (v <= 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1))}
              unit="dB"
              resetTo={0.9}
            />
            <div className="col grow">
              <div className="field">
                <span className="field__label">
                  <Icon name="waveform" size={12} /> Scope theme
                </span>
                <Segmented<ScopeThemeId>
                  value={s.scopeTheme}
                  onChange={(v) => s.set('scopeTheme', v)}
                  options={[
                    { value: 'avionics', label: 'PFD' },
                    { value: 'aqua', label: 'Aero' },
                    { value: 'amber', label: 'Caution' },
                    { value: 'mono', label: 'Mono' },
                  ]}
                />
              </div>
              <div className="field">
                <span className="field__label">
                  <Icon name="activity" size={12} /> Motion
                </span>
                <Segmented
                  value={s.motion}
                  onChange={(v) => s.set('motion', v)}
                  options={[
                    { value: 'full', label: 'Full' },
                    { value: 'reduced', label: 'Reduced' },
                  ]}
                />
              </div>
              <div className="field">
                <span className="field__label">
                  <Icon name="layers" size={12} /> Layout density
                </span>
                <Segmented
                  value={s.density}
                  onChange={(v) => s.set('density', v)}
                  options={[
                    { value: 'comfortable', label: 'Comfort' },
                    { value: 'compact', label: 'Compact' },
                  ]}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-block settings-block--wide">
          <header className="settings-block__head">
            <Icon name="cpu" size={13} />
            System Status
          </header>
          <div className="status-matrix">
            <div className="status-cell">
              <span className="t-micro">Audio engine</span>
              <Legend color={running ? 'green' : 'amber'}>{running ? 'Running' : 'Suspended'}</Legend>
            </div>
            <div className="status-cell">
              <span className="t-micro">Sample rate</span>
              <Readout value={(sr / 1000).toFixed(1)} unit="kHz" size="sm" />
            </div>
            <div className="status-cell">
              <span className="t-micro">PCM capture</span>
              <Legend color={engine.hasWorklet ? 'green' : 'amber'}>{engine.hasWorklet ? 'Worklet' : 'Fallback'}</Legend>
            </div>
            <div className="status-cell">
              <span className="t-micro">User samples</span>
              <Readout value={sampleCount} unit="loaded" size="sm" tone="plain" />
            </div>
            <div className="status-cell">
              <span className="t-micro">Runtime</span>
              <Readout value={navigator.hardwareConcurrency ?? '—'} unit="cores" size="sm" tone="plain" />
            </div>
            <div className="status-cell">
              <span className="t-micro">Install state</span>
              <Legend color={window.matchMedia('(display-mode: standalone)').matches ? 'green' : 'cyan'}>
                {window.matchMedia('(display-mode: standalone)').matches ? 'Standalone' : 'Browser'}
              </Legend>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   RAIL
   ══════════════════════════════════════════════════════════════════════════ */

function Rail({ route, go, onSettings }: { route: Route; go: (r: Route) => void; onSettings: () => void }) {
  const { running } = useEngineStatus();
  return (
    <nav className="rail tex-bezel" aria-label="Modules">
      <div className="rail__mark" title="LiteDAW">
        <Icon name="logo" size={24} />
      </div>
      <div className="rail__nav">
        {ROUTES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="navbtn"
            data-on={route === r.id}
            aria-current={route === r.id ? 'page' : undefined}
            onClick={() => go(r.id)}
          >
            <span className="navbtn__ico">
              <Icon name={r.icon} size={22} />
            </span>
            <span className="navbtn__label">{r.label}</span>
            <span className="navbtn__badge">
              <Led size="sm" color={route === r.id ? 'red' : 'cyan'} on={route === r.id ? true : running} />
            </span>
          </button>
        ))}
      </div>
      <div className="rail__foot">
        <IconBtn icon="gear" label="Settings" onClick={onSettings} />
      </div>
    </nav>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   APP
   ══════════════════════════════════════════════════════════════════════════ */

function TopBar({ route, onSettings }: { route: Route; onSettings: () => void }) {
  const { running, sr } = useEngineStatus();
  const s = useSettings();
  const meta = useMemo(() => ROUTES.find((r) => r.id === route)!, [route]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <header className="topbar tex-bezel">
      <div className="topbar__id">
        <span className="topbar__mark">
          LITE<em>DAW</em>
        </span>
        <span className="topbar__sub">{meta.sub}</span>
      </div>
      <span className="panel__spacer" />
      <div className="topbar__stat hide-xs">
        <Legend color={running ? 'green' : 'amber'} size="sm">
          {running ? 'Audio live' : 'Tap to arm'}
        </Legend>
      </div>
      <div className="topbar__stat hide-xs">
        <Readout value={(sr / 1000).toFixed(1)} unit="kHz" size="sm" tone="plain" />
      </div>
      <div className="topbar__stat hide-xs">
        <Readout value={clock.toTimeString().slice(0, 8)} size="sm" tone="plain" />
      </div>
      <div className="topbar__stat">
        <button
          type="button"
          className="rocker-inline"
          data-on={s.fxEnabled}
          onClick={() => s.set('fxEnabled', !s.fxEnabled)}
          title={s.fxEnabled ? 'Defect layer ON — click for pristine' : 'Pristine — click for defect layer'}
        >
          <Icon name="sparkle" size={13} />
          <span>{s.fxEnabled ? 'Defect' : 'Pristine'}</span>
        </button>
      </div>
      <IconBtn icon="gear" label="System configuration" onClick={onSettings} />
    </header>
  );
}

export function App() {
  const [route, go] = useHashRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ToastHost>
      <FxDefs />
      <div className="app">
        <Rail route={route} go={go} onSettings={() => setSettingsOpen(true)} />
        <div className="main">
          <TopBar route={route} onSettings={() => setSettingsOpen(true)} />
          <main className="page" key={route}>
            <ErrorBoundary resetKey={route} label={ROUTES.find((r) => r.id === route)?.label}>
              <Suspense fallback={<ModuleLoader label={ROUTES.find((r) => r.id === route)?.sub ?? ''} />}>
                {route === 'pitch' && <PitchPage />}
                {route === 'bpm' && <BpmPage />}
                {route === 'daw' && <DawPage />}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <FxStack />
      <SettingsBay open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ToastHost>
  );
}

/** Shown while a module chunk is in flight. */
function ModuleLoader({ label }: { label: string }) {
  return (
    <div className="pagegrid">
      <div className="pagegrid__main">
        <div className="module-loader">
          <Icon name="logo" size={34} />
          <span className="t-label" style={{ color: 'var(--alu-300)' }}>
            Loading module
          </span>
          <span className="t-micro">{label}</span>
          <span className="module-loader__bar">
            <i />
          </span>
        </div>
      </div>
      <div className="pagegrid__side" />
    </div>
  );
}

/** Internal helper so pages can raise a toast without importing the context. */
export function useAppToast() {
  return useToast();
}
