import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createAudioSession } from '../web/audio/session.js';
import { flushDiagnostics } from '../web/diagnostics.js';

function fixture(t: TestContext, local = true) {
  const spoken: Speech[] = [];
  const sent: (string | ArrayBuffer)[] = [];
  const requests: string[] = [];
  const failures: string[] = [];
  let socket!: Socket;
  let worklet!: AudioNode;
  let stopped = false;
  const track = {
    enabled: true,
    readyState: 'live',
    stop() {
      stopped = true;
      this.readyState = 'ended';
    },
    onended: null,
  };
  class AudioNode {
    gain = { value: 0 };
    port = { onmessage: null as null | ((event: { data: ArrayBuffer }) => void), postMessage() {} };
    connect() {
      return this;
    }
    disconnect() {}
  }
  class Context extends EventTarget {
    state = 'running';
    destination = {};
    audioWorklet = { async addModule() {} };
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    createMediaStreamSource() {
      return new AudioNode();
    }
    createGain() {
      return new AudioNode();
    }
  }
  class Peer {
    connectionState = 'new';
    createDataChannel() {
      return { close() {} };
    }
    addTransceiver() {
      return { sender: { async replaceTrack() {} } };
    }
    close() {
      this.connectionState = 'closed';
    }
  }
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor(readonly url: string) {
      socket = this;
    }
    send(value: string | ArrayBuffer) {
      sent.push(value);
    }
    close() {
      this.readyState = 3;
    }
  }
  class Speech {
    lang = '';
    voice: unknown;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(readonly text: string) {}
  }
  const synth = Object.assign(new EventTarget(), {
    getVoices: () => [{ lang: 'fr-FR', localService: local }],
    speak: (value: Speech) => spoken.push(value),
    cancel() {},
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: Object.assign(new EventTarget(), { speechSynthesis: synth }),
    localStorage: { getItem: () => null },
    location: { protocol: 'https:', host: 'miroir.local' },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
      },
    },
    AudioContext: Context,
    RTCPeerConnection: Peer,
    AudioWorkletNode: class extends AudioNode {
      constructor() {
        super();
        worklet = this;
      }
    },
    WebSocket: Socket,
    SpeechSynthesisUtterance: Speech,
    fetch: async (url: string) => {
      requests.push(url);
      return new Response('{}');
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const session = createAudioSession(
    { interactionId: 'groq-test', profileEpoch: 1, contextVersion: 1 },
    (kind) => failures.push(kind),
    undefined,
    false,
    null,
    'groq',
  );
  t.after(async () => {
    session.dispose();
    await flushDiagnostics();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    session,
    spoken,
    sent,
    requests,
    failures,
    synth,
    socket: () => socket,
    stopped: () => stopped,
    feed: (pcm: ArrayBuffer) => worklet.port.onmessage?.({ data: pcm }),
  };
}

test('navigateur Groq : voix locale, aucune offre OpenAI, arrêt et callbacks périmés', async (t) => {
  const f = fixture(t);
  await setImmediate();
  assert.equal(f.socket().url, 'wss://miroir.local/audio?interactionId=groq-test');
  f.socket().onmessage?.({ data: JSON.stringify({ type: 'speech', text: 'Bonjour.' }) });
  assert.equal(f.spoken[0]?.lang, 'fr-FR');
  assert.equal(f.session.levels().output, 0.5);
  const pcm = new Int16Array(512).fill(5000).buffer;
  f.feed(pcm);
  assert.ok(new Int16Array(f.sent.at(-1) as ArrayBuffer).every((sample) => sample === 0));
  f.socket().onmessage?.({ data: JSON.stringify({ type: 'speech', text: 'Une autre réponse.' }) });
  f.spoken[0]?.onend?.();
  assert.equal(
    f.session.levels().output,
    0.5,
    'La fin de l’ancienne lecture ne coupe pas la nouvelle.',
  );
  f.spoken[1]?.onend?.();
  assert.equal(f.session.levels().output, 0);
  f.feed(pcm);
  assert.equal(f.sent.at(-1), pcm);
  f.session.dispose();
  assert.equal(f.stopped(), true);
  assert.equal(f.socket().readyState, 3);
  assert.ok(!f.requests.includes('/api/media/offer'));
  assert.deepEqual(f.failures, []);
});

test('navigateur Groq : une voix distante est refusée avant toute connexion audio', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, false);
  t.mock.timers.tick(2600);
  await setImmediate();
  t.mock.timers.reset();
  assert.equal(f.socket(), undefined);
  assert.deepEqual(f.spoken, []);
  assert.deepEqual(f.failures, ['transport']);
});
