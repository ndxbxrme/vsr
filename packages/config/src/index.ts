import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenvConfig } from 'dotenv';
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
  queueBackend: z.enum(['database', 'sqs']).default('database'),
});

function findWorkspaceEnvPath(moduleUrl: string) {
  let currentDir = dirname(fileURLToPath(moduleUrl));

  for (;;) {
    const candidate = join(currentDir, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

export function loadWorkspaceEnv(moduleUrl: string) {
  const envPath = findWorkspaceEnvPath(moduleUrl);
  if (!envPath) {
    return {
      envPath: null,
      loaded: false,
    };
  }

  const result = loadDotenvConfig({
    path: envPath,
    override: false,
    quiet: true,
  });

  return {
    envPath,
    loaded: !result.error,
  };
}

export function describeEnvVarPresence(name: string) {
  const value = process.env[name];
  if (!value) {
    return 'missing';
  }

  return `present (${value.length} chars)`;
}

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
    queueBackend: process.env.QUEUE_BACKEND,
  });
}
