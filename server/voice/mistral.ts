import { Mistral } from '@mistralai/mistralai';
import { FunctionHandler } from '@mistralai/mistralai/extra/voice-agents';
import type { VoiceProviderAdapter, VoiceConfiguration, VoiceEvent } from './provider.js';

/** Linear interpolation for the exact 16→48 kHz SDK input ratio. */
export function upsamplePcm16(pcm: Buffer): Uint8Array {
  if (pcm.length % 2) throw new Error('Trame PCM16 invalide.');
  const result = Buffer.alloc(pcm.length * 3);
  for (let i = 0; i < pcm.length / 2; i++) {
    const a = pcm.readInt16LE(i * 2);
    const b = i + 1 < pcm.length / 2 ? pcm.readInt16LE(i * 2 + 2) : a;
    for (let j = 0; j < 3; j++)
      result.writeInt16LE(Math.round(a + ((b - a) * j) / 3), (i * 3 + j) * 2);
  }
  return result;
}
/** Preserve incomplete 48 kHz sample groups across arbitrary SDK chunk boundaries. */
export function pcmDownsampler() {
  let remainder = Buffer.alloc(0);
  return (chunk: Uint8Array): Buffer => {
    const source = Buffer.concat([remainder, chunk]);
    const samples = Math.floor(source.length / 6);
    const output = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++)
      output.writeInt16LE(
        Math.round(
          (source.readInt16LE(i * 6) +
            source.readInt16LE(i * 6 + 2) +
            source.readInt16LE(i * 6 + 4)) /
            3,
        ),
        i * 2,
      );
    remainder = Buffer.from(source.subarray(samples * 6));
    return output;
  };
}

/** Read only source URLs actually returned by the search tool, never model prose. */
export function searchSources(result: string | null | undefined): { url: string; title: string }[] {
  if (!result || result.length > 1_048_576) return [];
  let data: unknown;
  try {
    data = JSON.parse(result);
  } catch {
    return [];
  }
  const sources = new Map<string, string>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || sources.size >= 32 || !value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (typeof item.url === 'string') {
      try {
        const url = new URL(item.url);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
          sources.set(
            url.href,
            typeof item.title === 'string' ? item.title.slice(0, 240) : url.hostname,
          );
      } catch {}
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(data);
  return [...sources].map(([url, title]) => ({ url, title }));
}

export const MISTRAL_LLM_MODEL = 'mistral-small-2603';
export const MISTRAL_MAX_SESSION_MS = 15 * 60_000;

export const MISTRAL_STT_MODEL = 'voxtral-mini-transcribe-realtime-3';
export const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-3';

export function shouldForwardVoiceAudio(state: string): boolean {
  return state === 'speaking';
}

export function createMistralVoiceAdapter(
  apiKey: string,
  client = new Mistral({ apiKey, timeoutMs: 15_000 }),
): VoiceProviderAdapter {
  return {
    async connect(configuration, emit) {
      let closed = false;
      const pending = new Map<
        string,
        { resolve(value: string): void; timer: ReturnType<typeof setTimeout> }
      >();
      const handlers = (config: VoiceConfiguration) =>
        config.tools.map(
          (tool) =>
            new FunctionHandler({
              name: tool.name,
              declaration: { type: 'function', function: tool },
              timeoutMs: 65_000,
              invoke: async (args) => {
                if (closed || pending.size >= 32)
                  throw new Error('Session ou limite d’outils atteinte.');
                const id = crypto.randomUUID();
                return new Promise<string>((resolve) => {
                  const timer = setTimeout(() => {
                    pending.delete(id);
                    resolve(JSON.stringify({ error: 'Délai de l’outil dépassé.' }));
                  }, 60_000);
                  timer.unref();
                  pending.set(id, { resolve, timer });
                  emit({ type: 'tool_call', id, name: tool.name, arguments: JSON.stringify(args) });
                });
              },
            }),
        );
      const tools = (config: VoiceConfiguration) => [
        ...handlers(config),
        ...(config.webSearch ? [{ type: 'web_search' as const }] : []),
      ];
      let welcomeMessage = configuration.welcomeMessage;
      if (configuration.welcomeInstructions) {
        const greeting = await client.chat.complete({
          model: MISTRAL_LLM_MODEL,
          messages: [
            { role: 'system', content: configuration.instructions },
            { role: 'user', content: configuration.welcomeInstructions },
          ],
          maxTokens: 100,
        });
        const content = greeting.choices?.[0]?.message?.content;
        if (typeof content === 'string') welcomeMessage = content.trim().slice(0, 500) || undefined;
      }
      const session = await client.audio.sessions.init({
        llm: { model: MISTRAL_LLM_MODEL },
        stt: { model: MISTRAL_STT_MODEL, language: 'fr' },
        tts: { model: MISTRAL_TTS_MODEL, voiceId: 'fr_marie_neutral' },
        turn: { allowInterruptions: true },
        instructions: configuration.instructions,
        welcomeMessage,
        tools: tools(configuration),
      });
      const downsample = pcmDownsampler();
      const started = Date.now();
      const transcripts = new Map<string, string>();
      let speaking = false;
      let maximumDuration: ReturnType<typeof setTimeout> | undefined;
      const queue: Uint8Array[] = [];
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> => {
        if (closing) return closing;
        if (closed) return Promise.resolve();
        closed = true;
        clearTimeout(maximumDuration);
        queue.length = 0;
        for (const call of pending.values()) {
          clearTimeout(call.timer);
          call.resolve(JSON.stringify({ error: 'Session clôturée.' }));
        }
        pending.clear();
        // Emit once independently of the data-event filter, even if remote cleanup fails.
        closing = Promise.resolve().then(() => session.close()).finally(() => emit({ type: 'closed' }));
        return closing;
      };
      const notify = (event: VoiceEvent) => {
        if (!closed) emit(event);
      };
      session.on('tool_call_started', (event) => {
        if (event.name === 'web_search') notify({ type: 'web_search', id: event.id, active: true });
      });
      session.on('tool_call_ended', (event) => {
        if (event.name === 'web_search')
          notify({
            type: 'web_search',
            id: event.id,
            active: false,
            sources: event.status === 'done' ? searchSources(event.result) : [],
          });
      });
      session.on('audio', (pcm) => {
        // Voice Agents publishes a continuous background track, including silence while listening.
        // Forwarding it would fill the browser playback queue before the user has spoken.
        if (!shouldForwardVoiceAudio(speaking ? 'speaking' : 'listening')) return;
        const output = downsample(pcm);
        if (output.length) notify({ type: 'assistant_speech', pcm: output });
      });
      session.on('transcript', (event) => {
        if (event.role === 'user' && speaking && event.content.trim()) {
          notify({ type: 'interrupted' });
          speaking = false;
        }
        // Mistral sends cumulative replacements; only finalized segments are evidence for memory.
        if (!event.final || transcripts.get(event.id) === event.content) return;
        transcripts.set(event.id, event.content);
        const endMs = Date.now() - started;
        notify({
          type: event.role === 'user' ? 'user_transcript' : 'assistant_transcript',
          id: event.id,
          text: event.content,
          startMs: Math.max(0, (event.startTime ?? endMs / 1000) * 1000),
          endMs,
        });
      });
      session.on('agent_state_changed', (event) => {
        speaking = event.state === 'speaking';
        if (event.state === 'idle' || event.state === 'listening')
          notify({ type: 'turn_completed' });
        if (event.state !== 'initializing') notify({ type: 'state', state: event.state });
      });
      session.on('error', (event) => {
        if (event.fatal)
          notify({
            type: 'error',
            code: event.code ?? 'mistral_voice_failed',
            message: event.message,
          });
      });
      session.on('disconnected', () => { void close().catch(() => {}); });
      try {
        await session.connect();
      } catch (error) {
        await close().catch(() => {});
        throw error;
      }
      if (closed) throw new Error('Session Mistral fermée pendant la connexion.');
      notify({ type: 'connected', id: session.id });
      maximumDuration = setTimeout(() => { void close().catch(() => {}); }, MISTRAL_MAX_SESSION_MS);
      maximumDuration.unref();
      let sending = false;
      const pump = async () => {
        if (sending) return;
        sending = true;
        try {
          while (!closed && queue.length) await session.sendAudio(queue.shift()!);
        } catch {
          notify({ type: 'error', code: 'audio_send_failed' });
        } finally {
          sending = false;
        }
      };
      return {
        audio(pcm) {
          if (closed) return;
          if (queue.length >= 64) {
            notify({ type: 'error', code: 'audio_backpressure' });
            return;
          }
          queue.push(upsamplePcm16(pcm));
          void pump();
        },
        result(id, output) {
          const call = pending.get(id);
          if (!call) return;
          clearTimeout(call.timer);
          pending.delete(id);
          call.resolve(output);
        },
        async update(config, toolsChanged = true) {
          if (!closed)
            await session.update({ instructions: config.instructions, ...(toolsChanged ? { tools: tools(config) } : {}) });
        },
        close,

      };
    },
  };
}
