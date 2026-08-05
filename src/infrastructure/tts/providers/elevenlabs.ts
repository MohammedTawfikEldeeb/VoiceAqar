import { env } from '../../../config/env.js';
import type { ITtsService } from '../interface.js';

export class ElevenLabsTtsService implements ITtsService {
  private apiKey: string;
  private defaultVoiceId: string;
  private defaultModelId: string;

  constructor(
    apiKey: string = env.ELEVENLABS_API_KEY || '',
    defaultVoiceId: string = '21m00Tcm4TlvDq8ikWAM', // Rachel (Multilingual)
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

    const activeVoiceId = voiceId || this.defaultVoiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${activeVoiceId}`;

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

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
export default ElevenLabsTtsService;
