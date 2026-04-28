import { Logger } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from './schema';

const log = new Logger('Bootstrap');

export async function bootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) {
    log.log('BOOTSTRAP_ADMIN_EMAIL not set — skipping admin bootstrap');
    return;
  }

  const url =
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@localhost:5432/copilot';
  const sql = postgres(url, { max: 1 });

  try {
    const db = drizzle(sql, { schema: { users } });
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      log.log(`Admin '${email}' already exists`);
      return;
    }

    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'admin';
    const name = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Admin';
    const passwordHash = await hash(password, 10);

    await db.insert(users).values({
      email,
      passwordHash,
      name,
      role: 'admin',
    });
    log.log(`Bootstrap admin '${email}' created`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
