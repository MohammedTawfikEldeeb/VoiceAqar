import { pipeline } from '@xenova/transformers';
import type { IEmbeddingService } from '../interface.js';


export class HuggingFaceLocalEmbeddingService implements IEmbeddingService {
  private modelName: string;
  private extractor: any = null;
  private dimension: number;

  constructor(modelName: string = 'Xenova/multilingual-e5-small') {
    this.modelName = modelName;
  
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

  async warmup(): Promise<void> {
    await this.getExtractor();
  }

  async generateEmbedding(text: string, isQuery: boolean = false): Promise<number[]> {
    const extractor = await this.getExtractor();
    
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
