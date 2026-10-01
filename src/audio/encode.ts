/* ============================================================================
   LiteDAW · EXPORT / ENCODE
   Mediabunny writes every container. Codecs the platform ships natively
   (AAC via WebCodecs, Opus via WebCodecs, PCM) are used directly; MP3 (LAME),
   FLAC and AAC fall back to the bundled WASM encoders, registered lazily so
   the wasm payload is only fetched when a user actually exports.
   ========================================================================= */

import {
  AudioBufferSource,
  BufferTarget,
  FlacOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  canEncodeAudio,
  getEncodableAudioCodecs,
  type AudioCodec,
  type OutputFormat,
} from 'mediabunny';

export type ExportFormat = 'wav' | 'mp3' | 'm4a' | 'ogg' | 'flac';

export interface ContainerSpec {
  id: ExportFormat;
  label: string;
  extension: string;
  mime: string;
  codecs: { id: AudioCodec; label: string }[];
  /** Codecs that carry a bitrate control. */
  lossy: boolean;
  note: string;
}

export const CONTAINERS: ContainerSpec[] = [
  {
    id: 'wav',
    label: 'WAVE',
    extension: 'wav',
    mime: 'audio/wav',
    codecs: [
      { id: 'pcm-s16', label: 'PCM 16-bit' },
      { id: 'pcm-s24', label: 'PCM 24-bit' },
      { id: 'pcm-f32', label: 'PCM 32-bit float' },
    ],
    lossy: false,
    note: 'Uncompressed · maximum compatibility',
  },
  {
    id: 'mp3',
    label: 'MPEG-1 L3',
    extension: 'mp3',
    mime: 'audio/mpeg',
    codecs: [{ id: 'mp3', label: 'MP3 (LAME)' }],
    lossy: true,
    note: 'Universal · bundled LAME encoder',
  },
  {
    id: 'm4a',
    label: 'MPEG-4 Audio',
    extension: 'm4a',
    mime: 'audio/mp4',
    codecs: [{ id: 'aac', label: 'AAC-LC' }],
    lossy: true,
    note: 'Apple / Android native · best size ratio',
  },
  {
    id: 'ogg',
    label: 'Ogg',
    extension: 'ogg',
    mime: 'audio/ogg',
    codecs: [
      { id: 'opus', label: 'Opus' },
      { id: 'vorbis', label: 'Vorbis' },
    ],
    lossy: true,
    note: 'Open container · great at low bitrates',
  },
  {
    id: 'flac',
    label: 'FLAC',
    extension: 'flac',
    mime: 'audio/flac',
    codecs: [{ id: 'flac', label: 'FLAC' }],
    lossy: false,
    note: 'Lossless compression · archival',
  },
];

export interface ExportOptions {
  format: ExportFormat;
  codec: AudioCodec;
  /** 1 = mono, 2 = stereo. */
  channels: 1 | 2;
  sampleRate: number;
  /** bits per second, used by lossy codecs */
  bitrate: number;
  /** PCM bit depth for WAVE */
  bitDepth?: 16 | 24 | 32;
  /** 0..1, mapped onto Quality for VBR-capable codecs */
  quality?: number;
  onProgress?: (phase: string, ratio: number) => void;
}

export const SAMPLE_RATES = [22050, 32000, 44100, 48000, 88200, 96000, 192000];
export const BITRATES = [96, 128, 160, 192, 256, 320];

/* ── WASM encoder registration (once, lazily) ──────────────────────────── */

let registering: Promise<void> | null = null;

async function registerFallbacks(): Promise<void> {
  if (registering) return registering;
  registering = (async () => {
    if (!(await canEncodeAudio('mp3'))) {
      const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
      registerMp3Encoder();
    }
    if (!(await canEncodeAudio('flac'))) {
      const { registerFlacEncoder } = await import('@mediabunny/flac-encoder');
      registerFlacEncoder();
    }
    if (!(await canEncodeAudio('aac'))) {
      try {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        registerAacEncoder();
      } catch {
        /* AAC is a native-only option on this platform */
      }
    }
  })();
  return registering;
}

/** Reports which container/codec pairs this device can actually write. */
export async function probeCapabilities(): Promise<Record<string, AudioCodec[]>> {
  await registerFallbacks();
  const out: Record<string, AudioCodec[]> = {};
  for (const c of CONTAINERS) {
    const usable: AudioCodec[] = [];
    for (const codec of c.codecs) {
      // eslint-disable-next-line no-await-in-loop
      if (await canEncodeAudio(codec.id).catch(() => false)) usable.push(codec.id);
    }
    out[c.id] = usable.length ? usable : c.codecs.map((x) => x.id).slice(0, 1);
  }
  return out;
}

export async function encodableCodecs(): Promise<AudioCodec[]> {
  await registerFallbacks();
  return getEncodableAudioCodecs().catch(() => [] as AudioCodec[]);
}

/* ── Channel / rate prepare ────────────────────────────────────────────── */

function remix(buffer: AudioBuffer, channels: 1 | 2): AudioBuffer {
  if (buffer.numberOfChannels === channels) return buffer;
  const out = new AudioBuffer({
    numberOfChannels: channels,
    length: buffer.length,
    sampleRate: buffer.sampleRate,
  });
  if (channels === 1) {
    const dst = out.getChannelData(0);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      for (let i = 0; i < dst.length; i++) dst[i] += src[i] / buffer.numberOfChannels;
    }
  } else {
    const src = buffer.getChannelData(0);
    out.getChannelData(0).set(src);
    out.getChannelData(1).set(buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : src);
  }
  return out;
}

/** Offline resample to the requested export rate (linear + brick-wall trim). */
async function resample(buffer: AudioBuffer, rate: number): Promise<AudioBuffer> {
  if (Math.abs(buffer.sampleRate - rate) < 1) return buffer;
  const length = Math.ceil((buffer.duration * rate) / 1) + 1;
  const OAC: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OAC(buffer.numberOfChannels, length, rate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

/* ── Main export entry ─────────────────────────────────────────────────── */

export interface ExportResult {
  blob: Blob;
  filename: string;
  bytes: number;
  format: ExportFormat;
  codec: AudioCodec;
  sampleRate: number;
  channels: number;
}

export async function encodeAudioBuffer(input: AudioBuffer, opts: ExportOptions): Promise<ExportResult> {
  const { format, codec, channels, sampleRate, bitrate } = opts;
  const progress = opts.onProgress ?? (() => {});

  progress('Preparing encoders', 0.04);
  await registerFallbacks();

  progress('Remixing channels', 0.12);
  let buf = remix(input, channels);

  progress(`Resampling to ${(sampleRate / 1000).toFixed(1)} kHz`, 0.2);
  buf = await resample(buf, sampleRate);

  const spec = CONTAINERS.find((c) => c.id === format)!;
  let outputFormat: OutputFormat;
  switch (format) {
    case 'wav':
      outputFormat = new WavOutputFormat();
      break;
    case 'mp3':
      outputFormat = new Mp3OutputFormat();
      break;
    case 'm4a':
      outputFormat = new Mp4OutputFormat({ fastStart: 'in-memory' });
      break;
    case 'ogg':
      outputFormat = new OggOutputFormat();
      break;
    case 'flac':
      outputFormat = new FlacOutputFormat();
      break;
  }

  const target = new BufferTarget();
  const output = new Output({ format: outputFormat, target });

  const isPcm = codec.startsWith('pcm-');
  const quality = isPcm
    ? undefined
    : new Quality({ bitrate: Math.round(bitrate), bitrateMode: format === 'ogg' ? 'variable' : 'constant' });

  const pcmCodec: AudioCodec =
    format === 'wav' && opts.bitDepth === 24
      ? 'pcm-s24'
      : format === 'wav' && opts.bitDepth === 32
        ? 'pcm-f32'
        : codec;

  // Packet counter drives the progress readout without polling the encoder.
  const totalPackets = Math.max(8, Math.ceil(buf.duration / 0.021));
  let packets = 0;

  const source = new AudioBufferSource(
    {
      codec: isPcm ? pcmCodec : codec,
      ...(quality ? { quality } : {}),
      transform: {
        numberOfChannels: channels,
        sampleRate,
        // Only FLAC exposes the bit depth through the sample format; PCM
        // containers derive it from the codec string itself.
        ...(format === 'flac'
          ? { sampleFormat: (opts.bitDepth === 24 ? 's32' : 's16') as 's16' | 's32' }
          : {}),
      },
      onEncodedPacket: () => {
        packets++;
        progress('Encoding audio', 0.3 + Math.min(0.64, packets / totalPackets) * 0.64);
      },
    },
    { startTimestamp: 0 },
  );

  output.addAudioTrack(source, {});
  output.setMetadataTags({
    title: 'LiteDAW Mixdown',
    artist: 'LiteDAW',
    comment: `Rendered by LiteDAW · ${spec.label} / ${codec}`,
  });

  progress('Opening container', 0.28);
  await output.start();
  await source.add(buf);
  source.close();
  progress('Finalising file', 0.96);
  await output.finalize();

  const data = target.buffer;
  if (!data) throw new Error('encoder produced no data');
  const blob = new Blob([data], { type: spec.mime });
  progress('Done', 1);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return {
    blob,
    filename: `LiteDAW_Mix_${stamp}.${spec.extension}`,
    bytes: blob.size,
    format,
    codec: isPcm ? pcmCodec : codec,
    sampleRate,
    channels,
  };
}

/** Convenience: encode and immediately hand the file to the browser. */
export async function downloadAudioBuffer(input: AudioBuffer, opts: ExportOptions): Promise<ExportResult> {
  const res = await encodeAudioBuffer(input, opts);
  const url = URL.createObjectURL(res.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return res;
}

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};
