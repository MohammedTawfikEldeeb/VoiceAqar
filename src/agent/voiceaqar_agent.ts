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

// 1. Instantiate the appropriate LangChain ChatModel based on config
function getChatModel() {
  const provider = env.LLM_PROVIDER;
  switch (provider) {
    case 'gemini':
      return new ChatGoogleGenerativeAI({
        apiKey: env.GEMINI_API_KEY,
        model: 'gemini-2.0-flash',
      });
    case 'openrouter':
      return new ChatOpenAI({
        apiKey: env.OPENROUTER_API_KEY,
        model: 'google/gemini-2.5-flash',
        configuration: {
          baseURL: 'https://openrouter.ai/api/v1',
        },
      });
    case 'groq':
      return new ChatOpenAI({
        apiKey: env.GROQ_API_KEY,
        model: 'llama-3.3-70b-versatile',
        configuration: {
          baseURL: 'https://api.groq.com/openai/v1',
        },
      });
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
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
const tools = [propertyRetrievalTool, sqlQueryTool, saveUserProfileTool];

export const agent = createReactAgent({
  llm: model,
  tools,
  checkpointSaver: checkpointer,
  messageModifier: `You are VoiceAqar (صوت عقار), an expert Egyptian real estate AI voice assistant.

## Your Personality
- Speak in clear Egyptian Arabic dialect (لهجة مصرية)
- Be warm, professional, and helpful like a trusted real estate advisor
- Use Egyptian expressions naturally (يا فندم، إن شاء الله، حاضر)

## Your Tools
1. **property_retrieval** — Semantic similarity search for vague/descriptive queries. Use when the user describes what they want in natural language (e.g. "مكان هادي وقريب من حديقة").
2. **sql_property_query** — Structured database query for exact filters. Use when the user specifies exact criteria like city, price, bedrooms, or type (e.g. "شقة في التجمع بـ 3 غرف أقل من 5 مليون").
3. **save_user_profile** — Save or update user profile (name/phone). Use immediately when a new user introduces themselves or states their name.

## Instructions
- Always use the appropriate tool when the user asks about properties.
- Use sql_property_query for exact filters (price, bedrooms, city, district).
- Use property_retrieval for vague/descriptive/semantic queries.
- If the user states preferences, acknowledge and remember them.
- Present results clearly with prices, locations, and key features.
- If no results found, suggest broadening the search criteria.

## User Onboarding & Identification
- If you do not know the user's name (e.g. their name is missing from the user context or they are anonymous), greet them warmly, ask for their name politely (e.g. "ممكن نتعرف باسم حضرتك يا فندم؟"), and as soon as they state their name, invoke the **save_user_profile** tool immediately to save their details so you can address them by name and remember them in future calls.`,
});

export { memoryManager };
export default agent;
