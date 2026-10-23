import type { IncomingMessage } from 'node:http';
/** In-process marker; never derived from an HTTP header. */
export const mobileIngress = new WeakSet<IncomingMessage>();
