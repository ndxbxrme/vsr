import { createServer } from 'node:http';
import { describeEnvVarPresence, loadApiConfig, loadWorkspaceEnv } from '@vitalspace/config';
import { createDbClient } from '@vitalspace/db';
import { Server } from 'socket.io';
import { configureRealtime } from './realtime';
import { createRuntimeApp } from './runtime';

const envState = loadWorkspaceEnv(import.meta.url);
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
  console.log(
    `@vitalspace/api env ${envState.loaded ? 'loaded' : 'not loaded'} from ${envState.envPath ?? 'none'}; APP_ENCRYPTION_KEY ${describeEnvVarPresence('APP_ENCRYPTION_KEY')}`,
  );
  console.log(`@vitalspace/api listening on ${config.port}`);
});
