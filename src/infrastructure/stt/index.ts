import { env } from '../../config/env.js';
import type { ISttService } from './interface.js';
import { GeminiSttService } from './providers/gemini.js';
import { ElevenLabsSttService } from './providers/elevenlabs.js';
import { OpenRouterSttService } from './providers/openrouter.js';

export class SttServiceFactory {
  /**
   * Create an instance of STT service based on provider type.
   * @param provider The provider string ('gemini' | 'elevenlabs' | 'openrouter').
   */
  static create(provider: 'gemini' | 'elevenlabs' | 'openrouter'): ISttService {
    switch (provider) {
      case 'gemini':
        return new GeminiSttService();
      case 'elevenlabs':
        return new ElevenLabsSttService();
      case 'openrouter':
        return new OpenRouterSttService();
      default:
        throw new Error(`Unsupported STT provider: ${provider}`);
    }
  }
}

// Export default active STT service based on env setting
export const sttService = SttServiceFactory.create(env.STT_PROVIDER as 'gemini' | 'elevenlabs' | 'openrouter');
export default sttService;
