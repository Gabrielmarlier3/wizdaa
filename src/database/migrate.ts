import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase } from './connection';

function main(): void {
  const path = process.env.DB_PATH ?? './wizdaa.db';
  const migrationsFolder = './drizzle';

  if (!existsSync(migrationsFolder)) {
    // eslint-disable-next-line no-console
    console.log(
      `No migrations folder at ${migrationsFolder} — nothing to apply.`,
    );
    return;
  }

  const { db, client } = createDatabase({ path });
  migrate(db, { migrationsFolder });
  client.close();
  // eslint-disable-next-line no-console
  console.log(`Migrations applied to ${path}`);
}

main();
