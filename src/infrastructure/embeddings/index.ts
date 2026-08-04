import { env } from '../../config/env.js';
import type { IEmbeddingService } from './interface.js';
import { HuggingFaceLocalEmbeddingService } from './providers/huggingface.js';
import { GeminiEmbeddingService } from './providers/gemini.js';

export class EmbeddingServiceFactory {
  /**
   * Create an instance of the embedding service based on provider type.
   * @param provider The provider string ('local' or 'gemini').
   */
  static create(provider: 'local' | 'gemini'): IEmbeddingService {
    switch (provider) {
      case 'local':
        return new HuggingFaceLocalEmbeddingService();
      case 'gemini':
        return new GeminiEmbeddingService();
      default:
        throw new Error(`Unsupported embedding provider: ${provider}`);
    }
  }
}

// Export the default active embedding service based on env setting
export const embeddingService = EmbeddingServiceFactory.create(env.EMBEDDING_PROVIDER);
export default embeddingService;
