/* ============================================================================
   LiteDAW · BPM TRAINER · DIAGNOSTICS
   The adaptive model, made visible: a twelve-bucket region chart of the
   configured range (that is exactly what `nextTarget()` samples from), a
   signed-error scatter of recent rounds and the session performance readouts.
   ========================================================================= */

import { Btn, Chip, Divider, Readout } from '../../components/ui/kit';
import { Icon } from '../../design/Icon';
import type { BpmConfig, BpmStats } from '../../state/bpm';

const REGIONS = 12;

export function DiagnosticsPanel({
  cfg,
  stats,
  accuracy,
  meanError,
  onResetSession,
  onResetModel,
}: {
  cfg: BpmConfig;
  stats: BpmStats;
  accuracy: number;
  meanError: number;
  onResetSession: () => void;
  onResetModel: () => void;
}) {
  const lo = Math.min(cfg.minBpm, cfg.maxBpm);
  const hi = Math.max(cfg.minBpm, cfg.maxBpm);
  const span = Math.max(1, hi - lo);
  const bucket = span / REGIONS;

  const means = stats.regions.map((r) => (r.seen ? r.errorSum / r.seen : 0));
  const peak = Math.max(6, ...means);

  const rows = stats.history.slice(-24);
  const maxAbs = Math.max(4, cfg.tolerance * 1.6, ...rows.map((r) => Math.abs(r.errorBpm)));
  const W = 268;
  const H = 92;
  const x = (i: number) => 14 + (i * (W - 26)) / Math.max(1, rows.length - 1);
  const y = (err: number) => H / 2 - (err / maxAbs) * (H / 2 - 10);

  const half = Math.floor(rows.length / 2);
  const meanOf = (xs: typeof rows) => (xs.length ? xs.reduce((a, r) => a + r.errorPct, 0) / xs.length : 0);
  const trend =
    rows.length < 4 ? 'collecting' : meanOf(rows.slice(half)) < meanOf(rows.slice(0, half)) * 0.92 ? 'improving' : meanOf(rows.slice(half)) > meanOf(rows.slice(0, half)) * 1.08 ? 'drifting' : 'steady';

  return (
    <div className="bpm-diag">
      <div className="bpm-diag__grid">
        <span className="bpm-diag__cell">
          <span className="t-micro">Accuracy</span>
          <Readout value={(accuracy * 100).toFixed(0)} unit="%" tone={accuracy >= 0.7 ? 'green' : accuracy >= 0.4 ? 'amber' : 'red'} size="lg" />
        </span>
        <span className="bpm-diag__cell">
          <span className="t-micro">Rounds</span>
          <Readout value={stats.rounds} unit="logged" size="lg" tone="plain" />
        </span>
        <span className="bpm-diag__cell">
          <span className="t-micro">Mean |error|</span>
          <Readout value={meanError.toFixed(1)} unit="%" size="lg" tone={meanError <= cfg.tolerance * 2 ? 'green' : 'amber'} />
        </span>
        <span className="bpm-diag__cell">
          <span className="t-micro">Best error</span>
          <Readout
            value={Number.isFinite(stats.bestErrorPct) ? stats.bestErrorPct.toFixed(2) : '—'}
            unit="%"
            size="lg"
            tone="cyan"
          />
        </span>
      </div>

      <Divider />

      <div className="field">
        <span className="field__label">
          <Icon name="spectrum" size={12} /> Region error model
        </span>
        <div className="bpm-regions" role="img" aria-label="Mean absolute error per BPM region">
          <span className="bpm-regions__tol" style={{ bottom: `${Math.min(96, (cfg.tolerance / peak) * 100)}%` }} />
          {stats.regions.map((r, i) => {
            const m = r.seen ? r.errorSum / r.seen : 0;
            const h = r.seen ? Math.max(4, (m / peak) * 100) : 0;
            const tone = !r.seen ? 'none' : m <= cfg.tolerance ? 'green' : m <= cfg.tolerance * 2.5 ? 'amber' : 'red';
            const a = Math.round(lo + i * bucket);
            const b = Math.round(lo + (i + 1) * bucket);
            return (
              <span key={i} className="bpm-region" title={`${a}–${b} BPM · ${r.seen} round${r.seen === 1 ? '' : 's'} · mean ${m.toFixed(1)}%`}>
                <i className="bpm-region__bar" data-tone={tone} style={{ height: `${h}%` }} />
                <i className="bpm-region__n">{r.seen || ''}</i>
              </span>
            );
          })}
        </div>
        <span className="bpm-axis">
          <span className="bpm-axis__ends">
            <span className="t-micro">{Math.round(lo)} BPM</span>
            <span className="t-micro">{Math.round(hi)} BPM</span>
          </span>
          <span className="t-micro bpm-axis__note">mean |error %| per bucket · weak buckets get re-asked</span>
        </span>
      </div>

      <div className="field">
        <span className="field__label">
          <Icon name="trend" size={12} /> Signed error trend
        </span>
        {rows.length ? (
          <svg className="bpm-scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signed error per round">
            <rect x={0} y={y(cfg.tolerance)} width={W} height={Math.max(1, y(-cfg.tolerance) - y(cfg.tolerance))} className="bpm-scatter__band" />
            <line x1={0} y1={y(0)} x2={W} y2={y(0)} className="bpm-scatter__zero" />
            <polyline
              className="bpm-scatter__line"
              points={rows.map((r, i) => `${x(i).toFixed(1)},${y(r.errorBpm).toFixed(1)}`).join(' ')}
            />
            {rows.map((r, i) => (
              <circle
                key={`${r.at}-${i}`}
                cx={x(i)}
                cy={y(r.errorBpm)}
                r={2.6}
                className="bpm-scatter__dot"
                data-tone={r.correct ? 'green' : Math.abs(r.errorBpm) <= cfg.tolerance * 2.5 ? 'amber' : 'red'}
              />
            ))}
          </svg>
        ) : (
          <span className="bpm-note t-hint">No rounds logged.</span>
        )}
        <span className="bpm-axis">
          <span className="bpm-axis__ends">
            <span className="t-micro">older</span>
            <span className="t-micro">newer</span>
          </span>
          <span className="t-micro bpm-axis__note">0 = dead on · ± = fast / slow</span>
        </span>
      </div>

      <div className="row">
        <Chip tone={trend === 'improving' ? 'green' : trend === 'drifting' ? 'red' : 'cyan'} icon="trend">
          {trend}
        </Chip>
        <span className="panel__spacer" />
        <Readout value={stats.correct} unit={`/${stats.rounds} correct`} size="sm" tone="plain" />
      </div>

      <Divider />

      <div className="row row--wrap">
        <Btn size="sm" variant="ghost" icon="refresh" onClick={onResetModel} disabled={!stats.rounds}>
          Reset model
        </Btn>
        <Btn size="sm" variant="danger" icon="trash" onClick={onResetSession} disabled={!stats.rounds}>
          Reset session
        </Btn>
      </div>
      <p className="bpm-note t-micro">
        Model reset keeps the log and clears the region weights · session reset clears everything.
      </p>
    </div>
  );
}
