import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { relationalMemory } from '../infrastructure/memory/relational/index.js';

const sqlQuerySchema = z.object({
  cityAr: z.string().optional().describe("City name in Arabic"),
  districtAr: z.string().optional().describe("District name in Arabic"),
  compoundName: z.string().optional().describe("Compound/project name"),
  propertyType: z.string().optional().describe("e.g. شقة، فيلا، دوبلكس"),
  offeringType: z.string().optional().describe("للبيع or للإيجار"),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  minBedrooms: z.number().optional(),
  maxBedrooms: z.number().optional(),
  minArea: z.number().optional(),
  maxArea: z.number().optional(),
  furnished: z.boolean().optional(),
  limit: z.number().optional().default(5)
});

export const sqlQueryTool = tool(
  async (input) => {
    try {
      const { limit, ...filters } = input;
      const properties = await relationalMemory.queryProperties(filters, limit);
      
      if (properties.length === 0) {
        return "No properties found matching the specified criteria.";
      }

      const formattedResults = properties.map((p, index) => {
        return `[${index + 1}] Property ID: ${p.propertyId}
Title: ${p.titleAr || 'N/A'}
Type: ${p.propertyType || 'N/A'} - ${p.offeringType || 'N/A'}
Location: ${p.cityAr || 'N/A'}, ${p.districtAr || 'N/A'}${p.compoundName ? ` (${p.compoundName})` : ''}
Price: ${p.price || 'N/A'}
Area: ${p.areaSqm || 'N/A'} sqm
Bedrooms: ${p.bedrooms || 'N/A'}
Bathrooms: ${p.bathrooms || 'N/A'}
Furnished: ${p.furnished ? 'Yes' : 'No'}
Description: ${p.descriptionAr ? p.descriptionAr.substring(0, 200) + '...' : 'N/A'}
---`;
      }).join('\n');

      return `Found ${properties.length} exact matches:\n\n${formattedResults}`;
    } catch (error) {
      console.error("Error executing sql_property_query tool:", error);
      return `Failed to query properties: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'sql_property_query',
    description: 'Query the structured property database with exact filters. Use this for precise lookups by city, district, price range, bedrooms, area, property type, or offering type. Returns exact database records.',
    schema: sqlQuerySchema,
  }
);

export default sqlQueryTool;
