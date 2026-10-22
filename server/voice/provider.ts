/** Provider-neutral events. PCM at the Cornelius boundary is mono PCM16, 16 kHz. */
export type VoiceEvent =
  | { type: 'connected'; id: string }
  | {
      type: 'user_transcript' | 'assistant_transcript';
      id: string;
      text: string;
      startMs: number;
      endMs: number;
    }
  | { type: 'assistant_speech'; pcm: Buffer }
  | { type: 'web_search'; id: string; active: boolean; sources?: { url: string; title: string }[] }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'turn_completed' | 'interrupted' | 'closed' }
  | { type: 'state'; state: 'idle' | 'listening' | 'thinking' | 'speaking' }
  | { type: 'error'; code: string; message?: string };

export interface VoiceTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface VoiceConfiguration {
  instructions: string;
  tools: VoiceTool[];
  webSearch: boolean;
  welcomeMessage?: string;
}
export interface VoiceConnection {
  audio(pcm: Buffer): void;
  result(id: string, output: string): void;
  update(config: VoiceConfiguration): Promise<void>;
  close(): Promise<void>;
}
export interface VoiceProviderAdapter {
  connect(config: VoiceConfiguration, event: (event: VoiceEvent) => void): Promise<VoiceConnection>;
}
