/* ============================================================================
   LiteDAW · BPM TRAINER · DEBRIEF
   Everything the player sees after LOCK IN: the true tempo, their answer, the
   delta, a verdict chip, the Italian tempo marking, a needle gauge that sweeps
   from their guess to the truth, and the rolling round history.
   ========================================================================= */

import { useEffect, useState } from 'react';
import { Chip, Divider, Readout } from '../../components/ui/kit';
import { Icon } from '../../design/Icon';
import { tempoMark, type BpmConfig, type BpmRound } from '../../state/bpm';

export type Verdict = 'correct' | 'close' | 'off';

export const verdictOf = (r: BpmRound, tolerance: number): Verdict =>
  r.correct || Math.abs(r.errorBpm) <= tolerance
    ? 'correct'
    : Math.abs(r.errorBpm) <= tolerance * 2.5
      ? 'close'
      : 'off';

export const VERDICT_LABEL: Record<Verdict, string> = {
  correct: 'Correct',
  close: 'Close',
  off: 'Off target',
};

const signed = (v: number, digits = 0) => `${v > 0 ? '+' : v < 0 ? '-' : '±'}${Math.abs(v).toFixed(digits)}`;
/** Percent error keeps the direction of the BPM error. */
const signedPct = (errorBpm: number, pct: number) =>
  `${errorBpm > 0 ? '+' : errorBpm < 0 ? '-' : '±'}${pct.toFixed(1)}`;

/* ══════════════════════════════════════════════════════════════════════════
   NEEDLE GAUGE — the answer and the target inside the configured range
   ══════════════════════════════════════════════════════════════════════════ */

function Gauge({ target, answer, cfg, tolerance }: { target: number; answer: number; cfg: BpmConfig; tolerance: number }) {
  const lo = Math.min(cfg.minBpm, cfg.maxBpm);
  const hi = Math.max(cfg.minBpm, cfg.maxBpm);
  const span = Math.max(1, hi - lo);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));

  const tp = pct(target);
  const ap = pct(answer);
  const bandLo = pct(target - tolerance);
  const bandHi = pct(target + tolerance);

  /* The needle is released a beat after mount so it visibly sweeps. */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const t = window.setTimeout(() => setArmed(true), 90);
    return () => window.clearTimeout(t);
  }, [target, answer]);

  const grads = Array.from({ length: 9 }, (_, i) => lo + (span * i) / 8);

  return (
    <div className="bpm-gauge">
      <div className="bpm-gauge__scale">
        <span className="bpm-gauge__band" style={{ left: `${bandLo}%`, width: `${Math.max(1.2, bandHi - bandLo)}%` }} />
        <span className="bpm-gauge__track" />
        <span className="bpm-gauge__mark bpm-gauge__mark--answer" style={{ left: `${ap}%` }} />
        <span className="bpm-gauge__mark bpm-gauge__mark--target" style={{ left: `${tp}%` }} />
        <span className="bpm-gauge__needle" style={{ left: `${armed ? tp : ap}%` }} />
      </div>
      <div className="bpm-gauge__scale-x">
        {grads.map((g, i) => (
          <span key={i} className="bpm-gauge__grad t-micro">
            {Math.round(g)}
          </span>
        ))}
      </div>
      <div className="bpm-gauge__key">
        <span className="bpm-gauge__key-item">
          <i className="bpm-key bpm-key--answer" /> Your answer <b className="t-readout">{answer}</b>
        </span>
        <span className="bpm-gauge__key-item">
          <i className="bpm-key bpm-key--target" /> Target <b className="t-readout">{target}</b>
        </span>
        <span className="bpm-gauge__key-item">
          <i className="bpm-key bpm-key--band" /> ±{tolerance} BPM
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   HISTORY — the last rounds, colour coded, staggered in
   ══════════════════════════════════════════════════════════════════════════ */

export function HistoryList({
  history,
  rounds,
  tolerance,
  limit = 12,
}: {
  history: BpmRound[];
  rounds: number;
  tolerance: number;
  limit?: number;
}) {
  if (!history.length) {
    return <p className="bpm-note t-hint">No rounds logged yet — every LOCK IN lands here.</p>;
  }
  const rows = history.slice(-limit).reverse();
  return (
    <ol className="bpm-history">
      <li className="bpm-history__row bpm-history__row--head" aria-hidden="true">
        <span className="t-micro">#</span>
        <span className="t-micro">Target</span>
        <span className="t-micro" />
        <span className="t-micro">You</span>
        <span className="t-micro">Δ BPM</span>
        <span className="t-micro">Δ %</span>
      </li>
      {rows.map((r, i) => {
        const v = verdictOf(r, tolerance);
        return (
          <li
            key={`${r.at}-${i}`}
            className="bpm-history__row"
            data-tone={v}
            style={{ animationDelay: `${i * 26}ms` }}
          >
            <span className="bpm-history__idx t-readout">{Math.max(1, rounds - i)}</span>
            <span className="bpm-history__val t-readout">{r.target}</span>
            <span className="bpm-history__arrow">
              <Icon name="chevronRight" size={10} />
            </span>
            <span className="bpm-history__val bpm-history__val--ans t-readout">{r.answer}</span>
            <span className="bpm-history__err t-readout">{signed(r.errorBpm)}</span>
            <span className="bpm-history__err t-readout">{r.errorPct.toFixed(1)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   REVEAL PANEL
   ══════════════════════════════════════════════════════════════════════════ */

export function RevealPanel({
  round,
  cfg,
  history,
  rounds,
  bestMs,
  meanMs,
}: {
  round: BpmRound | null;
  cfg: BpmConfig;
  history: BpmRound[];
  rounds: number;
  bestMs: number;
  meanMs: number;
}) {
  if (!round) {
    return (
      <div className="bpm-reveal bpm-reveal--empty">
        <Icon name="target" size={26} />
        <p className="t-label">Nothing to debrief</p>
        <p className="bpm-note t-hint">
          The correct tempo, your error and the tempo marking appear here the moment you lock an answer in.
        </p>
      </div>
    );
  }

  const verdict = verdictOf(round, cfg.tolerance);
  const mark = tempoMark(round.target);
  const answerMark = tempoMark(round.answer);
  const sign = round.errorBpm > 0 ? 'too fast' : round.errorBpm < 0 ? 'too slow' : 'dead on';

  return (
    <div className="bpm-reveal" data-verdict={verdict}>
      <div className="bpm-reveal__head">
        <div className="bpm-reveal__truth">
          <span className="t-micro">Correct tempo</span>
          <Readout value={round.target} unit="BPM" tone="amber" size="xl" />
          <span className="bpm-reveal__mark">
            <b>{mark.name}</b>
            <em>— {mark.it}</em>
          </span>
        </div>

        <div className="bpm-reveal__delta">
          <Chip tone={verdict === 'correct' ? 'green' : verdict === 'close' ? 'amber' : 'red'} icon={verdict === 'correct' ? 'check' : verdict === 'close' ? 'alert' : 'close'}>
            {VERDICT_LABEL[verdict]}
            {verdict === 'correct' ? ` · ±${cfg.tolerance} BPM` : ''}
          </Chip>
          <div className="bpm-reveal__deltaval t-num" data-tone={verdict}>
            {signed(round.errorBpm)} <em>BPM</em>
          </div>
          <div className="bpm-reveal__deltapct t-readout" data-tone={verdict}>
            {signedPct(round.errorBpm, round.errorPct)} % {sign}
          </div>
        </div>

        <div className="bpm-reveal__you">
          <span className="t-micro">Your answer</span>
          <Readout value={round.answer} unit="BPM" tone="cyan" size="lg" />
          <span className="bpm-reveal__mark bpm-reveal__mark--dim">{answerMark.name}</span>
        </div>
      </div>

      <Gauge target={round.target} answer={round.answer} cfg={cfg} tolerance={cfg.tolerance} />

      <div className="bpm-reveal__meta">
        <span className="bpm-meta__cell">
          <span className="t-micro">Time signature</span>
          <Readout value={`${round.numerator}/${round.denominator}`} size="sm" tone="plain" />
        </span>
        <span className="bpm-meta__cell">
          <span className="t-micro">Subdivision</span>
          <Readout value={`×${round.subdivision}`} size="sm" tone="plain" />
        </span>
        <span className="bpm-meta__cell">
          <span className="t-micro">Click</span>
          <Readout value={round.sound} size="sm" tone="plain" />
        </span>
        <span className="bpm-meta__cell">
          <span className="t-micro">Response</span>
          <Readout value={(round.ms / 1000).toFixed(1)} unit="s" size="sm" tone="plain" />
        </span>
        <span className="bpm-meta__cell">
          <span className="t-micro">Best / mean</span>
          <Readout
            value={`${(bestMs / 1000).toFixed(1)}/${(meanMs / 1000).toFixed(1)}`}
            unit="s"
            size="sm"
            tone="plain"
          />
        </span>
      </div>

      <Divider />

      <div className="bpm-reveal__hist">
        <div className="row">
          <span className="field__label">
            <Icon name="activity" size={12} /> Round history
          </span>
          <span className="panel__spacer" />
          <span className="t-micro">last {Math.min(12, history.length)}</span>
        </div>
        <HistoryList history={history} rounds={rounds} tolerance={cfg.tolerance} />
      </div>
    </div>
  );
}
