import { env } from '../../../config/env.js';
import type { ILlmService, LlmMessage } from '../interface.js';
import type { z } from 'zod';

export class OpenRouterLlmService implements ILlmService {
  private apiKey: string;
  private baseUrl: string;
  private modelName: string;

  constructor(
    apiKey: string = env.OPENROUTER_API_KEY || '',
    modelName: string = 'google/gemini-2.5-flash',
    baseUrl: string = 'https://openrouter.ai/api/v1'
  ) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.baseUrl = baseUrl;
  }

  async generate(prompt: string, systemInstruction?: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API Key is missing. Please set OPENROUTER_API_KEY in your env.');
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter LLM request failed (Status ${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    systemInstruction?: string
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API Key is missing. Please set OPENROUTER_API_KEY in your env.');
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({
      role: 'user',
      content: `${prompt}\n\nReturn output in JSON format matching this schema.\nSchema: ${JSON.stringify(schema)}`
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter structured LLM request failed (Status ${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('OpenRouter returned an empty structured response');
    }

    return JSON.parse(text) as T;
  }

  async chat(messages: LlmMessage[], systemInstruction?: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API Key is missing. Please set OPENROUTER_API_KEY in your env.');
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: formattedMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter LLM chat request failed (Status ${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }
}
export default OpenRouterLlmService;
