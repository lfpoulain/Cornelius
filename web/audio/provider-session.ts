import type { Scope } from '../../shared/types';
import { takeAudioConnection } from './connection';
import { reportMediaFailure, type AudioFailure, type AudioLevels } from './session';

/** Server-side provider pipeline. Only scoped PCM crosses the local WebSocket. */
export function createProviderAudioSession(
  scope: Scope,
  onFailure: (kind: AudioFailure) => void,
  onLocked?: (locked: boolean) => void,
) {
  const { connection } = takeAudioConnection(false);
  const context = connection.context;
  const query = new URLSearchParams({
    interactionId: scope.interactionId!,
    profileEpoch: String(scope.profileEpoch),
    contextVersion: String(scope.contextVersion),
  });
  const socket = new WebSocket(
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/voice-audio?${query}`,
  );
  socket.binaryType = 'arraybuffer';
  let disposed = false;
  let enabled = true;
  let ready = false;
  let nextAt = 0;
  let unsubscribe: (() => void) | null = null;
  let inputSource: MediaStreamAudioSourceNode | null = null;
  const input = context.createAnalyser();
  const output = context.createAnalyser();
  input.fftSize = output.fftSize = 256;
  output.connect(context.destination);
  const samples = new Float32Array(256);
  const playing = new Set<AudioBufferSourceNode>();
  const queued: ArrayBuffer[] = [];
  const flush = () => {
    for (const source of playing) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    playing.clear();
    nextAt = context.currentTime;
  };
  const fail = (kind: AudioFailure = 'transport') => {
    if (disposed) return;
    reportMediaFailure(scope);
    onFailure(kind);
    dispose();
  };
  const resume = () => {
    if (disposed) return;
    void context
      .resume()
      .then(() => onLocked?.(context.state !== 'running'))
      .catch(() => onLocked?.(true));
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
  const timer = setInterval(() => {
    if (!ready || !enabled || socket.readyState !== WebSocket.OPEN || !queued.length) return;
    if (socket.bufferedAmount > 64_000) return fail();
    socket.send(queued.shift()!);
  }, 32);
  const startup = setTimeout(() => {
    if (!ready) fail();
  }, 40_000);
  socket.onmessage = ({ data }) => {
    if (disposed) return;
    if (typeof data === 'string') {
      const event = JSON.parse(data);
      if (event.type === 'ready') {
        ready = true;
        clearTimeout(startup);
      }
      if (event.type === 'interrupted') flush();
      return;
    }
    if (!(data instanceof ArrayBuffer) || !enabled || data.byteLength % 2) return;
    if (context.state !== 'running') {
      onLocked?.(true);
      return;
    }
    if (nextAt - context.currentTime > 2) return fail();
    const pcm = new DataView(data);
    const buffer = context.createBuffer(1, data.byteLength / 2, 16000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    playing.add(source);
    source.onended = () => {
      playing.delete(source);
      source.disconnect();
    };
    nextAt = Math.max(context.currentTime, nextAt);
    source.start(nextAt);
    nextAt += buffer.duration;
  };
  socket.onerror = () => fail();
  socket.onclose = () => fail();
  void connection
    .microphone()
    .then((stream) => {
      if (disposed) return;
      stream
        .getAudioTracks()
        .forEach((track) => track.addEventListener('ended', () => fail('device'), { once: true }));
      inputSource = context.createMediaStreamSource(stream);
      inputSource.connect(input);
      unsubscribe = connection.subscribePcm((pcm) => {
        if (!enabled || disposed) return;
        if (queued.length >= 500) return fail();
        queued.push(pcm);
      });
      resume();
    })
    .catch((error) =>
      fail(
        ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(error?.name)
          ? 'device'
          : 'transport',
      ),
    );
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    clearTimeout(startup);
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
    socket.close();
    unsubscribe?.();
    queued.length = 0;
    flush();
    inputSource?.disconnect();
    input.disconnect();
    output.disconnect();
    connection.dispose();
  }
  const rms = (node: AnalyserNode) => {
    node.getFloatTimeDomainData(samples);
    return Math.min(1, Math.sqrt(samples.reduce((a, v) => a + v * v, 0) / samples.length) * 5);
  };
  return {
    ready() {},
    silence: dispose,
    dispose,
    enable(value: boolean) {
      enabled = value;
      if (!value) {
        queued.length = 0;
        flush();
      }
    },
    levels(): AudioLevels {
      return disposed || !enabled
        ? { input: 0, output: 0 }
        : { input: rms(input), output: rms(output) };
    },
  };
}
