import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import pg from 'pg';
import { env } from '../config/env.js';
import { propertyRetrievalTool } from '../tools/property_retrieval_tool.js';
import { sqlQueryTool } from '../tools/sql_query_tool.js';
import { saveUserProfileTool } from '../tools/user_profile_tool.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { OpikCallbackHandler } from 'opik-langchain';
import type { ChatResult } from '@langchain/core/outputs';

/**
 * Returns callback handlers array for LangChain tracing, including Opik.
 */
export function getAgentCallbacks() {
  const callbacks: any[] = [];
  if (env.OPIK_API_KEY) {
    // Populate environment variables for Opik to avoid compiler options warnings
    process.env.OPIK_API_KEY = env.OPIK_API_KEY;
    if (env.OPIK_WORKSPACE) {
      process.env.OPIK_WORKSPACE = env.OPIK_WORKSPACE;
    }
    process.env.OPIK_PROJECT_NAME = env.OPIK_PROJECT_NAME;
    callbacks.push(new OpikCallbackHandler());
  }
  return callbacks;
}

import { BaseChatModel, BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { BaseMessage, AIMessage } from '@langchain/core/messages';
import { llmService } from '../infrastructure/llm/index.js';

/**
 * Format LangChain messages into standard OpenAI API messages.
 */
function formatLangChainMessagesToOpenAI(messages: BaseMessage[]): any[] {
  return messages.map(msg => {
    const role = msg._getType();
    const formatted: any = {
      content: msg.content,
    };

    if (role === 'system') {
      formatted.role = 'system';
    } else if (role === 'human') {
      formatted.role = 'user';
    } else if (role === 'ai') {
      formatted.role = 'assistant';
      const aiMsg = msg as AIMessage;
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        formatted.tool_calls = aiMsg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args)
          }
        }));
      }
    } else if (role === 'tool') {
      formatted.role = 'tool';
      const toolMsg = msg as any;
      formatted.tool_call_id = toolMsg.tool_call_id;
    }

    return formatted;
  });
}

/**
 * Custom LangChain ChatModel wrapper that routes all requests to our
 * custom LLM infrastructure configuration (supporting Gemini, OpenRouter, and Groq).
 */
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

    // Delegate and extract configuration directly from our custom LLM service factory instances
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

    const aiMessage = new AIMessage({
      content,
      tool_calls: toolCalls,
    });

    return {
      generations: [
        {
          text: content,
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
          const { zodToJsonSchema } = require('zod-to-json-schema');
          const jsonSchema = zodToJsonSchema(tool.schema);
          // Remove $schema key as OpenAI doesn't accept it
          delete jsonSchema.$schema;
          parameters = jsonSchema;
        } catch {
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

// 1. Instantiate the appropriate ChatModel using our custom model wrapper
function getChatModel() {
  const callbacks = getAgentCallbacks();
  return new CustomChatModel({ callbacks });
}

// 2. Initialize the Postgres Pool and Checkpointer Saver
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

export const checkpointer = new PostgresSaver(pool);

// Helper function to setup all infrastructure before agent runs
let isInitialized = false;
export async function initializeAgent() {
  if (isInitialized) return;

  // Setup LangGraph checkpoint tables in PostgreSQL
  await checkpointer.setup();

  // Initialize all memory layers (Neo4j constraints, etc.)
  await memoryManager.initialize();

  isInitialized = true;
}

// 3. Compile the React Agent with all tools and checkpointer
const model = getChatModel();
const tools = [propertyRetrievalTool, saveUserProfileTool];

export const agent = createReactAgent({
  llm: model,
  tools,
  checkpointSaver: checkpointer,
  messageModifier: `You are VoiceAqar, an expert Egyptian real estate AI voice assistant.

## Your Personality
- Speak in clear Egyptian Arabic dialect only.
- Be warm, professional, and helpful like a trusted real estate advisor.
- Use Egyptian expressions naturally like يا فندم، إن شاء الله، حاضر.

## Response Format Rules (CRITICAL)
- You are a VOICE assistant. Your responses will be spoken out loud by a TTS engine.
- NEVER use emojis, symbols, or special characters.
- NEVER use markdown formatting like bold (**), bullet points (-), headers (#), or lists.
- NEVER use numbered lists or structured formatting.
- Keep responses SHORT — 2 to 3 sentences maximum, like a natural phone conversation.
- Write in plain text only, as if you are talking on the phone to a customer.
- When presenting property results, mention them naturally in speech, not as a formatted list.

## Your Tools
1. property_retrieval — Search properties using a text query and optional structured metadata filters. Always use this for any property search.
2. save_user_profile — Save user name/phone when they introduce themselves.

## How to Use property_retrieval (CRITICAL)
When the user asks about properties, you MUST:
1. Extract the descriptive part as the "query" parameter in Arabic.
2. Extract any specific numeric or exact filters from the user request and pass them in the "filter" parameter.

Available filter keys: cityAr, districtAr, compoundName, propertyType, offeringType, bedrooms, bathrooms, areaSqm, price, furnished.

Filter format uses Qdrant syntax. Examples:

User says: "فيلا في مفيدا بحمامين"
Call: { "query": "فيلا في مفيدا", "filter": { "must": [{ "key": "bathrooms", "match": { "value": 2 } }] } }

User says: "شقة في التجمع الخامس بـ 3 غرف"
Call: { "query": "شقة في التجمع الخامس", "filter": { "must": [{ "key": "bedrooms", "match": { "value": 3 } }] } }

User says: "فيلا مفروشة في الشيخ زايد اقل من 5 مليون"
Call: { "query": "فيلا مفروشة في الشيخ زايد", "filter": { "must": [{ "key": "furnished", "match": { "value": true } }, { "key": "price", "range": { "lte": 5000000 } }] } }

User says: "عايز حاجة هادية وقريبة من مدارس"
Call: { "query": "مكان هادي وقريب من مدارس" } (no filter needed, pure semantic search)

Always extract what you can. If the user mentions bedrooms, bathrooms, price range, furnished, or property type, put them in the filter. The text query handles location names, compound names, and descriptive preferences.

## Instructions
- Always use property_retrieval when the user asks about properties.
- If no results found, suggest broadening the criteria in a short sentence.
- If you do not know the user's name, ask for it politely and immediately save it using save_user_profile.`,
});

export { memoryManager };
export default agent;
