import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { loadApiConfig } from '@vitalspace/config';
import { buildEntityChangedEvent } from '@vitalspace/realtime';
import { z } from 'zod';
import { Server } from 'socket.io';

const config = loadApiConfig();
const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'api' });
});

app.get('/api/v1/bootstrap', (_req: Request, res: Response) => {
  res.json({
    appName: 'VitalSpace',
    realtimeEnabled: true,
    oauthProviders: config.oauth.providers,
  });
});

const propertySyncRequestSchema = z.object({
  tenantId: z.string().uuid(),
});

app.post('/api/v1/integrations/dezrez/sync', (req: Request, res: Response) => {
  const parsed = propertySyncRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const event = buildEntityChangedEvent({
    tenantId: parsed.data.tenantId,
    entityType: 'property',
    entityId: '00000000-0000-0000-0000-000000000000',
    mutationType: 'sync_requested',
  });

  io.to(`tenant:${parsed.data.tenantId}`).emit('entity.changed', event);

  return res.status(202).json({ accepted: true, event });
});

io.on('connection', (socket) => {
  const tenantId = socket.handshake.auth.tenantId;
  if (typeof tenantId === 'string' && tenantId.length > 0) {
    socket.join(`tenant:${tenantId}`);
  }
});

server.listen(config.port, () => {
  console.log(`@vitalspace/api listening on ${config.port}`);
});
