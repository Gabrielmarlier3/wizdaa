import BetterSqlite3, { Database as BetterSqlite3Db } from 'better-sqlite3';
import {
  drizzle,
  BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface CreateDatabaseOptions {
  path: string;
}

export interface DatabasePair {
  db: Db;
  client: BetterSqlite3Db;
}

export function createDatabase(options: CreateDatabaseOptions): DatabasePair {
  const client = new BetterSqlite3(options.path);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  return { db, client };
}
