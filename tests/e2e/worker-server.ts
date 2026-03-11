import { createServer } from 'node:http';
import { startWorkerLoop } from '../../apps/worker/src/worker.ts';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? '250');
const port = Number(process.env.WORKER_HEALTH_PORT ?? '4322');

startWorkerLoop({
  databaseUrl,
  pollIntervalMs,
});

createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
}).listen(port, '127.0.0.1', () => {
  console.log(`e2e worker server listening on ${port}`);
});
