import crypto from 'node:crypto';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Recognizes existing user or registers a new one based on phone number.
 */
export async function getOrCreateUser(phone: string): Promise<{ userId: string; userName: string }> {
  const existing = await db.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
  
  if (existing.length > 0) {
    const userId = existing[0].userId;
    const userName = existing[0].name || 'anonymous';
    return { userId, userName };
  } else {
    const userId = `usr_${crypto.randomUUID()}`;
    await db.insert(users).values({
      userId,
      phoneNumber: phone,
      name: 'anonymous',
    });
    return { userId, userName: 'anonymous' };
  }
}
