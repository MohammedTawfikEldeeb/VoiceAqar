import { GoogleGenAI } from '@google/genai';
import { env } from '../../../config/env.js';
import type { IEmbeddingService } from '../interface.js';


export class GeminiEmbeddingService implements IEmbeddingService {
  private ai: GoogleGenAI;
  private modelName: string;
  private dimension: number;

  constructor(apiKey: string = env.GEMINI_API_KEY, modelName: string = 'text-embedding-004') {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
    this.dimension = 768;
  }

  getDimension(): number {
    return this.dimension;
  }

  async generateEmbedding(text: string, isQuery: boolean = false): Promise<number[]> {
    const response = await this.ai.models.embedContent({
      model: this.modelName,
      contents: text,
    });
    
    const embedding = response.embeddings?.[0] || (response as any).embedding;
    if (!embedding?.values) {
      throw new Error('Failed to generate embedding from Gemini API');
    }
    
    return embedding.values;
  }

  async generateEmbeddings(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.ai.models.embedContent({
      model: this.modelName,
      contents: texts,
    });

    if (response.embeddings) {
      return response.embeddings.map((e: any) => e.values);
    }
    
    const singleEmbedding = (response as any).embedding;
    if (singleEmbedding?.values) {
      return [singleEmbedding.values];
    }
    
    throw new Error('Failed to generate embeddings from Gemini API');
  }
}
export default GeminiEmbeddingService;
