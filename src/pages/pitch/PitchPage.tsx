/* ============================================================================
   LiteDAW · PITCH TRAINER PAGE
   The instrument surface: play a note or a chord, answer on a key bed or on a
   rotary dial, then read the verdict — while the weakness model quietly
   rewrites the question generator underneath.
   ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DialPicker, type DialItem } from '../../components/ui/DialPicker';
import { PianoKeyboard, type KeyState } from '../../components/ui/PianoKeyboard';
import { Btn, Chip, Divider, Empty, Led, Panel, Readout, ToggleRow, useToast } from '../../components/ui/kit';
import { CHORD_LABELS, chordName, midiName, pitchClassName } from '../../audio/dsp';
import { NotePlayer, type InstrumentId } from '../../audio/synth';
import { engine } from '../../audio/engine';
import { gradeAnswer, scaleConflicts, usePitch, type Attempt, type Question } from '../../state/pitch';
import { ConfigPanel } from './ConfigPanel';
import { ScopeStrip } from './ScopeStrip';
import { SourcesPanel } from './SourcesPanel';
import { WeaknessPanel } from './WeaknessPanel';
import { QuestionScheduler, type PlaybackInfo } from './playback';
import {
  PC_NAMES,
  allowedPcSet,
  answerPcSet,
  boundsOf,
  hz,
  intervalFormula,
  maxChordSize,
  midiForPc,
  ms as fmtMs,
  pct,
  sizeLabel,
  sizeName,
} from './shared';
import './pitch.css';

const AUTO_MS = 3000;
const AUTO_KEY = 'litedaw.pitch.auto';
/**
 * Longest plausible answer. A round can never be measured from epoch 0, and a
 * round left open across a module switch is capped instead of reporting hours.
 */
const ANSWER_CAP_MS = 10 * 60 * 1000;
const pcOf = (m: number) => ((m % 12) + 12) % 12;

type StagePhase = 'idle' | 'listening' | 'answering' | 'revealed';

/** Staggered reveal helper — drives `animation-delay` from the render order. */
const stag = (i: number): CSSProperties => ({ animationDelay: `${i * 70}ms` });

/* ══════════════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════════════ */

export function PitchPage() {
  const cfg = usePitch((s) => s.cfg);
  const question = usePitch((s) => s.question);
  const previous = usePitch((s) => s.previous);
  const phase = usePitch((s) => s.phase);
  const answerStartedAt = usePitch((s) => s.answerStartedAt);
  const lastResult = usePitch((s) => s.lastResult);
  const stats = usePitch((s) => s.stats);
  const attempts = usePitch((s) => s.attempts);
  const setCfg = usePitch((s) => s.setCfg);
  const toast = useToast();

  const [guess, setGuess] = useState<number[]>([]);
  const [play, setPlay] = useState<PlaybackInfo | null>(null);
  const [detail, setDetail] = useState<string>('');
  const [revealedAt, setRevealedAt] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [auto, setAuto] = useState(() => {
    try {
      return window.localStorage.getItem(AUTO_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [running, setRunning] = useState(engine.running);

  const guessRef = useRef<number[]>([]);
  const scheduler = useRef(new QuestionScheduler());
  const player = useRef<NotePlayer | null>(null);
  const preview = useRef<number | null>(null);
  const glide = useRef(false);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const advanceGuard = useRef(0);

  const { low, high } = boundsOf(cfg);

  /* ── Infrastructure ─────────────────────────────────────────────────── */

  const getPlayer = useCallback(async () => {
    if (player.current) return player.current;
    const ctx = await engine.init();
    player.current = new NotePlayer(
      ctx,
      engine.bus('pitch'),
      () => (usePitch.getState().cfg.instruments[0] ?? 'piano') as InstrumentId,
      () => 1,
      () => 0,
    );
    return player.current;
  }, []);

  useEffect(() => {
    const off = engine.onRunningChange(setRunning);
    const t = window.setInterval(() => setRunning(engine.running), 1500);
    return () => {
      off();
      window.clearInterval(t);
      scheduler.current.cancel();
      player.current?.stopAll();
      engine.releaseTap('pitch-vis');
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_KEY, auto ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, [auto]);

  const commitGuess = useCallback((next: number[]) => {
    guessRef.current = next;
    setGuess(next);
  }, []);

  /* ── Playback ───────────────────────────────────────────────────────── */

  const playQuestion = useCallback(async (q: Question) => {
    const live = usePitch.getState();
    await scheduler.current.play(q, live.cfg, {
      onPass: (pass, passes) => setPlay({ questionId: q.id, pass, passes }),
      onDone: () => {
        setPlay(null);
        const st = usePitch.getState();
        if (st.question?.id !== q.id || st.phase !== 'playing') return;
        st.setPhase('answering');
        setNow(Date.now());
      },
    });
  }, []);

  const startNew = useCallback(async () => {
    commitGuess([]);
    setDetail('');
    setShowAnswer(false);
    setRevealedAt(0);
    setPlay(null);
    await engine.init().catch(() => {});
    const q = usePitch.getState().nextQuestion();
    setNow(Date.now());
    await playQuestion(q);
  }, [commitGuess, playQuestion]);

  const replay = useCallback(
    (q: Question | null | undefined) => {
      if (!q) return;
      void playQuestion(q);
    },
    [playQuestion],
  );

  const skip = useCallback(() => {
    scheduler.current.cancel();
    setPlay(null);
    const st = usePitch.getState();
    if (st.phase === 'playing') {
      st.setPhase('answering');
      setNow(Date.now());
    }
  }, []);

  /**
   * Answering is allowed the moment a question exists — including while it is
   * still sounding. Recognising a note on the first hearing is the skill being
   * trained, so the trainer must never make the player wait for the replays to
   * drain; touching the answer surface simply moves the round into its
   * answering phase without interrupting the audio.
   */
  const beginAnswering = useCallback(() => {
    const st = usePitch.getState();
    if (st.phase === 'answering') return true;
    if (st.phase !== 'playing') return false;
    st.setPhase('answering');
    setNow(Date.now());
    return true;
  }, []);

  const drill = useCallback(
    (pair: [number, number]) => {
      const cur = usePitch.getState().cfg.focusPair;
      /* DRILL is a toggle: clicking the live pair ends the drill instead of
         silently re-arming the same one. */
      if (cur && cur[0] === pair[0] && cur[1] === pair[1]) {
        setCfg('focusPair', null);
        toast(`Drill off — ${PC_NAMES[pair[0]]} ↔ ${PC_NAMES[pair[1]]} released`, 'info');
        return;
      }
      setCfg('focusPair', pair);
      void startNew();
      toast(`Drilling ${PC_NAMES[pair[0]]} ↔ ${PC_NAMES[pair[1]]}`, 'warn');
    },
    [setCfg, startNew, toast],
  );

  /* ── Grading ────────────────────────────────────────────────────────── */

  const submit = useCallback(() => {
    const st = usePitch.getState();
    const q = st.question;
    if (!q) return;
    if (!beginAnswering()) return;
    const answer = guessRef.current;
    if (!answer.length) return;
    /* Read the stamp back after `beginAnswering` — it lives in the store and is
       stamped there, so this survives a module switch (a local ref would not). */
    const started = usePitch.getState().answerStartedAt || Date.now();
    const elapsed = Math.min(ANSWER_CAP_MS, Math.max(1, Date.now() - started));
    const g = gradeAnswer({ question: q, answerMidis: answer, ms: elapsed });
    const attempt: Attempt = {
      id: q.id,
      question: q,
      answerPcs: [...new Set(answer.map(pcOf))],
      answerMidis: answer,
      correct: g.correct,
      score: g.score,
      ms: elapsed,
      at: Date.now(),
    };
    st.record(attempt);
    setDetail(g.detail);
    setRevealedAt(Date.now());
    setShowAnswer(st.cfg.instantFeedback);
    setNow(Date.now());
  }, [beginAnswering]);

  const reveal = useCallback(() => setShowAnswer(true), []);

  /* ── Answer surface handlers ────────────────────────────────────────── */

  /**
   * Key-bed audition. Off by default (`cfg.auditionOnPick`): the question is
   * the only reference a pitch trainer may give away, so picking a key is
   * silent unless the player asks for audible confirmation. A release is
   * always honoured so a note held across a switch can never stick.
   */
  const audition = useCallback(
    (midi: number, down: boolean) => {
      if (down && !usePitch.getState().cfg.auditionOnPick) return;
      void (async () => {
        const p = await getPlayer();
        if (down) p.play(midi, 0.62, 1.5);
        else p.stop(midi, 0.1);
      })();
    },
    [getPlayer],
  );

  /**
   * Dial scrub. A deliberate drag across the ring always auditions — it is the
   * dial's own affordance and it is how the player compares detents. A plain
   * tap obeys the audition switch (see `previewOnPress` below).
   */
  const dialPreview = useCallback(
    (pc: number) => {
      const midi = midiForPc(pc, usePitch.getState().cfg);
      void (async () => {
        const p = await getPlayer();
        if (preview.current !== null && preview.current !== midi) p.stop(preview.current, 0.05);
        preview.current = midi;
        p.play(midi, 0.6, 0.85);
      })();
    },
    [getPlayer],
  );

  const pickPiano = useCallback(
    (midi: number) => {
      const st = usePitch.getState();
      if (!beginAnswering()) return;
      /* Both answer surfaces gate on the same legal set, so a key that cannot
         be part of any question can never enter the answer. */
      if (!answerPcSet(st.cfg).has(pcOf(midi))) return;
      if (st.cfg.mode === 'note') {
        commitGuess([midi]);
        return;
      }
      /* Chord mode: a drag glissando must not spray notes into the set. */
      if (glide.current) return;
      const size = maxChordSize(st.cfg);
      const cur = guessRef.current;
      if (cur.includes(midi)) commitGuess(cur.filter((m) => m !== midi));
      else if (cur.length < size) commitGuess([...cur, midi].sort((a, b) => a - b));
    },
    [beginAnswering, commitGuess],
  );

  const togglePc = useCallback(
    (pc: number) => {
      const st = usePitch.getState();
      if (!beginAnswering()) return;
      if (!answerPcSet(st.cfg).has(pc)) return;
      const size = st.cfg.mode === 'note' ? 1 : maxChordSize(st.cfg);
      const cur = guessRef.current;
      const has = cur.some((m) => pcOf(m) === pc);
      if (has) {
        commitGuess(cur.filter((m) => pcOf(m) !== pc));
        return;
      }
      if (st.cfg.mode === 'note') {
        commitGuess([midiForPc(pc, st.cfg)]);
        return;
      }
      if (cur.length >= size) return;
      commitGuess([...cur, midiForPc(pc, st.cfg)].sort((a, b) => a - b));
    },
    [beginAnswering, commitGuess],
  );

  const pickDial = useCallback(
    (pc: number) => {
      if (usePitch.getState().cfg.mode !== 'note') return;
      togglePc(pc);
    },
    [togglePc],
  );

  /* ── Hotkeys ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (tag === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'answering') replay(usePitch.getState().question);
        else void startNew();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'answering') submit();
        else if (phase === 'revealed') void startNew();
        else void startNew();
      } else if (e.key === 'r' || e.key === 'R') {
        replay(usePitch.getState().question);
      } else if (e.key === 'a' || e.key === 'A') {
        replay(usePitch.getState().previous);
      } else if (e.key === 'n' || e.key === 'N') {
        void startNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, replay, startNew, submit]);

  /* ── Clocks ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (phase === 'idle' && !play) return;
    if (phase === 'revealed' && !auto) return;
    const t = window.setInterval(() => setNow(Date.now()), 110);
    return () => window.clearInterval(t);
  }, [phase, play, auto]);

  useEffect(() => {
    if (phase !== 'revealed' || !auto || !revealedAt) return;
    if (Date.now() - revealedAt < AUTO_MS) return;
    if (advanceGuard.current === revealedAt) return;
    advanceGuard.current = revealedAt;
    void startNew();
  }, [now, phase, auto, revealedAt, startNew]);

  /* ── Derived view state ─────────────────────────────────────────────── */

  const stagePhase: StagePhase = play || phase === 'playing' ? 'listening' : phase;

  /**
   * Elapsed answering time. The store outlives this page: switching modules
   * remounts the component (every ref resets) while `phase` stays 'answering',
   * so the start is read from the store and an unset start degrades to "now"
   * rather than to epoch 0. Clamped to a sane round length.
   */
  const elapsed =
    phase === 'answering' ? Math.min(ANSWER_CAP_MS, Math.max(0, now - (answerStartedAt || now))) : 0;

  const targetPcs = useMemo(() => new Set((question?.midis ?? []).map(pcOf)), [question]);
  const guessPcs = useMemo(() => new Set(guess.map(pcOf)), [guess]);

  const keyStates = useMemo(() => {
    const st: Record<number, KeyState> = {};
    if (stagePhase === 'revealed' && question) {
      question.midis.forEach((m) => {
        st[m] = 'correct';
      });
      guess.forEach((m) => {
        st[m] = targetPcs.has(pcOf(m)) ? 'correct' : 'wrong';
      });
    } else {
      guess.forEach((m) => {
        st[m] = 'guess';
      });
    }
    return st;
  }, [stagePhase, question, guess, targetPcs]);

  const allowSet = useMemo(() => allowedPcSet(cfg), [cfg]);
  const answerSet = useMemo(() => answerPcSet(cfg), [cfg]);

  const dialItems = useMemo<DialItem<number>[]>(() => {
    const reveal = stagePhase === 'revealed' && !!question;
    return PC_NAMES.map((label, pc) => {
      let sub: string | undefined;
      if (reveal) {
        const isTarget = targetPcs.has(pc);
        const isGuess = guessPcs.has(pc);
        sub = isTarget ? (isGuess ? '✓' : 'miss') : isGuess ? '✗' : undefined;
      } else if (cfg.useScale) {
        sub = pc === ((cfg.scaleRoot % 12) + 12) % 12 ? 'R' : answerSet.has(pc) ? '·' : 'off';
      }
      return {
        value: pc,
        label,
        sub,
        /* Outside the legal answer set in either mode — a tone no question can
           contain and the generator will never ask for. */
        muted: !reveal && !answerSet.has(pc),
      };
    });
  }, [cfg.scaleRoot, cfg.useScale, answerSet, stagePhase, question, targetPcs, guessPcs]);

  const dialValues = useMemo(() => {
    if (stagePhase === 'revealed' && question) {
      return [...new Set([...targetPcs, ...guessPcs])].sort((a, b) => a - b);
    }
    return [...guessPcs].sort((a, b) => a - b);
  }, [stagePhase, question, targetPcs, guessPcs]);

  const countdown = revealedAt && auto ? Math.min(1, (now - revealedAt) / AUTO_MS) : 0;
  const accuracy = stats.total ? stats.correct / stats.total : 0;
  const voice = question ? (question.instrument === 'sample' ? 'SAMPLE' : question.instrument.toUpperCase()) : '—';
  const busy = stagePhase === 'listening';
  /* Exactly one red element at any moment: SUBMIT › REVEAL › PLAY/NEXT. */
  const primaryTransport = !(stagePhase === 'answering' || (stagePhase === 'revealed' && !showAnswer));

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="pt-page">
      <div className="pagegrid pt">
        <div className="pagegrid__main">
          <Panel
            className="pt-stage"
            variant="alu"
            icon="pitch"
            title="Pitch Trainer"
            tag={cfg.mode === 'note' ? `NOTE · ${cfg.playStyle.toUpperCase()}` : `CHORD ${sizeLabel(cfg.chordSizes)} · ${cfg.playStyle.toUpperCase()}`}
            actions={
              <div className="row pt-stage__tags">
                {allowSet.size < 12 ? (
                  <Chip tone="cyan" icon="grid">
                    POOL {allowSet.size}/12
                  </Chip>
                ) : null}
                {scaleConflicts(cfg) ? (
                  <Chip tone="amber" icon="alert">
                    SCALE DROPPED
                  </Chip>
                ) : null}
                {cfg.focusPair ? (
                  <Chip tone="amber" icon="target">
                    {PC_NAMES[cfg.focusPair[0]]}↔{PC_NAMES[cfg.focusPair[1]]}
                  </Chip>
                ) : null}
                {question?.drilled ? <Chip tone="red" icon="trend">{question.drillLabel ?? 'DRILL'}</Chip> : null}
              </div>
            }
          >
            <div className="pt-shell" data-phase={stagePhase}>
              <span className="pt-scan" aria-hidden="true" />

              {/* status strip */}
              <div className="pt-bar">
                <Led
                  on={busy || phase === 'answering' || phase === 'revealed'}
                  color={busy ? 'cyan' : stagePhase === 'revealed' ? (lastResult?.correct ? 'green' : 'red') : 'amber'}
                  pulse={busy}
                />
                <span className="pt-bar__state">
                  {stagePhase === 'idle'
                    ? 'STANDBY'
                    : busy
                      ? 'PLAYING'
                      : stagePhase === 'answering'
                        ? 'YOUR ANSWER'
                        : lastResult?.correct
                          ? 'CORRECT'
                          : 'MISSED'}
                </span>
                {play ? (
                  <Chip tone="cyan" icon="loop">
                    {play.passes > 1 ? `REPLAY ${play.pass}/${play.passes}` : 'PLAYING'}
                  </Chip>
                ) : null}
                {question ? (
                  /* Diagnostic detail: it yields to the state word and the timer
                     on a narrow instrument instead of pushing them out. */
                  <span className="pt-bar__q t-micro hide-xs" title={`Question #${question.id}`}>
                    #{question.id} · {voice}
                  </span>
                ) : null}
                <span className="panel__spacer" />
                <Readout
                  value={stagePhase === 'answering' ? fmtMs(elapsed) : lastResult && stagePhase === 'revealed' ? fmtMs(attempts[attempts.length - 1]?.ms ?? 0) : '—'}
                  unit="timer"
                  size="sm"
                  tone={stagePhase === 'answering' ? 'cyan' : 'plain'}
                />
              </div>

              {/* transport */}
              <div className="row row--wrap pt-transport">
                <Btn
                  variant={primaryTransport ? 'primary' : 'default'}
                  size="lg"
                  icon={stagePhase === 'revealed' || stagePhase === 'idle' ? 'play' : 'forward'}
                  onClick={() => void startNew()}
                >
                  {stagePhase === 'idle' ? 'Play' : stagePhase === 'revealed' ? 'Next' : 'New'}
                </Btn>
                <Btn
                  size="lg"
                  icon="loop"
                  variant="alu"
                  disabled={!question}
                  onClick={() => replay(usePitch.getState().question)}
                  title="Replay this question"
                >
                  Replay
                </Btn>
                <Btn
                  size="lg"
                  icon="rewind"
                  variant="alu"
                  disabled={!previous}
                  onClick={() => replay(usePitch.getState().previous)}
                  title="A/B — sound the previous question again"
                >
                  A/B
                </Btn>
                {busy ? (
                  <Btn size="lg" icon="forward" variant="ghost" onClick={skip} title="Stop playback and answer now">
                    Skip
                  </Btn>
                ) : null}
                <span className="panel__spacer" />
                <button
                  type="button"
                  className="pt-auto"
                  data-on={auto}
                  aria-pressed={auto}
                  onClick={() => setAuto((v) => !v)}
                  title="Advance automatically after the reveal"
                >
                  <Led on={auto} color="cyan" size="sm" />
                  AUTO
                </button>
              </div>

              {/* answer surface */}
              <div className="pt-surface" data-mode={cfg.answerInput}>
                {!question ? (
                  <Empty icon="headphones">
                    Press PLAY — a {cfg.mode === 'note' ? 'single note' : `${sizeName(cfg.chordSizes)} chord`} will sound
                  </Empty>
                ) : cfg.answerInput === 'piano' ? (
                  <div
                    className="pt-keys"
                    onPointerDownCapture={(e) => {
                      downAt.current = { x: e.clientX, y: e.clientY };
                      glide.current = false;
                    }}
                    onPointerMoveCapture={(e) => {
                      const d = downAt.current;
                      if (!d) return;
                      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 9) glide.current = true;
                    }}
                    onPointerUpCapture={() => {
                      downAt.current = null;
                    }}
                    onPointerCancelCapture={() => {
                      downAt.current = null;
                    }}
                  >
                    <PianoKeyboard
                      lowMidi={low}
                      highMidi={high}
                      states={keyStates}
                      onPick={pickPiano}
                      onAudition={audition}
                      labelMode="c"
                      height={172}
                      disabled={stagePhase === 'revealed'}
                    />
                  </div>
                ) : (
                  <div className="pt-dialwrap" data-phase={stagePhase}>
                    <DialPicker<number>
                      items={dialItems}
                      mode={cfg.mode === 'note' ? 'single' : 'multi'}
                      value={guessPcs.size ? [...guessPcs][0] : undefined}
                      onChange={pickDial}
                      values={dialValues}
                      onToggle={togglePc}
                      onPreview={dialPreview}
                      previewOnPress={cfg.auditionOnPick}
                      size={268}
                      label={cfg.mode === 'note' ? 'PITCH CLASS' : `CHORD TONES ${guess.length}/${maxChordSize(cfg)}`}
                      accent={stagePhase === 'revealed' ? (lastResult?.correct ? 'var(--green)' : 'var(--red-hi)') : 'var(--cyan)'}
                      disabled={stagePhase === 'revealed'}
                    />
                    <p className="pt-dialhint t-micro">
                      Drag the head — every detent auditions as you cross it, release to commit.{' '}
                      {cfg.auditionOnPick ? 'Taps audition too.' : 'Plain taps stay silent (Audition on pick).'}
                    </p>
                  </div>
                )}
              </div>

              {/* selection + actions */}
              <div className="pt-answer">
                <div className="pt-picked">
                  <span className="t-micro">{cfg.mode === 'note' ? 'Selected' : `Chord tones ${guess.length}/${maxChordSize(cfg)}`}</span>
                  <div className="row row--wrap pt-chips">
                    {guess.length === 0 ? (
                      <span className="pt-muted t-micro">nothing picked</span>
                    ) : (
                      guess.map((m) => (
                        <span key={m} className="pt-pick" data-pc={pcOf(m)}>
                          {midiName(m)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="row pt-actions">
                  <Btn
                    variant="ghost"
                    icon="close"
                    disabled={!guess.length || stagePhase === 'revealed'}
                    onClick={() => commitGuess([])}
                    title="Clear the selection"
                  >
                    Clear
                  </Btn>
                  {stagePhase === 'answering' ? (
                    <Btn variant="primary" size="lg" icon="check" disabled={!guess.length} onClick={submit}>
                      Submit
                    </Btn>
                  ) : stagePhase === 'revealed' && !showAnswer ? (
                    <Btn variant="primary" size="lg" icon="eye" onClick={reveal}>
                      Reveal
                    </Btn>
                  ) : null}
                </div>
              </div>

              {countdown > 0 ? (
                <span className="pt-cd" aria-hidden="true">
                  <i style={{ transform: `scaleX(${1 - countdown})` }} />
                </span>
              ) : null}

              {/* reveal */}
              {stagePhase === 'revealed' && question ? (
                <div className="pt-reveal" data-correct={lastResult?.correct || undefined}>
                  {showAnswer ? (
                    <>
                      <div className="pt-reveal__row" style={stag(0)}>
                        <span className="t-micro">Target</span>
                        <span className="pt-reveal__name">
                          {question.kind === 'note'
                            ? midiName(question.midi)
                            : chordName(question.midi, question.quality ?? 'maj')}
                        </span>
                        <span className="pt-reveal__meta">
                          {question.kind === 'note'
                            ? `${hz(question.midi)} Hz · MIDI ${question.midi}`
                            : `${question.quality ? CHORD_LABELS[question.quality] : ''} · ${question.midis.map(midiName).join(' ')}`}
                        </span>
                      </div>
                      {question.kind === 'chord' ? (
                        <div className="pt-reveal__row" style={stag(1)}>
                          <span className="t-micro">Formula</span>
                          <span className="pt-formula">{intervalFormula(question.quality)}</span>
                          <span className="pt-reveal__meta">
                            root {midiName(question.midi)} · {hz(question.midi)} Hz
                          </span>
                        </div>
                      ) : null}
                      <div className="pt-reveal__row" style={stag(2)}>
                        <span className="t-micro">You</span>
                        <span className="pt-reveal__you">
                          {attempts[attempts.length - 1]?.answerPcs.map(pitchClassName).join(' · ') || '—'}
                        </span>
                        <span className="pt-reveal__meta">{detail}</span>
                      </div>
                      <div className="pt-reveal__row" style={stag(3)}>
                        <span className="t-micro">Score</span>
                        <span className="pt-reveal__score">
                          {lastResult ? lastResult.score.toFixed(2) : '0.00'}
                          <em> / 1.00</em>
                        </span>
                        <span className="pt-reveal__meta">
                          {attempts[attempts.length - 1] ? fmtMs(attempts[attempts.length - 1].ms) : ''}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="pt-reveal__row" style={stag(0)}>
                      <span className="t-micro">Verdict</span>
                      <span className="pt-reveal__name">{lastResult?.correct ? 'CORRECT' : 'NOT THIS TIME'}</span>
                      <span className="pt-reveal__meta">Instant feedback is off — press REVEAL for the answer.</span>
                    </div>
                  )}
                  <PcStrip target={targetPcs} guess={guessPcs} shown={showAnswer} />
                </div>
              ) : null}
            </div>
          </Panel>

          <ScopeStrip live={busy} questionLabel={question ? `#${question.id} ${voice}` : 'no question'} />

          <WeaknessPanel onDrill={drill} />
        </div>

        <div className="pagegrid__side">
          <ConfigPanel />
          <SourcesPanel onToast={toast} />

          <Panel variant="alu" icon="clock" title="Procedure" tag="HOW TO FLY IT">
            <ol className="pt-proc">
              <li>Press PLAY. The question sounds once plus the configured replays.</li>
              <li>
                Answer on the {cfg.answerInput === 'piano' ? 'key bed' : 'dial'} — auditioning on pick is{' '}
                {cfg.auditionOnPick ? 'on' : 'off by default'}, so the trainer cannot hand you the answer.
              </li>
              <li>SUBMIT. The true notes go green, your misses go red.</li>
              <li>Repeat. The generator keeps feeding you the pairs you keep missing.</li>
            </ol>
            <Divider />
            <ToggleRow
              label="Auto-advance"
              hint={`Next question ${(AUTO_MS / 1000).toFixed(1)}s after the reveal`}
              icon="forward"
              on={auto}
              onChange={setAuto}
            />
            <div className="row pt-keys-help">
              <span className="t-micro">SPACE replay · ENTER submit/next · A/B previous</span>
            </div>
          </Panel>
        </div>
      </div>

      {/* Module status line: a footer of the whole module, so it stays attached
          to the instrument instead of being stranded mid-page once the layout
          stacks into one column on a phone. Segments carry a priority tier and
          are dropped from the least important end as the width shrinks. */}
      <div className="ticker pt-ticker">
        <span className="ticker__seg" data-pri="0">
          <Led size="sm" color={running ? 'green' : 'amber'} />
          AUDIO {running ? 'LIVE' : 'ARM'}
        </span>
        <span className="ticker__seg" data-pri="0">
          Q {question ? `#${question.id}` : '—'}
        </span>
        <span className="ticker__seg" data-pri="1">
          ACC {pct(accuracy)}
        </span>
        <span className="ticker__seg" data-pri="1">
          SCORE {stats.score.toFixed(1)}
        </span>
        <span className="ticker__seg" data-pri="2">
          N {stats.total}
        </span>
        <span className="ticker__seg" data-pri="3">
          T {stagePhase === 'answering' ? fmtMs(elapsed) : '—'}
        </span>
        <span className="ticker__seg hide-xs" data-pri="3">
          POOL {allowSet.size}/12
        </span>
        <span className="ticker__seg hide-xs" data-pri="4">
          SRC {voice}
        </span>
        <span className="ticker__seg hide-xs" data-pri="4">
          FOCUS {cfg.focusPair ? `${PC_NAMES[cfg.focusPair[0]]}↔${PC_NAMES[cfg.focusPair[1]]}` : '—'}
        </span>
        <span className="ticker__seg hide-xs" data-pri="4">
          ADAPT {cfg.adaptivity.toFixed(2)}
        </span>
        <span className="ticker__seg hide-xs" data-pri="5">
          SR {(engine.sampleRate / 1000).toFixed(1)}K
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ANSWER OVERLAY STRIP — 12 pitch classes, lit by the outcome
   ══════════════════════════════════════════════════════════════════════════ */

function PcStrip({ target, guess, shown }: { target: Set<number>; guess: Set<number>; shown: boolean }) {
  return (
    <div className="pt-pcstrip-ans">
      <span className="t-micro">{shown ? 'Pitch classes' : 'Pitch classes (hidden)'}</span>
      <div className="pt-pcstrip">
        {PC_NAMES.map((n, pc) => {
          const isT = target.has(pc);
          const isG = guess.has(pc);
          const state = !shown ? 'dim' : isT && isG ? 'both' : isT ? 'target' : isG ? 'wrong' : 'off';
          return (
            <span key={pc} className="pt-pccell pt-pccell--sm" data-state={state}>
              <span>{n}</span>
              <em>{state === 'both' ? '✓' : state === 'target' ? 'MISS' : state === 'wrong' ? '✗' : ''}</em>
            </span>
          );
        })}
      </div>    </div>
  );
}
