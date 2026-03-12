import { describeEnvVarPresence, loadWorkerConfig, loadWorkspaceEnv } from '@vitalspace/config';
import { startWorkerLoop } from './worker';

const envState = loadWorkspaceEnv(import.meta.url);
const config = loadWorkerConfig();
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';

startWorkerLoop({
  databaseUrl,
  pollIntervalMs: config.pollIntervalMs,
  queueBackend: config.queueBackend,
});

console.log(
  `@vitalspace/worker env ${envState.loaded ? 'loaded' : 'not loaded'} from ${envState.envPath ?? 'none'}; APP_ENCRYPTION_KEY ${describeEnvVarPresence('APP_ENCRYPTION_KEY')}`,
);
console.log(
  `@vitalspace/worker ready with concurrency ${config.concurrency}, poll interval ${config.pollIntervalMs}ms, queue backend ${config.queueBackend}`,
);
