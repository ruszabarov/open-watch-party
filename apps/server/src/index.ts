import http from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@open-watch-party/shared';

import { logger } from './logger';
import { RealtimeSocketService } from './socket';

const port = Number.parseInt(process.env['PORT'] ?? '8787', 10);

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    logger.debug({ method: request.method, url: request.url }, 'http:health');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  logger.debug({ method: request.method, url: request.url }, 'http:not_found');
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false }));
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
  },
  transports: ['websocket'],
});

const socketService = new RealtimeSocketService(io);

socketService.register();

server.listen(port, () => {
  logger.info({ port }, 'server:listening');
});
