import { Socket } from 'node:net';

export interface WyomingEndpoint {
  host: string;
  port: number;
}

interface WyomingEvent {
  type: string;
  data?: Record<string, unknown>;
  payload?: Buffer;
}

/**
 * Linearly resamples mono PCM16LE audio from `fromRate` to `toRate`.
 * Preserves full samples and handles arbitrary sample rate ratios cleanly.
 */
export function resamplePcm16Mono(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (pcm.length % 2 !== 0) throw new Error('Trame PCM16 invalide.');
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const inputSamples = pcm.length / 2;
  if (inputSamples === 1) return Buffer.from(pcm);
  const outputSamples = Math.max(1, Math.round((inputSamples * toRate) / fromRate));
  const output = Buffer.alloc(outputSamples * 2);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outputSamples; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = pcm.readInt16LE(Math.min(idx, inputSamples - 1) * 2);
    const b = pcm.readInt16LE(Math.min(idx + 1, inputSamples - 1) * 2);
    const sample = Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * frac)));
    output.writeInt16LE(sample, i * 2);
  }
  return output;
}

function encodeWyomingEvent(
  type: string,
  data?: Record<string, unknown>,
  payload?: Buffer,
): Buffer {
  const header: Record<string, unknown> = { type };
  if (data && Object.keys(data).length > 0) header.data = data;
  if (payload && payload.length > 0) header.payload_length = payload.length;
  const line = Buffer.from(JSON.stringify(header) + '\n', 'utf8');
  return payload && payload.length > 0 ? Buffer.concat([line, payload]) : line;
}

async function runWyomingSession<T>(
  endpoint: WyomingEndpoint,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  run: (
    send: (type: string, data?: Record<string, unknown>, payload?: Buffer) => void,
    onEvent: (handler: (event: WyomingEvent) => void) => void,
  ) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw new Error('Requête Wyoming annulée.');
  return new Promise<T>((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    let buffer = Buffer.alloc(0);
    let eventHandler: ((event: WyomingEvent) => void) | null = null;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.removeAllListeners();
      socket.destroy();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new Error('Requête Wyoming annulée.'));
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => fail(new Error('Délai Wyoming dépassé.')), timeoutMs);
    timer.unref();

    const parseBuffer = () => {
      while (!settled) {
        const newline = buffer.indexOf(0x0a);
        if (newline === -1) return;
        const headerLine = buffer.subarray(0, newline).toString('utf8').trim();
        let header: {
          type?: unknown;
          data?: unknown;
          data_length?: unknown;
          payload_length?: unknown;
        };
        try {
          header = JSON.parse(headerLine) as typeof header;
        } catch (error) {
          fail(error instanceof Error ? error : new Error('En-tête Wyoming invalide.'));
          return;
        }
        const dataLen = typeof header.data_length === 'number' ? header.data_length : 0;
        const payloadLen = typeof header.payload_length === 'number' ? header.payload_length : 0;
        const totalNeeded = newline + 1 + dataLen + payloadLen;
        if (buffer.length < totalNeeded) return;

        let data: Record<string, unknown> =
          header.data && typeof header.data === 'object'
            ? (header.data as Record<string, unknown>)
            : {};
        if (dataLen > 0) {
          const dataBytes = buffer.subarray(newline + 1, newline + 1 + dataLen).toString('utf8');
          try {
            data = { ...data, ...(JSON.parse(dataBytes) as Record<string, unknown>) };
          } catch {}
        }
        const payload =
          payloadLen > 0
            ? Buffer.from(buffer.subarray(newline + 1 + dataLen, totalNeeded))
            : undefined;
        buffer = buffer.subarray(totalNeeded);
        if (typeof header.type === 'string') {
          eventHandler?.({ type: header.type, data, payload });
        }
      }
    };

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      parseBuffer();
    });
    socket.on('error', (error) => fail(error));
    socket.on('close', () => {
      if (!settled) fail(new Error('Connexion Wyoming fermée prématurément.'));
    });
    socket.connect(endpoint.port, endpoint.host, () => {
      const send = (type: string, data?: Record<string, unknown>, payload?: Buffer) => {
        if (!socket.destroyed) socket.write(encodeWyomingEvent(type, data, payload));
      };
      const onEvent = (handler: (event: WyomingEvent) => void) => {
        eventHandler = handler;
      };
      void run(send, onEvent)
        .then((result) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        })
        .catch((error) => {
          fail(error instanceof Error ? error : new Error(String(error)));
        });
    });
  });
}

/** Transcribes a mono PCM16LE 16 kHz buffer via Wyoming Whisper. */
export async function transcribeWyoming(options: {
  endpoint: WyomingEndpoint;
  pcm16k: Buffer;
  language?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { endpoint, pcm16k, language = 'fr', timeoutMs = 15_000, signal } = options;
  if (pcm16k.length === 0) return '';
  return runWyomingSession(endpoint, timeoutMs, signal, (send, onEvent) => {
    return new Promise<string>((resolve, reject) => {
      onEvent((event) => {
        if (event.type === 'transcript') {
          resolve(typeof event.data?.text === 'string' ? event.data.text.trim() : '');
        } else if (event.type === 'error') {
          reject(new Error(String(event.data?.text ?? 'Erreur Whisper Wyoming.')));
        }
      });
      send('transcribe', { language });
      send('audio-start', { rate: 16000, width: 2, channels: 1 });
      const chunkSize = 8192;
      for (let offset = 0; offset < pcm16k.length; offset += chunkSize) {
        send(
          'audio-chunk',
          { rate: 16000, width: 2, channels: 1 },
          pcm16k.subarray(offset, offset + chunkSize),
        );
      }
      send('audio-stop');
    });
  });
}

/** Synthesizes text via Wyoming Piper and returns mono PCM16LE at 16 kHz. */
export async function synthesizeWyoming(options: {
  endpoint: WyomingEndpoint;
  text: string;
  voice?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const { endpoint, text, voice, timeoutMs = 20_000, signal } = options;
  const trimmed = text.trim();
  if (!trimmed) return Buffer.alloc(0);
  return runWyomingSession(endpoint, timeoutMs, signal, (send, onEvent) => {
    return new Promise<Buffer>((resolve, reject) => {
      let rate = 22050;
      let channels = 1;
      const chunks: Buffer[] = [];
      onEvent((event) => {
        if (event.type === 'audio-start') {
          if (typeof event.data?.rate === 'number') rate = event.data.rate;
          if (typeof event.data?.channels === 'number') channels = event.data.channels;
        } else if (event.type === 'audio-chunk' && event.payload) {
          chunks.push(event.payload);
        } else if (event.type === 'audio-stop') {
          let raw = Buffer.concat(chunks);
          if (channels > 1 && raw.length >= channels * 2) {
            const mono = Buffer.alloc(Math.floor(raw.length / channels / 2) * 2);
            for (let i = 0; i < mono.length / 2; i++) {
              mono.writeInt16LE(raw.readInt16LE(i * channels * 2), i * 2);
            }
            raw = mono;
          }
          resolve(resamplePcm16Mono(raw, rate, 16000));
        } else if (event.type === 'error') {
          reject(new Error(String(event.data?.text ?? 'Erreur Piper Wyoming.')));
        }
      });
      send('synthesize', {
        text: trimmed,
        ...(voice ? { voice: { name: voice } } : {}),
      });
    });
  });
}

/** Encodes raw 16 kHz mono PCM16LE audio into a standard RIFF/WAVE container. */
export function pcmToWav(pcm16k: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm16k.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // Linear PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  header.writeUInt16LE(2, 32); // Block align
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm16k.length, 40);
  return Buffer.concat([header, pcm16k]);
}

export interface WhisperVerboseSegment {
  text?: unknown;
  no_speech_prob?: unknown;
  avg_logprob?: unknown;
  compression_ratio?: unknown;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return Math.max(1, x);
}

/** Filters out low-confidence / silence-hallucinated Whisper segments when verbose_json metadata is present. */
export function extractConfidentTranscript(payload: {
  text?: unknown;
  segments?: WhisperVerboseSegment[];
}): string {
  if (!Array.isArray(payload.segments) || payload.segments.length === 0) {
    return typeof payload.text === 'string' ? payload.text.trim() : '';
  }
  const kept: string[] = [];
  for (const seg of payload.segments) {
    const text = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (!text) continue;
    const noSpeech = typeof seg.no_speech_prob === 'number' ? seg.no_speech_prob : 0;
    const avgLogprob = typeof seg.avg_logprob === 'number' ? seg.avg_logprob : 0;
    const compression = typeof seg.compression_ratio === 'number' ? seg.compression_ratio : 1;
    if (noSpeech > 0.72) continue;
    if (noSpeech > 0.55 && avgLogprob < -0.95) continue;
    if (avgLogprob < -1.25 || compression > 2.4) continue;
    kept.push(text);
  }
  return kept.join(' ').trim();
}

export async function transcribeOpenAiStt(input: {
  baseUrl: string;
  model: string;
  pcm16k: Buffer;
  language?: string;
  prompt?: string;
  hotwords?: string;
  vadFilter?: boolean;
  responseFormat?: 'json' | 'verbose_json';
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<string> {
  if (input.pcm16k.length === 0) return '';
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const wav = pcmToWav(input.pcm16k);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', input.model);
  form.append('language', input.language ?? 'fr');
  if (input.prompt?.trim()) form.append('prompt', input.prompt.trim());
  if (input.hotwords?.trim()) form.append('hotwords', input.hotwords.trim());
  form.append('response_format', input.responseFormat ?? 'verbose_json');
  form.append('temperature', '0');
  form.append('vad_filter', input.vadFilter === false ? 'false' : 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 20_000);
  timer.unref();
  const onParentAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const endpoint = input.baseUrl.replace(/\/+$/u, '') + '/v1/audio/transcriptions';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`STT HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      text?: unknown;
      segments?: WhisperVerboseSegment[];
    };
    return extractConfidentTranscript(payload);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onParentAbort);
  }
}

/** Synthesizes speech via an OpenAI-compatible TTS endpoint (e.g. Kokoro-FastAPI / Speaches) and resamples PCM to 16 kHz, streaming chunks when `onChunk` is provided. */
export async function synthesizeOpenAiTts(input: {
  baseUrl: string;
  model: string;
  voice: string;
  text: string;
  langCode?: string;
  sampleRate?: number;
  speed?: number;
  stream?: boolean;
  onChunk?: (pcm16k: Buffer) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<Buffer> {
  const trimmed = input.text.trim();
  if (!trimmed) return Buffer.alloc(0);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 20_000);
  timer.unref();
  const onParentAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onParentAbort, { once: true });
  const fromRate = input.sampleRate ?? 24000;
  const useStream = Boolean(input.stream ?? input.onChunk);

  try {
    const endpoint = input.baseUrl.replace(/\/+$/u, '') + '/v1/audio/speech';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        voice: input.voice,
        input: trimmed,
        response_format: 'pcm',
        ...(useStream ? { stream: true } : {}),
        ...(input.langCode ? { lang_code: input.langCode } : {}),
        ...(typeof input.speed === 'number' ? { speed: input.speed } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`TTS HTTP ${response.status}`);
    }
    if (!input.onChunk || !response.body) {
      let raw = Buffer.from(await response.arrayBuffer());
      if (raw.length % 2 !== 0) raw = raw.subarray(0, raw.length - 1);
      const pcm16k = resamplePcm16Mono(raw, fromRate, 16000);
      if (input.onChunk && pcm16k.length > 0) input.onChunk(pcm16k);
      return pcm16k;
    }

    // Align streaming chunk boundaries to exact integer input/output sample periods so resampling is click-free.
    const stepSamples = Math.max(1, Math.round(fromRate / gcd(fromRate, 16000)));
    const blockBytes = stepSamples * 2;
    const reader = response.body.getReader();
    let carry = Buffer.alloc(0);
    const outChunks: Buffer[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      carry = carry.length > 0 ? Buffer.concat([carry, Buffer.from(value)]) : Buffer.from(value);
      const usable = Math.floor(carry.length / blockBytes) * blockBytes;
      if (usable > 0) {
        const piece = carry.subarray(0, usable);
        carry = carry.subarray(usable);
        const resampled = resamplePcm16Mono(piece, fromRate, 16000);
        if (resampled.length > 0) {
          outChunks.push(resampled);
          input.onChunk(resampled);
        }
      }
    }
    if (carry.length >= 2) {
      const evenLen = carry.length - (carry.length % 2);
      if (evenLen >= 2) {
        const resampled = resamplePcm16Mono(carry.subarray(0, evenLen), fromRate, 16000);
        if (resampled.length > 0) {
          outChunks.push(resampled);
          input.onChunk(resampled);
        }
      }
    }
    return Buffer.concat(outChunks);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onParentAbort);
  }
}
