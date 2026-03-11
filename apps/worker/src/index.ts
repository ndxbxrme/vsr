import { loadWorkerConfig } from '@vitalspace/config';
import { startWorkerLoop } from './worker';

const config = loadWorkerConfig();
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';

startWorkerLoop({
  databaseUrl,
  pollIntervalMs: config.pollIntervalMs,
});

console.log(
  `@vitalspace/worker ready with concurrency ${config.concurrency} and poll interval ${config.pollIntervalMs}ms`,
);
