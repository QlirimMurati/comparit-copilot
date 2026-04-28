import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import postgres from 'postgres';

const log = new Logger('Migrations');

export async function runMigrations(): Promise<void> {
  const url =
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@localhost:5432/copilot';
  const sql = postgres(url, { max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    const db = drizzle(sql);
    const folder = join(process.cwd(), 'apps/api/src/db/migrations');
    await migrate(db, { migrationsFolder: folder });
    log.log('Database migrations applied');
  } finally {
    await sql.end({ timeout: 5 });
  }
}
