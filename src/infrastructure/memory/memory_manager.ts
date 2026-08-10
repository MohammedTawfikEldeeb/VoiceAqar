import { workingMemory } from './working/index.js';
import { relationalMemory } from './relational/index.js';
import { graphMemory } from './graph/index.js';
import { contextWindow } from './context/index.js';
import type { IWorkingMemoryService } from './working/interface.js';
import type { IRelationalMemoryService } from './relational/interface.js';
import type { IGraphMemoryService } from './graph/interface.js';
import type { IContextWindowService } from './context/interface.js';


export class MemoryManager {
  public working: IWorkingMemoryService;
  public relational: IRelationalMemoryService;
  public graph: IGraphMemoryService;
  public context: IContextWindowService;

  private isInitialized = false;

  constructor(
    workingMem: IWorkingMemoryService = workingMemory,
    relationalMem: IRelationalMemoryService = relationalMemory,
    graphMem: IGraphMemoryService = graphMemory,
    contextWin: IContextWindowService = contextWindow,
  ) {
    this.working = workingMem;
    this.relational = relationalMem;
    this.graph = graphMem;
    this.context = contextWin;
  }

  /**
   * Initialize all memory layers that require setup.
   * Should be called once at application startup.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Initialize Neo4j constraints/indexes
    await this.graph.initialize();

    this.isInitialized = true;
    console.log('MemoryManager initialized (Neo4j constraints created)');
  }

  /**
   * Called when a new voice call starts.
   * Creates a Redis working session and loads user preferences from the knowledge graph
   * into the context window.
   */
  async onCallStart(sessionId: string, userId?: string): Promise<void> {
    // 1. Create transient working session in Redis
    await this.working.createSession(sessionId, {
      userId: userId || 'anonymous',
      startedAt: new Date().toISOString(),
    });

    // 2. If user is known, load their preferences from Neo4j into context
    if (userId) {
      await this.graph.upsertUser(userId);
      const userContext = await this.graph.getUserContext(userId);
      this.context.injectMemorySummary(sessionId, userContext);
    }

    console.log(`Call started: session=${sessionId}, user=${userId || 'anonymous'}`);
  }

  /**
   * Called when the user sends a message during the call.
   * Pushes the turn to the Redis sliding window.
   */
  async onUserMessage(sessionId: string, message: string, userId?: string): Promise<void> {
    // Push to Redis sliding window
    await this.working.pushTurn(sessionId, 'user', message);

    // Optionally record the search query in the knowledge graph
    if (userId && message.length > 5) {
      await this.graph.addSearchHistory(userId, message);
    }
  }

  /**
   * Called when the agent produces a response.
   * Pushes the agent turn to the Redis sliding window.
   */
  async onAgentResponse(sessionId: string, response: string): Promise<void> {
    await this.working.pushTurn(sessionId, 'model', response);
  }

  /**
   * Called when a tool produces a result.
   * Stores the result in the in-memory context window and Redis.
   */
  async onToolResult(sessionId: string, toolName: string, result: string): Promise<void> {
    // Store in the session-scoped context window for the Live API
    this.context.addToolResult(sessionId, toolName, result);

    // Also record in Redis turns as a tool response
    await this.working.pushTurn(sessionId, 'tool', `[${toolName}]: ${result.substring(0, 500)}`);
  }

  /**
   * Called when the voice call ends.
   * Cleans up the Redis session and resets the context window.
   */
  async onCallEnd(sessionId: string, userId?: string): Promise<void> {
    // Clean up transient Redis session
    await this.working.deleteSession(sessionId);

    // Reset the session-scoped context window
    this.context.reset(sessionId);

    console.log(` Call ended: session=${sessionId}, user=${userId || 'anonymous'}`);
  }

  /**
   * Assemble the full agent context from all memory layers.
   * Returns the system prompt enriched with user preferences and recent conversation.
   */
  async getAgentContext(sessionId: string, userId?: string): Promise<{
    systemPrompt: string;
    recentTurns: Array<{ role: string; content: string }>;
  }> {
    // 1. Get recent turns from Redis working memory
    const recentTurns = await this.working.getRecentTurns(sessionId, 10);

    // 2. If user is known, refresh context from graph memory
    if (userId) {
      const userContext = await this.graph.getUserContext(userId);
      this.context.injectMemorySummary(sessionId, userContext);
    }

    // 3. Build the system prompt with all injected context
    const liveContext = this.context.getContextForLiveApi(sessionId, recentTurns);

    return {
      systemPrompt: liveContext.systemPrompt,
      recentTurns: liveContext.recentTurns,
    };
  }

  /**
   * Record a user's property preference in the knowledge graph.
   */
  async recordPreference(userId: string, preferenceType: string, value: string): Promise<void> {
    await this.graph.addPreference(userId, preferenceType, value);
  }

  /**
   * Record a user's budget range in the knowledge graph.
   */
  async recordBudget(userId: string, min: number, max: number, currency: string = 'EGP'): Promise<void> {
    await this.graph.setBudget(userId, min, max, currency);
  }

  /**
   * Record a user's interaction with a property in the knowledge graph.
   */
  async recordPropertyInteraction(userId: string, propertyId: string, interactionType: string): Promise<void> {
    await this.graph.addPropertyInteraction(userId, propertyId, interactionType);
  }

  /**
   * Evict idle session context windows. Called periodically by the sweeper.
   */
  cleanupIdleSessions(nowMs: number = Date.now()): void {
    this.context.cleanupExpiredIds(nowMs);
  }
}

export default MemoryManager;
