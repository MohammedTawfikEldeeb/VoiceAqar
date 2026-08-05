import { env } from '../../config/env.js';
import type { ITtsService } from './interface.js';
import { GeminiTtsService } from './providers/gemini.js';
import { ElevenLabsTtsService } from './providers/elevenlabs.js';

export class TtsServiceFactory {
  /**
   * Create an instance of TTS service based on provider type.
   * @param provider The provider string ('gemini' | 'elevenlabs').
   */
  static create(provider: 'gemini' | 'elevenlabs'): ITtsService {
    switch (provider) {
      case 'gemini':
        return new GeminiTtsService();
      case 'elevenlabs':
        return new ElevenLabsTtsService();
      default:
        throw new Error(`Unsupported TTS provider: ${provider}`);
    }
  }
}

// Export default active TTS service based on env setting
export const ttsService = TtsServiceFactory.create(env.TTS_PROVIDER as 'gemini' | 'elevenlabs');
export default ttsService;
