import type { QdrantClient } from '@qdrant/js-client-rest';
import type { IVectorDbService, VectorPoint, VectorSearchParams, SearchHit } from '../interface.js';

export interface QdrantLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

const defaultLogger: QdrantLogger = {
  info: (msg, ...meta) => console.log(msg, ...meta),
  warn: (msg, ...meta) => console.warn(msg, ...meta),
  error: (msg, ...meta) => console.error(msg, ...meta),
};

export class QdrantVectorDbService implements IVectorDbService {
  private client: QdrantClient;
  private logger: QdrantLogger;

  constructor(client: QdrantClient, logger: QdrantLogger = defaultLogger) {
    this.client = client;
    this.logger = logger;
  }

  async createCollection(
    collectionName: string,
    vectorSize: number = 1536,
    distance: 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan' = 'Cosine',
    customParams: Record<string, unknown> = {}
  ): Promise<boolean> {
    this.logger.info(`Creating Qdrant collection "${collectionName}" with vector size ${vectorSize} and distance metric ${distance}...`);
    return this.client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: distance as any,
      },
      ...customParams,
    });
  }

  async getCollection(collectionName: string): Promise<unknown> {
    return this.client.getCollection(collectionName);
  }

  async listCollections(): Promise<Array<{ name: string }>> {
    const response = await this.client.getCollections();
    return response.collections;
  }

  async deleteCollection(collectionName: string): Promise<boolean> {
    this.logger.info(`Deleting Qdrant collection "${collectionName}"...`);
    return this.client.deleteCollection(collectionName);
  }

  async upsertOne(collectionName: string, point: VectorPoint): Promise<unknown> {
    return this.client.upsert(collectionName, {
      wait: true,
      points: [{
        id: point.id,
        vector: point.vector,
        payload: point.payload,
      }],
    });
  }

  async upsertMany(
    collectionName: string,
    points: VectorPoint[],
    batchSize: number = 100
  ): Promise<unknown[]> {
    if (batchSize <= 0) {
      throw new Error('Batch size must be greater than 0');
    }

    if (points.length === 0) {
      return [];
    }

    this.logger.info(`Inserting ${points.length} points into Qdrant collection "${collectionName}" in batches of ${batchSize}...`);
    const results: unknown[] = [];

    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize).map(p => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      }));
      
      this.logger.info(`Uploading batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(points.length / batchSize)} (${batch.length} points)...`);
      const result = await this.client.upsert(collectionName, {
        wait: true,
        points: batch,
      });
      results.push(result);
    }

    return results;
  }

  async updatePoint(collectionName: string, point: VectorPoint): Promise<unknown> {
    return this.upsertOne(collectionName, point);
  }

  async updatePayload(
    collectionName: string,
    pointId: string | number,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    return this.client.setPayload(collectionName, {
      wait: true,
      payload,
      points: [pointId],
    });
  }

  async search(collectionName: string, params: VectorSearchParams): Promise<SearchHit[]> {
    const { vector, limit = 10, filter, withPayload = true, withVector = false } = params;
    const response = await this.client.search(collectionName, {
      vector,
      limit,
      filter,
      with_payload: withPayload,
      with_vector: withVector,
    });

    return response.map(hit => {
      let finalVector: number[] | undefined;
      if (Array.isArray(hit.vector)) {
        if (hit.vector.length > 0 && Array.isArray(hit.vector[0])) {
          finalVector = (hit.vector as number[][])[0];
        } else {
          finalVector = hit.vector as number[];
        }
      }
      return {
        id: hit.id,
        score: hit.score,
        payload: hit.payload as Record<string, unknown> | undefined,
        vector: finalVector,
      };
    });
  }
}
export default QdrantVectorDbService;
