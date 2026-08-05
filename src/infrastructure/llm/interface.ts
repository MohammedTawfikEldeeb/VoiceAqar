import { z } from 'zod';

export interface LlmMessage {
  role: 'user' | 'model' | 'system';
  content: string;
}

export interface ILlmService {
  /**
   * Generate simple text response from a prompt.
   * @param prompt The user prompt.
   * @param systemInstruction Optional system instructions to guide model behavior.
   */
  generate(prompt: string, systemInstruction?: string): Promise<string>;

  /**
   * Generate a structured JSON response matching a specific Zod schema.
   * @param prompt The user prompt.
   * @param schema The Zod schema validating the structured output.
   * @param systemInstruction Optional system instructions to guide model behavior.
   */
  generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    systemInstruction?: string
  ): Promise<T>;

  /**
   * Multi-turn chat generation.
   * @param messages Conversations history.
   * @param systemInstruction Optional system instructions to guide model behavior.
   */
  chat(messages: LlmMessage[], systemInstruction?: string): Promise<string>;
}
export default ILlmService;
