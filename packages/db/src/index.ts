import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

function parseDatabaseName(connectionString: string) {
  const databaseName = new URL(connectionString).pathname.replace(/^\//, '');
  if (!databaseName) {
    throw new Error('database_name_missing');
  }

  return {
    databaseName,
  };
}

export async function ensureDatabaseExists(connectionString: string) {
  const { databaseName } = parseDatabaseName(connectionString);
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const adminClient = postgres(adminUrl.toString(), {
    max: 1,
  });

  try {
    const existing = await adminClient<{ exists: number }[]>`
      select 1 as exists from pg_database where datname = ${databaseName}
    `;

    if (existing.length > 0) {
      return;
    }

    const escapedDatabaseName = databaseName.replace(/"/g, '""');
    await adminClient.unsafe(`create database "${escapedDatabaseName}"`);
  } finally {
    await adminClient.end();
  }
}

export function createDbClient(connectionString: string) {
  const client = postgres(connectionString, {
    max: 1,
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function migrateDb(connectionString: string) {
  await ensureDatabaseExists(connectionString);
  const { db, client } = createDbClient(connectionString);
  await migrate(db, {
    migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
  });
  await client.end();
}

export { schema };
