import { env } from '../config/env.js';
import { OpikCallbackHandler } from 'opik-langchain';

// Singleton instance to prevent "Parent not found" context errors during asynchronous boundary crossing
let opikHandlerInstance: OpikCallbackHandler | null = null;

/**
 * Returns callback handlers array for LangChain tracing, using a singleton Opik handler.
 */
export function getAgentCallbacks() {
  const callbacks: any[] = [];
  if (env.OPIK_API_KEY) {
    if (!env.OPIK_WORKSPACE) {
      console.warn('⚠️ Opik API Key is configured, but OPIK_WORKSPACE is empty in your .env file. Opik tracing is disabled to prevent startup crashes. Please set OPIK_WORKSPACE to your Comet workspace name.');
      return callbacks;
    }
    // Populate environment variables for Opik to avoid compiler options warnings
    process.env.OPIK_API_KEY = env.OPIK_API_KEY;
    process.env.OPIK_WORKSPACE = env.OPIK_WORKSPACE;
    process.env.OPIK_PROJECT_NAME = env.OPIK_PROJECT_NAME;
    
    if (!opikHandlerInstance) {
      opikHandlerInstance = new OpikCallbackHandler();
    }
    callbacks.push(opikHandlerInstance);
  }
  return callbacks;
}
