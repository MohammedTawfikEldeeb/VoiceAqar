import { db } from '../config/db.js';
import { properties } from '../db/schema.js';
import { embeddingService } from '../infrastructure/embeddings/index.js';
import { vectorDbService } from '../infrastructure/vectordb/index.js';

const COLLECTION_NAME = 'properties';

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const WESTERN = '0123456789';

function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩]/g, d => WESTERN[ARABIC_INDIC.indexOf(d)]);
}

interface MetadataCriteria {
  district?: string[];
  compound?: string[];
  bedrooms?: number;
  bathrooms?: number;
  minPrice?: number;
  maxPrice?: number;
}

function parseMetadataCriteria(
  rawQuery: string,
  districts: string[],
  compounds: string[]
): MetadataCriteria {
  const query = toWesternDigits(rawQuery);
  const criteria: MetadataCriteria = {};

  const exactDistricts = districts.filter(d => query.includes(d));
  if (exactDistricts.length > 0) {
    criteria.district = exactDistricts;
  } else {
    const tokens = query.split(/\s+/).filter(t => t.length >= 2);
    const prefixedDistricts = districts.filter(d => tokens.some(t => d.startsWith(t)));
    if (prefixedDistricts.length > 0) {
      criteria.district = prefixedDistricts;
    }
  }

  const exactCompounds = compounds.filter(c => query.includes(c));
  if (exactCompounds.length > 0) {
    criteria.compound = exactCompounds;
  } else {
    const tokens = query.split(/\s+/).filter(t => t.length >= 2);
    const prefixedCompounds = compounds.filter(c => tokens.some(t => c.startsWith(t)));
    if (prefixedCompounds.length > 0) {
      criteria.compound = prefixedCompounds;
    }
  }

  const bedroomsMatch = query.match(/(\d+)\s*غرف/);
  if (bedroomsMatch) {
    criteria.bedrooms = parseInt(bedroomsMatch[1], 10);
  }

  const bathroomsMatch = query.match(/(\d+)\s*حمام/);
  if (bathroomsMatch) {
    criteria.bathrooms = parseInt(bathroomsMatch[1], 10);
  }

  const priceMatch = query.match(/(\d+(?:\.\d+)?)\s*(مليون|ألف)/);
  if (priceMatch) {
    const amount = parseFloat(priceMatch[1]) * (priceMatch[2] === 'مليون' ? 1e6 : 1e3);
    if (/(أقل|تحت|حتى|بحد أقصى)/.test(query)) {
      criteria.maxPrice = amount;
    } else if (/(أكثر|فوق|أعلى|بحد أدنى|بداية من)/.test(query)) {
      criteria.minPrice = amount;
    } else {
      criteria.maxPrice = amount;
    }
  }

  return criteria;
}

function buildFilter(criteria: MetadataCriteria): any | undefined {
  const must: any[] = [];

  if (criteria.district?.length) {
    must.push({ key: 'district', match: { any: criteria.district } });
  }
  if (criteria.compound?.length) {
    must.push({ key: 'compound', match: { any: criteria.compound } });
  }
  if (criteria.bedrooms !== undefined) {
    must.push({ key: 'bedrooms', range: { gte: criteria.bedrooms } });
  }
  if (criteria.bathrooms !== undefined) {
    must.push({ key: 'bathrooms', range: { gte: criteria.bathrooms } });
  }
  if (criteria.minPrice !== undefined) {
    must.push({ key: 'price', range: { gte: criteria.minPrice } });
  }
  if (criteria.maxPrice !== undefined) {
    must.push({ key: 'price', range: { lte: criteria.maxPrice } });
  }

  return must.length > 0 ? { must } : undefined;
}

function formatCriteria(criteria: MetadataCriteria): string {
  const parts: string[] = [];
  if (criteria.district?.length) parts.push(`district=${criteria.district.join('|')}`);
  if (criteria.compound?.length) parts.push(`compound=${criteria.compound.join('|')}`);
  if (criteria.bedrooms !== undefined) parts.push(`bedrooms>=${criteria.bedrooms}`);
  if (criteria.bathrooms !== undefined) parts.push(`bathrooms>=${criteria.bathrooms}`);
  if (criteria.minPrice !== undefined) parts.push(`price>=${criteria.minPrice}`);
  if (criteria.maxPrice !== undefined) parts.push(`price<=${criteria.maxPrice}`);
  return parts.length > 0 ? parts.join(', ') : '(none)';
}

async function search(): Promise<void> {
  const districtRows = await db
    .selectDistinct({ value: properties.districtAr })
    .from(properties);
  const compoundRows = await db
    .selectDistinct({ value: properties.compoundName })
    .from(properties);

  const districts = districtRows.map(r => r.value);
  const compounds = compoundRows.map(r => r.value).filter((v): v is string => v !== null);

  const query = 'فيلا في التجمع ب 3 حمامات';
  const criteria = parseMetadataCriteria(query, districts, compounds);
  const filter = buildFilter(criteria);

  const queryVector = await embeddingService.generateEmbedding(query, true);

  const hits = await vectorDbService.search(COLLECTION_NAME, {
    vector: queryVector,
    limit: 10,
    filter,
    withPayload: true,
  });

  console.log(`Query: "${query}"`);
  console.log(`Metadata filter: ${formatCriteria(criteria)}\n`);

  hits.forEach((hit, index) => {
    const p = (hit.payload ?? {}) as Record<string, any>;
    console.log(`[${index + 1}] score=${hit.score.toFixed(4)} id=${hit.id}`);
    console.log(`    title: ${p.titleAr}`);
    console.log(`    district: ${p.district} | compound: ${p.compound}`);
    console.log(`    type: ${p.propertyType} | beds: ${p.bedrooms} | baths: ${p.bathrooms} | area: ${p.area_sqm} m²`);
    console.log(`    price: ${Number(p.price).toLocaleString()} EGP | priority: ${p.priority}`);
    console.log(`    description: ${p.descriptionAr?.slice(0, 160)}...\n`);
  });
}

search()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Search failed:', error);
    process.exit(1);
  });
