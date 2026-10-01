/* ============================================================================
   LiteDAW · WAV WRITER
   Minimal RIFF/WAVE encoder used for fast single-clip saves and as a
   dependency-free fallback when the mediabunny path is unavailable.
   ========================================================================= */

export type WavBitDepth = 16 | 24 | 32;

function writeString(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function floatTo16(view: DataView, offset: number, v: number) {
  const s = Math.max(-1, Math.min(1, v));
  view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
}

function floatTo24(view: DataView, offset: number, v: number) {
  const s = Math.max(-1, Math.min(1, v));
  const i = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
  view.setUint8(offset, i & 0xff);
  view.setUint8(offset + 1, (i >> 8) & 0xff);
  view.setUint8(offset + 2, (i >> 16) & 0xff);
}

/** Encodes an AudioBuffer as a RIFF/WAVE blob. */
export function audioBufferToWavBlob(buffer: AudioBuffer, bitDepth: WavBitDepth = 24): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const ab = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(ab);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = chans[c][i];
      if (bitDepth === 16) {
        floatTo16(view, offset, v);
        offset += 2;
      } else if (bitDepth === 24) {
        floatTo24(view, offset, v);
        offset += 3;
      } else {
        view.setFloat32(offset, v, true);
        offset += 4;
      }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
