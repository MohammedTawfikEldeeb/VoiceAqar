import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { env } from '../config/env.js';
import { agentTools } from '../tools/registry.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { embeddingService } from '../infrastructure/embeddings/index.js';
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

import { pool } from '../config/db.js';

export const checkpointer = new PostgresSaver(pool);

// Helper function to setup all infrastructure before agent runs
let isInitialized = false;
export async function initializeAgent() {
  if (isInitialized) return;

  // Setup LangGraph checkpoint tables in PostgreSQL
  await checkpointer.setup();

  // Sync latest system prompt from Opik Prompt Library
  await syncPromptWithOpik();

  // Preload the embedding model. Awaiting this blocks server startup until the model
  // is fully loaded in memory, preventing main-thread event loop blocks during the first client call.
  console.log(' Warming up embedding model (this may take a few seconds)...');
  try {
    await embeddingService.warmup();
    console.log(' Embedding model warmed up successfully!');
  } catch (err) {
    console.warn(' Embedding model warmup failed (will load lazily on first query):', err);
  }

  // Initialize all memory layers (Neo4j constraints, etc.)
  await memoryManager.initialize();

  isInitialized = true;
}

// 3. Compile the React Agent with all tools and checkpointer
const model = getChatModel();
const tools = agentTools;

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
