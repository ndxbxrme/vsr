import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDbClient(connectionString: string) {
  const client = postgres(connectionString, {
    max: 1,
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function migrateDb(connectionString: string) {
  const { db, client } = createDbClient(connectionString);
  await migrate(db, {
    migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
  });
  await client.end();
}

export { schema };
