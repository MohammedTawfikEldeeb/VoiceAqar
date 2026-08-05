import { GoogleGenAI } from '@google/genai';
import { env } from '../../../config/env.js';
import type { ILlmService, LlmMessage } from '../interface.js';
import type { z } from 'zod';

export class GeminiLlmService implements ILlmService {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string = env.GEMINI_API_KEY, modelName: string = 'gemini-2.0-flash') {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async generate(prompt: string, systemInstruction?: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: systemInstruction ? { systemInstruction } : undefined,
    });
    return response.text || '';
  }

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    systemInstruction?: string
  ): Promise<T> {
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema as any,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty structured response');
    }
    return JSON.parse(text) as T;
  }

  async chat(messages: LlmMessage[], systemInstruction?: string): Promise<string> {
    const geminiContents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'model' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      }));

    const systemContents = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n');

    const activeSystemInstruction = [systemInstruction, systemContents]
      .filter(Boolean)
      .join('\n');

    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: geminiContents,
      config: activeSystemInstruction ? { systemInstruction: activeSystemInstruction } : undefined,
    });

    return response.text || '';
  }
}
export default GeminiLlmService;
