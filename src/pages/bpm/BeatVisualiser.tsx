/* ============================================================================
   LiteDAW · BPM TRAINER · BEAT VISUALISER
   The centrepiece instrument. One requestAnimationFrame loop reads the
   metronome's audio clock and drives, in perfect sync:
     · a swinging pendulum arm (angle from the fractional beat phase) with a
       motion-blur trail and a glowing counterweight,
     · a ring of `numerator` beat lamps that flash on the click and decay,
     · a bar-progress arc, a bar.beat readout and a subdivision pip counter,
     · subdivision ticks that fire on sub-clicks from `metronome.drain()`,
     · a four-bar scrolling timeline strip with accents marked taller.
   When the reference is silent the same instrument is driven by the player's
   own dialled tempo, so the panel is never dead — but never leaks the answer.
   ========================================================================= */

import { useEffect, useRef, type ReactNode } from 'react';
import { engine } from '../../audio/engine';
import { metronome } from '../../audio/metronome';

export type VisPhase = 'idle' | 'listening' | 'answering' | 'revealed' | 'tapping';

export interface BeatVisualiserProps {
  phase: VisPhase;
  numerator: number;
  subdivision: number;
  /** Bars in the round (0 = endless). */
  bars: number;
  /** Context time the reference stops (0 = open ended). */
  endsAt: number;
  /** Master switch — off forces pure listening. */
  live: boolean;
  /** Tempo used when the reference is silent (the player's dialled answer). */
  previewBpm: number;
  children?: ReactNode;
}

const TAU = Math.PI * 2;
const CX = 300;
const CY = 150;
const RING = 108;
const ARCR = 78;
const FACE = 64;
const PIVOT_Y = 232;
const AX = 86;
const TIP_Y = 70;
const CW_Y = PIVOT_Y + 34;
const ARM_AMP = (26 * Math.PI) / 180;
const TRAIL = 5;
const MAX_BEATS = 16;
const MAX_SUB = 8;
const ARC_C = TAU * ARCR;
const TICK_NODES = 96;
const AMBIENT_BPM = 44;

const beatAngle = (i: number, n: number) => (i / Math.max(1, n)) * 360 - 90;

const pol = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

export function BeatVisualiser({
  phase,
  numerator,
  subdivision,
  bars,
  endsAt,
  live,
  previewBpm,
  children,
}: BeatVisualiserProps) {
  const lampRefs = useRef<(SVGGElement | null)[]>([]);
  const subRefs = useRef<(SVGLineElement | null)[]>([]);
  const ghostRefs = useRef<(SVGGElement | null)[]>([]);
  const rodRef = useRef<SVGGElement | null>(null);
  const cwRef = useRef<SVGGElement | null>(null);
  const arcRef = useRef<SVGCircleElement | null>(null);
  const barRef = useRef<SVGTextElement | null>(null);
  const countRef = useRef<SVGTextElement | null>(null);
  const subRef = useRef<SVGTextElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tickRefs = useRef<HTMLElement[]>([]);

  /* The rAF loop mounts once; live props are funnelled through a ref. */
  const propsRef = useRef<BeatVisualiserProps>({ phase, numerator, subdivision, bars, endsAt, live, previewBpm });
  useEffect(() => {
    propsRef.current = { phase, numerator, subdivision, bars, endsAt, live, previewBpm };
  });

  /* ── Timeline strip: a fixed pool of ticks, positioned imperatively. ──── */
  useEffect(() => {
    const host = stripRef.current;
    if (!host) return;
    const made: HTMLElement[] = [];
    for (let i = 0; i < TICK_NODES; i++) {
      const el = document.createElement('i');
      el.className = 'bpm-tick';
      host.appendChild(el);
      made.push(el);
    }
    tickRefs.current = made;
    return () => {
      made.forEach((el) => el.remove());
      tickRefs.current = [];
    };
  }, []);

  /* ── The one animation loop. ─────────────────────────────────────────── */
  useEffect(() => {
    const st = {
      k: new Float64Array(MAX_BEATS),
      ks: new Float64Array(MAX_BEATS * MAX_SUB),
      q: new Int16Array(MAX_BEATS),
      qs: new Int16Array(MAX_BEATS * MAX_SUB),
      cwq: -1,
      cur: -1,
      amp: 0,
      wall: 0,
      trail: [] as number[],
      hist: [] as { t: number; accent: boolean }[],
      histAudio: true,
      lastPreviewBeat: -1,
      stripW: 0,
      wasRunning: false,
    };

    const strip = stripRef.current;
    const ro = new ResizeObserver(() => {
      st.stripW = strip?.clientWidth ?? 0;
    });
    if (strip) {
      ro.observe(strip);
      st.stripW = strip.clientWidth;
    }

    const tick = () => {
      const p = propsRef.current;
      const now = performance.now() / 1000;
      const dt = st.wall ? Math.min(0.05, Math.max(0.002, now - st.wall)) : 0.016;
      st.wall = now;
      const audio = engine.time;
      const running = metronome.running;

      /* ── Clock: metronome when it plays, the dial otherwise. ─────────── */
      let beat = 0;
      let bar = 0;
      let frac = 0;
      let barDur = 0;
      let clocked = false;
      let clock = now;

      if (running) {
        const pos = metronome.position();
        const c = metronome.cfg;
        barDur = c.beatsPerBar * (60 / Math.max(1, c.bpm)) * (4 / Math.max(1, c.beatUnit));
        beat = pos.beat;
        bar = pos.bar;
        frac = pos.phase;
        clocked = true;
        clock = audio;
        if (!st.wasRunning || !st.histAudio) {
          st.hist.length = 0;
          st.trail.length = 0;
          st.histAudio = true;
          st.lastPreviewBeat = -1;
        }
      } else if (p.previewBpm > 20) {
        const beats = now * (p.previewBpm / 60);
        const bi = Math.floor(beats);
        beat = ((bi % Math.max(1, p.numerator)) + Math.max(1, p.numerator)) % Math.max(1, p.numerator);
        bar = Math.floor(bi / Math.max(1, p.numerator));
        frac = beats - bi;
        barDur = (Math.max(1, p.numerator) * 60) / p.previewBpm;
        clocked = true;
        if (st.histAudio || bi !== st.lastPreviewBeat) {
          if (st.histAudio) {
            st.hist.length = 0;
            st.trail.length = 0;
            st.histAudio = false;
          }
          if (bi !== st.lastPreviewBeat) {
            st.lastPreviewBeat = bi;
            st.k[beat] = 1;
            st.hist.push({ t: now, accent: beat === 0 });
          }
        }
      } else {
        /* Passive: a slow idle sway keeps the instrument alive without a clock. */
        st.lastPreviewBeat = -1;
        frac = (now * (AMBIENT_BPM / 60)) % 1;
        if (!st.histAudio) {
          st.hist.length = 0;
          st.histAudio = true;
        }
      }
      st.wasRunning = running;

      /* ── Consume scheduled clicks (always, so the queue cannot grow). ── */
      if (running) {
        for (const e of metronome.drain(audio)) {
          if (e.sub === 0) {
            if (e.beat >= 0 && e.beat < MAX_BEATS) st.k[e.beat] = 1;
            st.hist.push({ t: e.time, accent: e.accent });
          } else {
            const si = e.beat * MAX_SUB + e.sub;
            if (si >= 0 && si < st.ks.length) st.ks[si] = 1;
          }
        }
      }

      /* ── Ballistics: fast attack, 120 ms exponential-ish decay. ──────── */
      const dk = dt / 0.12;
      const ds = dt / 0.09;
      for (let i = 0; i < MAX_BEATS; i++) if (st.k[i] > 0) st.k[i] = Math.max(0, st.k[i] - dk);
      for (let i = 0; i < st.ks.length; i++) if (st.ks[i] > 0) st.ks[i] = Math.max(0, st.ks[i] - ds);

      /* ── Pendulum: click happens at the extremity of the swing. ──────── */
      const ampTarget = clocked ? 1 : p.phase === 'idle' ? 0.4 : p.phase === 'revealed' ? 0 : 0.22;
      st.amp += (ampTarget - st.amp) * Math.min(1, dt * 4.5);
      const angle = -(ARM_AMP * st.amp * Math.cos(TAU * frac) * 180) / Math.PI;

      if (p.live) {
        const rot = `rotate(${angle.toFixed(2)} ${AX} ${PIVOT_Y})`;
        rodRef.current?.setAttribute('transform', rot);
        cwRef.current?.setAttribute('transform', rot);
        if (!st.trail.length || Math.abs(st.trail[st.trail.length - 1] - angle) > 0.25) {
          st.trail.push(angle);
          if (st.trail.length > TRAIL) st.trail.shift();
        }
        for (let g = 0; g < ghostRefs.current.length; g++) {
          const el = ghostRefs.current[g];
          if (!el) continue;
          const a = st.trail[Math.max(0, st.trail.length - 2 - g)] ?? angle;
          el.setAttribute('transform', `rotate(${a.toFixed(2)} ${AX} ${PIVOT_Y})`);
        }

        /* ── Beat lamps. ─────────────────────────────────────────────── */
        const n = Math.max(1, p.numerator);
        let hottest = 0;
        for (let i = 0; i < MAX_BEATS; i++) {
          const el = lampRefs.current[i];
          if (!el) continue;
          if (i >= n) continue;
          if (st.k[i] > hottest) hottest = st.k[i];
          const q = Math.round(st.k[i] * 24);
          if (q !== st.q[i]) {
            st.q[i] = q;
            el.style.setProperty('--k', (q / 24).toFixed(3));
          }
        }
        if (clocked && st.cur !== beat) {
          lampRefs.current[st.cur]?.removeAttribute('data-cur');
          lampRefs.current[beat]?.setAttribute('data-cur', '1');
          st.cur = beat;
        } else if (!clocked && st.cur !== -1) {
          lampRefs.current[st.cur]?.removeAttribute('data-cur');
          st.cur = -1;
        }
        const cwq = Math.round(hottest * 12);
        if (cwq !== st.cwq) {
          st.cwq = cwq;
          cwRef.current?.style.setProperty('--k', (cwq / 12).toFixed(3));
        }

        /* ── Subdivision ticks. ──────────────────────────────────────── */
        for (let i = 0; i < st.ks.length; i++) {
          const el = subRefs.current[i];
          if (!el) continue;
          const q = Math.round(st.ks[i] * 16);
          if (q !== st.qs[i]) {
            st.qs[i] = q;
            el.style.setProperty('--k', (q / 16).toFixed(3));
          }
        }

        /* ── Bar arc + numeric readouts. ─────────────────────────────── */
        if (arcRef.current) {
          const prog = clocked ? (beat + frac) / Math.max(1, p.numerator) : 0;
          arcRef.current.style.strokeDashoffset = String(ARC_C * (1 - Math.min(1, Math.max(0, prog))));
        }
        if (barRef.current) {
          barRef.current.textContent = clocked ? `${bar + 1}.${beat + 1}` : '-.--';
        }
        if (subRef.current) {
          const pip = clocked ? Math.min(p.subdivision, Math.floor(frac * p.subdivision) + 1) : 0;
          subRef.current.textContent = clocked ? `${pip}/${Math.max(1, p.subdivision)}` : `0/${Math.max(1, p.subdivision)}`;
        }
        if (countRef.current) {
          if (running && p.endsAt > 0 && barDur > 0) {
            const left = Math.max(0, (p.endsAt - audio) / barDur);
            countRef.current.textContent = `${left.toFixed(1)} BAR`;
          } else if (running) {
            countRef.current.textContent = 'ENDLESS';
          } else {
            countRef.current.textContent = p.bars > 0 ? 'REF STOPPED' : 'FREE RUN';
          }
        }

        /* ── Timeline strip. ─────────────────────────────────────────── */
        const w = st.stripW;
        if (w > 0 && barDur > 0) {
          const span = Math.max(0.4, 4 * barDur);
          while (st.hist.length && clock - st.hist[0].t > span * 1.08) st.hist.shift();
          const nodes = tickRefs.current;
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const e = st.hist[st.hist.length - 1 - i];
            if (!e) {
              if (el.dataset.on !== '0') {
                el.dataset.on = '0';
                el.style.opacity = '0';
              }
              continue;
            }
            const x = w - ((clock - e.t) / span) * w;
            if (el.dataset.on !== '1') el.dataset.on = '1';
            el.dataset.accent = e.accent ? '1' : '0';
            el.style.opacity = '1';
            el.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };

    let raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const n = Math.max(1, numerator);
  const beats = Array.from({ length: n }, (_, i) => i);

  return (
    <div className="bpm-stage" data-phase={phase} data-live={live ? 'true' : 'false'}>
      <div className="bpm-stage__frame">
        <div className="bpm-stage__gutter bpm-stage__gutter--l">
          <span className="t-micro">Beats / bar</span>
          <span className="bpm-stage__big t-num">{n}</span>
          <span className="t-micro">Sub / beat</span>
          <span className="bpm-stage__small t-num">{Math.max(1, subdivision)}</span>
        </div>

        <svg
          className="bpm-stage__svg"
          viewBox="0 0 440 300"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Live beat visualiser"
        >
          <defs>
            <radialGradient id="bpm-face" cx="50%" cy="32%" r="80%">
              <stop offset="0%" stopColor="var(--carbon-700)" />
              <stop offset="62%" stopColor="var(--carbon-850)" />
              <stop offset="100%" stopColor="var(--carbon-950)" />
            </radialGradient>
          </defs>

          {/* ── Pendulum ─────────────────────────────────────────────── */}
          {Array.from({ length: TRAIL - 1 }, (_, i) => (
            <g
              key={i}
              className="bpm-ghost"
              style={{ opacity: 0.26 - i * 0.05 }}
              ref={(el) => {
                ghostRefs.current[i] = el;
              }}
            >
              <line x1={AX} y1={PIVOT_Y} x2={AX} y2={TIP_Y} className="bpm-rod bpm-rod--ghost" />
            </g>
          ))}
          <g
            className="bpm-rodgroup"
            ref={(el) => {
              rodRef.current = el;
            }}
          >
            <line x1={AX} y1={PIVOT_Y} x2={AX} y2={TIP_Y} className="bpm-rod" />
            <line x1={AX - 1.1} y1={PIVOT_Y - 4} x2={AX - 1.1} y2={TIP_Y + 4} className="bpm-rod__hi" />
            <line x1={AX} y1={PIVOT_Y} x2={AX} y2={CW_Y} className="bpm-rod bpm-rod--tail" />
            <rect x={AX - 13} y={88} width={26} height={36} rx={3} className="bpm-bob" />
            <path d={`M${AX - 13} 100h26M${AX - 13} 112h26`} className="bpm-bob-line" />
          </g>
          <g
            className="bpm-cwgroup"
            ref={(el) => {
              cwRef.current = el;
            }}
          >
            <circle cx={AX} cy={CW_Y} r={13} className="bpm-cw-halo" />
            <circle cx={AX} cy={CW_Y} r={7} className="bpm-cw" />
          </g>
          <path d={`M${AX - 17} ${PIVOT_Y + 9}L${AX} ${PIVOT_Y - 5}L${AX + 17} ${PIVOT_Y + 9}`} className="bpm-bracket" />
          <circle cx={AX} cy={PIVOT_Y} r={5.5} className="bpm-pivot" />
          <rect x={AX - 27} y={276} width={54} height={13} rx={2} className="bpm-base" />
          <text x={AX} y={266} className="bpm-base__cap" textAnchor="middle">
            TEMPO PENDULUM
          </text>

          {/* ── Dial ─────────────────────────────────────────────────── */}
          <circle cx={CX} cy={CY} r={RING + 26} className="bpm-dial__rim" />
          <circle cx={CX} cy={CY} r={FACE} className="bpm-dial__face" fill="url(#bpm-face)" />
          <circle cx={CX} cy={CY} r={ARCR} className="bpm-arc__track" />
          <circle
            cx={CX}
            cy={CY}
            r={ARCR}
            className="bpm-arc__prog"
            strokeDasharray={ARC_C}
            strokeDashoffset={ARC_C}
            transform={`rotate(-90 ${CX} ${CY})`}
            ref={(el) => {
              arcRef.current = el;
            }}
          />

          {beats.map((i) => {
            const [x1, y1] = pol(beatAngle(i, n), FACE + 2);
            const [x2, y2] = pol(beatAngle(i, n), RING - 26);
            return <line key={`sp${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className="bpm-spoke" />;
          })}

          {subdivision > 1 &&
            beats.flatMap((i) =>
              Array.from({ length: subdivision - 1 }, (_, s) => {
                const deg = beatAngle(i, n) + ((s + 1) * 360) / (n * subdivision);
                const [x1, y1] = pol(deg, RING - 15);
                const [x2, y2] = pol(deg, RING - 25);
                const idx = i * MAX_SUB + (s + 1);
                return (
                  <line
                    key={`st${i}-${s}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className="bpm-subtick"
                    ref={(el) => {
                      subRefs.current[idx] = el;
                    }}
                  />
                );
              }),
            )}

          {beats.map((i) => {
            const [lx, ly] = pol(beatAngle(i, n), RING);
            return (
              <g
                key={`lp${i}`}
                className="bpm-lamp"
                data-accent={i === 0 ? 'true' : undefined}
                ref={(el) => {
                  lampRefs.current[i] = el;
                }}
              >
                <circle cx={lx} cy={ly} r={16} className="bpm-lamp__halo" />
                <circle cx={lx} cy={ly} r={11} className="bpm-lamp__base" />
                <circle cx={lx} cy={ly} r={11} className="bpm-lamp__lit" />
                <text x={lx} y={ly} className="bpm-lamp__num" textAnchor="middle" dominantBaseline="central">
                  {i + 1}
                </text>
              </g>
            );
          })}

          <text x={CX} y={CY + 58} className="bpm-dial__cap" textAnchor="middle">
            BARS · BEATS
          </text>
          <text
            x={CX}
            y={CY + 26}
            className="bpm-dial__big"
            textAnchor="middle"
            ref={(el) => {
              barRef.current = el;
            }}
          >
            -.--
          </text>
          <text
            x={CX}
            y={CY - 30}
            className="bpm-dial__count"
            textAnchor="middle"
            ref={(el) => {
              countRef.current = el;
            }}
          >
            --
          </text>
          <text
            x={CX}
            y={CY - 46}
            className="bpm-dial__cap"
            textAnchor="middle"
            ref={(el) => {
              subRef.current = el;
            }}
          >
            0/1
          </text>
        </svg>

        <div className="bpm-stage__gutter bpm-stage__gutter--r">
          <span className="t-micro">Reference</span>
          <span className="bpm-stage__big t-num">{bars > 0 ? bars : '∞'}</span>
          <span className="t-micro">Bars</span>
        </div>
      </div>

      <div className="bpm-strip">
        <span className="bpm-strip__rail" />
        <div className="bpm-strip__ticks" ref={stripRef} />
        <span className="bpm-strip__cap t-micro">4-bar scroll · accents tall</span>
      </div>

      <span className="bpm-stage__scan" aria-hidden="true" />
      <span className="bpm-stage__glass" aria-hidden="true" />
      {children}
    </div>
  );
}
