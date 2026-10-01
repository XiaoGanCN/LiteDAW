/* ============================================================================
   LiteDAW · FX SURFACES
   <FxDefs>  — SVG filter primitives (lens defect, phosphor bloom, weave plate)
   <FxStack> — the compositing overlay that renders the artifact/defect layer
   ========================================================================= */

import { memo, useEffect, useMemo, useState } from 'react';

/** Static turbulence tile reused by the grain overlay — generated once per theme. */
function noiseTile(freq = 0.82, octaves = 4) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="190">
<filter id="n" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/>
<feComponentTransfer><feFuncR type="linear" slope="1.35" intercept="-0.18"/><feFuncG type="linear" slope="1.35" intercept="-0.18"/><feFuncB type="linear" slope="1.35" intercept="-0.18"/></feComponentTransfer>
</filter>
<rect width="190" height="190" filter="url(#n)"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/**
 * SVG `<defs>` mounted once at the app root.
 * `#litedaw-defect` is the semi-realistic lens/CRT defect: barrel displacement,
 * lateral chroma separation and a soft unsharp bloom. Applied through the
 * `.fx-defect` utility class so it can be switched off without a re-render.
 */
export const FxDefs = memo(function FxDefs() {
  return (
    <svg className="fx-probe" aria-hidden="true" focusable="false">
      <defs>
        {/* ── CRT / lens defect ─────────────────────────────────────────── */}
        <filter id="litedaw-defect" x="-4%" y="-4%" width="108%" height="108%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0009 0.0035" numOctaves="2" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="disp" />
          <feColorMatrix
            in="disp"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="base"
          />
          <feOffset in="base" dx="0.7" dy="0" result="rShift" />
          <feOffset in="base" dx="-0.7" dy="0" result="bShift" />
          <feColorMatrix
            in="rShift"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="rOnly"
          />
          <feColorMatrix
            in="bShift"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="bOnly"
          />
          <feColorMatrix
            in="base"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="gOnly"
          />
          <feBlend in="rOnly" in2="gOnly" mode="screen" result="rg" />
          <feBlend in="rg" in2="bOnly" mode="screen" result="chroma" />
          <feGaussianBlur in="chroma" stdDeviation="2.6" result="blur" />
          <feComposite in="blur" in2="chroma" operator="in" result="blurIn" />
          <feBlend in="chroma" in2="blurIn" mode="screen" />
        </filter>

        {/* ── Phosphor bloom for indicator lamps ────────────────────────── */}
        <filter id="litedaw-bloom" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feComponentTransfer in="b" result="bb">
            <feFuncA type="linear" slope="1.7" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="bb" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* ── Carbon-fibre weave plate (hatched procedural fill) ────────── */}
        <pattern id="litedaw-weave" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#0d1114" />
          <path d="M0 0 8 8M-2 6 2 10M6 -2 10 2" stroke="#161c21" strokeWidth="1.6" />
          <path d="M8 0 0 8M10 6 6 10M2 -2 -2 2" stroke="#0a0d10" strokeWidth="1.6" />
        </pattern>

        {/* ── Brushed aluminium gradient ────────────────────────────────── */}
        <linearGradient id="litedaw-alu" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5d6771" />
          <stop offset="18%" stopColor="#39424a" />
          <stop offset="52%" stopColor="#232b31" />
          <stop offset="84%" stopColor="#2f383f" />
          <stop offset="100%" stopColor="#4a545e" />
        </linearGradient>

        {/* ── Signal gradients ─────────────────────────────────────────── */}
        <linearGradient id="litedaw-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2d47" />
          <stop offset="46%" stopColor="#c70f28" />
          <stop offset="100%" stopColor="#7c0817" />
        </linearGradient>
        <radialGradient id="litedaw-glow-red" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff2d47" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c70f28" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
});

/**
 * The artifact / defect compositing stack. Purely decorative, pointer-events
 * free, and completely neutralised at `--fx: 0` so the flat pristine look is
 * pixel-identical to a design with no effects at all.
 */
export const FxStack = memo(function FxStack() {
  const tile = useMemo(() => noiseTile(), []);
  return (
    <div className="fx-stack" aria-hidden="true" style={{ ['--fx-noise-tile' as string]: tile }}>
      <div className="fx-aero" />
      <div className="fx-bloom" />
      <div className="fx-scan" />
      <div className="fx-roll" />
      <div className="fx-noise" />
      <div className="fx-chroma" />
      <div className="fx-vignette" />
    </div>
  );
});

/**
 * Live read-out of the effect level so canvas painters can scale their own
 * grain/scanline work to match the CSS layer. Values are 0..1.
 */
export function useFxLevel() {
  const [level, setLevel] = useState(1);
  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--fx');
      const n = Number.parseFloat(raw);
      setLevel(Number.isFinite(n) ? n : 1);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fx'] });
    return () => obs.disconnect();
  }, []);
  return level;
}
