# LiteScope — Audio Instrument Specification (for a web/TypeScript re-implementation)

**Purpose.** This is an implementation-ready specification of the five audio instruments ("scopes") in
the sibling Android/Kotlin project **LiteScope**, written so that a browser/TypeScript application can
reproduce the same *measurement behaviour* and the same *visual quality* without reading the Kotlin.

**Source of truth.** All constants, formulas and algorithms below were read from:

```
LiteScope/app/src/main/java/com/litescope/
  view/ScopeView.kt (599)  view/SpectrumView.kt (381)  view/WaveformView.kt (651)
  view/VectorScopeView.kt (258)  view/WaterfallView.kt (211)  view/MeterView.kt (709)
  view/ScopeTheme.kt (177)  audio/SpectrumAnalyzer.kt (255)  audio/LevelMeter.kt (91)
  audio/AudioCaptureEngine.kt (266)  dsp/Fft.kt (91)  dsp/Windows.kt (63)  dsp/Decimator.kt (87)
  dsp/Frames.kt (49)  dsp/Colormaps.kt (151)  dsp/Notes.kt (37)  core/FreqAxis.kt (213)
  core/WaterfallBuffer.kt (148)  core/CursorStore.kt (125)  core/AudioBus.kt (273)
  core/ScopeHub.kt (168)  core/Prefs.kt (552)  core/Tool.kt (43)
```

Values marked **[derived]** are arithmetic consequences of the source constants and are *not* written
in the source; values marked **not specified** do not exist in the source at all. Everything else is
a verbatim constant.

**Task-section mapping** (the section numbering of the request → sections here):

| Requested item | Section |
|---|---|
| 1 Signal chain | §1 |
| 2 FFT details | §2 |
| 3 Frequency axis | §3 |
| 4 Spectrum painting | §4 |
| 5 Waveform painting | §6 |
| 6 Vector scope | §7 |
| 7 Level meter | §8 |
| 8 Theme | §9 |
| 9 Frame pacing | §10 |
| 10 Copy vs Android-specific | §11 |
| *(extra instrument: Waterfall, requested via `WaterfallView`/`WaterfallBuffer`/`Colormaps`)* | §5 |

---

## 0. Global constants and defaults

### 0.1 Units and layout conventions

| Concept | Value | Notes |
|---|---|---|
| Layout unit | **dp** (`resources.displayMetrics.density`) | Every metric below is dp unless stated. `dp(v) = v * density`. On the web, define 1 dp = 1 CSS px and scale by `devicePixelRatio` for the backing store. |
| Amp/full scale | linear, 1.0 = 0 dBFS | A full-scale sine has amplitude 1.0 |
| dB definition | `20*log10(amp)` | `Notes.toDb` returns `-140` for `amp <= 1e-7`; the analyser clamps to `1e-9` (−180 dB) |
| Analysis floor (hard) | −180 dBFS | `20*log10(max(amp, 1e-9f))` |
| Display floor (soft) | prefs `dbFloor`, default **−100** | clamp −140…−20 |
| Display ceiling | prefs `dbTop`, default **0** | clamp −60…+20; displayed value is `max(dbTop, dbFloor+10)` |
| Meter floor | **−60 dBFS** | `MeterView.MIN_DB` |
| Canvas sizes | Tool default window geometry (dp), `Tool.kt` | Spectrum 360×190, Waterfall 360×240, Wave 360×170, Vector 220×220, Meters 150×230 |
| Min window | Spectrum/Waterfall/Wave 120×80 dp, Vector 96×80, Meters 74×90 | usability thresholds only |

### 0.2 Shared layout metrics (`ScopeMetrics`, `ScopeView.kt`)

| Constant | Value | Used by |
|---|---|---|
| `GUTTER_LEFT_DP` | **34** | Spectrum (dB scale), Waterfall (time scale) |
| `GUTTER_BOTTOM_DP` | **15** | Spectrum, Waterfall (frequency labels) |
| `PAD_DP` | **3** | all |

Plot rectangle rules (identical in Spectrum and Waterfall so stacked windows align line-for-line):

```
showLabels = (width > 150dp && height > 72dp)      // Spectrum, Wave
showLabels = (width > 140dp && height > 70dp)      // Waterfall
showLabels = (width > 120dp && height > 120dp)     // Vector
left   = showLabels ? dp(34) : dp(3)               // Spectrum/Waterfall only
top    = dp(3)
right  = width  - dp(3)
bottom = height - (showLabels ? dp(15) : dp(3))
abort drawing if (right-left < 8px || bottom-top < 8px)
```

Waveform deliberately has **no left gutter** ("the wave scope has no vertical scale of its own"):
`left = dp(3)`, `top = dp(3)`, `right = width - dp(3)`, `bottom = height - (showLabels ? dp(13) : dp(3))`.

### 0.3 Shared paint styles (`ScopeView.init`)

| Paint | Style | Width | Flags |
|---|---|---|---|
| `bgPaint` | FILL | — | **no** anti-alias |
| `gridPaint` | STROKE | `dp(1.0)` | AA |
| `gridMajorPaint` | STROKE | `dp(1.0)` | AA |
| `labelPaint` | text | `textSize = 9 * density`, `Typeface.MONOSPACE` | AA |
| `tracePaint` | STROKE | `dp(1.5)`, `strokeJoin = ROUND` | AA |
| `traceFillPaint` | FILL | — | AA |
| `secondaryPaint` | STROKE | `dp(1.1)` | AA |
| `cursorPaint` | STROKE | `dp(1.1)` | AA |
| `panelPaint` | FILL | — | AA |
| `glowPaint` | STROKE, `strokeJoin = ROUND` | varies | AA |
| `backdropPaint` | FILL | — | AA |

### 0.4 Preference defaults and ranges (`Prefs.kt`)

| Pref | Default | Range / options | Consumed by |
|---|---|---|---|
| `captureRate` | `0` (auto) | {AUTO, 48000, 44100, 96000, 192000} | capture |
| `analysisDivisor` | `1` | candidates {1,2,3,4,6,8,12,16}, must divide capture rate exactly | analyser |
| `spectrumChannel` | `0` | 0 = (L+R)/2, 1 = L, 2 = R | analyser |
| `fftSize` | **2048** | 256…8192, options {256,512,1024,2048,4096,8192} | analyser |
| `windowType` | `"HANN"` | HANN, HAMMING, BLACKMAN_HARRIS, FLAT_TOP, RECTANGULAR | analyser |
| `fftOverlap` | `1` | 0 = none, 1 = 50 %, 2 = 75 % | analyser |
| `spectrumAveraging` | **0.55** | 0…0.95 | analyser |
| `spectrumTilt` | `false` | bool | analyser |
| `tiltDbPerOctave` | **3.0** | 0…6 (UI) | analyser |
| `dbFloor` | **−100** | −140…−20 (UI range slider allows −180…20) | spectrum, waterfall |
| `dbTop` | **0** | −60…+20 | spectrum, waterfall |
| `peakHold` | `true` | bool | spectrum |
| `peakDecayDbPerSec` | **14** | 0…60 dB/s | spectrum |
| `freqScaleBlend` | **1.0** | 0 = linear … 1 = log | axis |
| `cursorNoteEnabled` | `true` | bool | readouts |
| `tuningHz` | **440** | 400…480 | note readout |
| `showReadout` | `true` | bool | all |
| `waterfallHistorySec` | **12** | Prefs 1…300 (UI slider 2…300) | waterfall |
| `waterfallColormap` | `0` (MAGMA) | 7 maps | waterfall |
| `waterfallNewestOnTop` | `true` | bool | waterfall |
| `waterfallFps` | **24** | 5…60 | waterfall |
| `waterfallFreeze` | `false` | bool | waterfall |
| `waveStereoMode` | `0` | 0 overlay, 1 split, 2 sum | wave |
| `waveMsPerDiv` | **5** | 0.02…200 (10 divisions ⇒ default 50 ms across) | wave |
| `waveGainDbL/R` | `0` / `0` | −40…+60 dB | wave |
| `waveLinkGain` | `true` | bool | wave |
| `waveTriggerMode` | `0` | 0 auto, 1 normal, 2 free-run | wave |
| `waveTriggerLevel` | `0` | −1…+1 FS | wave |
| `waveTriggerEdge` | `0` | 0 rising, 1 falling | wave |
| `waveTriggerSource` | `0` | 0 (L+R)/2, 1 L, 2 R | wave |
| `waveSource` | `0` | 0 L/R overlay, 1 L, 2 R, 3 mid, 4 side | wave |
| `waveAcCoupling` | `true` | bool | wave |
| `waveShowMeasurements` | `true` | bool | wave |
| `waveDots` | `false` | **never read by any view — not implemented** | — |
| `vectorMode` | `0` | 0 Lissajous, 1 goniometer | vector |
| `vectorPersistence` | **0.72** | 0…0.97 | vector |
| `vectorGain` | **1.0** | 0.05…8 | vector |
| `vectorShowAxes` | `true` | bool | vector |
| `vectorTraceMs` | **20** | 2…200 ms | vector |
| `meterHoldMs` | **1500** | 0…10000 ms | levels |
| `meterShowCorrelation` | `true` | bool | meters |
| `meterShowNumeric` | `true` | bool | meters |
| `meterLayout` | `0` | 0 split L/R, 1 combined L+R, 2 both | meters |
| `meterLabelPosition` | `0` | 0 under bars, 1 on bars (comments mention BETWEEN/OUTSIDE; **only 0 and 1 are reachable**) | meters |
| `meterSlim` | `true` | bool | meters |
| `meterShowScale` | `true` | bool | meters |
| `overlayOpacity` | `100` | 20…100 (%) | backdrop |
| `linkZoom` | `true` | bool | spectrum ↔ waterfall axis + cursors |
| `renderFps` | **30** | 5…60 | every view |
| `scopeBackdrop` | `0` | 0 plain, 1 dot matrix, 2 vignette, 3 scanlines | every view |
| `traceGlow` | `true` | bool | every trace |
| `accentTheme` | `0` | 0…7 | theme |
| `scopeBackground` | `0` | 0…7 | theme |

Any pref **write** increments `Prefs.generation` and notifies listeners; the analyser thread
re-configures when the generation changes (see §1.7), and every attached view calls `invalidate()`.

---

## 1. Signal chain

### 1.1 Capture (Android-specific, replace on the web)

`AudioCaptureEngine` captures the audio the device is **playing** (never the microphone) via
`AudioPlaybackCaptureConfiguration` + `AudioRecord`, matching `USAGE_MEDIA | USAGE_GAME | USAGE_UNKNOWN`.

| Constant | Value |
|---|---|
| Channel mask | `CHANNEL_IN_STEREO` (always) |
| Encodings tried, in order | `ENCODING_PCM_FLOAT`, then `ENCODING_PCM_16BIT` |
| Rate candidates, in order (deduped) | requested rate (if > 0) → `PROPERTY_OUTPUT_SAMPLE_RATE` (device native) → 48000 → 44100 |
| `AudioRecord` buffer bytes | `max(minBuf*2, rate * 2 * 2 / 5)` ⇒ at least **0.4 s** of stereo |
| Read chunk | **2048 frames** per blocking read (`chunkFrames = 2048`) |
| PCM16 → float | `sample / 32768f` |
| Mono capture | duplicated into both channels by the ring buffer |
| Capture thread | `Thread.MAX_PRIORITY`, name `LiteScope-Capture` |
| Ring history | `HISTORY_SECONDS = 6f` seconds of interleaved stereo float |

The negotiated rate/channels are read back from the `AudioRecord` and reported, so the frequency axis
is always derived from the *effective* rate (`sampleRate` may differ from the request).

> **Web mapping.** Replace with a Web Audio graph tap: `AudioWorkletNode` (a `MediaStreamAudioSourceNode`
> or a tap on the app's own output bus) feeding a stereo ring buffer, or `getDisplayMedia({audio:true})`
> for "what the machine is playing". The Kotlin ring/analyser split maps 1:1 onto *worklet/worker
> (producer + analyser)* vs *main thread (views)*.

### 1.2 Ring buffer (`AudioBus`)

* Interleaved **stereo float32**; `capacityFrames = (sampleRate * 6).toInt()` (≥ `sampleRate`).
* The capture thread is the **only writer**; readers address data by **absolute frame index** (frames
  written since the last `configure`), so every consumer keeps its own cursor.
* `configure()` resets `framesWritten = 0`, clears `stopped`.
* Mono input is written twice (L = R).
* `oldestFrame = max(0, framesWritten − capacityFrames)`; reads clamp to `[oldest, framesWritten)`.
* `awaitFrames(cursor, needed, timeout)` blocks until `framesWritten − cursor >= needed` or the timeout
  (the analyser uses **200 ms**), returning false on `stopped`/timeout.
* `stereoEnvelope(out, start, frames, columns)` — one pass over the ring producing per-column min/max
  for 4 stereo-derived signals: **`COLUMNS_STRIDE = 8` floats per column**, in this order:

| Slot | Signal | Definition |
|---|---|---|
| 0,1 | `minL, maxL` | L |
| 2,3 | `minR, maxR` | R |
| 4,5 | `minSum, maxSum` | `L + R` (literal sum) |
| 6,7 | `minDiff, maxDiff` | `L − R` (literal difference) |

Column index for sample `f` of `count` frames: `c = floor(f * columns / count)`.
Columns that receive **no** samples (very long time base) are filled by **copying the previous
column**. Returns `columns` (or 0 when there is no data).

### 1.3 Analysis thread (`SpectrumAnalyzer`, thread `LiteScope-FFT`)

One process-wide thread does all FFT/level work; every view only reads published results, so a tool
shown twice never doubles CPU. Per-iteration pseudocode (exact order):

```
loop while running:
  if (bus.capacity == 0 || bus.sampleRate <= 0)            -> sleep 50 ms; continue
  if (prefs.generation != cfgGeneration
      || bus.sampleRate != cfgCaptureRate)                 -> reconfigure()
  if (cursor < 0 || cursor < bus.oldestFrame) cursor = bus.oldestFrame
  if (!bus.awaitFrames(cursor, hopIn, 200 ms))             -> if (!running) break
                                                              if (bus.stopped) sleep 80 ms
                                                              continue
  got = bus.copyStereo(block, cursor, hopIn)               // interleaved stereo
  if (got <= 0)                                            -> sleep 10 ms; continue
  cursor += got
  hub.publishLevels(levelMeter.process(block, got, prefs.meterHoldMs))   // §8.1
  monoCount = downmix(block, got, prefs.spectrumChannel, mono)           // §1.4
  decCount  = decimator ? decimator.process(mono, monoCount, decimated)  // §1.5
                        : copy(mono -> decimated, monoCount)
  appendFifo(decimated, decCount)                          // append, clamp to space left
  while (fifoLen >= fftSize):
      publishFrame(prefs.spectrumAveraging, prefs.spectrumTilt, prefs.tiltDbPerOctave)  // §2.9
      drop = min(hopOut, fifoLen)
      memmove(fifo, fifo+drop, fifoLen-drop); fifoLen -= drop
```

**Levels are measured on the *raw* (non-decimated) block, before the down-mix** — the meter, the
vector readout and the waveform RMS/peak readout are all full-bandwidth (§8.1).

### 1.4 Down-mix for the spectrum

`prefs.spectrumChannel`: `0` → `(L + R) * 0.5`, `1` → `L`, `2` → `R`. No other processing.

### 1.5 Decimation (analysis sample rate)

`div = prefs.analysisDivisor` (default 1). If `captureRate % div != 0` the divisor is forced to **1**
(the analyser stops there; the settings UI additionally only offers divisors that divide the rate
exactly *and* leave ≥ 1000 Hz). `analysisRate = captureRate / div`. Candidates offered by the UI:
{1, 2, 3, 4, 6, 8, 12, 16}.

`FirDecimator(factor, taps = 63)` — windowed-sinc low-pass followed by integer decimation, with a
persistent delay line so block boundaries stay continuous:

| Parameter | Value |
|---|---|
| Taps | 63 (even values are bumped to `taps+1`, so always odd) |
| `m` | `(n−1)/2` = 31 |
| Cut-off | `fc = 0.46 / factor` (normalised, 1.0 = input sample rate) ⇒ **0.46 × analysisRate** = 92 % of the decimated Nyquist |
| Kernel | `sinc = (x == 0) ? 2*fc : sin(2π·fc·x)/(π·x)`, `x = i − m` |
| Window | Blackman: `w = 0.42 − 0.5·cos(2πi/(n−1)) + 0.08·cos(4πi/(n−1))` |
| Normalisation | `h[i] /= Σh` ⇒ **unity DC gain** |
| Emit rule | write one output every `factor` input samples: `y = Σ_{k=0..n-1} h[k] · delay[pos−1−k]` (newest first) |
| Group delay | `(n−1)/2` = **31 input samples** |
| Return | number of samples written ≤ `inputLen/factor + 1` |

Verified behaviour (unit tests): 100 Hz tone keeps unity gain (±5 %); a 20 kHz tone sampled at 48 kHz
and decimated by 4 is suppressed to **< 0.05 peak** (> 26 dB) — i.e. no aliasing folding into band.

### 1.6 Frame / hop sizing (exact)

Computed in `reconfigure()`, in this order:

```
overlapHop = when (fftOverlap) { 0 -> fftSize; 1 -> fftSize/2; else -> fftSize/4 }.coerceAtLeast(1)
minHop     = max(analysisRate / 60, 1)                 // MAX_FRAMES_PER_SECOND = 60
outHop     = max(overlapHop, minHop)
inHop      = ceil(outHop / div) * div                  // ((outHop + div - 1) / div) * div
ringCap    = bus.capacity (or fftSize*2*div when 0)
maxIn      = max(ringCap / 2, div)
if (inHop > maxIn) { inHop = (maxIn / div) * div; if (inHop < div) inHop = div; outHop = inHop / div }
hopIn  = inHop
hopOut = max(1, outHop)
```

Buffers allocated: `block = hopIn*2`, `mono = hopIn`, `decimated = hopIn/div + 2`,
`fifo = fftSize + hopOut + 8` (the FIFO is **cleared**, `fifoLen = 0`, and the read cursor is reset to
`bus.oldestFrame` on every reconfigure).

**Frame rate = `analysisRate / hopOut`**, capped at ≈60/s by `minHop`. Because `minHop` uses integer
division the cap is approximate (e.g. 16000/266 = 60.15 fps). Worked examples:

| capture | div | analysisRate | N | overlap | binHz | hopIn | hopOut | frames/s | latency (N/analysisRate) |
|---|---|---|---|---|---|---|---|---|---|
| 48000 | 1 | 48000 | 2048 | 50 % | 23.4375 | 1024 | 1024 | **46.88** | 42.7 ms |
| 48000 | 1 | 48000 | 2048 | 0 % | 23.4375 | 2048 | 2048 | 23.44 | 42.7 ms |
| 48000 | 1 | 48000 | 2048 | 75 % | 23.4375 | 800 | 800 | **60.00** | 42.7 ms |
| 48000 | 1 | 48000 | 256 | any | 187.5 | 800 | 800 | 60.00 | 5.3 ms |
| 48000 | 1 | 48000 | 8192 | 50 % | 5.8594 | 4096 | 4096 | 11.72 | 170.7 ms |
| 48000 | 3 | 16000 | 2048 | 50 % | 7.8125 | 1026 | 1024 | **15.62** | 128.0 ms |
| 48000 | 3 | 16000 | 1024 | 50 % | 15.625 | 801 | 800 | 60.00 | 64.0 ms |
| 44100 | 1 | 44100 | 2048 | 50 % | 21.5332 | 1024 | 1024 | 43.07 | 46.4 ms |

### 1.7 Hand-off to the views (pull model, no queues)

| Consumer | Transport | Semantics |
|---|---|---|
| `SpectrumView` | `AtomicReference<SpectrumFrame?>` (`hub.spectrum`) | Newest frame only; intermediate frames are silently dropped if the view draws slower than the analyser. Views call `get()` once per draw. |
| `WaterfallBuffer` | direct call from the analyser inside `hub.publishSpectrum` | Rate-throttled row push (§5.1) — the only place every published frame is considered. |
| Meters, Vector readouts, Wave RMS/peak | `AtomicReference<LevelFrame?>` (`hub.levels`) | Newest `LevelFrame` only. |
| `WaveformView`, `VectorScopeView` | read the **ring buffer** directly (`copyStereo`, `copyLatestStereo`, `stereoEnvelope`) | No copying until draw time; one pass per frame. |
| Cursors | shared `CursorStore` (§4.9) | Spectrum and Waterfall both draw the same cursors when `linkZoom` is on. |
| Frequency axis | shared `FreqAxis` (`hub.freqAxis`) when `linkZoom`, else one private `FreqAxis` per view | `axis()` calls `configure(hub.nyquistHz, prefs.freqScaleBlend)` every draw. |

`hub.nyquistHz = bus.sampleRate / 2f`.

**Reconfigure trigger:** *any* pref write bumps the generation ⇒ the analyser reallocates the FFT,
window and FIFO and restarts averaging (`firstFrame = true`). Changing an unrelated preference
(theme, fps) therefore produces a short spectrum transient. `WaterfallBuffer` is only cleared on
capture-format change (`onCaptureFormatChanged`), not on arbitrary pref writes.

---

## 2. FFT details

### 2.1 Transform (`Fft.kt`)

| Property | Value |
|---|---|
| Algorithm | in-place iterative **radix-2** complex FFT, decimation-in-time with bit-reversal permutation |
| Size constraint | power of two, ≥ 2 (`IllegalArgumentException` otherwise) |
| Direction | forward DFT `X[k] = Σ_n x[n]·exp(−j2πkn/N)`; imaginary part zeroed by the caller |
| Twiddles | precomputed `cosTable[i] = cos(2πi/N)`, `sinTable[i] = sin(2πi/N)` for `i < N/2` |
| Bit reversal | precomputed `IntArray(size)` |
| Butterfly | `tre = re[l]*c + im[l]*s; tim = im[l]*c − re[l]*s; re[l]=re[j]−tre; im[l]=im[j]−tim; re[j]+=tre; im[j]+=tim` |
| Exposed bins | `bins = size / 2` — DC … (N/2−1)·binHz. **The Nyquist bin (k = N/2) is not computed or exposed.** |
| Magnitudes | `mag[k] = sqrt(re[k]² + im[k]²)`, `k ∈ [0, bins)` |

Unit-test anchor: a full-scale sine of exactly `64/1024` bins lands as `mag[64] = N/2 = 512 ± N/100`
with neighbours < N/100.

### 2.2 Windows (`Windows.kt`) — exact coefficients

Denominator is `N−1` for every window (symmetric / "windowed DFT" definition, **not** the periodic
variant): `x = 2πi/(N−1)`, `i ∈ [0, N)`. `size <= 1` ⇒ all coefficients 1.0.

| `WindowType` | Label | Coefficient `w[i]` | Coherent gain |
|---|---|---|---|
| `RECTANGULAR` | Rect | `1.0` | **1.0** |
| `HANN` | Hann | `0.5 − 0.5·cos(x)` | **0.5** |
| `HAMMING` | Hamming | `0.54 − 0.46·cos(x)` | **0.54** |
| `BLACKMAN_HARRIS` | Blackman-Harris | `0.35875 − 0.48829·cos(x) + 0.14128·cos(2x) − 0.01168·cos(3x)` | **0.35875** |
| `FLAT_TOP` | Flat top | `0.21557895 − 0.41663158·cos(x) + 0.277263158·cos(2x) − 0.083578947·cos(3x) + 0.006947368·cos(4x)` | **0.21557895** |

`WindowType.fromName(name)` matches the enum name exactly, falling back to `HANN`.

Window properties, **[derived]** (not in the source; useful for sanity checks and for choosing a
window on the web — ENBW normalised to bins = `N·Σw² / (Σw)²`):

| Window | ENBW [derived] | Noise floor vs Rect [derived] | First sidelobe (textbook, **not in source**) | Notes |
|---|---|---|---|---|
| Rect | 1.000 | 0.0 dB | −13 dB, 6 dB/oct | highest resolution, worst leakage |
| Hann | 1.500 | +1.76 dB | −31 dB, 18 dB/oct | default |
| Hamming | 1.363 | +1.34 dB | −43 dB, 6 dB/oct | |
| Blackman-Harris (4-term, these coefficients) | 2.005 | +3.02 dB | ≈ −92 dB | |
| Flat top | 3.771 | +5.76 dB | ≈ −93 dB | best amplitude accuracy, worst resolution |

Test anchor: `coherentGain(type) == mean(coefficients(type, 512)) ± 5e-3`; Hann tapers to
`w[0] ≈ w[N−1] ≈ 0` and `w[N/2] ≈ 1`.

### 2.3 Magnitude → dBFS

```
normFactor = (fftSize / 2f) * coherentGain(windowType)
amp        = mag[k] / normFactor
db         = 20 * log10(max(amp, 1e-9))
```

`df` (Windows.kt doc comment): dividing by `N/2 × coherentGain` yields the amplitude of a full-scale
sinusoid, so **0 dBFS == a sine of amplitude 1.0 for every window**. With Hann and `N = 2048`,
`normFactor = 512`.

### 2.4 Averaging / smoothing

Exponential averaging on the **dB** values, per bin, per published frame:

```
s = clamp(prefs.spectrumAveraging, 0, 0.95)         // default 0.55
v[k] = firstFrame ? db[k] : averaged[k]*s + db[k]*(1 - s)
averaged[k] = v[k]
firstFrame = false                                   // false after the first frame following reconfigure
```

`s` is the weight of the **previous** value. `s = 0` ⇒ raw frames. Frames arrive every
`hopOut/analysisRate` s, so the equivalent continuous one-pole time constant is
`τ = −T / ln(s)` with `T = hopOut/analysisRate` **[derived]**:

| `s` | τ at 46.9 fps (T = 21.3 ms) **[derived]** | τ at 15.6 fps (T = 64 ms) **[derived]** |
|---|---|---|
| 0.0 | 0 (raw) | 0 |
| 0.55 (default) | 36 ms | 107 ms |
| 0.80 | 96 ms | 287 ms |
| 0.95 | 416 ms | 1.25 s |

The averaging is applied **before** the peak search, so `SpectrumFrame.peakDb` is the smoothed peak;
the parabolic peak *frequency* interpolation uses the **raw, un-averaged** magnitudes (§2.6).

### 2.5 Tilt (pink weighting)

```
if (tilt) db += tiltSlope * log2(max(k * binHz, 20) / 1000)
```

* `tiltSlope = prefs.tiltDbPerOctave`, default **3.0 dB/octave**, UI range 0…6.
* Anchor: **1 kHz** (`log2(f/1000)` is 0 there), so the curve pivots at 1 kHz.
* Frequencies below **20 Hz** are clamped to 20 Hz (flat below that), avoiding `−∞`.
* Default `false`. 3 dB/oct makes pink noise look flat.
* Tilt is applied **before** averaging and before the peak search.
* The tilt is *not* applied to the waterfall's own scaling beyond being part of the published dB
  values (the waterfall maps the same `frame.db`).

### 2.6 Peak detection and interpolation

```
peakDb = −200; peakBin = 0
for k in [0, bins):  if (v[k] > peakDb) { peakDb = v[k]; peakBin = k }     // v = averaged & tilted

peakHz = peakBin * binHz
if (peakBin in 1 until bins-1):
    a = mag[peakBin-1]; b = mag[peakBin]; c = mag[peakBin+1]              // raw magnitudes
    denom = a - 2b + c
    if (denom != 0):
        delta = 0.5*(a - c)/denom
        if (-1 < delta < 1) peakHz = (peakBin + delta) * binHz
```

`SignalGenerator`-verified accuracy (README): a 1000 Hz tone measures **1002 Hz** at the default
settings. `SpectrumFrame.peakDb` may be positive; the display clamps nothing.

### 2.7 Published frame (`SpectrumFrame`)

| Field | Content |
|---|---|
| `db` | `averaged.copyOf(bins)` — length `bins = fftSize/2`, dBFS, post-tilt, post-averaging |
| `bins` | `fftSize / 2` |
| `sampleRate` | `analysisRate` (after decimation) |
| `binHz` | `analysisRate / fftSize` (float) |
| `peakHz` | interpolated peak frequency (Hz) |
| `peakDb` | smoothed/tilted peak level (dBFS) |
| `seq` | monotonically increasing counter starting at 0 |

Displayed band top = `binHz * bins` = `analysisRate/2` (Nyquist), e.g. 24000 Hz at 48 kHz.

### 2.8 Bin → Hz mapping

* Bin *k* centre frequency: `k * binHz = k * analysisRate / fftSize` (bin 0 = DC).
* Arbitrary Hz → bin: `pos = hz / binHz` (float, then interpolate linearly between
  `floor(pos)` and `floor(pos)+1`, both clamped to `[0, bins−1]`) — this is what `SpectrumView`
  uses for the trace (§4.3), while the **peak-hold trace uses the nearest bin**
  `i = int(hz / binHz)` with no interpolation (§4.5).
* The spectrum is only drawn where `hz <= binHz * bins` (Nyquist).

### 2.9 `publishFrame` reference pseudocode

```
for i in [0, fftSize): re[i] = fifo[i] * window[i]
fill(im, 0f)
fft.transform(re, im)
fft.magnitudes(re, im, mag)                 // only bins = fftSize/2 values
binHz = analysisRate / fftSize
s = clamp(averaging, 0, 0.95)
for k in [0, bins):
    amp = mag[k] / normFactor
    db  = 20*log10(max(amp, 1e-9))
    if (tilt) db += tiltSlope * log2(max(k*binHz, 20) / 1000)
    v   = firstFrame ? db : averaged[k]*s + db*(1-s)
    averaged[k] = v
    track peak (v, k)
peakHz = parabolic(mag, peakBin, binHz)
publish SpectrumFrame(averaged.copyOf(bins), bins, analysisRate, binHz, peakHz, peakDb, seq++)
```

---

## 3. Frequency axis

Two objects cooperate: **`FreqAxis`** (band + visible window + coordinate mapping) and
**`FreqScopeView`** (tick generation, grid and label rendering). Spectrum and Waterfall share the
SAME `FreqAxis` instance when `prefs.linkZoom` is true; otherwise each view owns a private one.
`FreqScopeView.axis()` calls `axis.configure(hub.nyquistHz, prefs.freqScaleBlend)` on every draw, so
the band always tracks the live capture rate.

### 3.1 Band definition

| Field | Rule |
|---|---|
| `maxHz` | `max(configuredValue, 100)`; the hub passes `nyquistHz = bus.sampleRate / 2` (48000 ⇒ 24000) |
| `logBlend` | `clamp(prefs.freqScaleBlend, 0, 1)`; 0 = linear, 1 = log |
| `minHz` | `10` when `logBlend > 0.999`, otherwise **`0`** (pure linear has no 10 Hz floor) |

### 3.2 Position → frequency transform (exact)

```kotlin
transform(u):                       // u in [0,1] is a position inside the full band
    t      = clamp(u, 0, 1)
    linear = minHz + (maxHz - minHz) * t
    if (logBlend <= 0.0001) return linear
    lo     = ln(minHz + 1)
    hi     = ln(maxHz + 1)
    log    = exp(lo + (hi - lo) * t) - 1
    return linear + (log - linear) * logBlend
```

* The `+1` inside the log keeps the mapping finite when `minHz == 0` (pure linear never reaches it).
* The blend is a straight interpolation in *frequency* between the linear and the log curve, and it is
  **monotonic by construction** for every blend (unit-tested for 0, 0.25, 0.5, 0.75, 1).
* A **1025-entry LUT** (`LUT_SIZE = 1024`) caches `transform(i/1024)`. It is rebuilt only when the
  band (`maxHz`, `minHz`, `logBlend`) changes; a rebuild increments `version`.
* `posToHz(u)`: LUT lookup + linear interpolation between the two neighbouring entries.
* `hzToPos(hz)`: **binary search** over the monotonic LUT, then linear interpolation inside the
  bracketing pair — this is why the inverse of a blended axis is exact and cheap.

### 3.3 Visible window, zoom, pan

The visible window is stored as a pair of positions `u0 < u1` inside `[0, 1]`.

| Operation | Formula |
|---|---|
| `startHz` / `endHz` / `spanHz` | `posToHz(u0)`, `posToHz(u1)`, `max(0, endHz − startHz)` |
| `isFullBand` | `u0 <= 0.0001 && u1 >= 0.9999` |
| `zoomFraction` | `clamp(u1 − u0, 0, 1)` |
| `hzToX(hz, width)` | `(hzToPos(hz) − u0) / (u1 − u0) * width` (0 when span ≤ 0) |
| `xToHz(x, width)` | `posToHz(u0 + clamp(x/width, 0, 1) * (u1 − u0))` (returns `startHz` when `width <= 0`) |
| `zoomAt(focusHz, factor)` | `t = clamp((hzToPos(focusHz) − u0)/span, 0, 1)`; `newSpan = clamp(span*factor, MIN_SPAN_POS, 1)`; `a = focusPos − t*newSpan`; `b = a + newSpan`; `clampWindow(a,b)` |
| `panByFraction(f)` | `delta = span * f`; `clampWindow(u0 + delta, u1 + delta)` — positive `f` moves towards higher frequencies |
| `setRange(start, end)` | positions of both ends; if `b − a < MIN_SPAN_POS`, expand symmetrically around the midpoint; then `clampWindow` |
| `reset()` | `u0 = 0; u1 = 1` |
| `copyFrom(other)` | copy `u0`, `u1` |
| `MIN_SPAN_POS` | **0.0008** (smallest visible window as a fraction of the band) |

```kotlin
clampWindow(a, b):
    span = clamp(b - a, MIN_SPAN_POS, 1)
    if (a < 0) { a = 0; b = span }
    if (b > 1) { b = 1; a = b - span }
    if (a < 0) { a = 0; b = min(span, 1) }
    u0 = a; u1 = b
```

`configure()` only resets the window when the band actually changed **and** the existing window is
invalid (`u1 <= u0 || u1 > 1.0001`), so zoom survives a scale-blend change when possible.

**[derived]** magnitude of the maximum zoom on a pure log axis (band 10…24000 Hz):
`MIN_SPAN_POS` corresponds to a constant frequency **ratio** of `exp(0.0008·ln(24001/11)) = 1.00617`,
i.e. a window of ≈0.12 Hz at 20 Hz, ≈62 Hz at 10 kHz (0.6 % of the centre frequency). On a linear
axis it is 0.08 % of the band (19.2 Hz at 24 kHz).

### 3.4 Gesture → axis mapping (`FreqScopeView.onTouchEvent`)

| Gesture | Mapping |
|---|---|
| Drag (1 finger, `|dx| > 0.5 px`) | `axis.panByFraction(−dx / plotWidth)` — content follows the finger |
| Pinch (2 fingers) | focus = midpoint of the two fingers: `axis.zoomAt(axis.xToHz(focus − plotLeft, plotWidth), pointerSpan / span)`; requires both spans > `dp(8f)`; uses the raw finger distance each frame, not a scale detector |
| Double tap | `resetAxis()` → `axis.reset()` (peak trace and cursors are kept) |
| Tap | `onScopeTap` → spectrum adds a cursor; waterfall toggles freeze |
| Long press | `onScopeLongPress` → spectrum locks a cursor / clears peak hold; waterfall clears history |

`setPlot(left, width)` is called every frame so that touch coordinates can be converted with the
current plot rectangle; `plotWidth` is coerced ≥ 1.

### 3.5 Tick selection (`frequencyTicks`)

Two branches, chosen by `prefs.freqScaleBlend > 0.5` **and** `startHz > 0`:

**(a) Log branch** — 1-2-5 per decade, no adaptive step:

```
decade = 1
while (decade <= endHz * 2 && decade < 1e6):
    for m in (1, 2, 5):
        hz = decade * m
        if (hz in startHz..endHz) add(hz)
    decade *= 10
```

**(b) Linear / blended branch** — "nice numbers" targeting ~8 intervals:

```
span       = endHz - startHz
rawStep    = span / 8
magnitude  = 10^floor(log10(rawStep))
step       = rawStep/magnitude <= 1.5 ? 1*magnitude
           : rawStep/magnitude <= 3.5 ? 2*magnitude
           : rawStep/magnitude <= 7.5 ? 5*magnitude
           :                            10*magnitude
hz = ceil(startHz / step) * step
while (hz <= endHz && out.size < 40): add(hz); hz += step
```

* Log branch: up to 3 ticks per decade, **hard cap only via `decade < 1e6`**.
* Linear branch: **max 40 ticks**.
* Full-band examples: 20 Hz–20 kHz log ⇒ `{20, 50, 100, 200, 500, 1k, 2k, 5k, 10k, 20k}` (10 ticks);
  0–24 kHz linear ⇒ step 2000 ⇒ 13 ticks `{0, 2k, 4k, … 24k}`.
* **Consequence worth copying deliberately:** because the log branch does not adapt to zoom, a deeply
  zoomed log window (e.g. 800–1200 Hz) shows only a single grid line (`1.0k`).

### 3.6 Major vs minor ticks

```kotlin
isMajorTick(hz) = hz > 0 && abs(hz / 10^floor(log10(hz)) - {1|2|5}) < 0.01
```

Only **major** ticks get a text label. In the log branch every generated tick is 1/2/5 of a decade,
so **all log ticks are major and labelled** (subject to collision). In the linear branch only
mantissa ∈ {1, 2, 5} ticks are labelled — the 0–24 kHz example labels just **2.0k, 10k, 20k** while
drawing 13 grid lines.

### 3.7 Grid and label rendering (`drawFrequencyGrid`)

Drawn for each tick in order:

```
x = left + axis.hzToX(hz, right - left)
if (x < left - 0.5 || x > right + 0.5) continue                  // off-plot, skip line AND label
drawLine(x, top, x, bottom, major ? gridMajorPaint : gridPaint)   // colour from palette
if (!major) continue
text  = formatHz(hz)                                             // monospace 9dp
w     = measureText(text)
textX = x - w/2                                                  // centred on the tick (never clamped)
if (textX < left - dp(1) || textX + w > right + dp(1)) continue   // label would leave the plot
if (textX < lastLabelRight + dp(6)) continue                      // collision with previous label
label(text, textX, labelY, palette.dim); lastLabelRight = textX + w
lastTickLabelRight = lastLabelRight                               // exposed to the readout layer
```

* `labelY = bottom + dp(10)`.
* Grid lines use `gridPaint` (`palette.grid`) and `gridMajorPaint` (`palette.gridMajor`).
* The axis is drawn **after** the waterfall bitmap and **before** the cursors; in the spectrum it is
  drawn before the trace.
* Frequency labels are dim (`palette.dim`); the collision rule means the visible label count scales
  with the plot width while the number of *lines* does not.

**Label formatting (`formatHz`)**

| Range | Format | Examples |
|---|---|---|
| `hz >= 1_000_000` | `%.1fM` (hz/1e6) | `1.5M` |
| `hz >= 10_000` | `%.0fk` (hz/1000) | `20k`, `24000 → 24k` |
| `hz >= 1_000` | `%.1fk` (hz/1000) | `1.0k`, `2.0k`, `5.0k` |
| `hz >= 10` | `%.0f` | `20`, `100`, `500` |
| else | `%.1f` | `1.5`, `9.9` |

All formatting uses `Locale.US`.

**Worked example — default Spectrum window** (360 dp wide ⇒ `left = 34`, `right = 357`,
plot width **323 dp**; full-band pure-log axis with band 10…24000 Hz; monospace 9 dp text, char width
≈ 5.4 dp **[derived]**):

| Tick Hz | x (dp) | Label | Label width (dp) | Label textX | Drawn? |
|---|---|---|---|---|---|
| 10 | 0.00 | `10` | 10.8 | −5.4 | **no** (label leaves the plot; the grid line is still drawn at x=0) |
| 20 | 27.17 | `20` | 10.8 | 21.8 | yes |
| 50 | 64.45 | `50` | 10.8 | 59.0 | yes |
| 100 | 93.15 | `100` | 16.2 | 85.1 | yes |
| 200 | 122.07 | `200` | 16.2 | 114.0 | yes |
| 500 | 160.44 | `500` | 16.2 | 152.3 | yes |
| 1000 | 189.52 | `1.0k` | 21.6 | 178.7 | yes |
| 2000 | 218.62 | `2.0k` | 21.6 | 207.8 | yes |
| 5000 | 257.10 | `5.0k` | 21.6 | 246.3 | yes |
| 10000 | 286.22 | `10k` | 16.2 | 278.1 | yes |
| 20000 | 315.34 | `20k` | 16.2 | 307.2 | yes (right edge 323.4 ≤ right+1) |

So a default-width spectrum shows **10 frequency labels**; narrower windows drop labels from the
outside in (centred, so both ends go first), while all 11 grid lines remain.

---

## 4. Spectrum painting (`SpectrumView`)

### 4.1 Draw order

```
drawBackdrop(canvas)                       // §9.3
setPlot(left, right-left)
drawFrequencyGrid(...)                     // §3.7
drawDbGrid(...)                            // §4.2
frame = hub.spectrum.get()
if (frame == null || frame.bins == 0) { hint("waiting for playback audio…"); cursors(no labels); return }
    ── gradient fill under the curve
    ── trace (with optional phosphor glow)
    ── peak-hold trace (if prefs.peakHold)
    ── cursors (with labels)
    ── readout: peak panel (top-left), Δ panel (top-right), range text (bottom-right)
```

`showLabels = width > dp(150) && height > dp(72)`.

There is **no bar mode** anywhere in the source: the spectrum is always a **stroked polyline with a
vertical gradient fill** below it.

### 4.2 Magnitude → y mapping and dB grid

```
floorDb = prefs.dbFloor                        // default -100
topDb   = max(prefs.dbTop, floorDb + 10)       // default 0
span    = max(topDb - floorDb, 1)
dbToY(db) = top + (1 - (db - floorDb)/span) * (bottom - top)
```

* **Linear in dB**, top of the plot = `topDb`, bottom = `floorDb`. Values above `topDb` clip at the
  top edge; nothing is auto-scaled.
* dB grid: `step = (topDb − floorDb > 120) ? 20 : 10`; iterate `db = topDb` downwards while
  `db >= floorDb`; draw a horizontal line across the plot; the line at `db == topDb` uses
  `gridMajorPaint`, the rest `gridPaint`.
* Grid labels (only when `showLabels`): the integer dB as `"$db"`, right-aligned at
  `(left − dp(3), y + dp(3))`, colour `palette.dim`.

### 4.3 Trace construction (per-pixel column, bin-interpolated)

```
path.reset(); fillPath.reset(); started = false
nyquist = frame.binHz * frame.bins
x = left
while (x <= right):
    hz = axis.xToHz(x - left, right - left)          // axis mapping, §3.3
    if (hz <= nyquist):
        db = interpolate(frame, hz)                  // linear between bins (§2.8)
        y  = dbToY(db)
        if (!started) { path.moveTo(x, y); fillPath.moveTo(x, bottom); fillPath.lineTo(x, y); started = true }
        else          { path.lineTo(x, y); fillPath.lineTo(x, y) }
    x += 1f                                           // 1 DEVICE pixel, not dp
if (started):
    fillPath.lineTo(right, bottom); fillPath.close()
    traceFillPaint.shader = gradient(top, bottom); canvas.drawPath(fillPath, traceFillPaint)
    traceFillPaint.shader = null
    tracePaint.color = palette.accent
    drawTraced(canvas, path, tracePaint)
```

* The loop steps **1 device pixel**, so a 360 dp window at 3× density performs ~1080 iterations per
  frame (plus the same count again for the peak-hold pass).
* Columns with `hz > nyquist` are skipped entirely (the polyline stops before the right edge if the
  axis reaches past Nyquist; the *fill* still closes at `right`).
* `interpolate` clamps `i0` and `i0+1` to `[0, bins−1]`, so it is safe at the top bin.
* Trace paint: `palette.accent`, width `dp(1.5)`, round joins, AA.
* **Glow** (`prefs.traceGlow`, default on): first draw the same path with
  `glowPaint.color = accent @ 22 % alpha`, `strokeWidth = traceWidth * 3.4` (= `dp(5.1)` at default).

**Fill gradient** (cached by `accent|topInt|bottomInt`):

```
LinearGradient(0, top, 0, bottom,
    colors  = [accent@0.42, accent@0.10, accent@0.00],
    stops   = [0.0, 0.5, 1.0], TileMode.CLAMP)
```

### 4.4 Peak hold

* Storage: `peakDb: FloatArray(frame.bins)`, reallocated when `frame.bins` changes.
* Time base: `dt = (SystemClock.uptimeMillis() − lastPeakDraw) / 1000` seconds; the **first** frame
  after a reset has `dt = 0` (no decay); `lastPeakDraw` is updated every frame.
* Update (only while `dt > 0`):

```
if (prefs.peakHold):
    decay = prefs.peakDecayDbPerSec * dt                  // default 14 dB/s
    for each bin i: peakDb[i] = max(frame.db[i], peakDb[i] - decay)
else:
    fill(peakDb, prefs.dbFloor)                           // collapsed to the floor every frame
```

  The decay is **per second, scaled by frame dt**, so it is frame-rate independent. Units: dB/s,
  default **14**, UI range 0…60.
* Draw: for each pixel column x, `hz = axis.xToHz(...)`; if `hz <= nyquist`:
  `i = int(hz / frame.binHz)` clamped to `[0, bins−1]` (**nearest bin, no interpolation**) →
  `y = dbToY(peakDb[i])`; polyline.
* Style: `secondaryPaint`, colour `palette.hold` (= `palette.accentAlt`) at **85 % alpha**,
  width `dp(1.1)`, **no glow**.
* Clearing: long press on empty space (spectrum) or `resetView()` (sets `peakDb = FloatArray(0)`).

### 4.5 Readouts

| Element | Content | Placement / style |
|---|---|---|
| Peak panel | `"<peakHz>  <peakDb:.1f> dB  <note>  [<ch>]"` — e.g. `1.0k  6.0 dB  A4 +0c  [L+R]` | panel rounded rect `(left+3dp, top+3dp) … (left+3dp+w, top+17dp)`, label at `(left+7dp, top+14dp)`, `palette.text` |
| Channel tag | `spectrumChannel`: 1 ⇒ `L`, 2 ⇒ `R`, else `L+R` | inside the peak panel |
| Note | `Notes.describe(peakHz, tuningHz)` when `cursorNoteEnabled` | empty string outside 15 Hz…21 kHz |
| Δ panel | `"Δ <dHz>  <dDb:.1f> dB"` from the two "delta pair" cursors | panel `(right−dw−3dp, top+3dp) … (right−3dp, top+17dp)`, label colour `palette.accent` |
| Range text | `"<startHz> – <endHz>"` | right-aligned at `(right−4dp, bottom−2dp)`, `palette.dim`; **skipped** if `x < lastTickLabelRight + dp(8)` |

**Delta pair selection** (`deltaPair`): if `cursors.active` is visible, pair it with its nearest
visible neighbour (ordered low→high); otherwise sort all visible cursors by frequency and take the
first two. Shown only when ≥ 2 cursors are visible.

**Note naming (`Notes.describe`, `dsp/Notes.kt`)**: returns `""` outside **15 Hz…21000 Hz**;
`midi = 69 + 12·log2(hz/reference)`; `nearest = round(midi)`; `cents = round((midi − nearest)·100)`;
`name = NAMES[((nearest % 12) + 12) % 12]` with `NAMES = C, C#, D, D#, E, F, F#, G, G#, A, A#, B`;
`octave = nearest/12 − 1`; output `"<name><octave> <+/-><|cents|c"` (e.g. `A4 +3c`, `F#3 -12c`).
Reference defaults to 440 Hz; `tuningHz` is user-settable 400…480.

`Notes.toDb(amp) = amp <= 1e-7 ? -140 : 20·log10(amp)`; `Notes.fromDb(db) = 10^(db/20)`.

### 4.6 Measurement cursors (`CursorStore` + `SpectrumView` / `FreqScopeView`)

State per cursor: `hz: Float` (mutable), `locked: Boolean`, stable `id: Int` (1, 2, 3, …).
Store-level state: `active` (last touched), `lastInteraction` timestamp, `version`.

| Constant | Value |
|---|---|
| `AUTO_HIDE_MS` | **5000 ms** — unlocked cursors hide after this idle time; locked ones never hide |
| Hit tolerance | `(dp(22) / plotWidth) * (endHz − startHz)` Hz (≈22 dp on screen) |
| Drag start threshold (marks "moved") | `|Δhz| * plotWidth / (endHz − startHz) > dp(3)` |
| Long press | **500 ms** |
| Handle | circle radius `dp(5.5)` filled with `palette.bg`, stroked `dp(1.1)` |
| Locked handle | same + an inner filled dot of radius `dp(1.8)` |
| Label | `"<hz>  <db:.1f> dB"` (+ `  <note>` when enabled), placed `dp(7)` right of the handle, clamped to the plot right edge; stacked rows `dp(11)` apart, first row at `top + dp(32)` (spectrum, handle at top) or `bottom − dp(11)` (waterfall, handle at bottom) |
| Colours | locked line = `palette.accent`; unlocked = `palette.accentAlt`; fading alpha = **90** for strokes, **120** for labels; locked labels use `palette.accent`, others `palette.text` |
| Handle position | `handleAtBottom = false` (spectrum) ⇒ handle at `top + dp(7)`; `true` (waterfall) ⇒ `bottom − dp(7)` |

Interaction model:

| Input | Effect |
|---|---|
| Tap on empty plot | `cursors.add(xToHz(x))` + haptic `CLOCK_TICK` (unlocked cursor) |
| Tap on a cursor | remove it (locked cursors must be unlocked first) |
| Drag near a cursor | move it (`cursor.hz = max(0, xToHz(x))`); a **locked cursor consumes the gesture but never moves** |
| Long press on a cursor | `toggleLock` + haptic `LONG_PRESS` |
| Long press on empty space (spectrum) | clear the peak-hold trace |
| Cursor drag owns the whole gesture | pan/zoom cannot steal the marker (the view returns `true` before the gesture detector sees the event) |

Waterfall draws the same cursors (when linked) with the handle at the bottom of the plot.

---

## 5. Waterfall / spectrogram (`WaterfallView` + `WaterfallBuffer`, colormaps from `Colormaps.kt`)

### 5.1 Row production (in the hub, driven by the analyser thread)

```
WATERFALL_PIXEL_BUDGET = 4_000_000
waterfallMaxRows(bins)  = max(4_000_000 / max(bins,1), 64)
waterfallRowsPerSecond(bins) = max(0.5, min(waterfallFps, waterfallMaxRows(bins) / waterfallHistorySec))
```

* `bins` are clamped to 8…8192, `rows` to 8…16384 (`configure`).
* Push throttle: `interval = max(1, (1000 / rowsPerSecond).toLong())` ms; a row is pushed when
  `now − lastPush >= interval` (monotonic `elapsedRealtime`).
* Newest-frame rows only — if the analyser produces more frames than the row rate, intermediate
  frames are dropped for the waterfall.
* Achieved rate estimate: on each push with `dt > 0.002 s`,
  `actual = actual*0.97 + (1/dt)*0.03` (first sample = instantaneous). Views use
  `min(actual, wanted)` for the visible history so the displayed time span stays honest.
* `prefs.waterfallFreeze` ⇒ the hub returns before pushing (history retained).

### 5.2 dB → colour

```
range = max(topDb - floorDb, 1)                 // same dbTop/dbFloor as the spectrum
t     = clamp((db[i] - floorDb) / range, 0, 1)
index = round(t * (LEVELS - 1))                  // LEVELS = 256
rowPixels[i] = LUT[index]
```

### 5.3 Circular row bitmap (no per-row copies)

* One `ARGB_8888` bitmap of **`bins` × `rows`** pixels, erased to opaque black.
* `setPixels(rowPixels, 0, bins, 0, nextWrite, n, 1)` writes one row; `nextWrite = (nextWrite+1) % rows`.
* Row `y` is always **older** than row `y+1` (with one wrap), so rendering draws one wrapped block:

```
shown  = clamp(visibleRows, 1, rows)
firstY = ((newest - shown + 1) % rows + rows) % rows
part1  = min(shown, rows - firstY)      // rows firstY .. rows-1
part2  = shown - part1                  // rows 0 .. part2-1
```

  `part1` is drawn at the top of the plot (height `(bottom−top)*part1/shown`), then `part2` fills the
  rest. `"newest on top"` is achieved by `canvas.scale(1, −1, cx, (top+bottom)/2)` around the whole
  draw — **no row is ever copied**.
* `visibleRows = min(wf.rows, max(1, round(waterfallHistorySec * rowsPerSecond)))`.
* Row pixels are drawn with a plain (non-filtering) `Paint` → **nearest neighbour on purpose**
  (the source comment: filtering "reads as a smearing jelly edge at high row rates").

### 5.4 Strip mapping (log/blended axis correctness)

The bitmap stores linear frequency bins; it is drawn through the *live* axis mapping so the spectrogram
lines up with the frequency labels:

```
linear = (prefs.freqScaleBlend < 0.05)                 // one strip is exact on a linear axis
count  = linear ? 1 : clamp(int(plotWidth / dp(3)), 8, 256)
for i in [0, count):
    x0 = left + i*step ; x1 = (i == count-1) ? right : x0 + step
    f0 = clamp(xToHz(x0), 0, nyquist) ; f1 = clamp(xToHz(x1), 0, nyquist)
    strip = [ f0/nyquist, f1/nyquist, x0, x1 ]         // 4 floats per strip
```

Per strip: `srcX = clamp(int(lf*bins), 0, bins-1)`,
`srcRight = clamp(int(rf*bins), srcX+1, bins)`; skip when `rf <= lf || dstRight <= dstLeft`.
Note the source range is `[srcX, srcRight)` in bin units while the destination is in view px — at
8…256 strips the horizontal resampling is nearest-neighbour per strip.

### 5.5 Waterfall chrome

| Element | Rule |
|---|---|
| `showLabels` | `width > dp(140) && height > dp(70)` |
| Time gutter | In the left 34 dp gutter: `steps = 4`, for `i in 1..4`, `fraction = i/4`, `y = top + (newestOnTop ? fraction : 1−fraction)*(bottom−top)`; tick line `plotLeft … plotLeft+dp(4)` in `gridMajor`; label `"-%.1fs"` = `−waterfallHistorySec * fraction`, right-aligned at `(plotLeft − dp(5), y + dp(3))`, `palette.dim`. **Skipped entirely when `waterfallHistorySec <= 0`.** |
| Readout | `"%.1fs · %.0f rows/s · <ColormapLabel>[ · linked][ · HOLD]"` in a rounded panel `(left+3dp, top+3dp)…(min(left+3dp+w, right), top+17dp)`; text colour `palette.warn` when frozen else `palette.text` |
| Range text | `"<startHz> – <endHz>"` bottom-right, skipped on collision (same `dp(8)` rule) |
| Cursor labels | include the **level of the nearest bin** (`int(hz/binHz)`, no interpolation) plus the note |
| Gestures | tap = toggle `waterfallFreeze`; long press = `hub.clearWaterfall()`; pinch/drag/double tap = axis zoom/pan/reset (shared with the spectrum when linked) |
| Empty state | `"waterfall history empty"` at `(left+6dp, top+16dp)`, dim |

### 5.6 Colour maps (`Colormaps.kt`)

7 maps, `LEVELS = 256` entries each, built once and cached. `t = i/(LEVELS−1)`.
Control points are `(position, r, g, b)` with r/g/b 0…255; the ramp finds the bracketing pair,
interpolates linearly and clamps to 0…255. `Colormap.fromOrdinal(v) = entries[clamp(v, 0, 6)]`;
the default is `MAGMA` (ordinal 0).

**Magma** — **Viridis** — **Inferno**:

| t | Magma r,g,b | Viridis r,g,b | Inferno r,g,b |
|---|---|---|---|
| 0.00 | 0, 0, 4 | 68, 1, 84 | 0, 0, 4 |
| 0.13 | 28, 16, 68 | 72, 40, 120 | 31, 12, 72 |
| 0.25 | 79, 18, 123 | 59, 82, 139 | 85, 15, 109 |
| 0.38 | 129, 37, 129 | 44, 113, 142 | 136, 34, 106 |
| 0.50 | 181, 54, 122 | 33, 145, 140 | 186, 54, 85 |
| 0.63 | 229, 80, 100 | 39, 173, 129 | 227, 89, 51 |
| 0.75 | 251, 135, 97 | 92, 200, 99 | 249, 140, 10 |
| 0.88 | 254, 194, 135 | 170, 220, 50 | 249, 201, 50 |
| 1.00 | 252, 253, 191 | 253, 231, 37 | 252, 255, 164 |

**Fire** — **Ice** — **Grayscale**:

| t | Fire r,g,b | Ice r,g,b | Grayscale |
|---|---|---|---|
| 0.00 | 0, 0, 0 | 0, 0, 8 | 0, 0, 0 |
| 0.20 | 70, 0, 0 | 0, 30, 105 | — |
| 0.40 | 160, 20, 0 | 0, 110, 190 | — |
| 0.60 | 240, 90, 0 | 0, 190, 225 | — |
| 0.80 | 255, 200, 40 | 130, 235, 250 | — |
| 1.00 | 255, 255, 235 | 255, 255, 255 | 255, 255, 255 |

**Rainbow** — not a stop list: `hue = 240 * (1 − clamp(t,0,1))`, `s = 1`, `v = 1`, converted with the
standard HSV→RGB algorithm (`c = v*s`, `hh = (h/60) mod 6`, `x = c*(1 − |hh mod 2 − 1|)`,
`m = v − c`, components scaled by 255 and clamped). Net effect: **blue → cyan → green → yellow → red**
as level rises.

> **Web note.** The whole waterfall is one `OffscreenCanvas` of `bins × rows` pixels used as a ring
> in `y`, drawn with `drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)` per strip,
> `imageSmoothingEnabled = false`, and `ctx.setTransform(1, -1, 0, 1, 0, ...)`-style vertical mirror
> for "newest on top". Row writes are `ImageData` row blits + `putImageData`.

---

## 6. Waveform painting (`WaveformView`)

### 6.1 Time base, window and buffer strategy

| Constant | Value |
|---|---|
| `DIVISIONS` | **10** (grid divisions across the plot) |
| `waveMsPerDiv` | default **5 ms** ⇒ 50 ms across; range 0.02…200 ms |
| `windowFrames(rate)` (`sweep`) | `clamp(int((msPerDiv/1000) * rate * 10), 16, 2^22)`, i.e. clamped to **16 … 4 194 304 frames** |
| `RAW_LIMIT` | **8192** — `sweep <= 8192` ⇒ raw sample polyline, else min/max envelope |
| `MAX_COLUMNS` | **1400** — envelope columns = `min(int(right−left), 1400)`, at least 8 |
| `LANE_FILL` | **0.92** — fraction of the half-lane height used by ±1.0 FS |
| Vertical clamp | `clampFs(v) = clamp(v, −2.5, +2.5)` FS |
| `MAX_TRIGGER_SEARCH` | **32768** frames |
| `FREQ_WINDOW` | **8192** frames |
| Gain range | −40…+60 dB per channel (`gain = 10^(dB/20)`) |

Layout has **no left gutter** (§0.2). `"no capture"` is drawn when `rate <= 0 || capacity == 0`;
`"buffering…"` when `newest − oldest < sweep`.

### 6.2 Lane / channel model

`waveStereoMode` chooses the lane structure; `waveSource` only affects **overlay**:

| Mode | Lanes | Lane spec `(envelopeSlot, scale, gainChannel)` |
|---|---|---|
| 0 overlay (default) | 1 | `waveSource`: 0 ⇒ `(0,1.0,L)` **and** `(2,1.0,R)`; 1 ⇒ `(0,1.0,L)`; 2 ⇒ `(2,1.0,R)`; 3 ⇒ `(4,0.5,L)` = **(L+R)·0.5 (mid)**; 4 ⇒ `(6,0.5,L)` = **(L−R)·0.5 (side)** |
| 1 split | 2 | lane 0 = `(0,1.0,L)`, lane 1 = `(2,1.0,R)` (independent gain per lane) |
| 2 sum | 1 | `(4,1.0,L)` = **literal L + R**, no 0.5 factor |

Signal extraction from the ring: `slot 0 → L`, `slot 2 → R`, `slot 4 → L+R`, `slot 6 → L−R`
(the envelope slots are documented in §1.2). Envelope mode is used both for drawing and for Vpp.

### 6.3 Vertical mapping (no auto-scale)

```
laneTop    = top + (bottom-top) * lane / laneCount
laneBottom = top + (bottom-top) * (lane+1) / laneCount
midY       = (laneTop + laneBottom) / 2
halfH      = (laneBottom - laneTop) / 2 * 0.92
value      = (signal * scale − dc) * gain
y          = midY − clamp(value, −2.5, 2.5) * halfH
```

Consequences: **1.0 FS (0 dBFS) reaches 46 % of the lane height**; the trace visually clips at
±2.5 FS (flat-topped against the lane clip rect, since drawing is clipped to the lane rectangle);
there is no automatic vertical zoom. Order of operations is exactly
`scale → remove DC → apply gain → clamp`.

**DC / AC coupling** (`prefs.waveAcCoupling`, default `true`): subtract the mean of the *visible*
window, computed after the scale factor:

* raw mode: `dc = mean(rawValue(i,index) for i in window) * scale`
* envelope mode: `dc = mean((min_c + max_c)/2 for c in columns) * scale`
* when AC coupling is off, `dc = 0` (DC is drawn as an offset from the lane centre).

### 6.4 Raw polyline (zoomed in, `sweep ≤ 8192`)

One copy of `sweep` stereo frames (`copyStereo`) then, per lane/spec:

```
denom = frames - 1                                  // frames = actually copied
for i in 0 until frames:
    x = left + plotWidth * i / denom                // always spans the FULL plot width
    path.moveTo/lineTo(x, midY - clamp(value) * halfH)
```

The primary spec of a lane uses `tracePaint` (accent, `dp(1.5)`, glow); a second spec in the same lane
(overlay mode only) uses `secondaryPaint` (colour `palette.accentAlt` at 90 % alpha, `dp(1.1)`).
Lane channel 1 (right) is always drawn in `palette.accentAlt`, channel 0 in `palette.accent`.
Because `denom` uses the *copied* frame count, a partially available window is stretched across the
full width — in trigger "normal" mode this shows a horizontally compressed trace (source quirk, see
§12).

### 6.5 Min/max envelope (zoomed out, `sweep > 8192`)

`AudioBus.stereoEnvelope(envelope, start, sweep, columns)` (§1.2) fills 8 floats per column; the view
draws, per spec, a **vertical segment per column**:

```
step = plotWidth / columns
for c in 0 until columns:
    base = c * 8
    mn = (envelope[base + slot]     * scale - dc) * gain
    mx = (envelope[base + slot + 1] * scale - dc) * gain
    x  = left + c * step
    path.moveTo(x, midY - clamp(mn) * halfH)
    path.lineTo(x, midY - clamp(mx) * halfH)
```

One pass over the ring per frame — a 30 fps redraw never copies more than it draws. `columns` is
capped at 1400, so beyond ~1400 plot pixels the envelope becomes wider than one column per pixel
(the polyline still connects the segments).

### 6.6 Grid and lane chrome

| Element | Rule |
|---|---|
| Horizontal | mid line (`gridMajorPaint`) + lines at 25 % and 75 % of the lane (`gridPaint`) |
| Vertical | lines at `rect.left + rect.width()*i/DIVISIONS` for `i in 1..9` (`gridPaint`) |
| Lane boundary | split mode draws a line at each lane top |
| Lane label | overlay: `L / R`, `L`, `R`, `MID`, `SIDE` or `L+R` at `(left+4dp, top+11dp)`, dim (`palette.dim`) |
| Split labels | `L` (accent) / `R` (accentAlt) at each lane top-left, plus gain text `"%+.1f dB"` right-aligned at `(right−4dp, laneBottom−4dp)` |
| Trigger marker | only when `waveTriggerMode != 2` (free run); drawn for lane 0 only at `y = midY − triggerLevel * halfH` in `gridMajorPaint`, with the label `"trig %+.2f"` right-aligned above the line |
| HOLD badge | panel `(right−w−4dp, top+3dp) … (right−4dp, top+17dp)`, text `HOLD` in `palette.warn`, `w = textWidth + dp(12)` |

All trace drawing is clipped to `(left, top) … (right, bottom)` (and each envelope lane is clipped to
its own lane rectangle).

### 6.7 Trigger (`resolveStartFrame` / `findTrigger`)

| Mode | Value | Behaviour |
|---|---|---|
| Auto | 0 (default) | search for a trigger; `start = triggerLock − sweep/5`; then *falls through* to the live-edge clamps, so an old trigger slides out and the display free-runs when the trigger is too recent |
| Normal | 1 | search for a trigger; if a lock exists, `return max(start, oldest)` **immediately** — the trigger point stays pinned at 20 % and the window may extend past the newest frame (partial/blank right side) |
| Free run | 2 | `start = newest − sweep − panFrames`; no trigger search, no trigger marker; `panFrames` only applies here |

```
findTrigger(newest, oldest, sweep):
    available = int(newest - oldest)
    search    = min(min(sweep, 32768), available)
    if (search < 8) return -1
    copy `search` stereo frames ending at `newest`   (searchStart = newest - search)
    level  = prefs.waveTriggerLevel       // -1..+1 FS, default 0
    rising = (prefs.waveTriggerEdge == 0)
    source = prefs.waveTriggerSource      // 0 -> (L+R)/2, 1 -> L, 2 -> R
    for i from got-1 down to 1:           // MOST RECENT crossing wins
        a = sample(i-1), b = sample(i)
        if (rising ? (a < level && b >= level) : (a > level && b <= level)) return searchStart + i
    return -1
# then (auto/normal): start = (triggerLock >= 0) ? triggerLock - sweep/5 : newest - sweep
# auto/free tail:     if (start + sweep > newest) start = newest - sweep
#                     if (start < oldest) start = oldest
```

* **No hysteresis and no holdoff** — a plain single-sample level crossing.
* The trigger point is displayed **20 % from the left edge** (`sweep/5`).
* `triggerLock` persists across frames (`-1` = no lock); `resetView()` clears it.
* The comparator uses the raw ring samples, **not** the AC-coupled/gained signal.
* `panFrames` is ignored in auto/normal mode (drag-pan only works in free run).

### 6.8 Freeze

Tap toggles `frozen`. On freeze: `frozenNewest = bus.totalFrames`; while frozen
`newest = min(frozenNewest, bus.totalFrames)` — the display pins to that point in the ring and the
ring keeps rolling underneath (history is 6 s, so long freezes eventually lose their data).
`resetView()` unfreezes. Readout displays `HOLD`.

### 6.9 Readouts

| Element | Content |
|---|---|
| Head panel (bottom-left) | `"%.2f ms/div · %.1f ms · AC\|DC · overlay\|split\|sum"` + `" · ≈%.1f Hz"` when the estimate > 0; panel `(left+3dp, bottom−16dp) … (min(left+3dp+w, right), bottom−2dp)`; label at `(left+7dp, bottom−5dp)` in `palette.text` |
| Measurement line (top-left) | `"Vpp %.2f FS · RMS %.1f dBFS · peak %.1f dBFS"` at `(left+4dp, top+11dp)` in `palette.dim`; requires `waveShowMeasurements` **and** `showLabels` |
| RMS source | split ⇒ `max(rmsL, rmsR)`; sum ⇒ `min(1.5, rmsL + rmsR)`; overlay ⇒ per `waveSource`: L, R, midRms, sideRms, else `(rmsL+rmsR)/2` |
| Peak | `max(peakL, peakR)` from `LevelFrame` |
| Vpp | raw ⇒ `max − min` of the drawn window × scale; envelope ⇒ `max(max_c − min_c) × scale` |

**Frequency estimate** (`estimateFrequency`): `count = min(8192, newest)`; needs ≥ 64 frames; mean of
`(L+R)/2` over the window is removed; rising zero crossings (`last < 0 && v >= 0`) are counted;
`f = crossings * rate / got`; returns 0 for fewer than 2 crossings. It is a *rough* estimate
(one crossing count over a fixed 8192-frame window, no interpolation, no hysteresis).

### 6.10 Gestures

| Gesture | Effect |
|---|---|
| Pinch | `waveMsPerDiv = clamp(msPerDiv / scaleFactor, 0.02, 200)` |
| Horizontal drag (`|dx| > 0.5`) | `panFrames += (dx / max(1,width)) * sweep` (clamped ≥ 0); only meaningful in free-run |
| Vertical drag (`|dy| > 0.5`) | `deltaDb = −dy * 0.35`; applied to both gains when `waveLinkGain`, else to the gain of the lane the drag started in (lane 0 if `y < height/2` in split mode); gains clamped −40…+60; haptic tick |
| Tap | toggle freeze |
| Double tap | `resetView()`: pan 0, trigger lock cleared, unfreeze, `msPerDiv = 5`, both gains 0 dB |
| Long press | cycle stereo layout `overlay → split → sum → overlay` |

---

## 7. Vector scope (`VectorScopeView`)

Lissajous / goniometer of the stereo image, rendered into a **phosphor bitmap** that fades a little
every frame.

### 7.1 Geometry

| Constant / rule | Value |
|---|---|
| `showLabels` | `w > dp(120) && h > dp(120)` |
| `pad` | `showLabels ? dp(14) : dp(3)` |
| Plot square | `size = min(w,h) − 2*pad`, centred at `(w/2, h/2)` |
| Graticule | outer circle radius `size/2`; inner circle `size/4` (0.5×); full-width horizontal and vertical diameters |
| Diagonals (`vectorShowAxes`) | `d = radius * 0.7071`; lines `(cx−d, cy−d)…(cx+d, cy+d)` and `(cx−d, cy+d)…(cx+d, cy−d)` |
| Axis labels | goniometer: `L` at `(cx−d+2dp, cy−d+10dp)` accent, `R` at `(cx+d−10dp, cy−d+10dp)` accentAlt, `M` at `(cx+3dp, cy−radius+10dp)` dim, `S` at `(cx+radius−9dp, cy−3dp)` dim. Lissajous: `L` at `(cx−radius+2dp, cy−3dp)`, `R` at `(cx+radius−9dp, cy−3dp)`, `L=R` at `(cx+d−16dp, cy−d+10dp)`, `L=-R` at `(cx−d+2dp, cy−d+10dp)` |

### 7.2 The L/R → X/Y rotation

| `vectorMode` | X | Y | Label |
|---|---|---|---|
| 0 = **Lissajous** (default) | `L` | `R` | X = left, Y = right |
| 1 = **Goniometer** | `(L − R) · inv` | `(L + R) · inv` | rotated 45°: mid at top, side at right |

with **`inv = 1 / sqrt(2) = 0.70710678`** — this *is* the ±45° mid/side rotation, scaled by 1/√2 so
that a mono full-scale signal reaches the same radius as in Lissajous mode. Note X = **S** and
Y = **M**, i.e. side horizontal, mid vertical, screen Y inverted.

### 7.3 Point mapping, gain and trace

```
gain = prefs.vectorGain * (size / 2) * 0.92        // vectorGain default 1.0, range 0.05…8
x = cx + xv * gain
y = cy − yv * gain                                  // screen Y is inverted
```

* The trace is a **connected polyline** (line segments between consecutive samples), not a point
  cloud and not dots: `drawLine(prev, cur)` per sample with `strokeWidth = dp(1.3)`, colour
  `palette.accent`, AA. There is no persistence per point and no brightness modulation per sample.
* Sample window: `traceFrames = clamp(int((vectorTraceMs/1000) * rate), 32, 16384)` — default
  **20 ms ⇒ 960 frames at 48 kHz**, taken from the newest data (`copyLatestStereo`).
* If fewer than 2 frames are available nothing new is drawn (the previous phosphor frame is still
  composited).

### 7.4 Persistence / afterglow (per rendered frame)

```
ensure phosphor bitmap = ARGB_8888 (width × height), erased to 0
each frame:
    alpha = clamp(int((1 - prefs.vectorPersistence) * 110), 6, 110)     // integer truncation!
    draw a full-view rect with xfermode DST_OUT and colour argb(alpha, 0,0,0)
    ... draw this frame's polyline into the phosphor bitmap
    canvas.drawBitmap(phosphor, 0, 0)
```

* The fade is applied **once per rendered frame**, so the afterglow duration depends on
  `prefs.renderFps` (30 fps default) — it is *not* time-scaled (unlike the spectrum peak-hold decay).
* Per-frame retention `r = 1 − alpha/255` **[derived]**:

| `vectorPersistence` | `alpha` | retention/frame | half-life (frames) | half-life @30 fps |
|---|---|---|---|---|
| 0.00 | 110 | 0.569 | 1.2 | 0.04 s |
| 0.30 | 77 | 0.698 | 1.9 | 0.06 s |
| 0.50 | 55 | 0.784 | 2.9 | 0.10 s |
| **0.72 (default)** | **30** | **0.882** | **5.5** | **0.18 s** |
| 0.90 | 10 | 0.961 | 17.3 | 0.58 s |
| 0.97 (max) | 6 (floor) | 0.976 | 29.1 | 0.97 s |

* The phosphor is **cleared** on: mode change, `vec_persist` preference change, double tap /
  `resetView()` (which also resets `vectorGain = 1`), and on detach (bitmap recycled).
* The graticule is redrawn every frame beneath the bitmap, so it always stays crisp; the backdrop is
  also redrawn, so the afterglow only affects the trace layer.

### 7.5 Readouts and gestures

| Element | Formula / placement |
|---|---|
| `corr %+.2f` | `LevelFrame.correlation` at `(plot.left+4dp, plot.top+11dp)`; colour `palette.bad` when `corr < −0.2`, else `palette.text` |
| `width %.0f%%` | `100 * sideRms / (midRms + sideRms)` (0 when the denominator ≤ 1e-6) at `(plot.left+4dp, plot.top+23dp)`, dim; needs `showLabels` |
| `bal %+.1f dB` | `20*log10(max(rmsR,1e-6) / max(rmsL,1e-6))` right-aligned at `(plot.right−4dp, plot.bottom−4dp)`, dim; needs `showLabels` |
| Pinch | `vectorGain = clamp(gain * scaleFactor, 0.05, 8)` (uses a `ScaleGestureDetector`) |
| Double tap | `resetView()` ⇒ gain 1 + clear phosphor |
| No capture | `"no capture"` at `(plot.left+4dp, plot.top+14dp)`, dim |

---

## 8. Level meter

Measurements come from `LevelMeter` (analyser thread, §1.1/§1.3); the smoothing, layout and painting
live in `MeterView`.

### 8.1 `LevelMeter.process(buf, frames, holdMs)` — exact math

Per analysis block of `frames` stereo frames (the same `hopIn` block the FFT consumes):

| Quantity | Formula |
|---|---|
| `peakL`, `peakR` | `max abs(sample)` per channel over the block |
| `rmsL`, `rmsR` | `sqrt(Σ x² / max(1, frames))` |
| `midRms` | RMS of `(L + R) * 0.5` |
| `sideRms` | RMS of `(L − R) * 0.5` |
| `sumPeak` | `max abs(L + R)` (literal sum) |
| `sumRms` | RMS of `(L + R)` (literal sum, no 0.5 factor) |
| `correlation` | `Σ(L·R) / sqrt(ΣL² · ΣR²)`, clamped to `[−1, 1]`; **1.0** when the denominator ≤ 1e-12 |
| Clip latch | if `peakL >= 0.999 \|\| peakR >= 0.999` ⇒ `clippedAt = elapsedRealtime()` |
| Peak hold | `if (peak >= hold \|\| now > holdUntil) { hold = peak; holdUntil = now + holdMs }` |

**Peak hold is a sample-and-hold, not a decay ramp:** the held value stays exactly constant for
`meterHoldMs` (default **1500 ms**, range 0…10000) and then jumps straight to the current block peak.
There is no dB/s decay for the meter hold (unlike the spectrum peak-hold trace).
All timestamps use the monotonic `elapsedRealtime()` clock.

`LevelFrame` carries: `peakL/R`, `rmsL/R`, `holdL/R`, `correlation`, `midRms`, `sideRms`, `sumPeak`,
`sumRms`, `clippedAt`, `seq`.

### 8.2 Display ballistics (`MeterView.updateBallistics`)

One-pole smoothing of six display values — `[rmsL, rmsR, peakL, peakR, sumRms, sumPeak]`:

```
dt      = (now - lastFrameAt) / 1000                     // first frame: 0.016 s; clamped to [0.001, 0.5]
attack  = 1 - exp(-dt / 0.025)                           // tau = 25 ms
release = 1 - exp(-dt / 0.32)                            // tau = 320 ms
k       = (target > display) ? attack : release
display += (target - display) * k
```

Derived at the default 30 fps (`dt = 33 ms`) **[derived]**: attack coefficient ≈ 0.733, release
coefficient ≈ 0.098 — the bar reaches ~90 % of a step in ~1.7 frames and falls ~10 % per frame.
**The hold marker is not smoothed** — it is drawn straight from `LevelFrame.holdL/R` (or
`max(holdL, holdR)` for combined/sum channels).

### 8.3 dB scale, tick placement, and the red zone

```
dbToFraction(amplitude) = clamp((20*log10(max(amplitude, 1e-6)) - (-60)) / 60, 0, 1)
dbToY(amp, top, bottom) = bottom - fraction * (bottom - top)        // vertical bars grow upwards
dbToX(amp, left, right) = left + fraction * (right - left)          // horizontal bars grow rightwards
scaleSteps() = [0, -6, -12, -20, -30, -45, -60]                     // dBFS, denser near the top
dbText(v)    = (v <= -59.5) ? "-∞" : "%.1f"                          // MIN_DB + 0.5
```

* Scale span: **−60 dBFS … 0 dBFS**, linear in dB. Ticks at **0, −6, −12, −20, −30, −45, −60** dBFS —
  deliberately non-uniform ("denser near the top where it matters").
* `amplitude <= 1e-6` maps to fraction 0 (the bottom); values above 1.0 clamp to the top.
* Ticks: vertical layout ⇒ short lines at each step (in the middle gap, one stub against each bar, or
  in the right-hand gutter) with the label centred/right-aligned at `y + dp(3)`, dim. Horizontal
  layout ⇒ ticks along the bottom with labels above them, centred, at `y − dp(5)`.

**Where the red/caution zone sits: at the TOP of the scale (the loud end).** The bar fill uses a
vertical `LinearGradient` from `bottom` (position 0) to `top` (position 1) with

```
colors = [good, good, warn, bad]
stops  = [0.00, 0.55, 0.80, 1.00]
```

**[derived]** in dBFS terms that is: `good` from −60 to −27 dBFS (solid up to stop 0.55), a
`good→warn` ramp over −27…−12 dBFS, solid `warn` from −12 to −6 dBFS, and a `warn→bad` ramp over
−6…0 dBFS (stop 0.80 = −12 dBFS, stop 1.00 = 0 dBFS). In the **horizontal** layout the same stop
list runs left→right, so the red end is on the **right** (still the loud end).
`good`/`warn`/`bad` come from the palette (§9.2).

Related indicators:

* **Clip rectangle** — a latching red rectangle per channel, drawn **above** the bar in the vertical
  layout (`top + dp(13)`, height `dp(8)`) and as a `dp(4)`-wide vertical bar just right of the bar in
  the horizontal layout. `age = elapsedRealtime() − clippedAt`; lit for `age < 2000 ms` with
  `fade = clamp(1 − age/2000, 0.3, 1)`; when unlit, `bad @ 22 %`. Corner radius `dp(2)`.
* **Peak line** — `palette.text`, `dp(2)`, drawn across the bar (vertical) or across the bar height
  (horizontal) at the smoothed peak.
* **Hold marker** — `palette.warn @ 95 %`, `dp(1.5)`, plus (vertical layout only) a centred
  `dp(4) × dp(3)` tick sitting on the line.
* **Track** — rounded rect radius `dp(3)` (slim vertical: `dp(2)`), fill `0x14000000` on light themes,
  `0x33000000` on dark themes. Bars are only drawn when `rms > 1e-5`.

### 8.4 Layouts and adaptive thresholds

Orientation: **vertical when `height >= width * 0.72`**, otherwise horizontal.

**Vertical** (`drawVertical`)

| Element | Rule |
|---|---|
| `pad` | `dp(5)` |
| `showScale` | `meterShowScale && width > dp(112)` |
| Scale gutter | split layout (`meterLayout == 0`) ⇒ scale in the **middle gap** between the bars; otherwise a `dp(27)` right gutter |
| `headerH` / `clipH` | `dp(13)` / `dp(8)`; bars start at `top + headerH + clipH + dp(2)` |
| Value pills | only when `meterLabelPosition == 0`; height `dp(24)` if `width > dp(96)` else `dp(18)` |
| Loudness panel | reserved `panelHeight()` at the bottom |
| Gap | `dp(32)` when split + scale, else `dp(5)` |
| Bar width | `meterSlim ? min(dp(24), slot) : slot` |
| Channel order | `meterLayout`: 0 ⇒ L, R; 1 ⇒ L+R; 2 ⇒ L, R, L+R |
| Fallback | if the bars would be shorter than `dp(16)`, switch to **slim mode** |

**Horizontal** (`drawHorizontal`)

| Element | Rule |
|---|---|
| `pad` | `dp(5)` |
| Loudness panel | left block, width `min(w*0.34, dp(124))` when it has rows |
| Pill column | `dp(48)` wide when `w > dp(300)` else `dp(40)` (only for `LABEL_UNDER`) |
| Clip gutter | `dp(9)` on the right |
| `showScale` | `meterShowScale && height > dp(88)`, scale band `dp(12)` tall |
| Row height | `availH / channels`, at least `dp(16)`; bar height `clamp(rowH − dp(6), dp(6), dp(26))` |
| Channel letter | drawn inside the bar at `(barsLeft+3dp, centre+3dp)`: accent on dark themes, `0xFF101418` on light themes |

**Slim vertical** (fallback when the window is too short): bars + a `dp(7)` clip strip only; bar width
`max((w − 2·dp(4) − gap·(n−1))/n, dp(3))`, gap `dp(4)`, corner radius `dp(2)`, peak line `dp(1.5)`.

**Value pills and badges**

* Pill: radius `dp(8)`, fill `0x14000000` (light) / `0x33FFFFFF` (dark), stroke `accent @ 50 %`,
  `dp(1)`; text = `dbText(peak)` centred, font `13·density` when `big` (pill height ≥ `dp(22)`),
  else `10·density`; text baseline offset `+textSize*0.36`. Skipped when smaller than
  `dp(16) × dp(12)`.
* Badge (on-bar placement): radius `dp(6)`, fill `bg @ 72 %` (light) / `62 %` (dark), stroke
  `accent @ 60 %`, text `10·density`. Skipped below `dp(14) × dp(10)`.
* `LABEL_UNDER` row: pills centred under the bars, group capped at `min(w − dp(10), dp(168))`,
  `dp(5)` gaps.

**Loudness panel** (`drawLoudness`)

* Rounded rect radius `dp(7)` filled with `palette.panel`; skipped below `dp(52) × dp(16)`.
* Header `LEVELS dBFS` in `dim @ 85 %` when the panel is taller than `dp(52)`.
* Rows (`rowH = dp(13)`, text inset `dp(6)`):
  `PEAK` = `20log10(max(max(peakL,peakR),1e-6))`,
  `RMS` = `20log10(max(max(rmsL,rmsR),1e-6))` (loudest channel),
  `CREST` = peak − rms (dB),
  `BAL` = `20log10(max(rmsR,1e-6)/max(rmsL,1e-6))` with a `+` sign.
  Two columns when the panel is ≥ `dp(215)` wide, otherwise four stacked rows (text right-aligned).
* **Correlation bar** (`meterShowCorrelation`): track `0x1A000000` (light) / `0x33000000` (dark),
  rounded `dp(3)`, height `dp(6)`; a centre line in `gridMajor`; the marker is a `dp(3) × dp(9)`
  rounded rect at `x = left + (corr+1)/2 * width`, coloured
  `corr < −0.2 → bad`, `corr < 0.5 → warn`, else `good`; label `CORR %+.2f` above it in `dim`.
* Panel height: `dp(13) * rows + dp(9)`, plus `dp(8)` when the correlation bar is shown; `rows` =
  2 (two-column numeric) or 4 (one-column numeric) or 0, plus 1 for correlation.

---

## 9. Theme

### 9.1 The colour model

A theme is the **Cartesian product of 8 accents × 8 backgrounds** (64 combinations), resolved into a
`Palette` and cached by `key = accentIndex * 16 + backgroundIndex`:

| Palette field | Derivation |
|---|---|
| `accent` | `ACCENTS[accentIndex]`, **darkened ×0.62 per channel** when the background `isLight` |
| `accentAlt` | `ACCENT_ALTS[accentIndex]`, same light-background darkening |
| `accentSoft` | `accent` with alpha `0x2E` (46/255) |
| `bg`, `grid`, `gridMajor`, `text`, `dim`, `panel` | straight from the selected background |
| `good` | light ⇒ `0xFF1F9D55`, dark ⇒ `0xFF6BE675` |
| `warn` | light ⇒ `0xFFC77700`, dark ⇒ `0xFFFFB020` |
| `bad` | light ⇒ `0xFFD64545`, dark ⇒ `0xFFFF5C5C` |
| `isLight` | background flag |
| `hold` (derived getter) | `= accentAlt` — the peak-hold / secondary trace colour |

Helpers: `alpha(color, f) = (color & 0x00FFFFFF) | ((int(alpha(color) * clamp(f,0,1))) << 24)`;
`scale(color, f)` multiplies RGB by `f` (clamped 0…255), keeping alpha;
`darken(color)` = `argb(alpha, r*0.62, g*0.62, b*0.62)` with **integer truncation**.

**Accents** (`ScopeTheme.ACCENTS` / `ACCENT_ALTS`, names in `accentNames`):

| # | Name | Accent | Accent-alt (`hold`, secondary traces) |
|---|---|---|---|
| 0 | Teal | `#35D6C4` | `#FF7A9A` |
| 1 | Amber | `#FFB020` | `#7BD88F` |
| 2 | Violet | `#A78BFA` | `#62D0FF` |
| 3 | Ice | `#62D0FF` | `#FFB020` |
| 4 | Mono | `#E8EDF2` | `#8A97A5` |
| 5 | Rose | `#FF7A9A` | `#7BD8C0` |
| 6 | Lime | `#A3E635` | `#62D0FF` |
| 7 | Ember | `#FF8A4C` | `#FFD166` |

**Backgrounds** (`ScopeTheme.BACKGROUNDS`, names in `backgroundNames`; all values ARGB with the alpha
shown):

| # | Name | `bg` (fill) | `grid` | `gridMajor` | `text` | `dim` | `panel` | `isLight` |
|---|---|---|---|---|---|---|---|---|
| 0 | Deep black | `F0 06080B` | `FF 1B232C` | `FF 2E3C4A` | `FF E6EDF3` | `FF 8A97A5` | `CC 10151A` | no |
| 1 | Graphite | `FF 14181D` | `FF 2A3138` | `FF 3D4753` | `FF E6EDF3` | `FF 93A1B1` | `CC 1B2129` | no |
| 2 | OLED | `FF 000000` | `FF 171717` | `FF 2B2B2B` | `FF EDEDED` | `FF 8C8C8C` | `CC 0D0D0D` | no |
| 3 | Midnight | `FF 070E1A` | `FF 16243A` | `FF 27405F` | `FF DCE8F5` | `FF 8FA6BF` | `CC 0C1626` | no |
| 4 | Plum | `FF 120A18` | `FF 2A1836` | `FF 43265A` | `FF F0E6F7` | `FF A992BC` | `CC 180F22` | no |
| 5 | Forest | `FF 08130F` | `FF 163026` | `FF 244C3C` | `FF E1F2EA` | `FF 93B5A7` | `CC 0D1C17` | no |
| 6 | Paper | `FF F4F6F8` | `FF D8DEE6` | `FF AEB8C4` | `FF 1B2129` | `FF 5D6A78` | `E6 FFFFFF` | **yes** |
| 7 | Sand | `FF F6F1E7` | `FF DED5C4` | `FF B8AA90` | `FF 2A241A` | `FF 6E6350` | `E6 FFFDF7` | **yes** |

Note the default dark background (`Deep black`) is itself **semi-transparent** (`F0`) — window
opacity multiplies on top of that.

### 9.2 Where each token is used

| Token | Consumers |
|---|---|
| `bg` | full-view backdrop fill; cursor handle fill; value-badge fill (with alpha) |
| `grid` | minor frequency grid lines, dB grid lines, meter ticks, vector circles/diameters, scanline-free grids |
| `gridMajor` | major frequency lines, the top dB line, lane mid-line, trigger marker line, correlation centre line |
| `text` | readout panel text, meter peak line, waveform header text, correlation label values |
| `dim` | frequency/scale labels, hints, lane labels, secondary readout text |
| `accent` | primary trace, spectrum fill gradient, waterfall-independent UI, locked cursor, left channel, pill stroke |
| `accentAlt` / `hold` | peak-hold trace, right channel, unlocked cursor |
| `good` / `warn` / `bad` | meter gradient, hold marker (`warn`), correlation marker, clip indicators, `HOLD` badge, corr readout |
| `panel` | readout panels, loudness block |

### 9.3 Backdrops (`prefs.scopeBackdrop`) and glow

`drawBackdrop` first fills the whole view with `bg @ (overlayOpacity/100)` — the opacity **only fades
the backdrop**; traces, cursors and readouts stay at full contrast. Then:

| # | Backdrop | Construction |
|---|---|---|
| 0 | Plain | nothing |
| 1 | Dot matrix ("Nothing-inspired") | grid `step = dp(11)`; points at `(c*step + step/2, r*step + step/2)` for `cols = int(w/step)+1`, `rows = int(h/step)+1`; drawn as a **FILL** `drawPoints` with `strokeWidth = dp(1.6)`, `strokeCap = ROUND`, colour `text @ 0.10` (light) / `text @ 0.07` (dark). Point array is cached per `WxH`. |
| 2 | Vignette | `RadialGradient(cx, cy, radius = max(w,h)*0.75)` with colours `[transparent, transparent, black @ (light ? 0.10 : 0.55)]` at stops `[0, 0.55, 1]`, `CLAMP`; cached per `WxH + bg` |
| 3 | Scanlines | `1 dp`-tall rects every `3 dp`, white at `0.05` (light) / `0.035` (dark) |

**Trace glow** (`prefs.traceGlow`, default on): every `drawTraced` call draws the path twice — first
with `glowPaint` (`colour = trace colour @ 22 %`, `strokeWidth = traceWidth × 3.4`, round join), then
the trace itself. This is what produces the "lit phosphor" look and is the single most visible
quality difference if omitted.

**Panels** (`drawPanel`, used by readouts, HOLD badge, pills use their own style): rounded rect radius
`dp(6)`; glow pass 1 = stroke `accent @ 18 %`, width `dp(3.5)`; pass 2 = stroke `accent @ 35 %`,
width `dp(1.2)`; then fill `panel`.

### 9.4 CSS custom properties (equivalent expression)

Direct mapping — one block per theme, all values verbatim from §9.1:

```css
:root {
  /* palette tokens (Palette field -> custom property) */
  --scope-bg:          #06080B;   /* bg,           F0 alpha in the app */
  --scope-grid:        #1B232C;   /* grid */
  --scope-grid-major:  #2E3C4A;   /* gridMajor */
  --scope-text:        #E6EDF3;   /* text */
  --scope-dim:         #8A97A5;   /* dim */
  --scope-panel:       rgba(16,21,26,0.80);   /* panel, CC alpha */
  --scope-accent:      #35D6C4;   /* accent  (darken x0.62 per channel on light backgrounds) */
  --scope-accent-alt:  #FF7A9A;   /* accentAlt / hold */
  --scope-accent-soft: rgba(53,214,196,0.18); /* accentSoft, alpha 0x2E */
  --scope-good:        #6BE675;
  --scope-warn:        #FFB020;
  --scope-bad:         #FF5C5C;

  /* derived alpha variants used by the painters */
  --scope-accent-fill-top:    rgba(53,214,196,0.42);  /* spectrum fill gradient, stop 0.0 */
  --scope-accent-fill-mid:    rgba(53,214,196,0.10);  /*                               stop 0.5 */
  --scope-accent-fill-bot:    rgba(53,214,196,0.00);  /*                               stop 1.0 */
  --scope-glow:               rgba(53,214,196,0.22);  /* trace glow */
  --scope-hold-line:          rgba(255,122,154,0.85); /* peak-hold trace */
  --scope-cursor-locked:      var(--scope-accent);
  --scope-cursor-unlocked:    var(--scope-accent-alt);
  --scope-cursor-fading:      0.35;                   /* stroke alpha 90/255 */
  --scope-dim-label:          var(--scope-dim);
  --scope-track:              rgba(0,0,0,0.20);       /* meter track, dark: 0x33 => 0.20 */
  --scope-clip-idle:          rgba(255,92,92,0.22);
  --scope-panel-fill:         var(--scope-panel);
  --scope-meter-grad: linear-gradient(to top,
        var(--scope-good) 0%, var(--scope-good) 55%,
        var(--scope-warn) 80%, var(--scope-bad) 100%);
  --scope-backdrop-opacity:   1;                      /* overlayOpacity/100, 0.2..1 */

  /* geometry tokens */
  --scope-gutter-left:   34px;   /* dp == CSS px */
  --scope-gutter-bottom: 15px;
  --scope-pad:            3px;
  --scope-grid-width:     1px;
  --scope-trace-width:    1.5px;
  --scope-trace2-width:   1.1px;
  --scope-cursor-width:   1.1px;
  --scope-glow-width:     5.1px;  /* traceWidth * 3.4 */
  --scope-font:           9px ui-monospace, "SF Mono", Menlo, monospace;
  --scope-panel-radius:   6px;
  --scope-handle-radius:  5.5px;
}
```

For **light** backgrounds (Paper/Sand) the accent must be darkened by 0.62 per channel before it is
used anywhere, e.g. Teal `#35D6C4` → `#20857A`, and `good/warn/bad` switch to `#1F9D55`, `#C77700`,
`#D64545`. Because the painters use many *alpha variants of the accent*, the practical CSS approach is
to store the accent as an `R,G,B` triple (`--scope-accent-rgb: 53,214,196`) and compose variants with
`rgb(var(--scope-accent-rgb) / 0.42)`.

---

## 10. Frame pacing

### 10.1 Per-view redraw loop (`ScopeView.scheduleNextFrame`, called at the end of every `onDraw`)

```
fps      = clamp(prefs.renderFps, 5, 60)          // default 30
interval = 1000L / fps                            // INTEGER division: 30 -> 33 ms, 60 -> 16 ms, 5 -> 200 ms
now      = uptimeMillis()
elapsed  = now - lastDrawAt
lastDrawAt = now
delay    = max(0, interval - elapsed)
if (delay <= 2) postInvalidateOnAnimation()       // vsync-aligned immediate repaint
else            { removeCallbacks(frameRunnable); postDelayed(frameRunnable, delay) }
```

* `frameRunnable = { if (attached) invalidate() }`; the loop exists only while the view is attached
  (`onAttachedToWindow` registers the pref listener and invalidates; `onDetachedFromWindow` removes
  callbacks). There is **no visibility/occlusion check** — an attached but hidden view keeps drawing.
* Because `scheduleNextFrame()` runs *after* `drawScope()`, the achieved period is
  `drawTime + delay`; the fps setting is an upper bound on redraw rate, not a fixed cadence.
* Every frame is a **full redraw** of the view: backdrop, grid, traces, cursors and readouts. There
  is **no dirty-rectangle, no layer caching and no partial invalidation** anywhere in the five
  instruments.
* `onPrefsChanged` forwards to `onScopePrefsChanged` and calls `invalidate()` immediately, so a
  settings change repaints without waiting for the next tick.
* Each view owns its own loop: N open instruments ⇒ N independent timers, all capped by the same
  `renderFps`. There is no shared compositor and no frame budget coordination.
* **Error containment**: `onDraw` is wrapped in `try/catch`; on failure the view paints
  `"render error"` plus the first 48 chars of the message in `palette.bad`/`palette.dim`, logs only
  when the message changes, and **keeps the loop running** — a drawing bug can never take down the
  capture service.

### 10.2 Rates that are deliberately decoupled from `renderFps`

| Producer | Rate | Independent control |
|---|---|---|
| FFT frames | `analysisRate / hopOut`, capped ≈60/s | `fftSize`, `fftOverlap`, `analysisDivisor` |
| Waterfall rows | `min(waterfallFps, maxRows/history)`, ≥0.5/s | `waterfallHistorySec`, `waterfallFps`, pixel budget |
| Meter `LevelFrame` | one per analysis block (`hopIn` frames ⇒ 21.3 ms at 48 kHz) | follows the FFT block size |
| View redraws | `renderFps` (5…60) | `renderFps` |
| Vector phosphor fade | **per rendered frame** | `vectorPersistence` × `renderFps` |
| Spectrum peak-hold decay | **per second** (`dB/s × dt`) | `peakDecayDbPerSec` |
| Meter ballistics | **per second** (τ = 25 ms / 320 ms with `dt`) | fixed constants |
| Meter peak hold | **wall-clock** (`holdUntil`, monotonic clock) | `meterHoldMs` |
| Clip latch | **wall-clock** (2 s) | fixed |
| Waveform/Vector data | pulled from the ring at draw time | — |

> **Web implementation note.** Drive all instruments from a **single `requestAnimationFrame` loop**
> with an accumulator that reproduces the `interval` / `delay <= 2 → repaint now` rule per
> instrument, instead of one rAF loop per canvas (browsers throttle/throttle-stop background loops
> per document, not per canvas, and N loops make frame-time attribution impossible). Keep the same
> split: decay the phosphor **once per painted frame** and the peak-hold / ballistics **by elapsed
> time**, otherwise the vector afterglow and the meter feel will change with the display refresh
> rate (a 120 Hz screen would halve the vector trail).

---

## 11. Behaviour worth copying vs Android-specific behaviour

### 11.1 Copy verbatim (this is the measurement + look)

| # | Behaviour | Why it matters |
|---|---|---|
| 1 | dBFS normalisation `mag / ((N/2) · coherentGain)` | 0 dBFS = full-scale sine for every window; makes the numbers mean the same as the Kotlin app |
| 2 | Exact window coefficients with `i/(N−1)` denominator + the five coherent-gain constants | Bit-comparable spectra |
| 3 | Anti-alias FIR decimation before the FFT (63 taps, `fc = 0.46/factor`, Blackman, unity DC, 31-sample delay) | The "analysis sample rate" is honest; no folded aliases |
| 4 | Hop sizing: `max(fftSize/{1,2,4}, analysisRate/60)`, FIFO drop of `hopOut` | Identical frame rate/overlap semantics |
| 5 | Exponential averaging with `s` = weight of the *previous* frame, clamped 0…0.95 | Same responsiveness feel |
| 6 | Tilt `+slope · log2(max(f,20)/1000)`, default 3 dB/oct | Pink noise looks flat, anchored at 1 kHz |
| 7 | Parabolic (3-point) peak-frequency interpolation on raw magnitudes | Accurate peak readout (1000 Hz → 1002 Hz in the app's own test) |
| 8 | Blended linear↔log axis in **position space** with a 1025-entry LUT and binary-search inverse | Zoom/pan behave identically at any blend; no drift between spectrum and waterfall |
| 9 | `MIN_SPAN_POS = 0.0008`, log floor `minHz = 10` when blend > 0.999, linear floor 0 | Same zoom limits |
| 10 | Tick algorithms exactly (log 1-2-5 per decade vs "nice numbers" from `span/8` with 1.5/3.5/7.5 thresholds), major-tick rule {1,2,5}±0.01 | Grid density and label placement match, including the "only 2.0k/10k/20k labelled on a linear axis" quirk |
| 11 | Label placement: centred, dropped on plot overflow, dropped on `+6 dp` collision, `lastTickLabelRight` gating the range text | Same label sets at the same widths |
| 12 | Peak-hold decay in **dB/s × dt** (default 14 dB/s), cleared by long press | Frame-rate independent, same fall-off |
| 13 | Peak-hold mapped through the **nearest bin** while the live trace is bin-interpolated | The held trace is visibly step-like at high zoom — an intentional-looking characteristic |
| 14 | Cursor model: 22 dp hit tolerance, tap-to-add/remove, drag-to-move, 500 ms long press to lock, 5 s auto-hide for unlocked cursors, locked cursors pinned, delta readout following the active cursor | The measurement workflow |
| 15 | Waveform: sweep = `msPerDiv × 10 × rate` clamped to 16…2²²; raw polyline ≤ 8192 frames; min/max envelope with ≤ 1400 columns above that; `LANE_FILL = 0.92`; ±2.5 FS clamp; dB gain −40…+60 | Same time-base feel and the same "zoom in = real samples, zoom out = envelope" transition |
| 16 | Waveform trigger: most-recent level crossing in the last `min(sweep, 32768)` frames, rising/falling, source L/R/(L+R)/2, trigger point **20 % from the left edge**, auto vs normal distinction, no hysteresis | Stable-looking periodic display |
| 17 | AC coupling by subtracting the *window mean* (raw: mean of samples; envelope: mean of per-column midpoints) | Same DC behaviour, and the envelope mode does not need a second pass |
| 18 | Vector: Lissajous X=L/Y=R and goniometer `(L∓R)/√2` (Y inverted on screen), `gain = vectorGain · (size/2) · 0.92`, 45° diagonals at `0.7071·radius`, inner circle at 0.5× | The two modes are geometrically identical to the app |
| 19 | Vector persistence formula `alpha = clamp(int((1−p)·110), 6, 110)` as a per-frame `DST_OUT` fade | The phosphor look, including the 6/255 floor |
| 20 | Meter measurements exactly: peak = max abs; RMS = `sqrt(Σx²/n)`; mid/side `(L±R)·0.5`; `sumPeak`/`sumRms` use the **literal** `L+R`; correlation = `ΣLR/sqrt(ΣL²ΣR²)` with a `1.0` fallback | Numbers match the app to the last digit |
| 21 | Meter ballistics τ = **25 ms attack / 320 ms release** with `dt` clamped to 0.001…0.5 s, and a **sample-and-hold** peak (1500 ms, then jump to the current peak) | The characteristic meter "bounce" without flicker |
| 22 | Meter scale −60…0 dBFS with steps `[0, −6, −12, −20, −30, −45, −60]`, `-∞` text below −59.5 | Same scale |
| 23 | **Red/caution zone at the top (loud end)** with gradient stops `[0, 0.55, 0.80, 1.0]` → `good@(−60…−27)`, ramp to `warn@−12`, ramp to `bad@0` | Correct loudness semantics; do **not** flip it |
| 24 | Clip latch: 2 s, `fade = clamp(1 − age/2000, 0.3, 1)`, idle at 22 % | Short overloads stay visible |
| 25 | Theme model: 8 accents × 8 backgrounds, `hold = accentAlt`, light-background accent darkening ×0.62, per-background `good/warn/bad` | The whole visual identity |
| 26 | Glow = same path, `alpha 22 %`, `strokeWidth × 3.4`; panel = radius 6 dp, 18 %/35 % accent strokes + panel fill; backdrops (dot matrix 11 dp, vignette, scanlines) and backdrop-only opacity | This is most of the "visual quality" |
| 27 | Waterfall nearest-neighbour rows, ring-in-y bitmap, strip-wise log mapping, 4 MP pixel budget with row-rate reduction instead of history loss, achieved-rate EMA (`0.97/0.03`) | Sharp spectrogram that stays aligned to the log labels, with an honest time axis |
| 28 | The **omissions** are part of the behaviour: no auto-gain, no auto-scale, no waveform smoothing, no bars mode for the spectrum, no trigger hysteresis | Reproducing the app means reproducing these omissions |

### 11.2 Android-specific — replace on the web

| Kotlin/Android mechanism | What it does | Web replacement |
|---|---|---|
| `MediaProjection` + `AudioPlaybackCaptureConfiguration` (+ `RECORD_AUDIO`) | captures the device's playback stream | `getDisplayMedia({audio:true})` for system audio, or a `MediaStreamAudioSourceNode` / `AudioWorklet` tap on the app's own graph. "Allowed to be captured" is a browser/OS-level analogue of `ALLOW_CAPTURE_BY_NONE` |
| `AudioRecord` blocking read of 2048 stereo frames, PCM float / PCM16 (`/32768`) | producer of raw samples | `AudioWorkletProcessor` (128-frame render quanta) or `MediaStreamTrackProcessor`; accumulate into the same ring |
| `AudioBus` `ReentrantLock` + `Condition` + `awaitFrames` | thread-safe ring with blocking waits | single-threaded JS ring, or `SharedArrayBuffer` + `Atomics.wait` if the analyser lives in a Worker. A blocking wait is not needed: schedule the analysis pass from the rAF/timer loop and process whatever is available |
| `Thread` for capture (MAX_PRIORITY), analysis (`LiteScope-FFT`), signal generator | concurrency | `AudioWorklet` (audio thread) + optional `Worker` for the FFT; **never** run the FFT loop on the audio thread |
| `AtomicReference<SpectrumFrame/LevelFrame>` | latest-value hand-off without queues | a plain mutable field / small object pool; the semantics ("newest wins, drops are silent") are worth keeping |
| `android.graphics.Canvas/Paint/Path`, `LinearGradient`, `RadialGradient` | immediate-mode 2D drawing | Canvas2D (`Path2D`, `createLinearGradient`, `createRadialGradient`, `shadowBlur` for the glow) or WebGL2 for the waterfall/envelope-heavy views |
| `Bitmap` + `PorterDuffXfermode(DST_OUT)` phosphor; `Bitmap` ring for the waterfall; `setPixels` rows | pixel buffers | `OffscreenCanvas` + `ctx.globalCompositeOperation = 'destination-out'`; `ImageData` + `putImageData` for rows |
| `Bitmap` nearest-neighbour row blits (`drawBitmap(src, srcRect, dstRect)`) | waterfall resampling | `ctx.imageSmoothingEnabled = false` + `drawImage` per strip |
| `resources.displayMetrics.density` (`dp`) | resolution independence | 1 dp = 1 CSS px, backing store scaled by `devicePixelRatio` |
| `SystemClock.uptimeMillis()` / `elapsedRealtime()` | frame dt, timers, clip latch | `performance.now()` (monotonic). Do **not** use `Date.now()` for dt |
| `GestureDetector`, `ScaleGestureDetector`, `MotionEvent` (pointer index, `ACTION_POINTER_DOWN/UP`, `pointerCount`) | pinch/pan/tap/long-press | `PointerEvent` + `setPointerCapture`; implement the "cursor drag owns the whole gesture" rule explicitly (a cursor hit returns before the pan handler) |
| `Typeface.MONOSPACE`, `textSize = 9·density` | readout typography | `font: 9px ui-monospace, Menlo, monospace`; measure with `ctx.measureText` (the 6 dp collision gap and label-overflow rules depend on real metrics) |
| `SharedPreferences` + weak listener map + `generation` counter | settings, change notification | a plain settings object + `CustomEvent`/observer; keep the "any write bumps a generation ⇒ analyser reconfigures" behaviour or deliberately improve it (see §12) |
| Overlay windows (`TYPE_APPLICATION_OVERLAY`), notification chips, Quick Settings tile, `WavRecorder`, `ScopeTileService` | window management / OS integration | out of scope: HTML/Web Components or canvas panels, `<audio>`/MediaRecorder for recording |
| `performHapticFeedback` | tap feedback | `navigator.vibrate` (where supported) or nothing |
| Robolectric render tests | rasterisation smoke tests | Playwright/Vitest canvas snapshot tests asserting "ink on the canvas" per instrument |

---

## 12. Gaps, ambiguities and source quirks (decide before porting)

Everything below is **not specified** in the Kotlin, or is a behaviour a web port must consciously
choose to keep or fix. None of these block implementation.

1. **No noise-floor / ENBW correction.** The analyser normalises only by coherent gain, so the
   displayed noise floor of a white-noise signal rises with the window's ENBW (rect 0 dB, Hann
   +1.76 dB, flat top +5.76 dB **[derived]**). ENBW values in §2.2 are **[derived]**, not in the
   source. Also **not specified**: per-bin power averaging (the averaging is done in dB), spectral
   leakage compensation, or A/C weighting.
2. **No DC removal in the spectrum path** (bin 0 is whatever the signal contains). DC removal exists
   only as the waveform's AC coupling.
3. **`peakDb` is post-tilt and post-averaging** while `peakHz` uses the raw magnitudes — a deliberate
   or accidental inconsistency; copy it if you want identical readouts.
4. **`SpectrumView.interpolate` is not used for the peak-hold trace** (nearest bin ⇒ visible
   staircase when zoomed).
5. **Waterfall row rate is derived, not measured, per view**: `min(actual, wanted)` is used for the
   visible history; the EMA constants (0.97/0.03) are the only smoothing.
6. **Any preference write resets the spectrum FIFO and averaging** (`reconfigure()`), producing a
   brief transient — including changes that have nothing to do with the FFT.
7. **`waveDots` is a dead preference** (declared, persisted, never read) — the "dots" waveform mode
   does not exist.
8. **`meterLabelPosition` documents four placements** (UNDER/ON_BAR/BETWEEN/OUTSIDE) but only
   `0 = under` and `1 = on bar` are implemented/reachable.
9. **Waveform raw mode stretches a partial window** (`denom = frames − 1` uses the copied count), so
   trigger "normal" mode can display a horizontally compressed trace; the envelope path always spans
   the full width.
10. **No trigger hysteresis and no holdoff**; the most-recent crossing in the search window wins, so
    noise around the trigger level can jitter the start point.
11. **`panFrames` is ignored in auto/normal trigger mode** — panning only works in free-run.
12. **Vector persistence is per rendered frame, not per second** (§7.4) — it changes with
    `renderFps`/display refresh.
13. **`FreqAxis` log tick selection does not adapt to zoom** (§3.5) — a narrow zoomed window can show
    a single grid line.
14. **`waterfallHistorySec`**: `Prefs` clamps 1…300 s, the settings slider offers 2…300 s, the README
    says 2–300 s — pick one (2…300 s is the user-visible contract).
15. **Not specified anywhere in the source**: audio-thread resampling quality when `captureRate` is
    negotiated down, behaviour under sample-rate changes mid-stream (the app reconfigures the whole
    bus), stereo channel count other than 1/2, and any form of calibration/offset (dBFS is assumed
    exact).
16. **Nothing is persisted beyond the prefs in §0.4**: measurement cursors, the frequency window
    (`u0/u1`), waveform `panFrames`/`triggerLock`, and the spectrum peak-hold trace all live in memory
    and are lost when the process restarts.

---

## 13. Acceptance checklist (numbers to reproduce)

Straight from the project's own verification notes (README + unit tests) — a web port should match
these before it is considered behaviourally equivalent:

| Check | Expected |
|---|---|
| FFT vs naive DFT (N = 64, mixed signal) | every bin within 1e-3 |
| Full-scale sine at bin 64 of N = 1024 | `mag[64] = 512 ± N/100`; neighbours `< N/100` |
| `Fft(100)` | throws (power of two required) |
| Window coherent gain vs mean of 512 coefficients | within 5e-3 for all five windows |
| Hann window of 256 | `w[0] = w[255] ≈ 0`, `w[128] ≈ 1` |
| Decimator, factor 4, 100 Hz tone @48 kHz | unity gain within ±5 % after the transient |
| Decimator, factor 4, 20 kHz tone @48 kHz | output peak `< 0.05` (alias rejection > 26 dB) |
| `FreqAxis` linear round trip (1000…5000 Hz, width 1000) | within 1 Hz |
| `FreqAxis` log round trip (20…23000 Hz, width 800) | within 1 % + 1 Hz |
| `FreqAxis` blend 0.5 round trip | within 2 % + 2 Hz; strictly monotonic for blends 0, 0.25, 0.5, 0.75, 1 |
| `zoomAt(1000, 0.5)` on a 24 kHz log band | focus still visible, span < 24000 Hz |
| 30× `zoomAt(1000, 2.0)` | `startHz >= 0`, `endHz <= 24000.1` |
| `panByFraction(±100)` on a 1000–3000 Hz linear window | clamps to 24000 Hz / 0 Hz |
| 1 kHz test tone, default settings, level 0.5 | peak **−6.0 dBFS**, RMS **−9.0 dBFS**, crest **3.0 dB** |
| 1 kHz test tone frequency readout | **1002 Hz** (±2 Hz, from parabolic interpolation) |
| Mono signal | correlation **+1.00** |
| Default spectrum window (360×190 dp) | 11 log grid lines (10 Hz…20 kHz), 10 labels (no 10 Hz label) |
| Default spectrum frame rate (48 kHz, N = 2048, 50 % overlap) | 46.88 frames/s, `binHz` 23.4375 Hz, band 0…24000 Hz |
| Cursor auto-hide | unlocked cursors vanish after 5 s idle; locked ones persist |
| Meter hold | held value constant for 1500 ms, then jumps to the current peak |
| Clip latch | red clip rect lit (fading from 100 % to 30 %) for 2000 ms |
