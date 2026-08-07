import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import { propertyRetrievalTool } from '../tools/property_retrieval_tool.js';
import { saveUserProfileTool } from '../tools/user_profile_tool.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { CustomChatModel } from '../infrastructure/llm/custom_chat_model.js';
import { getAgentCallbacks } from '../utils/callbacks.js';
import { getSystemPrompt, syncPromptWithOpik } from './prompt.js';
import { SystemMessage } from '@langchain/core/messages';

// Re-export callback helper for backwards compatibility with gateways
export { getAgentCallbacks };

// 1. Initialize the Custom ChatModel
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

  // Sync latest system prompt from Opik Prompt Library
  await syncPromptWithOpik();

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
  // Evaluate the active system prompt dynamically on every run
  messageModifier: (messages: any[]) => [
    new SystemMessage(getSystemPrompt()),
    ...messages
  ],
});

export { memoryManager };
export default agent;
