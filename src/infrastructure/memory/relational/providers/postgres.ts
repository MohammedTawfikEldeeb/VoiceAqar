import { db } from '../../../../config/db.js';
import { properties } from '../../../../db/schema.js';
import type { Property } from '../../../../db/schema.js';
import type { IRelationalMemoryService, PropertyFilter } from '../interface.js';
import { eq, and, gte, lte, ilike, or } from 'drizzle-orm';

export class PostgresRelationalMemoryService implements IRelationalMemoryService {
  async queryProperties(filters: PropertyFilter, limit: number = 10): Promise<Property[]> {
    const conditions = [];

    if (filters.cityAr) conditions.push(eq(properties.cityAr, filters.cityAr));
    if (filters.districtAr) conditions.push(eq(properties.districtAr, filters.districtAr));
    if (filters.compoundName) conditions.push(eq(properties.compoundName, filters.compoundName));
    if (filters.propertyType) conditions.push(eq(properties.propertyType, filters.propertyType));
    if (filters.offeringType) conditions.push(eq(properties.offeringType, filters.offeringType));
    
    if (filters.minPrice !== undefined) conditions.push(gte(properties.price, String(filters.minPrice)));
    if (filters.maxPrice !== undefined) conditions.push(lte(properties.price, String(filters.maxPrice)));
    
    if (filters.minBedrooms !== undefined) conditions.push(gte(properties.bedrooms, filters.minBedrooms));
    if (filters.maxBedrooms !== undefined) conditions.push(lte(properties.bedrooms, filters.maxBedrooms));
    
    if (filters.minArea !== undefined) conditions.push(gte(properties.areaSqm, filters.minArea));
    if (filters.maxArea !== undefined) conditions.push(lte(properties.areaSqm, filters.maxArea));
    
    if (filters.furnished !== undefined) conditions.push(eq(properties.furnished, filters.furnished));

    return await db.select().from(properties)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(limit);
  }

  async getPropertyById(propertyId: string): Promise<Property | null> {
    const result = await db.select().from(properties)
      .where(eq(properties.propertyId, propertyId))
      .limit(1);
    return result[0] || null;
  }

  async searchProperties(searchTerm: string, limit: number = 10): Promise<Property[]> {
    return await db.select().from(properties)
      .where(
        or(
          ilike(properties.titleAr, `%${searchTerm}%`),
          ilike(properties.descriptionAr, `%${searchTerm}%`)
        )
      )
      .limit(limit);
  }

  async getDistinctValues(column: 'cityAr' | 'districtAr' | 'compoundName' | 'propertyType' | 'offeringType'): Promise<string[]> {
    const results = await db.selectDistinct({ value: properties[column] }).from(properties);
    return results
      .map(r => r.value)
      .filter((v): v is string => v !== null && v !== undefined);
  }
}

export default PostgresRelationalMemoryService;
