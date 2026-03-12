import type { EntityChangedEvent } from '@vitalspace/contracts';
import type { createDbClient } from '@vitalspace/db';
import { schema } from '@vitalspace/db';
import { buildTenantRoom } from '@vitalspace/realtime';
import type { Socket, Server } from 'socket.io';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { loadAuthContext } from './auth-context';

type DbClient = ReturnType<typeof createDbClient>['db'];

type SocketData = {
  auth?: Awaited<ReturnType<typeof loadAuthContext>>;
};

function extractSocketToken(socket: Socket) {
  const authToken = socket.handshake.auth.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }

  const authorization = socket.handshake.auth.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }

  return null;
}

export function configureRealtime(io: Server, db: DbClient) {
  io.use(async (socket, next) => {
    const token = extractSocketToken(socket);
    if (!token) {
      return next(new Error('unauthorized'));
    }

    const auth = await loadAuthContext(db, token);
    if (!auth) {
      return next(new Error('unauthorized'));
    }

    (socket.data as SocketData).auth = auth;
    return next();
  });

  io.on('connection', (socket) => {
    const auth = (socket.data as SocketData).auth;
    if (!auth) {
      socket.disconnect(true);
      return;
    }

    const joinedTenants = new Set<string>();
    for (const membership of auth.memberships) {
      if (joinedTenants.has(membership.tenantId)) {
        continue;
      }

      socket.join(buildTenantRoom(membership.tenantId));
      joinedTenants.add(membership.tenantId);
    }
  });
}

export async function publishPendingOutboxEvents(args: {
  db: DbClient;
  io: Server;
  limit?: number;
}) {
  const pendingEvents = await args.db
    .select()
    .from(schema.outboxEvents)
    .where(
      and(
        isNull(schema.outboxEvents.publishedAt),
        eq(schema.outboxEvents.status, 'pending'),
      ),
    )
    .orderBy(asc(schema.outboxEvents.createdAt))
    .limit(args.limit ?? 50);

  let publishedCount = 0;

  for (const outboxEvent of pendingEvents) {
    if (!outboxEvent.tenantId) {
      continue;
    }

    const event: EntityChangedEvent = {
      tenantId: outboxEvent.tenantId,
      entityType: outboxEvent.entityType,
      entityId: outboxEvent.entityId,
      mutationType: outboxEvent.mutationType,
      payload:
        outboxEvent.payloadJson && typeof outboxEvent.payloadJson === 'object'
          ? (outboxEvent.payloadJson as Record<string, unknown>)
          : undefined,
      occurredAt: outboxEvent.createdAt.toISOString(),
    };

    args.io.to(buildTenantRoom(outboxEvent.tenantId)).emit('entity.changed', event);

    await args.db
      .update(schema.outboxEvents)
      .set({
        status: 'published',
        publishedAt: new Date(),
      })
      .where(eq(schema.outboxEvents.id, outboxEvent.id));

    publishedCount += 1;
  }

  return { publishedCount };
}
