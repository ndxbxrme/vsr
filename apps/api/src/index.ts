import { createServer } from 'node:http';
import { loadApiConfig } from '@vitalspace/config';
import { createDbClient } from '@vitalspace/db';
import { Server } from 'socket.io';
import { configureRealtime } from './realtime';
import { createRuntimeApp } from './runtime';

const config = loadApiConfig();
const { db } = createDbClient(
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace',
);
const server = createServer();

const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const app = createRuntimeApp({
  db,
  io,
  oauthProviders: config.oauth.providers,
});
server.removeAllListeners('request');
server.on('request', app);
configureRealtime(io, db);

server.listen(config.port, () => {
  console.log(`@vitalspace/api listening on ${config.port}`);
});
