import type { createDbClient } from '@vitalspace/db';
import { buildTenantRoom } from '@vitalspace/realtime';
import type { Socket, Server } from 'socket.io';
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
