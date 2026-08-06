import { GoogleGenAI } from '@google/genai';
import { env } from '../../../config/env.js';
import type { ITtsService } from '../interface.js';

export class GeminiTtsService implements ITtsService {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string = env.GEMINI_API_KEY, modelName: string = 'gemini-2.5-flash-preview-tts') {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async synthesize(text: string, voiceName: string = 'Puck'): Promise<Buffer> {
    // Generate content requesting audio modality
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: `Read the following text out loud in clear Egyptian Arabic (باللهجة المصرية). Do not add any text other than reading it word-for-word: "${text}"`,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName as any,
            }
          }
        }
      } as any
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part?.inlineData?.data) {
      return Buffer.from(part.inlineData.data, 'base64');
    }

    throw new Error('No audio data returned from Gemini Text-To-Speech');
  }
}
export default GeminiTtsService;
