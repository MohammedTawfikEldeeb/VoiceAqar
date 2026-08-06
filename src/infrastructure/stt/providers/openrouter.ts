import { env } from '../../../config/env.js';
import type { ISttService } from '../interface.js';

export class OpenRouterSttService implements ISttService {
  private apiKey: string;
  private defaultModelId: string;
  private baseUrl: string;

  constructor(
    apiKey: string = env.OPENROUTER_API_KEY || '',
    defaultModelId: string = 'openai/whisper-large-v3',
    baseUrl: string = 'https://openrouter.ai/api/v1'
  ) {
    this.apiKey = apiKey;
    this.defaultModelId = defaultModelId;
    this.baseUrl = baseUrl;
  }

  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
    prompt?: string
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API Key is missing. Please set OPENROUTER_API_KEY in your env.');
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', this.defaultModelId);
    
    if (prompt) {
      formData.append('prompt', prompt);
    } else {
      // Guide the model to transcribe in Egyptian Arabic
      formData.append('prompt', 'الكلام باللهجة المصرية العامية. يرجى كتابة النص بدقة.');
    }

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter Speech-To-Text request failed (Status ${response.status}): ${errorText}`);
    }

    const data = await response.json() as { text?: string };
    if (data.text !== undefined) {
      return data.text.trim();
    }

    throw new Error('No transcription returned from OpenRouter Speech-To-Text');
  }
}
export default OpenRouterSttService;
