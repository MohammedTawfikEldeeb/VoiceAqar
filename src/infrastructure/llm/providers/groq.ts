import { Groq } from 'groq-sdk';
import { env } from '../../../config/env.js';
import type { ILlmService, LlmMessage } from '../interface.js';
import type { z } from 'zod';

export class GroqLlmService implements ILlmService {
  private client: Groq;
  private modelName: string;

  constructor(apiKey: string = env.GROQ_API_KEY || '', modelName: string = 'openai/gpt-oss-20b') {
    this.client = new Groq({ apiKey });
    this.modelName = modelName;
  }

  async generate(prompt: string, systemInstruction?: string): Promise<string> {
    if (!env.GROQ_API_KEY) {
      throw new Error('Groq API Key is missing. Please set GROQ_API_KEY in your env.');
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
    });

    return completion.choices[0]?.message?.content || '';
  }

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    systemInstruction?: string
  ): Promise<T> {
    if (!env.GROQ_API_KEY) {
      throw new Error('Groq API Key is missing. Please set GROQ_API_KEY in your env.');
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({
      role: 'user',
      content: `${prompt}\n\nReturn output in JSON format matching this schema.\nSchema: ${JSON.stringify(schema)}`
    });

    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      throw new Error('Groq returned empty structured response');
    }

    return JSON.parse(text) as T;
  }

  async chat(messages: LlmMessage[], systemInstruction?: string): Promise<string> {
    if (!env.GROQ_API_KEY) {
      throw new Error('Groq API Key is missing. Please set GROQ_API_KEY in your env.');
    }

    const formattedMessages: any[] = [];
    if (systemInstruction) {
      formattedMessages.push({ role: 'system', content: systemInstruction });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      });
    }

    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages: formattedMessages,
    });

    return completion.choices[0]?.message?.content || '';
  }
}
export default GroqLlmService;
