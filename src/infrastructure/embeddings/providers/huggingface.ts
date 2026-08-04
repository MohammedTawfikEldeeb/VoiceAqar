import { pipeline } from '@xenova/transformers';
import type { IEmbeddingService } from '../interface.js';

/**
 * Local Hugging Face embedding service using @xenova/transformers.
 * Highly suitable for running offline and cost-effectively.
 * Good at Arabic using the multilingual-e5-small model.
 */
export class HuggingFaceLocalEmbeddingService implements IEmbeddingService {
  private modelName: string;
  private extractor: any = null;
  private dimension: number;

  constructor(modelName: string = 'Xenova/multilingual-e5-small') {
    this.modelName = modelName;
    // Xenova/multilingual-e5-small outputs 384 dimensions.
    // Xenova/multilingual-e5-base outputs 768 dimensions.
    this.dimension = modelName.includes('small') ? 384 : 768;
  }

  private async getExtractor() {
    if (!this.extractor) {
      this.extractor = await pipeline('feature-extraction', this.modelName);
    }
    return this.extractor;
  }

  getDimension(): number {
    return this.dimension;
  }

  async generateEmbedding(text: string, isQuery: boolean = false): Promise<number[]> {
    const extractor = await this.getExtractor();
    
    // E5 models expect a prefix: "query: " or "passage: "
    const formattedText = this.modelName.includes('e5')
      ? `${isQuery ? 'query' : 'passage'}: ${text}`
      : text;

    const output = await extractor(formattedText, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data) as number[];
  }

  async generateEmbeddings(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const results: number[][] = [];

    // Process sequentially to avoid blocking the event loop for too long
    for (const text of texts) {
      const formattedText = this.modelName.includes('e5')
        ? `${isQuery ? 'query' : 'passage'}: ${text}`
        : text;

      const output = await extractor(formattedText, {
        pooling: 'mean',
        normalize: true,
      });

      results.push(Array.from(output.data) as number[]);
    }

    return results;
  }
}
export default HuggingFaceLocalEmbeddingService;
