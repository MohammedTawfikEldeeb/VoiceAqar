// =============================================================================
// Memory Infrastructure — Barrel Exports
// =============================================================================

// Layer 1: Working & Session Memory (Redis)
export { workingMemory, WorkingMemoryFactory } from './working/index.js';
export type { IWorkingMemoryService } from './working/interface.js';

// Layer 2: Relational & Structured Memory (PostgreSQL)
export { relationalMemory, RelationalMemoryFactory } from './relational/index.js';
export type { IRelationalMemoryService, PropertyFilter } from './relational/interface.js';

// Layer 3: Semantic Memory (Qdrant) — re-exports
export { vectorDbService, embeddingService } from './semantic/index.js';

// Layer 4: Preference & Relationship Memory (Neo4j)
export { graphMemory, GraphMemoryFactory } from './graph/index.js';
export type { IGraphMemoryService, UserPreference, UserBudget, PropertyInteraction } from './graph/interface.js';

// Layer 5: Multimodal Context Window (In-Memory)
export { contextWindow, ContextWindowFactory } from './context/index.js';
export type { IContextWindowService, ContextEntry, LiveApiContext } from './context/interface.js';

// Orchestrator
export { MemoryManager } from './memory_manager.js';

// Default singleton instance
import { MemoryManager } from './memory_manager.js';
export const memoryManager = new MemoryManager();
export default memoryManager;
