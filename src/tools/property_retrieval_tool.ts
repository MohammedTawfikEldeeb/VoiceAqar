import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { embeddingService } from '../infrastructure/embeddings/index.js';
import { vectorDbService } from '../infrastructure/vectordb/index.js';

export const propertyRetrievalTool = tool(
  async ({ query, bedrooms, bathrooms, minPrice, maxPrice, minArea, maxArea, furnished, limit = 5, filter: incomingFilter }) => {
    
    const queryVector = await embeddingService.generateEmbedding(query, true);

    // Build structured filter for numeric and boolean criteria only
    const mustConditions: any[] = [];
    
    if (bedrooms !== undefined && bedrooms !== null && bedrooms > 0) {
      mustConditions.push({ key: 'bedrooms', match: { value: bedrooms } });
    }
    if (bathrooms !== undefined && bathrooms !== null && bathrooms > 0) {
      mustConditions.push({ key: 'bathrooms', match: { value: bathrooms } });
    }
    if (furnished === true) {
      mustConditions.push({ key: 'furnished', match: { value: true } });
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const range: any = {};
      if (minPrice !== undefined && minPrice !== null && minPrice > 0) range.gte = minPrice;
      if (maxPrice !== undefined && maxPrice !== null && maxPrice > 0) range.lte = maxPrice;
      if (Object.keys(range).length > 0) {
        mustConditions.push({ key: 'price', range });
      }
    }

    if (minArea !== undefined || maxArea !== undefined) {
      const range: any = {};
      if (minArea !== undefined && minArea !== null && minArea > 0) range.gte = minArea;
      if (maxArea !== undefined && maxArea !== null && maxArea > 0) range.lte = maxArea;
      if (Object.keys(range).length > 0) {
        mustConditions.push({ key: 'areaSqm', range });
      }
    }

    let filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;
    if (incomingFilter) {
      filter = incomingFilter;
    }

    const hits = await vectorDbService.search('properties', {
      vector: queryVector,
      limit: limit ?? 5,
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
Property ID: ${p.propertyId || 'N/A'}
Qdrant ID: ${hit.id}
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
    description: 'Search properties using a natural language query for descriptions/locations, and optional exact filters for numeric properties (bedrooms, bathrooms, price range, area range, furnished).',
    schema: z.object({
      query: z.string().describe('The search query in Arabic or English describing the desired location, property type, or compound (e.g. فيلا في مفيدا الشيخ زايد).'),
      bedrooms: z.number().optional().nullable().describe('Exact number of bedrooms desired.'),
      bathrooms: z.number().optional().nullable().describe('Exact number of bathrooms desired.'),
      minPrice: z.number().optional().nullable().describe('Minimum price in EGP.'),
      maxPrice: z.number().optional().nullable().describe('Maximum price in EGP.'),
      minArea: z.number().optional().nullable().describe('Minimum area in square meters.'),
      maxArea: z.number().optional().nullable().describe('Maximum area in square meters.'),
      furnished: z.boolean().optional().nullable().describe('Whether the property must be furnished.'),
      limit: z.number().optional().nullable().default(5).describe('Maximum number of properties to retrieve.'),
      filter: z.any().optional().nullable().describe('Structured filter object for Qdrant (advanced).'),
    }),
  }
);

export default propertyRetrievalTool;
