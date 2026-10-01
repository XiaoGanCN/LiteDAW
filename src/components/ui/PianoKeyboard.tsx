/* ============================================================================
   LiteDAW · PIANO KEYBOARD
   Vector-drawn key bed with pointer glissando, auditioning and answer states.
   ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type KeyState = 'target' | 'correct' | 'wrong' | 'guess' | 'ghost' | 'root' | 'dim';

const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
const PC_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface PianoKeyboardProps {
  lowMidi: number;
  highMidi: number;
  /** Per-note decoration map, keyed by MIDI number. */
  states?: Record<number, KeyState>;
  /** Fired when the user picks a note (tap or glissando entry). */
  onPick?: (midi: number) => void;
  /** Audition: called on press and release so the synth can hold the note. */
  onAudition?: (midi: number, down: boolean) => void;
  labelMode?: 'none' | 'c' | 'all';
  height?: number;
  /** Show MIDI note numbers under the C keys. */
  showOctaveMarks?: boolean;
  disabled?: boolean;
  className?: string;
}

export function PianoKeyboard({
  lowMidi,
  highMidi,
  states = {},
  onPick,
  onAudition,
  labelMode = 'c',
  height = 150,
  showOctaveMarks = true,
  disabled = false,
  className = '',
}: PianoKeyboardProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [held, setHeld] = useState<number | null>(null);
  const dragging = useRef(false);
  const lastNote = useRef<number | null>(null);
  const [hint, setHint] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { whites, blacks, whiteCount } = useMemo(() => {
    const w: { midi: number; index: number }[] = [];
    const b: { midi: number; leftWhite: number }[] = [];
    let wi = 0;
    for (let m = lowMidi; m <= highMidi; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (WHITE_PC.includes(pc)) {
        w.push({ midi: m, index: wi });
        wi++;
      } else {
        b.push({ midi: m, leftWhite: wi - 1 });
      }
    }
    return { whites: w, blacks: b, whiteCount: wi };
  }, [lowMidi, highMidi]);

  const ww = whiteCount > 0 ? width / whiteCount : 20;
  const bw = Math.max(6, ww * 0.62);

  const noteAt = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      // black keys take priority in their upper 62% band
      if (y < height * 0.62) {
        for (const k of blacks) {
          const cx = (k.leftWhite + 1) * ww;
          if (Math.abs(x - cx) <= bw / 2) return k.midi;
        }
      }
      const idx = Math.min(whiteCount - 1, Math.max(0, Math.floor(x / ww)));
      const hit = whites[idx];
      return hit ? hit.midi : null;
    },
    [blacks, bw, height, whiteCount, whites, ww],
  );

  const press = (midi: number | null) => {
    if (midi === null) return;
    if (lastNote.current === midi) return;
    if (lastNote.current !== null) onAudition?.(lastNote.current, false);
    lastNote.current = midi;
    setHeld(midi);
    onAudition?.(midi, true);
  };
  const release = () => {
    if (lastNote.current !== null) onAudition?.(lastNote.current, false);
    lastNote.current = null;
    setHeld(null);
    dragging.current = false;
  };

  useEffect(() => () => {
    if (lastNote.current !== null) onAudition?.(lastNote.current, false);
  }, [onAudition]);

  const stateOf = (m: number): KeyState | undefined => states[m];

  return (
    <div
      ref={wrapRef}
      className={`piano ${className}`}
      style={{ height, opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : undefined }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
        const m = noteAt(e.clientX, e.clientY);
        if (m !== null) {
          press(m);
          onPick?.(m);
        }
      }}
      onPointerMove={(e) => {
        const m = noteAt(e.clientX, e.clientY);
        setHint(m);
        if (!dragging.current) return;
        if (m !== null && m !== lastNote.current) {
          press(m);
          onPick?.(m);
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={() => {
        setHint(null);
        release();
      }}
      role="group"
      aria-label="Piano keyboard"
    >
      {/* white bed */}
      {whites.map(({ midi, index }) => {
        const pc = midi % 12;
        const st = stateOf(midi);
        const showLabel = labelMode === 'all' || (labelMode === 'c' && pc === 0);
        return (
          <div
            key={midi}
            className="pkey pkey--white"
            data-state={st}
            data-held={held === midi || undefined}
            data-hint={hint === midi || undefined}
            style={{ left: index * ww, width: ww - 1, height }}
            title={`${PC_NAME[pc]}${Math.floor(midi / 12) - 1}`}
          >
            <span className="pkey__gloss" />
            {showLabel && <span className="pkey__label">{PC_NAME[pc]}</span>}
            {showOctaveMarks && pc === 0 && (
              <span className="pkey__oct">{Math.floor(midi / 12) - 1}</span>
            )}
          </div>
        );
      })}

      {/* black keys */}
      {blacks.map(({ midi, leftWhite }) => {
        const pc = midi % 12;
        const st = stateOf(midi);
        return (
          <div
            key={midi}
            className="pkey pkey--black"
            data-state={st}
            data-held={held === midi || undefined}
            data-hint={hint === midi || undefined}
            style={{ left: (leftWhite + 1) * ww - bw / 2, width: bw, height: height * 0.62 }}
            title={`${PC_NAME[pc]}${Math.floor(midi / 12) - 1}`}
          >
            <span className="pkey__gloss" />
            {labelMode === 'all' && <span className="pkey__label pkey__label--b">{PC_NAME[pc]}</span>}
          </div>
        );
      })}
    </div>
  );
}

export const NOTE_NAMES = PC_NAME;
export const midiToName = (m: number) => `${PC_NAME[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
export const midiToPc = (m: number) => ((m % 12) + 12) % 12;
export const pcName = (pc: number) => PC_NAME[((pc % 12) + 12) % 12];
