import { env } from '../../../config/env.js';
import type { ISttService } from '../interface.js';

export class ElevenLabsSttService implements ISttService {
  private apiKey: string;
  private defaultModelId: string;

  constructor(
    apiKey: string = env.ELEVENLABS_API_KEY || '',
    defaultModelId: string = 'scribe_v2'
  ) {
    this.apiKey = apiKey;
    this.defaultModelId = defaultModelId;
  }

  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
    prompt?: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API Key is missing. Please set ELEVENLABS_API_KEY in your env.');
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append('file', blob, 'audio.wav');
    formData.append('model_id', this.defaultModelId);
    
    // Scribe v2 supports diarization and prompt inputs if supported by ElevenLabs API parameters
    // In Scribe REST API, prompt is optional.
    if (prompt) {
      // Scribe transcription API uses 'prompt' key for guidance or context
      formData.append('prompt', prompt);
    }

    const url = 'https://api.elevenlabs.io/v1/speech-to-text';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs Speech-To-Text request failed (Status ${response.status}): ${errorText}`);
    }

    const data = await response.json() as { text?: string };
    if (data.text !== undefined) {
      return data.text.trim();
    }

    throw new Error('No transcription returned from ElevenLabs Speech-To-Text');
  }
}
export default ElevenLabsSttService;
