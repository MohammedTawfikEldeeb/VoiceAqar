import { env } from '../../config/env.js';
import type { ISttService } from './interface.js';
import { GeminiSttService } from './providers/gemini.js';
import { ElevenLabsSttService } from './providers/elevenlabs.js';

export class SttServiceFactory {
  /**
   * Create an instance of STT service based on provider type.
   * @param provider The provider string ('gemini' | 'elevenlabs').
   */
  static create(provider: 'gemini' | 'elevenlabs'): ISttService {
    switch (provider) {
      case 'gemini':
        return new GeminiSttService();
      case 'elevenlabs':
        return new ElevenLabsSttService();
      default:
        throw new Error(`Unsupported STT provider: ${provider}`);
    }
  }
}

// Export default active STT service based on env setting
export const sttService = SttServiceFactory.create(env.STT_PROVIDER as 'gemini' | 'elevenlabs');
export default sttService;
