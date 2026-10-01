/* ============================================================================
   LiteDAW · IMPORT / DECODE
   Two-tier decode strategy:
     1. `AudioContext.decodeAudioData` — native, fastest, preserves the file's
        native sample rate (which is what makes mixed-rate playback possible).
     2. Mediabunny demux + decode — covers anything the browser refuses,
        notably Ogg/Vorbis, FLAC and Matroska on Safari/Android WebView.
   ========================================================================= */

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { peakEnvelope, type PeakEnvelope } from './dsp';

export interface DecodedAudio {
  buffer: AudioBuffer;
  name: string;
  /** Original container/codec description, shown in the inspector. */
  source: string;
  sampleRate: number;
  channels: number;
  duration: number;
  peak: PeakEnvelope;
  /** Which decode path produced this buffer. */
  via: 'native' | 'mediabunny';
}

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'mp4', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'weba', 'aif', 'aiff', 'caf'];

export const isAudioFile = (f: File) =>
  f.type.startsWith('audio/') ||
  f.type === 'video/mp4' ||
  AUDIO_EXTENSIONS.includes(f.name.split('.').pop()?.toLowerCase() ?? '');

function makeBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
  return new AudioBuffer({ numberOfChannels, length: Math.max(1, length), sampleRate });
}

/** Tier 2: demux + decode with mediabunny, merged into a single AudioBuffer. */
async function decodeViaMediabunny(file: File): Promise<{ buffer: AudioBuffer; source: string }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no audio track found in container');
    const [codec, sr, ch] = await Promise.all([
      track.getCodec(),
      track.getSampleRate(),
      track.getNumberOfChannels(),
    ]);
    const sink = new AudioBufferSink(track);

    const chunks: { buffer: AudioBuffer; timestamp: number; duration: number }[] = [];
    let frames = 0;
    let rate = sr ?? 48000;
    let channels = ch ?? 2;
    for await (const wrapped of sink.buffers()) {
      chunks.push(wrapped);
      rate = wrapped.buffer.sampleRate || rate;
      channels = Math.max(channels, wrapped.buffer.numberOfChannels);
      frames += wrapped.buffer.length;
    }
    if (!chunks.length) throw new Error('container produced no decodable audio');

    const out = makeBuffer(channels, frames, rate);
    let offset = 0;
    for (const c of chunks) {
      for (let ci = 0; ci < channels; ci++) {
        const src = c.buffer.getChannelData(Math.min(ci, c.buffer.numberOfChannels - 1));
        out.getChannelData(ci).set(src, offset);
      }
      offset += c.buffer.length;
    }
    return { buffer: out, source: `${codec ?? 'unknown'} · ${file.name.split('.').pop()?.toUpperCase()}` };
  } finally {
    try {
      input.dispose();
    } catch {
      /* already disposed */
    }
  }
}

/** Full import pipeline: decode → build peaks → describe. */
export async function decodeAudioFile(file: File, peakBuckets = 2048): Promise<DecodedAudio> {
  let buffer: AudioBuffer | null = null;
  let via: DecodedAudio['via'] = 'native';
  let source = `${file.name.split('.').pop()?.toUpperCase() ?? 'AUDIO'}`;

  try {
    const ctx = new OfflineAudioContext(1, 1, 48000); // decode-only context
    const bytes = await file.arrayBuffer();
    buffer = await ctx.decodeAudioData(bytes.slice(0));
    source = `${source} · native`;
  } catch {
    const res = await decodeViaMediabunny(file);
    buffer = res.buffer;
    source = res.source;
    via = 'mediabunny';
  }

  if (!buffer) throw new Error(`Could not decode ${file.name}`);

  const peak = peakEnvelope(buffer.getChannelData(0), peakBuckets);
  return {
    buffer,
    name: file.name.replace(/\.[^.]+$/, ''),
    source,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    duration: buffer.duration,
    peak,
    via,
  };
}

/** Reads a Blob/File as a mono/stereo AudioBuffer without peak analysis (fast path). */
export async function decodeToBuffer(blob: Blob): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

/** Extracts the first channel of an AudioBuffer as a plain Float32Array. */
export function channelData(buf: AudioBuffer, channel = 0): Float32Array {
  return buf.getChannelData(Math.min(channel, buf.numberOfChannels - 1));
}

/** Human-readable container summary for the inspector. */
export function describeBuffer(buf: AudioBuffer) {
  return {
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
    duration: buf.duration,
    frames: buf.length,
    layout: buf.numberOfChannels === 1 ? 'Mono' : buf.numberOfChannels === 2 ? 'Stereo' : `${buf.numberOfChannels}ch`,
  };
}

/** Sniffs a likely file kind for iconography. */
export function fileKind(name: string): 'wav' | 'mp3' | 'm4a' | 'ogg' | 'flac' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'wav' || ext === 'aif' || ext === 'aiff') return 'wav';
  if (ext === 'mp3') return 'mp3';
  if (ext === 'm4a' || ext === 'mp4' || ext === 'aac') return 'm4a';
  if (ext === 'ogg' || ext === 'oga' || ext === 'opus') return 'ogg';
  if (ext === 'flac') return 'flac';
  return 'other';
}
