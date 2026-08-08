import { BaseChatModel, BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { BaseMessage, AIMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { env } from '../../config/env.js';
import { llmService } from './index.js';
import { formatLangChainMessagesToOpenAI } from '../../utils/message_formatter.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class CustomChatModel extends BaseChatModel {
  private _boundTools: any[] = [];

  constructor(fields?: BaseChatModelParams) {
    super(fields || {});
  }

  _llmType() {
    return 'custom_voiceaqar_llm';
  }

  async _generate(
    messages: BaseMessage[],
    options: any,
    runManager?: any
  ): Promise<ChatResult> {
    const provider = env.LLM_PROVIDER;
    const service = llmService as any;

    let url = '';
    let apiKey = '';
    let modelName = '';

    if (provider === 'openrouter') {
      url = `${service.baseUrl || 'https://openrouter.ai/api/v1'}/chat/completions`;
      apiKey = service.apiKey || env.OPENROUTER_API_KEY || '';
      modelName = service.modelName || 'google/gemini-2.5-flash';
    } else if (provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
      apiKey = service.client?.apiKey || env.GROQ_API_KEY || '';
      modelName = service.modelName || 'llama-3.3-70b-versatile';
    } else if (provider === 'gemini') {
      url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      apiKey = service.ai?.apiKey || env.GEMINI_API_KEY || '';
      modelName = service.modelName || 'gemini-2.0-flash';
    } else {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }

    const formattedMessages = formatLangChainMessagesToOpenAI(messages);
    const requestBody: any = {
      model: modelName,
      messages: formattedMessages,
    };

    // Use tools from options (runtime) or from bound tools (bindTools call)
    const tools = options?.tools || this._boundTools;
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CustomChatModel request failed (Status ${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];
    const choiceMsg = choice?.message;

    const content = choiceMsg?.content || '';
    const toolCalls: any[] = [];

    if (choiceMsg?.tool_calls && choiceMsg.tool_calls.length > 0) {
      for (const tc of choiceMsg.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
          type: 'tool_call'
        });
      }
    }

    // LangGraph requires at least content or tool_calls to be non-empty
    const finalContent = (!content && toolCalls.length === 0)
      ? 'معلش، مقدرتش أفهم طلبك. ممكن تعيد تاني؟'
      : content;

    const aiMessage = new AIMessage({
      content: finalContent,
      tool_calls: toolCalls,
    });

    return {
      generations: [
        {
          text: finalContent,
          message: aiMessage,
        }
      ]
    };
  }

  bindTools(tools: any[], _kwargs?: any): this {
    this._boundTools = tools.map((tool: any) => {
      // Already in OpenAI format
      if (tool.type === 'function' && tool.function) {
        return tool;
      }
      // Convert LangChain StructuredTool to OpenAI format using zod-to-json-schema
      let parameters: any = { type: 'object', properties: {} };
      if (tool.schema) {
        try {
          const jsonSchema = zodToJsonSchema(tool.schema);
          // Remove $schema key as OpenAI doesn't accept it
          delete (jsonSchema as any).$schema;
          parameters = jsonSchema;
        } catch (e) {
          console.error(`⚠️ Failed to convert Zod schema for tool ${tool.name}:`, e);
          parameters = { type: 'object', properties: {} };
        }
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters,
        }
      };
    });
    return this;
  }
}

export default CustomChatModel;
