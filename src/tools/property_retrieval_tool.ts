import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { embeddingService } from '../infrastructure/embeddings/index.js';
import { vectorDbService } from '../infrastructure/vectordb/index.js';

export const propertyRetrievalTool = tool(
  async ({ query, filter, limit = 5 }) => {

    const queryVector = await embeddingService.generateEmbedding(query, true);

    const hits = await vectorDbService.search('properties', {
      vector: queryVector,
      limit,
      filter,
      withPayload: true,
    });

    if (hits.length === 0) {
      return 'No properties found matching your query.';
    }

    return hits
      .map((hit, index) => {
        const p = hit.payload || {};
        return `[Property ${index + 1}] (Score: ${(hit.score * 100).toFixed(1)}%)
ID: ${hit.id}
Title: ${p.titleAr || p.title || 'N/A'}
Description: ${p.descriptionAr || p.description || 'N/A'}
City: ${p.cityAr || p.city || 'N/A'}
District: ${p.districtAr || p.district || 'N/A'}
Compound: ${p.compoundName || 'N/A'}
Type: ${p.propertyType || 'N/A'}
Offering: ${p.offeringType || 'N/A'}
Price: ${p.price || 'N/A'} EGP
Bedrooms: ${p.bedrooms || 'N/A'}
Bathrooms: ${p.bathrooms || 'N/A'}
Area: ${p.areaSqm || 'N/A'} sqm
Furnished: ${p.furnished ? 'Yes' : 'No'}
`;
      })
      .join('\n---\n\n');
  },
  {
    name: 'property_retrieval',
    description: 'Useful for searching/retrieving real estate properties matching a natural language description (e.g., location, type, size, price range). Input query should be in Arabic or English.',
    schema: z.object({
      query: z.string().describe('The search query in Arabic or English describing desired properties.'),
      filter: z.any().optional().describe(
        'Optional structured filter object. Example for filtering by city: { "must": [{ "key": "cityAr", "match": { "value": "الشيخ زايد" } }] }'
      ),
      limit: z.number().optional().default(5).describe('Maximum number of properties to retrieve (default: 5).'),
    }),
  }
);

export default propertyRetrievalTool;
