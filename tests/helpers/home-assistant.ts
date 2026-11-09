import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

export function haState(id: string, state = 'off', brightness = false) {
  return {
    entity_id: id,
    state,
    last_updated: new Date().toISOString(),
    attributes: {
      friendly_name:
        id === 'light.salon' ? 'Lampe du salon' : id === 'switch.bureau' ? 'Prise du bureau' : id,
      supported_color_modes: brightness ? ['brightness'] : ['onoff'],
      ...(brightness ? { brightness: 128 } : {}),
    },
  };
}
export async function fakeHomeAssistant() {
  const token = 'ha-secret-test-only';
  const states = new Map<string, ReturnType<typeof haState>>([
    ['light.salon', haState('light.salon', 'off', true)],
    ['switch.bureau', haState('switch.bureau')],
    ['light.cachee', haState('light.cachee')],
    ['light.default', haState('light.default')],
    ['light.refusee', haState('light.refusee')],
    ['lock.porte', haState('lock.porte')],
  ]);
  const aliases = new Map<string, (string | null)[]>([
    ['light.salon', ['Lumière du canapé', 'Salon cosy', null]],
    ['switch.bureau', ['Bureau secret']],
    ['light.cachee', ['Lampe cachée']],
  ]);
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  // Entrées de registre ajoutées par un test (capteurs, grand catalogue).
  const registry: Record<string, unknown>[] = [];
  const wsCalls: string[] = [];
  const options = {
    apply: true,
    /** Délai avant que l’appareil factice remonte son nouvel état (comme un vrai Zigbee). */
    applyDelayMs: 0,
    serviceStatus: 200,
    readStatus: 200,
    assistDenied: false,
    aliasBatchDenied: false,
    malformed: false,
    holdRead: false,
  };
  let releaseRead: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + token) {
      res.writeHead(401);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    const path = req.url ?? '';
    if (path.startsWith('/api/states/')) {
      if (options.holdRead)
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      const entity = states.get(decodeURIComponent(path.slice('/api/states/'.length)));
      res.writeHead(entity ? options.readStatus : 404);
      res.end(options.malformed ? 'bad-json' : JSON.stringify(entity ?? {}));
    } else if (path.startsWith('/api/services/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      calls.push({ path, body });
      const entity = states.get(String(body.entity_id));
      if (options.apply && entity && options.serviceStatus === 200) {
        const apply = () => {
          entity.state = path.endsWith('/turn_on') ? 'on' : 'off';
          entity.last_updated = new Date().toISOString();
          const attributes = entity.attributes as Record<string, unknown>;
          if (typeof body.brightness_pct === 'number')
            attributes.brightness = Math.round((body.brightness_pct / 100) * 255);
          // Comme une ampoule réelle : la couleur est relue à pleine intensité (canal le plus
          // fort à 255) et un peu arrondie par sa teinte.
          if (Array.isArray(body.rgb_color)) {
            const rgb = body.rgb_color as number[];
            const max = Math.max(...rgb) || 1;
            attributes.rgb_color = rgb.map((value) => {
              const channel = Math.round((value * 255) / max);
              return Math.min(255, Math.max(0, channel + (channel > 127 ? -3 : 2)));
            });
            attributes.color_mode = 'hs';
          }
          if (typeof body.color_temp_kelvin === 'number') {
            attributes.color_temp_kelvin = body.color_temp_kelvin;
            attributes.color_mode = 'color_temp';
          }
          emit(entity);
        };
        if (options.applyDelayMs > 0) setTimeout(apply, options.applyDelayMs);
        else apply();
      }
      res.writeHead(options.serviceStatus);
      res.end('[]');
    } else {
      res.writeHead(404);
      res.end('{}');
    }
  });
  const wss = new WebSocketServer({ server, path: '/api/websocket' });
  const subscriptions = new Map<import('ws').WebSocket, Map<string, number>>();
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.9.0' }));
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      if (request.type === 'auth') {
        socket.send(
          JSON.stringify({ type: request.access_token === token ? 'auth_ok' : 'auth_invalid' }),
        );
        return;
      }
      wsCalls.push(request.type);
      let result: unknown = null;
      if (request.type === 'get_states') result = [...states.values()];
      if (request.type === 'subscribe_events') {
        const events = subscriptions.get(socket) ?? new Map<string, number>();
        events.set(request.event_type, request.id);
        subscriptions.set(socket, events);
      }
      if (request.type === 'config/entity_registry/get_entries' && options.aliasBatchDenied) {
        socket.send(
          JSON.stringify({
            id: request.id,
            type: 'result',
            success: false,
            error: { code: 'not_found', message: 'Unsupported command' },
          }),
        );
        return;
      }
      if (request.type === 'config/entity_registry/get_entries')
        result = Object.fromEntries(
          request.entity_ids.map((id: string) => [
            id,
            aliases.has(id) ? { entity_id: id, aliases: aliases.get(id) } : null,
          ]),
        );
      if (request.type === 'config/entity_registry/get')
        result = aliases.has(request.entity_id)
          ? { entity_id: request.entity_id, aliases: aliases.get(request.entity_id) }
          : null;
      if (request.type === 'homeassistant/expose_entity/list') {
        if (options.assistDenied) {
          socket.send(
            JSON.stringify({
              id: request.id,
              type: 'result',
              success: false,
              error: { code: 'unauthorized', message: token },
            }),
          );
          return;
        }
        result = {
          exposed_entities: {
            'light.salon': { conversation: true },
            'switch.bureau': { 'cloud.alexa': true },
            'light.refusee': { conversation: true },
          },
        };
      }
      if (request.type === 'homeassistant/expose_new_entities/get') result = { expose_new: true };
      if (request.type === 'config/entity_registry/list')
        result = [
          { entity_id: 'light.salon', options: { conversation: { should_expose: true } } },
          { entity_id: 'light.default', options: {} },
          { entity_id: 'light.cachee', hidden_by: 'user', options: {} },
          { entity_id: 'light.refusee', options: { conversation: { should_expose: false } } },
          { entity_id: 'switch.bureau', options: { conversation: { should_expose: false } } },
          ...registry,
        ];
      socket.send(JSON.stringify({ id: request.id, type: 'result', success: true, result }));
    });
    socket.on('close', () => subscriptions.delete(socket));
  });
  function emitEvent(event_type: string, data: Record<string, unknown>) {
    for (const [socket, events] of subscriptions) {
      const id = events.get(event_type);
      if (id === undefined) continue;
      socket.send(JSON.stringify({ id, type: 'event', event: { event_type, data } }));
    }
  }
  function emit(entity: ReturnType<typeof haState> | null, id = entity?.entity_id) {
    emitEvent('state_changed', { entity_id: id, new_state: entity });
  }
  function emitRegistry(id: string, oldEntityId?: string) {
    emitEvent('entity_registry_updated', {
      action: 'update',
      entity_id: id,
      ...(oldEntityId ? { old_entity_id: oldEntityId } : {}),
      // HA fournit l'ancienne valeur dans changes ; seul get fournit les alias actuels.
      changes: { aliases: ['ancienne valeur'] },
    });
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return {
    url: 'http://127.0.0.1:' + address.port,
    token,
    states,
    aliases,
    registry,
    calls,
    wsCalls,
    options,
    emit,
    emitRegistry,
    releaseRead: () => releaseRead?.(),
    drop: () => {
      for (const socket of wss.clients) socket.terminate();
    },
    close: async () => {
      releaseRead?.();
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
