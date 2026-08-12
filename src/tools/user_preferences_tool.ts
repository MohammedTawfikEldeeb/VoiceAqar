import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { graphMemory } from '../infrastructure/memory/graph/index.js';

export const saveUserPreferencesTool = tool(
  async (input) => {
    try {
      const { userId, preferredPropertyTypes, minPrice, maxPrice, currency } = input;

      if (!userId) {
        return 'Failed to save preferences: userId is required.';
      }

      let summary = `Updated preferences for user ${userId}:`;

      if (preferredPropertyTypes && preferredPropertyTypes.length > 0) {
        for (const type of preferredPropertyTypes) {
          await graphMemory.addPreference(userId, 'propertyType', type);
        }
        summary += `\n- Property Types: ${preferredPropertyTypes.join(', ')}`;
      }

      if (minPrice !== undefined || maxPrice !== undefined) {
        const min = minPrice ?? 0;
        const max = maxPrice ?? 999999999;
        const cur = currency || 'EGP';
        await graphMemory.setBudget(userId, min, max, cur);
        summary += `\n- Budget: ${min} - ${max} ${cur}`;
      }

      return summary;
    } catch (error) {
      console.error(' Error saving user preferences to Neo4j:', error);
      return `Failed to save user preferences: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'save_user_preferences',
    description: 'Save or update user search preferences (specifically preferred property types and budget range) in the Neo4j knowledge graph. Use this tool immediately when the user specifies their budget or the type of property they are interested in.',
    schema: z.object({
      userId: z.string().describe("The unique user ID (e.g. usr_...)"),
      preferredPropertyTypes: z.array(z.string()).optional().describe("Array of preferred property types in Arabic (e.g., ['فيلا', 'شقة'])"),
      minPrice: z.number().optional().describe('Minimum budget in EGP'),
      maxPrice: z.number().optional().describe('Maximum budget in EGP'),
      currency: z.string().optional().default('EGP').describe('Currency (e.g. EGP)'),
    }),
  }
);

export default saveUserPreferencesTool;
