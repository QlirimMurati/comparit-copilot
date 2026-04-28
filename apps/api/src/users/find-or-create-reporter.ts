import { eq } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { users } from '../db/schema';

/**
 * Look up a user by email; if missing, create a placeholder "widget-only"
 * user record so the bug-report FK constraint holds. Returns the user id.
 *
 * Placeholder users:
 *  - have an empty `password_hash` (cannot log in to copilot)
 *  - get role `dev` (sensible default)
 *  - get a name derived from the email local-part
 *
 * Once the user is in the table, subsequent submissions reuse the same row.
 */
export async function findOrCreateReporter(
  db: Database,
  email: string
): Promise<string> {
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (found.length > 0) return found[0].id;

  const localPart = email.split('@')[0];
  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash: '',
      name: localPart && localPart.length > 0 ? localPart : email,
      role: 'dev',
    })
    .returning({ id: users.id });
  return created.id;
}
