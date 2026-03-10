import { loadWorkerConfig } from '@vitalspace/config';

const config = loadWorkerConfig();

console.log(`@vitalspace/worker ready with concurrency ${config.concurrency}`);
