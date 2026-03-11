import type { createDbClient } from '@vitalspace/db';
import type { Server } from 'socket.io';
import { createApp } from './app';
import { publishPendingOutboxEvents } from './realtime';

type DbClient = ReturnType<typeof createDbClient>['db'];

export function createRuntimeApp(args: {
  db: DbClient;
  io: Server;
  oauthProviders?: string[];
}) {
  const app = createApp({
    db: args.db,
    oauthProviders: args.oauthProviders ?? [],
    publishEntityChangedEvent: (event) => {
      args.io.to(`tenant:${event.tenantId}`).emit('entity.changed', event);
    },
  });

  const interval = setInterval(() => {
    void publishPendingOutboxEvents({
      db: args.db,
      io: args.io,
    });
  }, 1000);
  interval.unref();

  return app;
}
