import crypto from 'node:crypto';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Recognizes an existing user or registers a new one based on phone number.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING so two concurrent first-time requests
 * for the same phone number never collide on the unique constraint.
 */
export async function getOrCreateUser(phone: string): Promise<{ userId: string; userName: string }> {
  const normalizedPhone = (phone || '').toString().substring(0, 50);
  const userId = `usr_${crypto.randomUUID()}`;

  const inserted = await db
    .insert(users)
    .values({ userId, phoneNumber: normalizedPhone, name: 'anonymous' })
    .onConflictDoNothing({ target: users.phoneNumber })
    .returning();

  if (inserted.length > 0) {
    return { userId, userName: 'anonymous' };
  }

  // Lost the race or the user already existed → read the winning row.
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.phoneNumber, normalizedPhone))
    .limit(1);

  if (existing.length > 0) {
    return { userId: existing[0].userId, userName: existing[0].name || 'anonymous' };
  }

  return { userId, userName: 'anonymous' };
}