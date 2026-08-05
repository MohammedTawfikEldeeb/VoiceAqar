import type { Property } from '../../../db/schema.js';

export interface PropertyFilter {
  cityAr?: string;
  districtAr?: string;
  compoundName?: string;
  propertyType?: string;
  offeringType?: string;
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  maxBedrooms?: number;
  minArea?: number;
  maxArea?: number;
  furnished?: boolean;
}

export interface IRelationalMemoryService {
  queryProperties(filters: PropertyFilter, limit?: number): Promise<Property[]>;
  getPropertyById(propertyId: string): Promise<Property | null>;
  searchProperties(searchTerm: string, limit?: number): Promise<Property[]>;
  getDistinctValues(column: 'cityAr' | 'districtAr' | 'compoundName' | 'propertyType' | 'offeringType'): Promise<string[]>;
}

export default IRelationalMemoryService;
