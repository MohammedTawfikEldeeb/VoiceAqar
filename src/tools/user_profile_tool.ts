import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { graphMemory } from '../infrastructure/memory/graph/index.js';
import { eq } from 'drizzle-orm';

export const saveUserProfileTool = tool(
  async (input) => {
    try {
      const { name, phoneNumber, userId } = input;
      
      if (!userId && !phoneNumber) {
        return "Failed to save profile: Either userId or phoneNumber must be provided.";
      }

      let activeUserId = userId;

      // 1. Check if user already exists by phone number
      if (phoneNumber) {
        const existing = await db.select().from(users).where(eq(users.phoneNumber, phoneNumber)).limit(1);
        if (existing.length > 0) {
          activeUserId = existing[0].userId;
        }
      }

      // 2. Generate a new userId if none exists
      if (!activeUserId) {
        activeUserId = `usr_${Date.now()}`;
      }

      // 3. Upsert in PostgreSQL (Relational Memory)
      const existingUser = await db.select().from(users).where(eq(users.userId, activeUserId)).limit(1);
      if (existingUser.length > 0) {
        await db.update(users).set({ 
          name, 
          phoneNumber: phoneNumber || existingUser[0].phoneNumber 
        }).where(eq(users.userId, activeUserId));
      } else {
        await db.insert(users).values({
          userId: activeUserId,
          name,
          phoneNumber: phoneNumber || 'unknown',
        });
      }

      // 4. Upsert in Neo4j Graph Memory to keep knowledge graph in sync
      await graphMemory.upsertUser(activeUserId, { name });

      return `Successfully saved user profile for "${name}" (ID: ${activeUserId}, Phone: ${phoneNumber || 'N/A'}).`;
    } catch (error) {
      console.error("Error saving user profile:", error);
      return `Failed to save user profile: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'save_user_profile',
    description: 'Save or update the user profile details (such as their name and phone number) in the PostgreSQL database and Neo4j. Use this tool immediately when a new user introduces themselves or states their name.',
    schema: z.object({
      name: z.string().describe("The user's name in Arabic"),
      phoneNumber: z.string().optional().describe("The user's phone number if provided or known from the call connection"),
      userId: z.string().optional().describe("The unique user ID if currently known"),
    }),
  }
);

export default saveUserProfileTool;
