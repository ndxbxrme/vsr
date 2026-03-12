import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenvConfig } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

let currentDir = dirname(fileURLToPath(import.meta.url));
for (;;) {
  const candidate = join(currentDir, '.env');
  if (existsSync(candidate)) {
    loadDotenvConfig({
      path: candidate,
      override: false,
      quiet: true,
    });
    break;
  }

  const parentDir = dirname(currentDir);
  if (parentDir === currentDir) {
    break;
  }
  currentDir = parentDir;
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace',
  },
});
