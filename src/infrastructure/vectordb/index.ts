import { env } from '../../config/env.js';
import { qdrant } from '../../config/qdrant.js';
import type { IVectorDbService } from './interface.js';
import { QdrantVectorDbService } from './providers/qdrant.js';

export class VectorDbServiceFactory {
  /**
   * Create an instance of the vector database service based on provider type.
   * @param provider The provider string ('qdrant').
   */
  static create(provider: 'qdrant'): IVectorDbService {
    switch (provider) {
      case 'qdrant':
        return new QdrantVectorDbService(qdrant);
      default:
        throw new Error(`Unsupported Vector DB provider: ${provider}`);
    }
  }
}

// Export the default active vector database service based on env setting
export const vectorDbService = VectorDbServiceFactory.create(env.VECTOR_DB_PROVIDER as 'qdrant');
export default vectorDbService;
