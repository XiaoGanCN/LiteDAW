/* ============================================================================
   LiteDAW · PITCH PAGE — configuration rack
   Question shape, range/scale, playback voicing, adaptive model and the
   answer input selector. Every control writes straight through to the store.
   ========================================================================= */

import { useMemo } from 'react';
import { Knob } from '../../components/ui/Hardware';
import { Btn, Chip, Divider, Field, NumDrag, Panel, Segmented, ToggleRow } from '../../components/ui/kit';
import {
  CHORD_INTERVALS,
  chordName,
  pitchClassName,
  type ChordQuality,
  type ScaleName,
} from '../../audio/dsp';
import { CHORD_SIZE_CHOICES, allowedPcs, rangeMidis, scaleConflicts, usePitch } from '../../state/pitch';
import type { AnswerInput, ChordFlavor, PlayStyle } from '../../state/pitch';
import {
  ALL_QUALITIES,
  PC_NAMES,
  activeQualities,
  boundsOf,
  noteName,
  qualityLabel,
  qualitiesAtSize,
  scaleOptions,
  sizeLabel,
} from './shared';

export function ConfigPanel() {
  const cfg = usePitch((s) => s.cfg);
  const setCfg = usePitch((s) => s.setCfg);
  const resetConfig = usePitch((s) => s.resetConfig);
  const confusion = usePitch((s) => s.confusion);
  /* The store owns the ranking; we only memoise its result against the matrix. */
  const weak = useMemo(() => usePitch.getState().weakPairs(6), [confusion]);
  const { low, high } = boundsOf(cfg);
  const pool = rangeMidis(cfg);
  const active = activeQualities(cfg);
  const allowed = useMemo(() => allowedPcs(cfg), [cfg]);
  const scaleDropped = scaleConflicts(cfg);
  /* No selected size is backed by a quality — the generator falls back to the
     whole flavour set, so say so rather than pretending the filter applied. */
  const sizeMismatch = active.some((q) => !cfg.chordSizes.includes(CHORD_INTERVALS[q].length));

  const octaveLo = Math.min(cfg.octaveLow, cfg.octaveHigh);
  const octaveHi = Math.max(cfg.octaveLow, cfg.octaveHigh);

  const toggleSize = (size: number) => {
    const on = cfg.chordSizes.includes(size);
    /* Never empty: the generator has to draw a voice count from somewhere. */
    if (on && cfg.chordSizes.length === 1) return;
    const next = on ? cfg.chordSizes.filter((s) => s !== size) : [...cfg.chordSizes, size];
    setCfg('chordSizes', [...next].sort((a, b) => a - b));
  };

  return (
    <Panel
      variant="alu"
      icon="gear"
      title="Configuration"
      tag={cfg.mode === 'note' ? `SINGLE TONE · ${sizeLabel(cfg.chordSizes)}` : `CHORD ${sizeLabel(cfg.chordSizes)}`}
      actions={
        <Btn size="sm" variant="ghost" icon="refresh" onClick={resetConfig} title="Restore factory configuration">
          Reset
        </Btn>
      }
    >
      {/* ── Question shape ─────────────────────────────────────────────── */}
      <Field
        label="Question"
        icon="pitch"
        hint="A chord root is chosen, then voiced from the selected qualities."
      >
        <Segmented
          value={cfg.mode}
          onChange={(v) => setCfg('mode', v)}
          accent
          ariaLabel="Question kind"
          options={[
            { value: 'note', label: 'Note', icon: 'note' },
            { value: 'chord', label: 'Chord', icon: 'layers' },
          ]}
        />
      </Field>

      <Field
        label="Chord flavour"
        icon="layers"
        hint="A hard constraint on both modes: Chord picks the qualities that are voiced, Note asks only their chord tones."
      >
        <Segmented<ChordFlavor>
          value={cfg.chordFlavor}
          onChange={(v) => setCfg('chordFlavor', v)}
          ariaLabel="Chord flavour"
          options={[
            { value: 'major', label: 'Maj' },
            { value: 'minor', label: 'Min' },
            { value: 'both', label: 'Both' },
            { value: 'custom', label: 'Cust' },
          ]}
        />
      </Field>

      {cfg.chordFlavor === 'custom' ? (
        <Field label="Explicit qualities" icon="eq" hint="Only these are drawn (intersected with the chord sizes).">
          <div className="row row--wrap pt-chips">
            {ALL_QUALITIES.map((q) => {
              const on = cfg.qualities.includes(q);
              return (
                <button
                  key={q}
                  type="button"
                  className="chip pt-chip"
                  data-on={on}
                  aria-pressed={on}
                  onClick={() =>
                    setCfg(
                      'qualities',
                      on ? cfg.qualities.filter((x) => x !== q) : ([...cfg.qualities, q] as ChordQuality[]),
                    )
                  }
                >
                  {qualityLabel(q)}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}

      <Field
        label="Chord sizes"
        icon="eq"
        hint="Any mix — one question can be a triad, the next a seventh. At least one size stays on."
      >
        <div className="row row--wrap pt-chips pt-sizes" role="group" aria-label="Chord sizes">
          {CHORD_SIZE_CHOICES.map((size) => {
            const on = cfg.chordSizes.includes(size);
            const shapes = qualitiesAtSize(cfg, size).length;
            /* No quality of this flavour can be voiced that way (2 and 5 never
               can): the size cannot be switched on, and it says why. A size
               that is already on but has become empty stays switchable off so
               the player is never locked out. */
            const empty = shapes === 0;
            const locked = on && cfg.chordSizes.length === 1;
            return (
              <button
                key={size}
                type="button"
                className="chip pt-chip pt-sizechip"
                data-on={on}
                data-empty={empty || undefined}
                aria-pressed={on}
                disabled={locked || (!on && empty)}
                title={
                  locked
                    ? 'At least one chord size stays on'
                    : empty
                      ? `No ${size}-note shape in this flavour`
                      : `${size} notes · ${shapes} shape${shapes > 1 ? 's' : ''} in this flavour`
                }
                onClick={() => toggleSize(size)}
              >
                {size}
                <em>{shapes}</em>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="pt-activeq">
        <span className="t-micro">
          Active qualities · {active.length} · pool {allowed.length}/12 pitch classes
        </span>
        <div className="row row--wrap pt-chips">
          {active.map((q) => (
            <span key={q} className="pt-qtag" title={CHORD_INTERVALS[q].join(' · ')}>
              {chordName(60, q).replace(/^C/, '') || 'maj'}
            </span>
          ))}
        </div>
        {sizeMismatch ? (
          <Chip tone="amber" icon="alert">
            No {cfg.chordSizes.filter((s) => qualitiesAtSize(cfg, s).length === 0).join('/')}-note quality — the full set is used
          </Chip>
        ) : null}
        {scaleDropped ? (
          <Chip tone="amber" icon="alert">
            Scale excludes every allowed tone — the scale filter is ignored
          </Chip>
        ) : null}
      </div>

      <Divider />

      {/* ── Range ──────────────────────────────────────────────────────── */}
      <Field label="Octave range" icon="piano" hint={`${noteName(low)} … ${noteName(high)} · ${pool.length} keys`}>
        <div className="row pt-inline">
          <span className="t-micro">Low</span>
          <NumDrag
            value={octaveLo}
            min={0}
            max={7}
            step={1}
            unit="oct"
            onChange={(v) => {
              const n = Math.round(v);
              setCfg('octaveLow', n);
              if (n > octaveHi) setCfg('octaveHigh', n);
            }}
            width={92}
          />
          <span className="t-micro">High</span>
          <NumDrag
            value={octaveHi}
            min={0}
            max={7}
            step={1}
            unit="oct"
            onChange={(v) => {
              const n = Math.round(v);
              setCfg('octaveHigh', n);
              if (n < octaveLo) setCfg('octaveLow', n);
            }}
            width={92}
          />
        </div>
      </Field>

      <ToggleRow
        label="Constrain to scale"
        hint="Only scale degrees become question roots"
        icon="grid"
        on={cfg.useScale}
        onChange={(v) => setCfg('useScale', v)}
      />

      {cfg.useScale ? (
        <div className="row pt-inline pt-scale">
          <Field label="Scale" icon="grid" className="grow">
            <select
              className="input"
              value={cfg.scaleName}
              onChange={(e) => setCfg('scaleName', e.target.value as ScaleName)}
            >
              {scaleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Knob
            value={cfg.scaleRoot}
            onChange={(v) => setCfg('scaleRoot', ((Math.round(v) % 12) + 12) % 12)}
            min={0}
            max={11}
            step={1}
            size={54}
            label="Tonic"
            format={(v) => pitchClassName(Math.round(v))}
          />
        </div>
      ) : null}

      <Divider />

      {/* ── Playback voicing ───────────────────────────────────────────── */}
      <Field label="Play style" icon="waveform">
        <Segmented<PlayStyle>
          value={cfg.playStyle}
          onChange={(v) => setCfg('playStyle', v)}
          ariaLabel="Play style"
          options={[
            { value: 'block', label: 'Block', icon: 'layers' },
            { value: 'arpeggio', label: 'Arp', icon: 'pitchShift' },
          ]}
        />
      </Field>

      <div className="row pt-inline pt-3up">
        <Field label="Sustain" icon="clock">
          <NumDrag
            value={cfg.sustain}
            min={0.3}
            max={6}
            step={0.1}
            unit="s"
            onChange={(v) => setCfg('sustain', Number(v.toFixed(2)))}
            width={94}
          />
        </Field>
        <Field label="Replays" icon="loop">
          <NumDrag
            value={cfg.replays}
            min={0}
            max={5}
            step={1}
            unit="×"
            onChange={(v) => setCfg('replays', Math.round(v))}
            width={86}
          />
        </Field>
        <Field label="Detune ±" icon="tuner">
          <NumDrag
            value={cfg.detuneJitter}
            min={0}
            max={50}
            step={1}
            unit="ct"
            onChange={(v) => setCfg('detuneJitter', Math.round(v))}
            width={86}
          />
        </Field>
      </div>

      <ToggleRow
        label="Inversions"
        hint="Random voicings — the root may not be the lowest note"
        icon="layers"
        on={cfg.inversions}
        onChange={(v) => setCfg('inversions', v)}
        disabled={cfg.mode === 'note'}
      />
      <ToggleRow
        label="Instant feedback"
        hint="Off: the answer is held back until you ask for it"
        icon="eye"
        on={cfg.instantFeedback}
        onChange={(v) => setCfg('instantFeedback', v)}
      />
      <ToggleRow
        label="Audition on pick"
        hint="Off (default): picking a key or tapping the dial is silent — only the dial's drag scrub sounds. On: every pick is confirmed audibly."
        icon="speakerOff"
        on={cfg.auditionOnPick}
        onChange={(v) => setCfg('auditionOnPick', v)}
      />

      <Divider />

      {/* ── Adaptive model ─────────────────────────────────────────────── */}
      <div className="row pt-adapt">
        <Knob
          value={cfg.adaptivity}
          onChange={(v) => setCfg('adaptivity', Number(v.toFixed(2)))}
          min={0}
          max={1}
          step={0.05}
          size={60}
          label="Adaptivity"
          resetTo={0.6}
          accent="var(--amber)"
          format={(v) => v.toFixed(2)}
        />
        <div className="col grow pt-adapt__txt">
          <span className="t-label">Weakness weighting</span>
          {/* A slider, matching the Tempo trainer's adaptivity control: the two
              modules expose the same concept, so they read the same way. The
              knob beside it stays for fine adjustment. */}
          <input
            className="range range--slim"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.adaptivity}
            onChange={(e) => setCfg('adaptivity', Number(e.target.value))}
            aria-label="Adaptivity slider"
          />
          <span className="field__hint">
            {cfg.adaptivity <= 0.02
              ? '0.00 = uniform random questions.'
              : cfg.adaptivity >= 0.98
                ? '1.00 = always drill the weakest material.'
                : `${cfg.adaptivity.toFixed(2)} = ${Math.round(cfg.adaptivity * 100)}% of questions chase your error rate, the rest stay random.`}
          </span>
        </div>
      </div>

      <Field
        label="Focus pair"
        icon="target"
        hint="A drill pair takes 75% of questions, across random octaves and random instruments."
      >
        <div className="row row--wrap pt-chips">
          <button
            type="button"
            className="chip pt-chip"
            data-on={!cfg.focusPair}
            aria-pressed={!cfg.focusPair}
            onClick={() => setCfg('focusPair', null)}
          >
            None
          </button>
          {weak.map((p) => {
            const on = cfg.focusPair?.[0] === p.a && cfg.focusPair?.[1] === p.b;
            return (
              <button
                key={`${p.a}-${p.b}`}
                type="button"
                className="chip pt-chip"
                data-on={on}
                aria-pressed={on}
                title={`${p.aToB} × ${pitchClassName(p.a)}→${pitchClassName(p.b)} · ${p.bToA} × reverse`}
                onClick={() => setCfg('focusPair', on ? null : [p.a, p.b])}
              >
                {PC_NAMES[p.a]}↔{PC_NAMES[p.b]}
              </button>
            );
          })}
          {weak.length === 0 ? <span className="t-micro">No confusion data yet</span> : null}
        </div>
      </Field>

      <Divider />

      <Field label="Answer input" icon="pointer" hint="Both surfaces grade pitch-class sets.">
        <Segmented<AnswerInput>
          value={cfg.answerInput}
          onChange={(v) => setCfg('answerInput', v)}
          accent
          ariaLabel="Answer input"
          options={[
            { value: 'piano', label: 'Keyboard', icon: 'piano' },
            { value: 'dial', label: 'Dial', icon: 'dial' },
          ]}
        />
      </Field>
    </Panel>
  );
}
