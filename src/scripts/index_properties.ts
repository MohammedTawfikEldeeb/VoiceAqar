import { createHash } from 'node:crypto';
import { db } from '../config/db.js';
import { properties } from '../db/schema.js';
import { embeddingService } from '../infrastructure/embeddings/index.js';
import { vectorDbService } from '../infrastructure/vectordb/index.js';
import { qdrant } from '../config/qdrant.js';

function stableUuid(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

const COLLECTION_NAME = 'properties';
const EMBED_BATCH_SIZE = 25;
const UPSERT_BATCH_SIZE = 100;

const INDEXABLE_FIELDS: Array<{ fieldName: string; fieldSchema: string }> = [
  { fieldName: 'district', fieldSchema: 'keyword' },
  { fieldName: 'compound', fieldSchema: 'keyword' },
  { fieldName: 'priority', fieldSchema: 'integer' },
  { fieldName: 'price', fieldSchema: 'float' },
  { fieldName: 'bedrooms', fieldSchema: 'integer' },
  { fieldName: 'bathrooms', fieldSchema: 'integer' },
  { fieldName: 'area_sqm', fieldSchema: 'integer' },
];

async function ensureCollection(): Promise<void> {
  const collections = await vectorDbService.listCollections();
  if (!collections.some(c => c.name === COLLECTION_NAME)) {
    await vectorDbService.createCollection(COLLECTION_NAME, embeddingService.getDimension(), 'Cosine');
    console.log(`Collection "${COLLECTION_NAME}" created with dimension ${embeddingService.getDimension()}.`);
  }
}

async function ensurePayloadIndexes(): Promise<void> {
  const collectionInfo = (await qdrant.getCollection(COLLECTION_NAME)) as any;
  const existing = new Set(Object.keys(collectionInfo?.payload_schema ?? {}));
  for (const idx of INDEXABLE_FIELDS) {
    if (existing.has(idx.fieldName)) continue;
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: idx.fieldName,
      field_schema: idx.fieldSchema as any,
    });
    console.log(`Payload index created on "${idx.fieldName}" (${idx.fieldSchema}).`);
  }
}

function buildPayload(property: typeof properties.$inferSelect): Record<string, unknown> {
  return {
    propertyId: property.propertyId,
    titleAr: property.titleAr,
    descriptionAr: property.descriptionAr,
    city: property.cityAr,
    district: property.districtAr,
    compound: property.compoundName ?? '',
    priority: property.furnished ? 1 : 0,
    price: parseFloat(property.price),
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    area_sqm: property.areaSqm,
    propertyType: property.propertyType,
    offeringType: property.offeringType,
    furnished: property.furnished,
  };
}

async function indexProperties(): Promise<void> {
  const allProperties = await db.select().from(properties);
  console.log(`Loaded ${allProperties.length} properties from PostgreSQL.`);

  await ensureCollection();
  await ensurePayloadIndexes();

  for (let i = 0; i < allProperties.length; i += EMBED_BATCH_SIZE) {
    const batch = allProperties.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(p => `${p.titleAr}\n${p.descriptionAr}`);

    const vectors = await embeddingService.generateEmbeddings(texts, false);

    const points = batch.map((p, j) => ({
      id: stableUuid(p.propertyId),
      vector: vectors[j],
      payload: buildPayload(p),
    }));

    await vectorDbService.upsertMany(COLLECTION_NAME, points, UPSERT_BATCH_SIZE);
    console.log(`Indexed ${Math.min(i + EMBED_BATCH_SIZE, allProperties.length)}/${allProperties.length} points.`);
  }

  console.log(`Successfully indexed ${allProperties.length} properties into Qdrant collection "${COLLECTION_NAME}".`);
}

indexProperties()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to index properties:', error);
    process.exit(1);
  });
