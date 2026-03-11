import { z } from 'zod';

const apiConfigSchema = z.object({
  port: z.coerce.number().default(4220),
  oauth: z.object({
    providers: z.array(z.enum(['google'])).default([]),
  }),
});

const webConfigSchema = z.object({
  apiBaseUrl: z.string().default('http://localhost:4220/api/v1'),
  apiOrigin: z.string().default('http://localhost:4220'),
});

const workerConfigSchema = z.object({
  concurrency: z.coerce.number().default(5),
  pollIntervalMs: z.coerce.number().default(1000),
});

export function loadApiConfig() {
  return apiConfigSchema.parse({
    port: process.env.API_PORT,
    oauth: {
      providers: process.env.GOOGLE_CLIENT_ID ? ['google'] : [],
    },
  });
}

export function loadWebConfig(env: {
  VITE_API_BASE_URL?: string;
  VITE_API_ORIGIN?: string;
}) {
  return webConfigSchema.parse({
    apiBaseUrl: env.VITE_API_BASE_URL,
    apiOrigin: env.VITE_API_ORIGIN,
  });
}

export function loadWorkerConfig() {
  return workerConfigSchema.parse({
    concurrency: process.env.WORKER_CONCURRENCY,
    pollIntervalMs: process.env.WORKER_POLL_INTERVAL_MS,
  });
}
