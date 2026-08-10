export interface ContextEntry {
  source: string;  // e.g. 'tool:property_retrieval', 'memory:graph'
  content: string;
  timestamp: Date;
}

export interface SessionContext {
  memorySummary: string;
  toolResults: ContextEntry[];
}

export interface LiveApiContext {
  systemPrompt: string;
  memorySummary: string;
  recentToolResults: ContextEntry[];
  recentTurns: Array<{ role: string; content: string }>;
}

export interface IContextWindowService {
  addToolResult(sessionId: string, toolName: string, result: string): void;
  getToolResults(sessionId: string): ContextEntry[];
  injectMemorySummary(sessionId: string, summary: string): void;
  getContextForLiveApi(
    sessionId: string,
    recentTurns?: Array<{ role: string; content: string }>
  ): LiveApiContext;
  reset(sessionId: string): void;
  cleanupExpiredIds(nowMs?: number): void;
}

export default IContextWindowService;