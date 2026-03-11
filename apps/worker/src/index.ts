import { loadWorkerConfig } from '@vitalspace/config';
import { startWorkerLoop } from './worker';

const config = loadWorkerConfig();
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';

startWorkerLoop({
  databaseUrl,
  pollIntervalMs: config.pollIntervalMs,
  queueBackend: config.queueBackend,
});

console.log(
  `@vitalspace/worker ready with concurrency ${config.concurrency}, poll interval ${config.pollIntervalMs}ms, queue backend ${config.queueBackend}`,
);
