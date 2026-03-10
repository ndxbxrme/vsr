import type { createDbClient } from '@vitalspace/db';
import type { Server } from 'socket.io';
import { createApp } from './app';

type DbClient = ReturnType<typeof createDbClient>['db'];

export function createRuntimeApp(args: {
  db: DbClient;
  io: Server;
  oauthProviders?: string[];
}) {
  return createApp({
    db: args.db,
    oauthProviders: args.oauthProviders ?? [],
    publishEntityChangedEvent: (event) => {
      args.io.to(`tenant:${event.tenantId}`).emit('entity.changed', event);
    },
  });
}
