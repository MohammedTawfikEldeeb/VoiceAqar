import { IContextWindowService, ContextEntry, LiveApiContext } from './interface.js';

export class ContextWindowService implements IContextWindowService {
  private memorySummary: string = '';
  private toolResults: ContextEntry[] = [];
  private maxToolResults: number = 10;

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

  addToolResult(toolName: string, result: string): void {
    this.toolResults.push({
      source: `tool:${toolName}`,
      content: result,
      timestamp: new Date(),
    });
    
    if (this.toolResults.length > this.maxToolResults) {
      this.toolResults = this.toolResults.slice(-this.maxToolResults);
    }
  }

  getToolResults(): ContextEntry[] {
    return [...this.toolResults];
  }

  injectMemorySummary(summary: string): void {
    this.memorySummary = summary;
  }

  getContextForLiveApi(recentTurns?: Array<{ role: string; content: string }>): LiveApiContext {
    return {
      systemPrompt: this.buildSystemPrompt(this.memorySummary),
      memorySummary: this.memorySummary,
      recentToolResults: [...this.toolResults],
      recentTurns: recentTurns || [],
    };
  }

  reset(): void {
    this.memorySummary = '';
    this.toolResults = [];
  }
}

export default ContextWindowService;
