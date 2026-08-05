import { GoogleGenAI } from '@google/genai';
import { env } from '../../../config/env.js';
import type { ISttService } from '../interface.js';

export class GeminiSttService implements ISttService {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string = env.GEMINI_API_KEY, modelName: string = 'gemini-2.0-flash') {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
    prompt: string = 'Please transcribe this audio. Note that the audio is in Egyptian Arabic (لهجة مصرية) or English. Output only the transcription, nothing else.'
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: [
        {
          inlineData: {
            data: audioBuffer.toString('base64'),
            mimeType: mimeType,
          }
        },
        prompt
      ]
    });

    const text = response.text;
    if (text) {
      return text.trim();
    }

    throw new Error('No transcription returned from Gemini Speech-To-Text');
  }
}
export default GeminiSttService;
