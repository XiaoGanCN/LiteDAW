/* ============================================================================
   LiteDAW · PITCH PAGE — weakness model
   The headline instrument: a live 12×12 confusion heat-grid, the ranked weak
   pairs that can be turned into a drill, per-class accuracy, breakdowns by
   instrument / octave / quality and the session flight recorder.
   ========================================================================= */

import { memo, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Bar } from '../../components/ui/Hardware';
import { Btn, Chip, Divider, Modal, Panel, Readout, useToast } from '../../components/ui/kit';
import { CHORD_LABELS, type ChordQuality } from '../../audio/dsp';
import type { InstrumentId } from '../../audio/synth';
import { usePitch, type ConfusionPair } from '../../state/pitch';
import {
  PC_NAMES,
  accColor,
  accInk,
  heatCell,
  heatDiag,
  instrumentLabel,
  ms,
  pct,
} from './shared';

export function WeaknessPanel({ onDrill }: { onDrill: (pair: [number, number]) => void }) {
  const confusion = usePitch((s) => s.confusion);
  const stats = usePitch((s) => s.stats);
  const attempts = usePitch((s) => s.attempts);
  const cfg = usePitch((s) => s.cfg);
  const resetSession = usePitch((s) => s.resetSession);
  const resetModel = usePitch((s) => s.resetModel);
  const exportProfile = usePitch((s) => s.exportProfile);
  const importProfile = usePitch((s) => s.importProfile);
  const toast = useToast();

  const [confirm, setConfirm] = useState<'session' | 'model' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const weak = useMemo(() => usePitch.getState().weakPairs(6), [confusion]);
  const pcAcc = useMemo(() => usePitch.getState().pcAccuracy(), [confusion]);
  const accuracy = stats.total ? stats.correct / stats.total : 0;
  const meanMs = stats.latency.length
    ? stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length
    : 0;
  const scoreRate = stats.total ? stats.score / stats.total : 0;

  const doExport = () => {
    const blob = new Blob([exportProfile()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `litedaw-pitch-profile-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Profile exported', 'ok');
  };

  const doImport = async (file: File) => {
    const text = await file.text();
    if (importProfile(text)) toast(`Profile "${file.name}" loaded`, 'ok');
    else toast('That file is not a LiteDAW pitch profile', 'error');
  };

  const instrRows = toRows(stats.byInstrument, (k) => instrumentLabel(k as InstrumentId | 'sample'));
  const octRows = toRows(stats.byOctave, (k) => `Oct ${k}`);
  const qualRows = toRows(stats.byQuality, (k) => CHORD_LABELS[k as ChordQuality] ?? k);

  return (
    <Panel
      variant="alu"
      icon="target"
      title="Weakness Model"
      tag="12×12 CONFUSION · ADAPTIVE"
      actions={
        <div className="row pt-wm__acts">
          {cfg.focusPair ? (
            <Chip tone="amber" icon="target">
              DRILL {PC_NAMES[cfg.focusPair[0]]}↔{PC_NAMES[cfg.focusPair[1]]}
            </Chip>
          ) : null}
          <Chip tone={stats.total ? 'cyan' : 'default'}>{stats.total} SAMPLES</Chip>
        </div>
      }
    >
      {/* ── Session flight recorder ────────────────────────────────────── */}
      <div className="pt-wm__dash">
        <div className="pt-wm__meters">
          <div className="pt-stats">
            <Stat label="Attempts" value={String(stats.total)} tone="plain" />
            <Stat label="Accuracy" value={pct(accuracy)} tone={accuracy >= 0.8 ? 'green' : accuracy >= 0.5 ? 'amber' : 'red'} />
            <Stat label="Mean latency" value={ms(meanMs)} tone="cyan" />
            <Stat label="Streak" value={`${stats.streak}`} tone={stats.streak > 0 ? 'green' : 'plain'} />
            <Stat label="Best" value={`${stats.bestStreak}`} tone="plain" />
            <Stat label="Score" value={stats.score.toFixed(1)} tone="amber" />
          </div>
          <div className="pt-scorerow">
            <span className="t-micro">Credit gain</span>
            <Bar value={scoreRate} max={1} length="100%" thickness={7} color="var(--amber)" />
            <span className="pt-mono">{pct(scoreRate)}</span>
          </div>
        </div>
        <Sparkline attempts={attempts} />
      </div>

      <Divider />

      {/* ── Matrix + weak pairs + class accuracy ───────────────────────── */}
      <div className="pt-wm__grid">
        <section className="pt-wm__cell pt-wm__cell--matrix">
          <header className="pt-wm__head">
            <span className="t-label">Confusion matrix</span>
            <span className="t-micro">rows played · cols answered</span>
          </header>
          <Matrix confusion={confusion} />
          <div className="pt-matrix__legend">
            <span className="pt-lg">
              <i style={{ background: heatDiag(0.85) }} /> correct
            </span>
            <span className="pt-lg">
              <i style={{ background: heatCell(0.35) }} /> occasional slip
            </span>
            <span className="pt-lg">
              <i style={{ background: heatCell(1) }} /> systematic confusion
            </span>
          </div>
        </section>

        <section className="pt-wm__cell">
          <header className="pt-wm__head">
            <span className="t-label">Weak pairs</span>
            <span className="t-micro">ranked by count × error</span>
          </header>
          {weak.length === 0 ? (
            <p className="pt-wm__empty">
              No confusions recorded yet. Answer a few questions — anything you mix up shows up here with a DRILL
              button.
            </p>
          ) : (
            <ul className="pt-weak">
              {weak.map((p, i) => (
                <WeakRow
                  key={`${p.a}-${p.b}`}
                  pair={p}
                  index={i}
                  active={cfg.focusPair?.[0] === p.a && cfg.focusPair?.[1] === p.b}
                  onDrill={() => onDrill([p.a, p.b])}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="pt-wm__cell">
          <header className="pt-wm__head">
            <span className="t-label">Per-class accuracy</span>
            <span className="t-micro">hit rate inside each row</span>
          </header>
          <div className="pt-pcstrip">
            {pcAcc.map((a, pc) => (
              <div
                key={pc}
                className="pt-pccell"
                style={{ background: accColor(a) }}
                title={a === null ? `${PC_NAMES[pc]} — never played` : `${PC_NAMES[pc]} — ${pct(a)} of ${confusion[pc].reduce((x, y) => x + y, 0)}`}
              >
                <span style={{ color: accInk(a) }}>{PC_NAMES[pc]}</span>
                <em>{a === null ? '—' : pct(a)}</em>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Breakdowns read better side by side across the full width. */}
      <div className="pt-breaks">
        <BreakList title="By instrument" rows={instrRows} />
        <BreakList title="By octave" rows={octRows} />
        <BreakList title="By chord quality" rows={qualRows} />
      </div>

      <Divider />

      <div className="row row--wrap pt-wm__foot">
        <Btn size="sm" variant="danger" icon="trash" onClick={() => setConfirm('session')}>
          Reset session
        </Btn>
        <Btn size="sm" variant="danger" icon="refresh" onClick={() => setConfirm('model')}>
          Reset model
        </Btn>
        <span className="panel__spacer" />
        <Btn size="sm" variant="ghost" icon="download" onClick={doExport}>
          Export profile
        </Btn>
        <Btn size="sm" variant="ghost" icon="upload" onClick={() => fileRef.current?.click()}>
          Import
        </Btn>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void doImport(f);
          }}
        />
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'model' ? 'Reset weakness model' : 'Reset session'}
        icon="alert"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Btn>
            <Btn
              variant="danger"
              icon="check"
              onClick={() => {
                if (confirm === 'model') {
                  resetModel();
                  toast('Confusion model cleared', 'ok');
                } else {
                  resetSession();
                  toast('Session counters cleared', 'ok');
                }
                setConfirm(null);
              }}
            >
              Confirm
            </Btn>
          </>
        }
      >
        <p className="t-body">
          {confirm === 'model'
            ? 'The 12×12 confusion matrix and the chord-quality matrix will be zeroed. Session totals and your configuration are kept.'
            : 'Attempts, accuracy, latency, streaks and the score gain will be cleared. The learned confusion model is kept so the drill history survives.'}
        </p>
      </Modal>
    </Panel>
  );
}

/* ── Session statistic cell ────────────────────────────────────────────── */

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'cyan' | 'red' | 'amber' | 'green' | 'plain';
}) {
  return (
    <div className="pt-stat">
      <span className="t-micro">{label}</span>
      <Readout value={value} tone={tone} size="sm" />
    </div>
  );
}

/* ── Sparkline ─────────────────────────────────────────────────────────── */

const Sparkline = memo(function Sparkline({ attempts }: { attempts: { correct: boolean; ms: number }[] }) {
  const tail = attempts.slice(-40);
  const maxMs = Math.max(1, ...tail.map((a) => a.ms));
  const W = 320;
  const H = 34;
  const step = tail.length ? W / tail.length : W;
  return (
    <div className="pt-spark">
      <div className="pt-spark__head">
        <span className="t-micro">Last {tail.length || 40} attempts · height = latency</span>
        <span className="t-micro">
          <i className="pt-dot pt-dot--ok" /> correct <i className="pt-dot pt-dot--bad" /> missed
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pt-spark__svg" aria-hidden="true">
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(190,210,225,.22)" strokeWidth={0.6} />
        {tail.map((a, i) => {
          const h = 3 + (a.ms / maxMs) * (H / 2 - 4);
          const x = i * step + 0.6;
          const w = Math.max(1.2, step - 1.6);
          return a.correct ? (
            <rect key={i} x={x} y={H / 2 - h} width={w} height={h} fill="var(--green)" opacity={0.9} />
          ) : (
            <rect key={i} x={x} y={H / 2} width={w} height={h} fill="var(--red-hi)" opacity={0.9} />
          );
        })}
      </svg>
    </div>
  );
});

/* ── Confusion heat-grid ───────────────────────────────────────────────── */

const Matrix = memo(function Matrix({ confusion }: { confusion: number[][] }) {
  const [pick, setPick] = useState<{ r: number; c: number } | null>(null);
  const { max, rowTotals } = useMemo(() => {
    let m = 0;
    const rt = confusion.map((row) => {
      const t = row.reduce((a, b) => a + b, 0);
      row.forEach((v) => {
        if (v > m) m = v;
      });
      return t;
    });
    return { max: m || 1, rowTotals: rt };
  }, [confusion]);

  const read = pick
    ? pick.r === pick.c
      ? `${PC_NAMES[pick.r]} identified correctly ×${confusion[pick.r][pick.c]}`
      : `${PC_NAMES[pick.r]} heard as ${PC_NAMES[pick.c]} ×${confusion[pick.r][pick.c]}`
    : 'Tap or hover a cell to read the pair.';

  return (
    <div className="pt-matrix">
      <div className="pt-matrix__grid">
        <span className="pt-matrix__corner" />
        {PC_NAMES.map((n, c) => (
          <span key={`c${c}`} className="pt-matrix__col" data-hot={pick?.c === c || undefined}>
            {n}
          </span>
        ))}
        {confusion.map((row, r) => (
          <Row key={`r${r}`} row={row} r={r} max={max} rowTotal={rowTotals[r]} pick={pick} onPick={setPick} />
        ))}
      </div>
      <p className="pt-matrix__read" data-dim={!pick || undefined}>
        {read}
      </p>
    </div>
  );
});

const Row = memo(function Row({
  row,
  r,
  max,
  rowTotal,
  pick,
  onPick,
}: {
  row: number[];
  r: number;
  max: number;
  rowTotal: number;
  pick: { r: number; c: number } | null;
  onPick: (p: { r: number; c: number } | null) => void;
}) {
  return (
    <>
      <span className="pt-matrix__row" data-hot={pick?.r === r || undefined}>
        {PC_NAMES[r]}
      </span>
      {row.map((v, c) => {
        const diag = r === c;
        const t = diag ? (rowTotal ? v / Math.max(1, rowTotal) : 0) : v / max;
        const style: CSSProperties = { background: diag ? heatDiag(t) : heatCell(t) };
        return (
          <button
            key={c}
            type="button"
            className="pt-cell"
            data-diag={diag || undefined}
            data-sel={(pick?.r === r && pick?.c === c) || undefined}
            style={style}
            title={diag ? `${PC_NAMES[r]} correct ×${v}` : `${PC_NAMES[r]} heard as ${PC_NAMES[c]} ×${v}`}
            onPointerEnter={() => onPick({ r, c })}
            onFocus={() => onPick({ r, c })}
            onClick={() => onPick({ r, c })}
            aria-label={diag ? `${PC_NAMES[r]} correct, ${v}` : `${PC_NAMES[r]} heard as ${PC_NAMES[c]}, ${v} times`}
          >
            {v > 0 ? <span>{v > 99 ? '99' : v}</span> : null}
          </button>
        );
      })}
    </>
  );
});

/* ── Weak pair row ─────────────────────────────────────────────────────── */

function WeakRow({
  pair,
  index,
  active,
  onDrill,
}: {
  pair: ConfusionPair;
  index: number;
  active: boolean;
  onDrill: () => void;
}) {
  return (
    <li className="pt-weakrow" data-active={active || undefined} style={{ animationDelay: `${index * 45}ms` }}>
      <div className="pt-weakrow__id">
        <span className="pt-weakrow__pair">
          {PC_NAMES[pair.a]}
          <i>↔</i>
          {PC_NAMES[pair.b]}
        </span>
        <span className="pt-weakrow__meta">
          {pair.aToB}× {PC_NAMES[pair.a]}→{PC_NAMES[pair.b]} · {pair.bToA}× reverse
        </span>
      </div>
      <div className="pt-weakrow__err">
        <Bar value={pair.error} max={1} length="100%" thickness={5} color="var(--red-hi)" />
        <span className="pt-mono">{pct(pair.error)}</span>
      </div>
      {/* A toggle, not a one-way switch: the pressed state is amber (the drill
          colour) so the single red primary action stays with SUBMIT/PLAY. */}
      <Btn
        size="sm"
        className="pt-drill"
        data-on={active || undefined}
        aria-pressed={active}
        icon={active ? 'close' : 'target'}
        onClick={onDrill}
        title={active ? 'End this drill and return to the full pool' : `Drill ${PC_NAMES[pair.a]} ↔ ${PC_NAMES[pair.b]}`}
      >
        {active ? 'Drill on' : 'Drill'}
      </Btn>
    </li>
  );
}

/* ── Breakdown lists ───────────────────────────────────────────────────── */

interface Row2 {
  key: string;
  label: string;
  seen: number;
  correct: number;
  rate: number;
}

function toRows(rec: Record<string, { seen: number; correct: number }>, label: (k: string) => string): Row2[] {
  return Object.entries(rec)
    .filter(([, v]) => v.seen > 0)
    .map(([k, v]) => ({ key: k, label: label(k), seen: v.seen, correct: v.correct, rate: v.correct / v.seen }))
    .sort((a, b) => b.seen - a.seen);
}

function BreakList({ title, rows }: { title: string; rows: Row2[] }) {
  if (!rows.length) return null;
  return (
    <div className="pt-break">
      <span className="t-micro">{title}</span>
      <ul>
        {rows.map((r, i) => (
          <li key={r.key} style={{ animationDelay: `${i * 35}ms` }}>
            <span className="pt-break__lab marquee" title={r.label}>
              {r.label}
            </span>
            <Bar
              value={r.rate}
              max={1}
              length="100%"
              thickness={5}
              color={r.rate >= 0.8 ? 'var(--green)' : r.rate >= 0.5 ? 'var(--amber)' : 'var(--red-hi)'}
            />
            <span className="pt-break__n">{r.seen}</span>
            <span className="pt-mono pt-break__p">{pct(r.rate)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
