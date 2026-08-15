import { workingMemory } from './working/index.js';
import { relationalMemory } from './relational/index.js';
import { graphMemory } from './graph/index.js';
import { contextWindow } from './context/index.js';
import { getSystemPrompt } from '../../agent/prompt.js';
import type { IWorkingMemoryService } from './working/interface.js';
import type { IRelationalMemoryService } from './relational/interface.js';
import type { IGraphMemoryService } from './graph/interface.js';
import type { IContextWindowService } from './context/interface.js';
import { db } from '../../config/db.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';



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
  async getAgentContext(sessionId: string, userId?: string, personalitySection?: string): Promise<{
    systemPrompt: string;
    recentTurns: Array<{ role: string; content: string }>;
  }> {
    // 1. Get recent turns from Redis working memory
    const recentTurns = await this.working.getRecentTurns(sessionId, 10);

    // 2. If user is known, refresh context from graph memory
    let memorySummary = '';
    if (userId) {
      const userContext = await this.graph.getUserContext(userId);
      memorySummary = userContext;
      this.context.injectMemorySummary(sessionId, userContext);
    }

    // 3. Look up user details in Postgres to identify if name is known
    let phone: string | undefined = undefined;
    let userName: string | undefined = undefined;

    if (userId) {
      try {
        const pgUsers = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
        if (pgUsers.length > 0) {
          phone = pgUsers[0].phoneNumber || undefined;
          userName = pgUsers[0].name || undefined;
        }
      } catch (err) {
        console.warn('Failed to load user info from postgres in getAgentContext:', err);
      }
    }

    let userGreetingInstruction = '';
    if (phone) {
      if (!userName || userName === 'anonymous') {
        userGreetingInstruction = `## User Identity Context
- We do NOT know the user's name yet.
- The user's phone number is already known to the system: "${phone}".
- You MUST ask the user for their name (e.g. "ممكن أعرف اسم حضرتك يا فندم؟").
- Do NOT ask the user for their phone number, as we already have it.
- Once the user shares their name, you MUST call the "save_user_profile" tool passing their name, the phone number "${phone}", and the active user ID "${userId || ''}".`;
      } else {
        userGreetingInstruction = `## User Identity Context
- The user's name is "${userName}".
- The user's phone number is "${phone}".
- You already know the user's name and phone number.
- Do NOT ask them for their name or phone number.
- Address them by their name (e.g. "يا فندم ${userName}") and proceed with their request.`;
      }
    }

    // 4. Build the system prompt from the active real prompt (prompt.ts)
    //    enriched with the graph memory summary (user preferences/budget/history).
    const basePrompt = getSystemPrompt(personalitySection);
    let systemPrompt = basePrompt;

    if (userGreetingInstruction) {
      systemPrompt += `\n\n${userGreetingInstruction}`;
    }
    if (memorySummary && memorySummary.trim() !== 'No user context available.') {
      systemPrompt += `\n\n## User Context (from memory)\n${memorySummary}`;
    }

    return {
      systemPrompt,
      recentTurns,
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
