import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { AppModule } from '../../src/app.module';
import { createDatabase, Db } from '../../src/database/connection';
import { DATABASE } from '../../src/database/database.module';

export interface TestContext {
  app: INestApplication;
  db: Db;
  close: () => Promise<void>;
}

export async function buildTestApp(): Promise<TestContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'wizdaa-e2e-'));
  const dbPath = join(tmpDir, 'test.db');
  process.env.DB_PATH = dbPath;

  // Apply migrations on a fresh DB so each test starts clean.
  if (existsSync('./drizzle')) {
    const { db, client } = createDatabase({ path: dbPath });
    migrate(db, { migrationsFolder: './drizzle' });
    client.close();
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const db = moduleRef.get<Db>(DATABASE);

  return {
    app,
    db,
    close: async () => {
      await app.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
