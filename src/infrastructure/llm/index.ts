import { env } from '../../config/env.js';
import type { ILlmService } from './interface.js';
import { GeminiLlmService } from './providers/gemini.js';
import { OpenRouterLlmService } from './providers/openrouter.js';
import { GroqLlmService } from './providers/groq.js';

export class LlmServiceFactory {
  /**
   * Create an instance of LLM service based on provider type.
   * @param provider The provider string ('gemini' | 'openrouter' | 'groq').
   */
  static create(provider: 'gemini' | 'openrouter' | 'groq'): ILlmService {
    switch (provider) {
      case 'gemini':
        return new GeminiLlmService();
      case 'openrouter':
        return new OpenRouterLlmService();
      case 'groq':
        return new GroqLlmService();
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
}

// Export default active LLM service (Gemini only for Live mode)
export const llmService = new GeminiLlmService();
export default llmService;
