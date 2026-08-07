export interface ContextEntry {
  source: string;  // e.g. 'tool:property_retrieval', 'memory:graph'
  content: string;
  timestamp: Date;
}

export interface LiveApiContext {
  systemPrompt: string;
  memorySummary: string;
  recentToolResults: ContextEntry[];
  recentTurns: Array<{ role: string; content: string }>;
}

export interface IContextWindowService {
  addToolResult(toolName: string, result: string): void;
  getToolResults(): ContextEntry[];
  injectMemorySummary(summary: string): void;
  getContextForLiveApi(recentTurns?: Array<{ role: string; content: string }>): LiveApiContext;
  reset(): void;
}

export default IContextWindowService;
