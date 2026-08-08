import type { ITtsService } from './interface.js';

/**
 * Resilient TTS service that tries primary provider first (Gemini),
 * then automatically falls back to secondary (ElevenLabs) on failure.
 */
export class ResilientTtsService implements ITtsService {
  private primary: ITtsService;
  private fallback: ITtsService;

  constructor(primary: ITtsService, fallback: ITtsService) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async synthesize(text: string, voiceName?: string): Promise<Buffer> {
    try {
      console.log('🔊 Attempting TTS with primary service (Gemini)...');
      return await this.primary.synthesize(text, voiceName);
    } catch (primaryErr: any) {
      console.warn(`⚠️ Primary TTS failed: ${primaryErr.message}. Failing over to ElevenLabs...`);
      try {
        return await this.fallback.synthesize(text);
      } catch (fallbackErr: any) {
        throw new Error(
          `Both TTS services failed. Primary: ${primaryErr.message} | Fallback: ${fallbackErr.message}`
        );
      }
    }
  }
}

export default ResilientTtsService;
