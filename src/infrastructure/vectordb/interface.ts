export interface VectorPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}

export interface VectorSearchParams {
  vector: number[];
  limit?: number;
  filter?: any; // Generic filter object (can be provider-specific)
  withPayload?: boolean;
  withVector?: boolean;
}

export interface SearchHit {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
  vector?: number[];
}

export interface IVectorDbService {
  /**
   * Create a new collection/index in the vector database.
   * @param collectionName Name of the collection/index.
   * @param vectorSize Dimension of the vector embeddings (default: 1536).
   * @param distance Distance metric to use (default: 'Cosine').
   * @param customParams Database-specific configuration parameters.
   */
  createCollection(
    collectionName: string,
    vectorSize?: number,
    distance?: 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan',
    customParams?: Record<string, unknown>
  ): Promise<boolean>;

  /**
   * Get metadata info of a specific collection/index.
   */
  getCollection(collectionName: string): Promise<unknown>;

  /**
   * List all collections/indices in the vector database.
   */
  listCollections(): Promise<Array<{ name: string }>>;

  /**
   * Delete/drop a specific collection/index.
   */
  deleteCollection(collectionName: string): Promise<boolean>;

  /**
   * Upsert a single point (vector + payload) into a collection.
   */
  upsertOne(collectionName: string, point: VectorPoint): Promise<unknown>;

  /**
   * Upsert multiple points (vectors + payloads) into a collection in batches.
   */
  upsertMany(
    collectionName: string,
    points: VectorPoint[],
    batchSize?: number
  ): Promise<unknown[]>;

  /**
   * Update (upsert) a single point's vector and/or payload.
   */
  updatePoint(collectionName: string, point: VectorPoint): Promise<unknown>;

  /**
   * Update (merge) the payload of a specific point without modifying its vector.
   */
  updatePayload(
    collectionName: string,
    pointId: string | number,
    payload: Record<string, unknown>
  ): Promise<unknown>;

  /**
   * Search for closest vectors in a collection.
   */
  search(collectionName: string, params: VectorSearchParams): Promise<SearchHit[]>;
}
