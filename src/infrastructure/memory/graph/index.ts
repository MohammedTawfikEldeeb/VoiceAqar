import { Neo4jGraphMemoryService } from './providers/neo4j.js';
import { IGraphMemoryService } from './interface.js';

export class GraphMemoryFactory {
  static create(): IGraphMemoryService {
    return new Neo4jGraphMemoryService();
  }
}

export const graphMemory = GraphMemoryFactory.create();
export default graphMemory;
export * from './interface.js';
