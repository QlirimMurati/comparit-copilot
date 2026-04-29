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
 * For existing users: only fills in `firstName` / `lastName` (and rebuilds the
 * combined `name`) when those fields are currently null. Values already set on
 * the row are never overwritten.
 */
export async function findOrCreateReporter(
  db: Database,
  email: string,
  options: { firstName?: string | null; lastName?: string | null } = {}
): Promise<string> {
  const firstName =
    typeof options.firstName === 'string' && options.firstName.trim().length > 0
      ? options.firstName.trim()
      : null;
  const lastName =
    typeof options.lastName === 'string' && options.lastName.trim().length > 0
      ? options.lastName.trim()
      : null;

  const found = await db
    .select({
      id: users.id,
      name: users.name,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (found.length > 0) {
    const row = found[0];
    const patch: { firstName?: string; lastName?: string; name?: string } = {};
    if (firstName && !row.firstName) patch.firstName = firstName;
    if (lastName && !row.lastName) patch.lastName = lastName;

    if (patch.firstName || patch.lastName) {
      const localPart = email.split('@')[0];
      const fallback = localPart && localPart.length > 0 ? localPart : email;
      const looksLikeFallback = row.name === fallback || row.name === email;
      if (looksLikeFallback) {
        const newFirst = patch.firstName ?? row.firstName ?? null;
        const newLast = patch.lastName ?? row.lastName ?? null;
        const rebuilt = [newFirst, newLast]
          .filter((s): s is string => typeof s === 'string' && s.length > 0)
          .join(' ');
        if (rebuilt.length > 0) patch.name = rebuilt;
      }
      await db.update(users).set(patch).where(eq(users.id, row.id));
    }

    return row.id;
  }

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
