import { env } from '../../../config/env.js';
import type { ITtsService } from '../interface.js';

export class ElevenLabsTtsService implements ITtsService {
  private apiKey: string;
  private defaultVoiceId: string;
  private defaultModelId: string;
  
  // Cache the first voice ID that successfully synthesizes to avoid fallback overhead in future calls
  private static cachedWorkingVoiceId: string | null = null;

  constructor(
    apiKey: string = env.ELEVENLABS_API_KEY || '',
    defaultVoiceId: string = 'pNInz6obpgqjVWtJ45dB', // Adam
    defaultModelId: string = 'eleven_multilingual_v2'
  ) {
    this.apiKey = apiKey;
    this.defaultVoiceId = defaultVoiceId;
    this.defaultModelId = defaultModelId;
  }

  async synthesize(text: string, voiceId?: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API Key is missing. Please set ELEVENLABS_API_KEY in your env.');
    }

    const primaryVoiceId = voiceId || ElevenLabsTtsService.cachedWorkingVoiceId || this.defaultVoiceId;
    
    // Candidates to fallback to if the primary voice ID is not found (404/402)
    const voiceCandidates = [
      primaryVoiceId,
      'pNInz6obpgqjVWtJ45dB', // Adam
      'EXAVITQu4vr4xnSDxMaL', // Bella
      '21m00Tcm4TlvDq8ikWAM', // Rachel
      'AZnzlk1XvdvUeBnXmlld', // Domi
      'MF3mGyEYCl7XYWbV9VbO', // Elli
      'TxGEqn7nUaNZTRJjOFxi', // Josh
      'VR6A4mxrYt8sUsCmnHRd', // Arnold
      'ErXwobaYiN019PkySvjV'  // Antoni
    ];

    // Filter out duplicates keeping order
    const uniqueCandidates = Array.from(new Set(voiceCandidates));

    let lastError: Error | null = null;

    for (const candidateId of uniqueCandidates) {
      try {
        console.log(`ElevenLabs: Trying synthesis with voice ID: ${candidateId}...`);
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${candidateId}?output_format=pcm_24000`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: this.defaultModelId,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs Text-To-Speech request failed (Status ${response.status}): ${errorText}`);
        }

        // Cache the successful voice ID
        ElevenLabsTtsService.cachedWorkingVoiceId = candidateId;
        console.log(`ElevenLabs: Success with voice ID: ${candidateId}`);

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);

      } catch (err: any) {
        console.warn(`ElevenLabs warning: Voice ID ${candidateId} failed: ${err.message}`);
        lastError = err;
        // Continue loop to try next candidate if it was a voice-related error (404, 402, voice_not_found)
        if (err.message.includes('404') || err.message.includes('402') || err.message.includes('voice_not_found')) {
          continue;
        } else {
          // If it's a fatal network error or invalid API key, throw immediately
          throw err;
        }
      }
    }

    throw new Error(`All ElevenLabs default voice candidates failed. Last error: ${lastError?.message}`);
  }
}
export default ElevenLabsTtsService;
