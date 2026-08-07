import { env } from '../config/env.js';
import { OpikCallbackHandler } from 'opik-langchain';


export function getAgentCallbacks() {
  const callbacks: any[] = [];
  if (env.OPIK_API_KEY) {
    process.env.OPIK_API_KEY = env.OPIK_API_KEY;
    if (env.OPIK_WORKSPACE) {
      process.env.OPIK_WORKSPACE = env.OPIK_WORKSPACE;
    }
    process.env.OPIK_PROJECT_NAME = env.OPIK_PROJECT_NAME;
    callbacks.push(new OpikCallbackHandler());
  }
  return callbacks;
}
