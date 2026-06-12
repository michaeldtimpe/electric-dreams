import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { app } from 'electron';
import type { ClientMessage, ServerMessage } from '@ed/shared';

export interface DashboardServer {
  broadcast: (msg: ServerMessage) => void;
  port: number;
  urls: string[];
}

function dashboardDist(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'dashboard');
  return resolve(__dirname, '../../../dashboard/dist');
}

export async function startServer(opts: {
  port: number;
  onMessage: (msg: ClientMessage) => void;
  snapshot: () => ServerMessage[];
}): Promise<DashboardServer> {
  const fastify = Fastify({ logger: false });
  await fastify.register(fastifyWebsocket);

  const dist = dashboardDist();
  if (existsSync(dist)) {
    await fastify.register(fastifyStatic, { root: dist });
  } else {
    fastify.get('/', async () => ({
      error: 'Dashboard not built. Run: npm run build -w @ed/dashboard',
    }));
  }

  const sockets = new Set<{ send: (s: string) => void }>();

  fastify.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => {
      sockets.add(socket);
      for (const msg of opts.snapshot()) socket.send(JSON.stringify(msg));
      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;
          opts.onMessage(msg);
        } catch (e) {
          console.error('[ws] bad message', e);
        }
      });
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => sockets.delete(socket));
    });
  });

  await fastify.listen({ port: opts.port, host: '0.0.0.0' });

  const urls = [`http://localhost:${opts.port}`];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) urls.push(`http://${iface.address}:${opts.port}`);
    }
  }

  return {
    port: opts.port,
    urls,
    broadcast: (msg) => {
      const s = JSON.stringify(msg);
      for (const sock of sockets) {
        try {
          sock.send(s);
        } catch {
          /* dropped */
        }
      }
    },
  };
}
