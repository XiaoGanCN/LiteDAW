/* ============================================================================
   LiteDAW · BPM TRAINER PAGE
   Two drills on one instrument:
     IDENTIFY — the reference plays an unknown tempo for N bars (0 = endless);
                the player names it on the wheel and locks in.
     TAP      — the reference keeps playing; the player taps the beat and the
                median inter-tap interval seeds the answer.
   Round flow: idle → listening → (tapping) → answering → revealed.
   ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Btn,
  Chip,
  Divider,
  Empty,
  Field,
  IconBtn,
  Led,
  Legend,
  Modal,
  NumDrag,
  Panel,
  Readout,
  Segmented,
  ToggleRow,
  useToast,
  Well,
} from '../../components/ui/kit';
import { Knob, Meter } from '../../components/ui/Hardware';
import { WheelPicker, type WheelItem } from '../../components/ui/WheelPicker';
import { Icon } from '../../design/Icon';
import { engine } from '../../audio/engine';
import { metronome, type ClickSound } from '../../audio/metronome';
import { tempoMark, useBpm, type BpmConfig, type BpmMode } from '../../state/bpm';
import { BeatVisualiser, type VisPhase } from './BeatVisualiser';
import { Cap, LiveReadout, MultiToggle, RangeSlider } from './Controls';
import { DiagnosticsPanel } from './Diagnostics';
import { RevealPanel } from './Reveal';
import './bpm.css';

/* ── Static option banks ──────────────────────────────────────────────── */

const NUMERATORS = [2, 3, 4, 5, 6, 7, 9, 12];
const DENOMINATORS = [2, 4, 8];
const SUBDIVISIONS: { value: number; label: string; sub: string }[] = [
  { value: 1, label: 'Beats', sub: 'One click per beat' },
  { value: 2, label: 'Eighths', sub: 'Two clicks per beat' },
  { value: 3, label: 'Triplets', sub: 'Three clicks per beat' },
  { value: 4, label: 'Sixteenths', sub: 'Four clicks per beat' },
];
const SOUNDS: ClickSound[] = ['beep', 'wood', 'rim', 'tick', 'sub'];
const BARS = [0, 1, 2, 4, 8];

const PHASE_LABEL: Record<VisPhase, string> = {
  idle: 'Standby',
  listening: 'Reference',
  tapping: 'Tap along',
  answering: 'Set answer',
  revealed: 'Debrief',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** mm:ss.d — the drill timer format. */
function formatLap(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const tenths = Math.floor(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Median inter-tap interval → BPM. The first tap is only the origin. */
function tapBpmFrom(times: number[]): number | null {
  if (times.length < 3) return null;
  const iv: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d >= 120 && d <= 3000) iv.push(d);
  }
  if (iv.length < 2) return null;
  iv.sort((a, b) => a - b);
  const mid = iv.length >> 1;
  const med = iv.length % 2 ? iv[mid] : (iv[mid - 1] + iv[mid]) / 2;
  return 60000 / med;
}

function applyRoundToMetronome(
  t: { bpm: number; numerator: number; denominator: number; subdivision: number; sound: ClickSound },
  cfg: BpmConfig,
  level: number,
) {
  metronome.cfg.bpm = t.bpm;
  metronome.cfg.beatsPerBar = t.numerator;
  metronome.cfg.beatUnit = t.denominator;
  metronome.cfg.subdivision = t.subdivision;
  metronome.cfg.sound = t.sound;
  metronome.cfg.downbeatOnly = cfg.downbeatOnly;
  metronome.cfg.accents = Array.from({ length: t.numerator }, (_, i) => i === 0);
  metronome.setLevel(level);
}

/* ══════════════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════════════ */

export function BpmPage() {
  const cfg = useBpm((s) => s.cfg);
  const phase = useBpm((s) => s.phase);
  const round = useBpm((s) => s.round);
  const lastRound = useBpm((s) => s.lastRound);
  const stats = useBpm((s) => s.stats);
  const setCfg = useBpm((s) => s.setCfg);
  const resetConfig = useBpm((s) => s.resetConfig);
  const resetSession = useBpm((s) => s.resetSession);
  const resetModel = useBpm((s) => s.resetModel);
  const accuracy = useBpm((s) => s.accuracy);
  const meanErrorPct = useBpm((s) => s.meanErrorPct);
  const toast = useToast();
  // Round lifecycle actions are read imperatively inside handlers so the page
  // never re-renders mid-scheduling: useBpm.getState().begin/setPhase/finish.

  const lo = Math.min(cfg.minBpm, cfg.maxBpm);
  const hi = Math.max(cfg.minBpm, cfg.maxBpm);
  const locked = phase === 'listening' || phase === 'tapping' || phase === 'answering';

  const [answer, setAnswer] = useState(() => Math.round((cfg.minBpm + cfg.maxBpm) / 2));
  const [visOn, setVisOn] = useState(true);
  const [level, setLevel] = useState(0.75);
  const [taps, setTaps] = useState(0);
  const [tapBpm, setTapBpm] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<null | 'session' | 'model'>(null);
  const [engineState, setEngineState] = useState({ running: engine.running, sr: engine.sampleRate });

  /* ── Live DOM handles written by the timer rAF (no per-frame renders). ── */
  const roundTimeRef = useRef<HTMLSpanElement | null>(null);
  const windowTimeRef = useRef<HTMLSpanElement | null>(null);
  const sessionTimeRef = useRef<HTMLSpanElement | null>(null);
  const tickerTimeRef = useRef<HTMLSpanElement | null>(null);

  const answerRef = useRef(answer);
  const levelRef = useRef(level);
  const wallStartRef = useRef(0);
  const tapDeadlineRef = useRef(0);
  const tapTimesRef = useRef<number[]>([]);
  const sessionStartRef = useRef(0);
  const auditionTimers = useRef<number[]>([]);
  const tapIdRef = useRef<string | null>(null);

  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);
  useEffect(() => {
    levelRef.current = level;
    metronome.setLevel(level);
  }, [level]);

  /* ── Engine status for the ticker ─────────────────────────────────────── */
  useEffect(() => {
    const off = engine.onRunningChange((running) => setEngineState({ running, sr: engine.sampleRate }));
    const t = window.setInterval(() => setEngineState({ running: engine.running, sr: engine.sampleRate }), 1500);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, []);

  /* ── Audio tap on the BPM bus (activity meter) ────────────────────────── */
  const getLevel = useCallback(() => (tapIdRef.current ? engine.level(tapIdRef.current) : 0), []);
  const ensureTap = useCallback(() => {
    if (tapIdRef.current) return;
    try {
      engine.createTap('bpm-trainer', engine.bus('bpm'), 512);
      tapIdRef.current = 'bpm-trainer';
    } catch {
      tapIdRef.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      if (tapIdRef.current) engine.releaseTap(tapIdRef.current);
      metronome.stop();
      auditionTimers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  /* ══════════════════════════════════════════════════════════════════════
     ROUND CONTROL
     ══════════════════════════════════════════════════════════════════════ */

  const startRound = useCallback(async () => {
    auditionTimers.current.forEach((t) => window.clearTimeout(t));
    auditionTimers.current = [];
    await engine.init();
    ensureTap();
    const st = useBpm.getState();
    const t = st.nextTarget();
    const at = engine.time + 0.12;
    const beatDur = (60 / t.bpm) * (4 / t.denominator);
    const bars = st.cfg.bars;
    const endsAt = bars > 0 ? at + bars * t.numerator * beatDur : 0;

    applyRoundToMetronome(t, st.cfg, levelRef.current);
    wallStartRef.current = performance.now();
    if (!sessionStartRef.current) sessionStartRef.current = wallStartRef.current;
    tapDeadlineRef.current = 0;
    tapTimesRef.current = [];
    setTaps(0);
    setTapBpm(null);
    const loNow = Math.min(st.cfg.minBpm, st.cfg.maxBpm);
    const hiNow = Math.max(st.cfg.minBpm, st.cfg.maxBpm);
    setAnswer((a) => clamp(Math.round(a), loNow, hiNow));
    st.begin({
      target: t.bpm,
      numerator: t.numerator,
      denominator: t.denominator,
      subdivision: t.subdivision,
      sound: t.sound,
      startedAt: at,
      endsAt,
      taps: [],
    });
    metronome.start(at);
  }, [ensureTap]);

  const enterAnswering = useCallback(() => {
    metronome.stop();
    tapDeadlineRef.current = 0;
    useBpm.getState().setPhase('answering');
  }, []);

  const enterTapping = useCallback(() => {
    const st = useBpm.getState();
    tapTimesRef.current = [];
    setTaps(0);
    setTapBpm(null);
    tapDeadlineRef.current = engine.time + Math.max(2, st.cfg.tapWindow);
    useBpm.setState((s) => (s.round ? { round: { ...s.round, taps: [] } } : {}));
    st.setPhase('tapping');
  }, []);

  const finalizeTaps = useCallback(
    (auto: boolean) => {
      const st = useBpm.getState();
      if (st.phase !== 'tapping') return;
      tapDeadlineRef.current = 0;
      const bpm = tapBpmFrom(tapTimesRef.current);
      const a = Math.min(st.cfg.minBpm, st.cfg.maxBpm);
      const b = Math.max(st.cfg.minBpm, st.cfg.maxBpm);
      if (bpm) setAnswer(clamp(Math.round(bpm), a, b));
      st.setPhase('answering');
      if (!bpm) toast('Not enough taps — dial the tempo in by hand.', 'warn');
      else if (auto) toast(`Tap estimate ${bpm.toFixed(1)} BPM — nudge the wheel or lock in.`, 'info');
    },
    [toast],
  );

  const onTap = useCallback(() => {
    const st = useBpm.getState();
    if (st.phase !== 'tapping') return;
    const next = [...tapTimesRef.current, performance.now()].slice(-41);
    tapTimesRef.current = next;
    setTaps(Math.max(0, next.length - 1));
    setTapBpm(tapBpmFrom(next));
    useBpm.setState((s) => (s.round ? { round: { ...s.round, taps: next } } : {}));
  }, []);

  const resetTaps = useCallback(() => {
    tapTimesRef.current = [];
    setTaps(0);
    setTapBpm(null);
    useBpm.setState((s) => (s.round ? { round: { ...s.round, taps: [] } } : {}));
  }, []);

  const submit = useCallback(() => {
    const st = useBpm.getState();
    const r = st.round;
    if (!r) return;
    const a = Math.min(st.cfg.minBpm, st.cfg.maxBpm);
    const b = Math.max(st.cfg.minBpm, st.cfg.maxBpm);
    const ans = clamp(Math.round(answerRef.current), a, b);
    const errorBpm = ans - r.target;
    const errorPct = (Math.abs(errorBpm) / r.target) * 100;
    const correct = Math.abs(errorBpm) <= st.cfg.tolerance;
    const ms = Math.max(0, performance.now() - wallStartRef.current);
    metronome.stop();
    tapDeadlineRef.current = 0;
    st.finish({
      target: r.target,
      answer: ans,
      errorBpm,
      errorPct,
      correct,
      ms,
      numerator: r.numerator,
      denominator: r.denominator,
      subdivision: r.subdivision,
      sound: r.sound,
      at: Date.now(),
    });
    const delta = `${errorBpm > 0 ? '+' : errorBpm < 0 ? '-' : '±'}${Math.abs(errorBpm)}`;
    toast(
      correct ? `Correct · ${r.target} BPM (${delta})` : `Off by ${delta} BPM · target was ${r.target}`,
      correct ? 'ok' : 'warn',
    );
  }, [toast]);

  const abort = useCallback(() => {
    metronome.stop();
    tapDeadlineRef.current = 0;
    tapTimesRef.current = [];
    setTaps(0);
    setTapBpm(null);
    useBpm.setState({ round: null, phase: 'idle' });
  }, []);

  const primary = useCallback(() => {
    const st = useBpm.getState();
    switch (st.phase) {
      case 'idle':
      case 'revealed':
        void startRound();
        break;
      case 'listening':
        if (st.cfg.mode === 'tap') enterTapping();
        else enterAnswering();
        break;
      case 'tapping':
        finalizeTaps(false);
        break;
      case 'answering':
        submit();
        break;
      default:
        break;
    }
  }, [startRound, enterTapping, enterAnswering, finalizeTaps, submit]);

  /* The rAF timer loop mounts once; actions ride a ref so it never goes stale. */
  const api = useRef({ primary, enterAnswering, enterTapping, finalizeTaps });
  useEffect(() => {
    api.current = { primary, enterAnswering, enterTapping, finalizeTaps };
  });

  useEffect(() => {
    let raf = 0;
    let lastSession = -1;
    const tick = () => {
      const st = useBpm.getState();
      const now = performance.now();
      const at = engine.time;
      if (st.round) {
        if (roundTimeRef.current) roundTimeRef.current.textContent = formatLap((now - wallStartRef.current) / 1000);
        if (windowTimeRef.current) {
          if (st.phase === 'tapping' && tapDeadlineRef.current > 0) {
            windowTimeRef.current.textContent = `${Math.max(0, tapDeadlineRef.current - at).toFixed(1)}s`;
          } else if (st.round.endsAt > 0) {
            windowTimeRef.current.textContent = `${Math.max(0, st.round.endsAt - at).toFixed(1)}s`;
          } else {
            windowTimeRef.current.textContent = '∞';
          }
        }
        if (st.phase === 'listening' && st.round.endsAt > 0 && at >= st.round.endsAt) {
          if (st.cfg.mode === 'identify') api.current.enterAnswering();
          else api.current.enterTapping();
        } else if (st.phase === 'tapping' && tapDeadlineRef.current > 0 && at >= tapDeadlineRef.current) {
          api.current.finalizeTaps(true);
        }
      } else {
        if (roundTimeRef.current) roundTimeRef.current.textContent = '0:00.0';
        if (windowTimeRef.current) windowTimeRef.current.textContent = '--';
      }
      if (sessionStartRef.current) {
        const sec = (now - sessionStartRef.current) / 1000;
        if (sec - lastSession >= 0.1) {
          lastSession = sec;
          const txt = formatLap(sec);
          if (sessionTimeRef.current) sessionTimeRef.current.textContent = txt;
          if (tickerTimeRef.current) tickerTimeRef.current.textContent = txt;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── Keyboard: space/enter drive the one action, space taps in tap mode ─ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const st = useBpm.getState();
      if (e.code === 'Space' && st.phase === 'tapping' && tag !== 'BUTTON') {
        e.preventDefault();
        onTap();
        return;
      }
      if ((e.code === 'Space' || e.key === 'Enter') && tag !== 'BUTTON') {
        e.preventDefault();
        api.current.primary();
        return;
      }
      if ((e.key === 'r' || e.key === 'R') && st.phase === 'tapping' && tag !== 'BUTTON') {
        e.preventDefault();
        resetTaps();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onTap, resetTaps]);

  /* ══════════════════════════════════════════════════════════════════════
     SOUND AUDITION
     ══════════════════════════════════════════════════════════════════════ */

  const audition = useCallback(async (sound: ClickSound) => {
    await engine.init();
    ensureTap();
    const saved = { ...metronome.cfg };
    metronome.stop();
    Object.assign(metronome.cfg, {
      sound,
      bpm: 120,
      beatsPerBar: 4,
      beatUnit: 4,
      subdivision: 1,
      accents: [true, false, false, false],
      downbeatOnly: false,
    });
    metronome.setLevel(levelRef.current);
    metronome.start();
    const id = window.setTimeout(() => {
      metronome.stop();
      Object.assign(metronome.cfg, saved);
      auditionTimers.current = auditionTimers.current.filter((x) => x !== id);
    }, 1900);
    auditionTimers.current.push(id);
  }, [ensureTap]);

  /* ══════════════════════════════════════════════════════════════════════
     DERIVED
     ══════════════════════════════════════════════════════════════════════ */

  const wheelItems = useMemo<WheelItem<number>[]>(() => {
    const a = Math.min(cfg.minBpm, cfg.maxBpm);
    const b = Math.max(cfg.minBpm, cfg.maxBpm);
    const out: WheelItem<number>[] = [];
    for (let v = a; v <= b; v++) out.push({ value: v, label: String(v), sub: tempoMark(v).name });
    return out;
  }, [cfg.minBpm, cfg.maxBpm]);

  const timing = useMemo(() => {
    const h = stats.history;
    if (!h.length) return { best: 0, mean: 0 };
    let best = Number.POSITIVE_INFINITY;
    let sum = 0;
    for (const r of h) {
      if (r.ms < best) best = r.ms;
      sum += r.ms;
    }
    return { best, mean: sum / h.length };
  }, [stats.history]);

  const acc = accuracy();
  const meanErr = meanErrorPct();
  const previewBpm = phase === 'answering' ? answer : 0;

  const toggleCfg = <K extends keyof BpmConfig>(key: K, v: BpmConfig[K]) => {
    if (locked) return;
    setCfg(key, v);
  };

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */

  const primaryBtn = (() => {
    switch (phase) {
      case 'idle':
        return (
          <Btn variant="primary" size="xl" icon="record" onClick={() => void startRound()}>
            Start
          </Btn>
        );
      case 'listening':
        return (
          <Btn
            variant="ghost"
            size="lg"
            icon="forward"
            onClick={() => (cfg.mode === 'tap' ? enterTapping() : enterAnswering())}
          >
            {cfg.mode === 'tap' ? 'Tap now' : 'Answer now'}
          </Btn>
        );
      case 'tapping':
        return (
          <Btn variant="alu" size="lg" icon="check" onClick={() => finalizeTaps(false)} disabled={taps < 2}>
            Use taps
          </Btn>
        );
      case 'answering':
        return (
          <Btn variant="primary" size="xl" icon="lock" onClick={submit}>
            Lock in
          </Btn>
        );
      case 'revealed':
        return (
          <Btn variant="primary" size="xl" icon="forward" onClick={() => void startRound()}>
            Next
          </Btn>
        );
      default:
        return null;
    }
  })();

  const verdictChip = (() => {
    if (!lastRound || phase !== 'revealed') return null;
    const v = lastRound.correct ? 'green' : Math.abs(lastRound.errorBpm) <= cfg.tolerance * 2.5 ? 'amber' : 'red';
    return (
      <Chip tone={v === 'green' ? 'green' : v === 'amber' ? 'amber' : 'red'} icon={lastRound.correct ? 'check' : 'alert'}>
        Target {lastRound.target} · you {lastRound.answer}
      </Chip>
    );
  })();

  return (
    <div className="pagegrid bpm-page">
      <div className="pagegrid__main">
        {/* ══ THE INSTRUMENT ═══════════════════════════════════════════ */}
        <Panel
          title="Tempo Acquisition"
          icon="bpm"
          variant="alu"
          tag={cfg.mode === 'identify' ? 'MODE · IDENTIFY' : 'MODE · TAP'}
          actions={
            <div className="row" style={{ gap: 7 }}>
              <Legend color={phase === 'listening' || phase === 'tapping' ? 'red' : 'cyan'} size="sm">
                {PHASE_LABEL[phase]}
              </Legend>
              <IconBtn
                icon={visOn ? 'eye' : 'eyeOff'}
                size="sm"
                label={visOn ? 'Beat visualiser on' : 'Beat visualiser off — pure listening'}
                variant={visOn ? 'alu' : 'ghost'}
                onClick={() => setVisOn((v) => !v)}
              />
            </div>
          }
        >
          <BeatVisualiser
            phase={phase}
            numerator={round?.numerator ?? cfg.numerators[0] ?? 4}
            subdivision={round?.subdivision ?? cfg.subdivisions[0] ?? 1}
            bars={cfg.bars}
            endsAt={round?.endsAt ?? 0}
            live={visOn}
            previewBpm={previewBpm}
          >
            {phase === 'revealed' && lastRound && (
              <div className="bpm-stage__verdict">
                <span className="t-micro">Revealed</span>
                {verdictChip}
              </div>
            )}
            {phase === 'listening' && visOn && <span className="bpm-stage__tag t-micro">Reference · listen</span>}
            {phase === 'answering' && visOn && previewBpm > 0 && (
              <span className="bpm-stage__tag t-micro">Preview · your dial {previewBpm} BPM</span>
            )}
          </BeatVisualiser>

          {/* transport */}
          <div className="bpm-transport">
            <div className="bpm-transport__act">
              {primaryBtn}
              {(phase === 'listening' || phase === 'tapping' || phase === 'answering') && (
                <Btn variant="ghost" size="sm" icon="close" onClick={abort}>
                  Abort
                </Btn>
              )}
              {phase === 'revealed' && (
                <Btn variant="ghost" size="sm" icon="refresh" onClick={abort}>
                  Standby
                </Btn>
              )}
            </div>
            <div className="panel__spacer" />
            <div className="bpm-transport__meters">
              <span className="bpm-meter">
                <span className="t-micro">Bus</span>
                <Meter getLevel={getLevel} length={86} thickness={7} />
              </span>
              <span className="bpm-meter">
                <Led on={phase === 'listening' || phase === 'tapping'} color="red" />
                <span className="t-micro">Ref</span>
              </span>
              <span className="bpm-meter">
                <Led on={metronome.running} color="green" />
                <span className="t-micro">Click</span>
              </span>
            </div>
            <div className="bpm-transport__times">
              <span className="bpm-time">
                <span className="t-micro">Round</span>
                <LiveReadout innerRef={roundTimeRef} initial="0:00.0" size="lg" />
              </span>
              <span className="bpm-time">
                <span className="t-micro">Window</span>
                <LiveReadout innerRef={windowTimeRef} initial="--" tone="amber" />
              </span>
              <span className="bpm-time">
                <span className="t-micro">Session</span>
                <LiveReadout innerRef={sessionTimeRef} initial="0:00.0" tone="plain" />
              </span>
            </div>
          </div>
        </Panel>

        {/* ══ ANSWER ENTRY ═════════════════════════════════════════════ */}
        <Panel
          title="Answer Entry"
          icon="target"
          tag={cfg.mode === 'tap' ? 'TAP → WHEEL' : 'WHEEL'}
          actions={
            <span className="t-micro">
              {phase === 'answering' ? 'dial & lock in' : phase === 'revealed' ? 'locked' : 'standby'}
            </span>
          }
        >
          {phase === 'idle' && (
            <Empty icon="bpm">
              Press START — a tempo plays for {cfg.bars > 0 ? `${cfg.bars} bar${cfg.bars === 1 ? '' : 's'}` : 'as long as you like'}.
              Name it on the wheel.
            </Empty>
          )}

          {phase === 'listening' && (
            <div className="bpm-listen">
              <Led size="lg" pulse color="red" />
              <div className="col grow">
                <span className="t-label">Reference playing</span>
                <span className="t-hint">
                  {cfg.bars > 0
                    ? `${cfg.bars} bar${cfg.bars === 1 ? '' : 's'} of ${round?.numerator ?? 4}/${round?.denominator ?? 4} at an unknown tempo.`
                    : 'Endless reference — stop it yourself when you have the tempo.'}{' '}
                  No numbers are shown until it stops.
                </span>
              </div>
              <div className="bpm-listen__count">
                <span className="t-micro">Bars to go</span>
                <Readout value={cfg.bars > 0 ? cfg.bars : '∞'} size="lg" tone="amber" />
              </div>
            </div>
          )}

          {phase === 'tapping' && (
            <div className="bpm-tapwrap">
              <button
                type="button"
                className="bpm-tap"
                aria-label="Tap the beat"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onTap();
                }}
                onKeyDown={(e) => {
                  if (e.code === 'Space' || e.key === 'Enter') {
                    e.preventDefault();
                    onTap();
                  }
                }}
              >
                <span className="bpm-tap__ring" />
                <Icon name="hand" size={26} />
                <span className="bpm-tap__label">Tap</span>
                <span className="bpm-tap__hint t-micro">or press space</span>
              </button>
              <div className="bpm-tapinfo">
                <Field label="Taps (origin rejected)" hint="The first tap only starts the clock.">
                  <Readout value={taps} unit="beats" size="lg" tone={taps >= 2 ? 'green' : 'plain'} />
                </Field>
                <Field label="Running estimate" hint="Median inter-tap interval.">
                  <Readout
                    value={tapBpm ? tapBpm.toFixed(1) : '--.-'}
                    unit="bpm"
                    size="lg"
                    tone={tapBpm ? 'cyan' : 'plain'}
                  />
                </Field>
                <div className="row">
                  <Btn size="sm" variant="ghost" icon="refresh" onClick={resetTaps} disabled={!taps}>
                    Reset taps
                  </Btn>
                </div>
              </div>
            </div>
          )}

          {(phase === 'answering' || phase === 'revealed') && (
            <div className="bpm-wheelrow">
              <Well className="bpm-wheelwell">
                <WheelPicker
                  items={wheelItems}
                  value={answer}
                  onChange={(v) => phase === 'answering' && setAnswer(v)}
                  onLive={(v) => phase === 'answering' && setAnswer(v)}
                  itemHeight={30}
                  visible={5}
                  width={148}
                  ariaLabel="Your tempo answer in BPM"
                  className={phase === 'revealed' ? 'bpm-wheel--locked' : ''}
                />
                <span className="bpm-wheelwell__gate t-micro">{phase === 'revealed' ? 'locked' : 'bpm'}</span>
              </Well>
              <div className="bpm-wheelside">
                <Field label="Your call" hint={`Range ${lo}–${hi} BPM · tolerance ±${cfg.tolerance}`}>
                  <Readout value={answer} unit="bpm" size="xl" tone="cyan" />
                </Field>
                <div className="bpm-wheelside__mark">
                  <Icon name="note" size={13} />
                  <b>{tempoMark(answer).name}</b>
                  <em>— {tempoMark(answer).it}</em>
                </div>
                {cfg.mode === 'tap' && (
                  <Chip tone={tapBpm ? 'cyan' : 'default'} icon="hand">
                    {tapBpm ? `taps ${tapBpm.toFixed(1)} bpm` : 'no tap estimate'}
                  </Chip>
                )}
                {phase === 'answering' && (
                  <p className="bpm-note t-micro">
                    Scrub the drum, use ↑ ↓, then LOCK IN. The pendulum previews the tempo you dialled.
                  </p>
                )}
                {phase === 'revealed' && lastRound && (
                  <div className="bpm-wheelresult">
                    <Chip tone={lastRound.correct ? 'green' : 'red'}>{lastRound.correct ? 'within tolerance' : 'outside tolerance'}</Chip>
                    <Readout value={lastRound.target} unit="was the target" size="lg" tone="amber" />
                  </div>
                )}
              </div>
            </div>
          )}
        </Panel>

        {/* ══ DEBRIEF ══════════════════════════════════════════════════ */}
        <Panel
          title="Debrief"
          icon="target"
          tag={lastRound ? `${lastRound.numerator}/${lastRound.denominator} · ×${lastRound.subdivision}` : 'no data'}
        >
          <RevealPanel
            round={lastRound}
            cfg={cfg}
            history={stats.history}
            rounds={stats.rounds}
            bestMs={timing.best}
            meanMs={timing.mean}
          />
        </Panel>

        {/* ══ TICKER ═══════════════════════════════════════════════════ */}
        <div className="ticker">
          <span className="ticker__seg">
            <Led size="sm" color={engineState.running ? 'green' : 'amber'} on />
            {engineState.running ? 'engine live' : 'engine idle'}
          </span>
          <span className="ticker__seg">SR {(engineState.sr / 1000).toFixed(1)} kHz</span>
          <span className="ticker__seg">PHASE {PHASE_LABEL[phase]}</span>
          <span className="ticker__seg">
            RANGE {lo}–{hi} BPM
          </span>
          <span className="ticker__seg">MODE {cfg.mode}</span>
          <span className="ticker__seg">ROUNDS {stats.rounds}</span>
          <span className="ticker__seg">
            SESSION <b ref={tickerTimeRef}>0:00.0</b>
          </span>
          <span className="ticker__seg">VIS {visOn ? 'on' : 'off'}</span>
        </div>
      </div>

      {/* ══ SIDE COLUMN ════════════════════════════════════════════════ */}
      <div className="pagegrid__side">
        <Panel
          title="Drill Configuration"
          icon="gear"
          variant="alu"
          tag={locked ? 'locked' : 'ready'}
          actions={
            <Btn size="sm" variant="ghost" icon="refresh" onClick={resetConfig} disabled={locked}>
              Defaults
            </Btn>
          }
        >
          <Field label="Drill mode" icon="dial" hint="IDENTIFY names an unknown tempo · TAP matches a playing reference.">
            <Segmented<BpmMode>
              value={cfg.mode}
              onChange={(v) => toggleCfg('mode', v)}
              options={[
                { value: 'identify', label: 'Identify', icon: 'target', disabled: locked },
                { value: 'tap', label: 'Tap', icon: 'hand', disabled: locked },
              ]}
            />
          </Field>

          <Divider />

          <Field label="Tempo range" icon="speed" hint="The adaptive model segments this span into 12 regions.">
            <div className="row">
              <NumDrag
                value={cfg.minBpm}
                min={20}
                max={300}
                step={1}
                unit="min"
                width={104}
                format={(v) => String(Math.round(v))}
                onChange={(v) => toggleCfg('minBpm', Math.min(v, cfg.maxBpm - 5))}
              />
              <NumDrag
                value={cfg.maxBpm}
                min={20}
                max={320}
                step={1}
                unit="max"
                width={104}
                format={(v) => String(Math.round(v))}
                onChange={(v) => toggleCfg('maxBpm', Math.max(v, cfg.minBpm + 5))}
              />
            </div>
          </Field>

          <Field label="Time signature · numerator" icon="grid" hint="Beats per bar the reference will use.">
            <MultiToggle
              ariaLabel="Time signature numerators"
              columns={4}
              options={NUMERATORS.map((n) => ({ value: n, label: String(n) }))}
              values={cfg.numerators}
              onChange={(v) => toggleCfg('numerators', v)}
              disabled={locked}
            />
          </Field>

          <Field label="Denominator" icon="note" hint="Which note value gets the beat.">
            <MultiToggle
              ariaLabel="Time signature denominators"
              columns={3}
              options={DENOMINATORS.map((n) => ({ value: n, label: `1/${n}` }))}
              values={cfg.denominators}
              onChange={(v) => toggleCfg('denominators', v)}
              disabled={locked}
            />
          </Field>

          <Field label="Subdivision" icon="eq" hint="Clicks between the beats.">
            <MultiToggle
              ariaLabel="Subdivisions"
              columns={2}
              options={SUBDIVISIONS.map((s) => ({ value: s.value, label: s.label, sub: s.sub }))}
              values={cfg.subdivisions}
              onChange={(v) => toggleCfg('subdivisions', v)}
              disabled={locked}
            />
          </Field>

          <Field label="Click sound" icon="speaker" hint="Tap the speaker to audition a voice on its own.">
            <MultiToggle
              ariaLabel="Click sounds"
              columns={3}
              options={SOUNDS.map((s) => ({ value: s, label: s }))}
              values={cfg.sounds}
              onChange={(v) => toggleCfg('sounds', v)}
              disabled={locked}
              audition={(s) => void audition(s)}
            />
          </Field>

          <Field label="Reference length" icon="hourglass" hint="Bars played before the reference stops (∞ = until you stop it).">
            <Segmented<number>
              value={cfg.bars}
              onChange={(v) => toggleCfg('bars', v)}
              options={BARS.map((b) => ({ value: b, label: b === 0 ? '∞' : String(b), disabled: locked }))}
            />
          </Field>

          <div className="bpm-cfgrow">
            <Field label="Tap window" icon="clock" hint="Seconds to tap before auto-scoring.">
              <NumDrag
                value={cfg.tapWindow}
                min={4}
                max={40}
                step={1}
                unit="s"
                width={96}
                format={(v) => String(Math.round(v))}
                onChange={(v) => toggleCfg('tapWindow', Math.round(v))}
              />
            </Field>
            <Field label="Tolerance" icon="target" hint="Accepted error.">
              <NumDrag
                value={cfg.tolerance}
                min={1}
                max={20}
                step={1}
                unit="±bpm"
                width={110}
                format={(v) => String(Math.round(v))}
                onChange={(v) => toggleCfg('tolerance', Math.round(v))}
              />
            </Field>
          </div>

          <Field
            label={`Adaptivity · ${(cfg.adaptivity * 100).toFixed(0)}%`}
            icon="trend"
            hint="Chance that the next tempo is drawn from a region you keep misjudging. 0% = uniform random."
          >
            <RangeSlider
              ariaLabel="Adaptivity"
              value={cfg.adaptivity}
              min={0}
              max={1}
              step={0.05}
              disabled={locked}
              onChange={(v) => toggleCfg('adaptivity', v)}
            />
          </Field>

          <Divider />

          <ToggleRow
            label="Downbeat only"
            hint="Mute every beat except the bar downbeat — hardest setting."
            icon="bpm"
            on={cfg.downbeatOnly}
            disabled={locked}
            onChange={(v) => {
              toggleCfg('downbeatOnly', v);
              metronome.cfg.downbeatOnly = v;
            }}
          />

          <ToggleRow
            label="Beat visualiser"
            hint="Off = pure listening, no pendulum, no lamps."
            icon={visOn ? 'eye' : 'eyeOff'}
            on={visOn}
            onChange={setVisOn}
          />

          <div className="bpm-levelrow">
            <Knob
              value={level}
              onChange={setLevel}
              min={0}
              max={1}
              step={0.01}
              size={56}
              label="Click level"
              resetTo={0.75}
              format={(v) => (v <= 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(0))}
              unit="dB"
            />
            <div className="col grow">
              <Cap icon="speaker">Metronome bus</Cap>
              <Meter getLevel={getLevel} length={120} thickness={8} />
              <span className="bpm-note t-micro">Level is written straight to the metronome bus.</span>
            </div>
          </div>
        </Panel>

        <Panel title="Diagnostics" icon="activity" tag={`${stats.rounds} rounds`}>
          <DiagnosticsPanel
            cfg={cfg}
            stats={stats}
            accuracy={acc}
            meanError={meanErr}
            onResetSession={() => setConfirm('session')}
            onResetModel={() => setConfirm('model')}
          />
        </Panel>
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'session' ? 'Reset session' : 'Reset adaptive model'}
        icon="alert"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Btn>
            <Btn
              variant="danger"
              icon="trash"
              onClick={() => {
                if (confirm === 'session') {
                  resetSession();
                  sessionStartRef.current = 0;
                  if (sessionTimeRef.current) sessionTimeRef.current.textContent = '0:00.0';
                  if (tickerTimeRef.current) tickerTimeRef.current.textContent = '0:00.0';
                  toast('Session log cleared.', 'ok');
                } else {
                  resetModel();
                  toast('Region model cleared — tempos are uniform again.', 'ok');
                }
                setConfirm(null);
              }}
            >
              Confirm reset
            </Btn>
          </>
        }
      >
        <p className="t-body">
          {confirm === 'session'
            ? 'This clears every logged round, the accuracy statistics and the region error model. It cannot be undone.'
            : 'This clears the 12-region error model that biases which tempos come back, but keeps your round history.'}
        </p>
      </Modal>
    </div>
  );
}
