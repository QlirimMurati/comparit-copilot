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
 *  - get a name from `firstName` + `lastName` if provided, else the email
 *    local-part as a fallback
 *
 * Existing users are returned as-is — their `name` is not clobbered even if
 * `firstName`/`lastName` are passed.
 */
export async function findOrCreateReporter(
  db: Database,
  email: string,
  options: { firstName?: string | null; lastName?: string | null } = {}
): Promise<string> {
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (found.length > 0) return found[0].id;

  const firstName =
    typeof options.firstName === 'string' && options.firstName.trim().length > 0
      ? options.firstName.trim()
      : null;
  const lastName =
    typeof options.lastName === 'string' && options.lastName.trim().length > 0
      ? options.lastName.trim()
      : null;
  const fullName = [firstName, lastName].filter((s): s is string => !!s).join(' ');
  const localPart = email.split('@')[0];
  const fallback = localPart && localPart.length > 0 ? localPart : email;

  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash: '',
      name: fullName.length > 0 ? fullName : fallback,
      firstName,
      lastName,
      role: 'dev',
    })
    .returning({ id: users.id });
  return created.id;
}
