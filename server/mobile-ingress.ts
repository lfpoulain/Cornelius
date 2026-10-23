import { createServer, type IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { mobilePath } from '../shared/mobile.js';
/** In-process marker; never derived from an HTTP header. */
export const mobileIngress = new WeakSet<IncomingMessage>();
export function createMobileProxy(app: FastifyInstance) {
  const proxy = createServer((req, res) => {
    if (!mobilePath(req.url ?? '')) {
      res.writeHead(404).end();
      return;
    }
    mobileIngress.add(req);
    app.routing(req, res);
  });
  proxy.on('upgrade', (req, socket, head) => {
    if (!mobilePath(req.url ?? '')) {
      socket.destroy();
      return;
    }
    mobileIngress.add(req);
    app.server.emit('upgrade', req, socket, head);
  });
  return proxy;
}
