import { IContextWindowService, ContextEntry, LiveApiContext, SessionContext } from './interface.js';

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Per-session multimodal context window.
 *
 * State is stored in a Map keyed by `sessionId` so concurrent calls never
 * share memory summaries or tool results. Idle sessions are evicted after
 * DEFAULT_TTL_MS to prevent unbounded growth.
 */
export class ContextWindowService implements IContextWindowService {
  private sessions = new Map<string, { createdAt: number; lastTouchedAt: number; data: SessionContext }>();
  private maxToolResults: number = 10;
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private touch(sessionId: string): SessionContext | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    entry.lastTouchedAt = Date.now();
    return entry.data;
  }

  private ensure(sessionId: string): SessionContext {
    let entry = this.sessions.get(sessionId);
    if (!entry || entry.createdAt + this.ttlMs < Date.now()) {
      entry = {
        createdAt: Date.now(),
        lastTouchedAt: Date.now(),
        data: { memorySummary: '', toolResults: [] },
      };
      this.sessions.set(sessionId, entry);
    }
    return entry.data;
  }

  buildSystemPrompt(userContext?: string): string {
    return `You are VoiceAqar (صوت عقار), an expert Egyptian real estate AI voice assistant.

## Your Personality
- Speak in clear Egyptian Arabic dialect (لهجة مصرية)
- Be warm, professional, and helpful like a trusted real estate advisor
- Use Egyptian expressions naturally (يا فندم، إن شاء الله، حاضر)

## Your Capabilities
- Search properties using semantic similarity (property_retrieval tool)
- Query exact property data from the database (sql_property_query tool)
- Remember user preferences across sessions

## Instructions
- Always use the appropriate tool when the user asks about properties
- Use sql_property_query for exact filters (price, bedrooms, city)
- Use property_retrieval for vague/descriptive queries
- If the user states preferences, acknowledge them

${userContext ? `## User Context\n${userContext}` : ''}`;
  }

  addToolResult(sessionId: string, toolName: string, result: string): void {
    const data = this.ensure(sessionId);
    data.toolResults.push({
      source: `tool:${toolName}`,
      content: result,
      timestamp: new Date(),
    });

    if (data.toolResults.length > this.maxToolResults) {
      data.toolResults = data.toolResults.slice(-this.maxToolResults);
    }
  }

  getToolResults(sessionId: string): ContextEntry[] {
    return [...(this.touch(sessionId)?.toolResults ?? [])];
  }

  injectMemorySummary(sessionId: string, summary: string): void {
    this.ensure(sessionId).memorySummary = summary;
  }

  getContextForLiveApi(sessionId: string, recentTurns?: Array<{ role: string; content: string }>): LiveApiContext {
    const data = this.touch(sessionId) ?? this.ensure(sessionId);
    return {
      systemPrompt: this.buildSystemPrompt(data.memorySummary),
      memorySummary: data.memorySummary,
      recentToolResults: [...data.toolResults],
      recentTurns: recentTurns || [],
    };
  }

  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanupExpiredIds(nowMs: number = Date.now()): void {
    for (const [id, entry] of this.sessions) {
      if (nowMs - entry.lastTouchedAt > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }
}

export default ContextWindowService;