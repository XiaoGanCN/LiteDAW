/* Headless model test: bundles the pure trainer logic and drives the real
   generator, so flavour/size/inversion claims can be checked deterministically
   instead of by ear. */
// @ts-expect-error stubs for the browser globals zustand's persist touches
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
// @ts-expect-error minimal window
globalThis.window = globalThis;

const { usePitch, allowedPcs, qualitiesFor, answerablePcs, CHORD_SIZE_CHOICES } = await import('../../src/state/pitch');
const { CHORD_INTERVALS, pitchClassName } = await import('../../src/audio/dsp');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, ev = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${ev ? ` — ${ev}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${ev ? ` — ${ev}` : ''}`);
  }
};

const gen = (n: number) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(usePitch.getState().nextQuestion().rootPc);
  return out;
};

console.log('\nA. Chord sizes are all reachable');
for (const size of CHORD_SIZE_CHOICES) {
  const shapes = (Object.keys(CHORD_INTERVALS) as (keyof typeof CHORD_INTERVALS)[]).filter(
    (q) => CHORD_INTERVALS[q].length === size,
  );
  check(`size ${size} has at least one quality`, shapes.length > 0, `${shapes.length} shape(s)`);
}

console.log('\nB. Chord flavour constrains note mode');
for (const flavor of ['major', 'minor', 'both'] as const) {
  usePitch.getState().setCfg('mode', 'note');
  usePitch.getState().setCfg('chordFlavor', flavor);
  usePitch.getState().setCfg('useScale', false);
  usePitch.getState().setCfg('focusPair', null);
  usePitch.getState().setCfg('adaptivity', 0);
  const pool = new Set(allowedPcs(usePitch.getState().cfg));
  const asked = gen(400);
  const outside = [...new Set(asked.filter((pc) => !pool.has(pc)))];
  check(
    `flavour "${flavor}" never asks a tone outside its pool`,
    outside.length === 0,
    `pool ${pool.size}/12, 400 questions, ${outside.length} stray (${outside.map(pitchClassName).join(',') || 'none'})`,
  );
}

console.log('\nC. A stale focus pair cannot escape the pool');
usePitch.getState().setCfg('mode', 'note');
usePitch.getState().setCfg('chordFlavor', 'major');
usePitch.getState().setCfg('useScale', false);
usePitch.getState().setCfg('adaptivity', 0);
usePitch.getState().setCfg('focusPair', [3, 6]); // both outside the major pool
const majorPool = new Set(allowedPcs(usePitch.getState().cfg));
const stray = [...new Set(gen(300).filter((pc) => !majorPool.has(pc)))];
check('focus pair outside the pool is ignored', stray.length === 0, `${stray.length} stray`);

console.log('\nD. Every legal chord size can actually be generated');
for (const size of CHORD_SIZE_CHOICES) {
  usePitch.getState().setCfg('mode', 'chord');
  usePitch.getState().setCfg('chordFlavor', 'both');
  usePitch.getState().setCfg('chordSizes', [size]);
  usePitch.getState().setCfg('inversions', false);
  const seen = new Set<number>();
  for (let i = 0; i < 160; i++) seen.add(usePitch.getState().nextQuestion().midis.length);
  check(`size ${size} produces ${size}-voice questions`, seen.has(size) && seen.size === 1, `saw sizes ${[...seen].join(',')}`);
}

console.log('\nE. Inversions never duplicate a voice');
for (const size of CHORD_SIZE_CHOICES) {
  usePitch.getState().setCfg('mode', 'chord');
  usePitch.getState().setCfg('chordSizes', [size]);
  usePitch.getState().setCfg('inversions', true);
  let dupes = 0;
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const q = usePitch.getState().nextQuestion();
    const m = q.midis;
    if (new Set(m).size !== m.length) dupes++;
    for (let k = 1; k < m.length; k++) if (m[k] <= m[k - 1]) bad++;
  }
  check(`size ${size}: no duplicate or unordered voices over 400 questions`, dupes === 0 && bad === 0, `${dupes} dupes, ${bad} ordering faults`);
}

console.log('\nF. The answer surface covers every askable tone');
usePitch.getState().setCfg('mode', 'chord');
usePitch.getState().setCfg('chordFlavor', 'both');
usePitch.getState().setCfg('chordSizes', [...CHORD_SIZE_CHOICES]);
const ans = new Set(answerablePcs(usePitch.getState().cfg));
let uncovered = 0;
for (let i = 0; i < 600; i++) {
  const q = usePitch.getState().nextQuestion();
  for (const m of q.midis) if (!ans.has(((m % 12) + 12) % 12)) uncovered++;
}
check('every generated tone is selectable on the answer surface', uncovered === 0, `${uncovered} uncovered tones in 600 chords`);

console.log('\nG. Mixed sizes really mix, and the voice count is honoured');
for (const inv of [false, true]) {
  usePitch.getState().setCfg('mode', 'chord');
  usePitch.getState().setCfg('chordFlavor', 'both');
  usePitch.getState().setCfg('chordSizes', [3, 5]);
  usePitch.getState().setCfg('inversions', inv);
  const sizes = new Set<number>();
  const offenders: string[] = [];
  for (let i = 0; i < 300; i++) {
    const q = usePitch.getState().nextQuestion();
    sizes.add(q.midis.length);
    if (q.midis.length !== 3 && q.midis.length !== 5 && offenders.length < 3) {
      offenders.push(`${q.quality} asked ${q.midis.length} voices [${q.midis.join(',')}]`);
    }
  }
  check(
    `[3,5] with inversions=${inv} only ever asks 3 or 5 voices`,
    [...sizes].every((n) => n === 3 || n === 5),
    `saw ${[...sizes].sort().join(',')}${offenders.length ? ` · ${offenders.join(' · ')}` : ''}`,
  );
}

console.log('\nH. Voice count is honoured across every size and inversion setting');
for (const inv of [false, true]) {
  const bad: string[] = [];
  for (const size of CHORD_SIZE_CHOICES) {
    usePitch.getState().setCfg('mode', 'chord');
    usePitch.getState().setCfg('chordFlavor', 'both');
    usePitch.getState().setCfg('chordSizes', [size]);
    usePitch.getState().setCfg('inversions', inv);
    for (let i = 0; i < 300; i++) {
      const q = usePitch.getState().nextQuestion();
      if (q.midis.length !== size && bad.length < 4) {
        bad.push(`size ${size} → ${q.midis.length} (${q.quality} [${q.midis.join(',')}])`);
      }
    }
  }
  check(`inversions=${inv}: asked size always equals played voices`, bad.length === 0, bad.join(' · ') || 'clean across 2/3/4/5');
}

console.log(`\n${pass}/${pass + fail} model checks passed`);
if (fail) process.exitCode = 1;
